// /api/notify: tells the people a finished action affects, on their phones.
//
// No cron: when someone's own payment, chip-in, pot or pot payment request
// is final, their app calls this with the transaction hash; when they ask
// someone for money, with the request's signed proof. Who to tell comes from
// the chain alone, never from what the caller says:
//
//   POST { kind: "tx", deployment, tx } reads the receipt and checks it is in
//   a finalized block, succeeded and is under MAX_AGE_S old. Then, from its
//   events on NivPay's own contracts and dollars only:
//     * a dollar (or CTK) Transfer: "received" to whoever got it, "sent" to
//       whoever paid it, but not for money going into a pot;
//     * Funded: "chippedIn" to the pot's deciders and payees, not the funder;
//     * Proposed: "askYes" to the pot's deciders, not the one who asked;
//     * PotCreated: "potNamesYou" to the people it names, not its maker, and
//       only those who keep the maker among their contacts.
//   POST { kind: "request", from, to, time, signature, digest } checks the
//   requester's proof, as /api/inbox does, and tells `to`, unless they muted
//   `from`. It never carries the amount or the name: those are sealed.
//
// Each phone gets only the kinds it turned on, in its language, with an
// amount only if it chose "Show amounts on the lock screen". A transaction
// or request is handled once per server instance; at most PER_ACCOUNT_PER_MINUTE
// calls a minute for one account. Unknown, unfinished or failed transactions
// are ignored. If the caller's app closes first, the push is missed; the
// bell in the app still shows it (README, "Notifications on the phone").
//
// The addresses, proofMessage and the push rules are copies of app/src/lib
// (config.ts, proof.ts, push.ts); app/src/api-tests/notify.test.ts fails if
// they differ.

import webpush from "web-push";
import { createPublicClient, getAddress, hexToString, http, isAddress, isAddressEqual, parseEventLogs, recoverMessageAddress, type Address, type Hex, type Log } from "viem";
import { get, list, del } from "@vercel/blob";

// Copies of api/push/index.ts, which this can't import (api files build alone).
export type PushEnv = { BLOB_STORE_ID?: string; BLOB_READ_WRITE_TOKEN?: string; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string; ALLOWED_ORIGINS?: string };
export interface PushStore {
  put(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  read(path: string): Promise<Uint8Array | null>;
}
export const PUSH_KINDS = ["received", "sent", "chippedIn", "askYes", "request", "potNamesYou"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export type PushSettings = { kinds: Record<PushKind, boolean>; amounts: boolean };
export const DEFAULT_SETTINGS: PushSettings = {
  kinds: { received: true, sent: false, chippedIn: true, askYes: true, request: true, potNamesYou: false },
  amounts: false,
};
export function cleanSettings(raw: unknown): PushSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as { kinds?: Record<string, unknown>; amounts?: unknown };
  const kinds = { ...DEFAULT_SETTINGS.kinds };
  for (const k of PUSH_KINDS) if (typeof r.kinds?.[k] === "boolean") kinds[k] = r.kinds[k] as boolean;
  return { kinds, amounts: r.amounts === true };
}
export type Subscription = {
  account: Address;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  lang: string;
  settings: PushSettings;
  muted: Address[];
  trusted: Address[];
  at: number;
};
export const subsPrefix = (account: Address) => `push/${getAddress(account)}/`;
export const pushEnabled = (env: PushEnv) => Boolean((env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN) && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

export const MAX_BODY_BYTES = 2 * 1024;
export const MAX_AGE_S = 15 * 60;
export const PROOF_WINDOW_S = 300;
export const PER_ACCOUNT_PER_MINUTE = 20;
export const MAX_PEOPLE = 50;

// Copies of app/src/lib/config.ts
export const RPC_URL = "https://testnet-rpc.monad.xyz";
export const POTS_AUSD: Address = getAddress("0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB");
export const POTS_TESTUSD: Address = getAddress("0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA");
export const TESTUSD: Address = getAddress("0x9FD60818e0DFee982d677cd72FbC3601Cc2eB6f7");
export const AUSD: Address = getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
export const AUSD_FAUCET: Address = getAddress("0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C");
export const CTK: Address = getAddress("0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D");
export const SETTLEMENT_PAIR: Address = getAddress("0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae");

type Deployment = "ausd" | "testusd";
const DEPLOYMENTS: Record<Deployment, { pots: Address; tokens: { address: Address; decimals: number; symbol: string }[] }> = {
  ausd: { pots: POTS_AUSD, tokens: [{ address: AUSD, decimals: 6, symbol: "$" }, { address: CTK, decimals: 18, symbol: "CTK" }] },
  testusd: { pots: POTS_TESTUSD, tokens: [{ address: TESTUSD, decimals: 6, symbol: "$" }] },
};

const EVENTS = [
  { type: "event", name: "Transfer", inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false }] },
  { type: "event", name: "PotCreated", inputs: [{ name: "potId", type: "uint256", indexed: true }, { name: "creator", type: "address", indexed: true }, { name: "purpose", type: "bytes32", indexed: false }, { name: "approvers", type: "address[]", indexed: false }, { name: "threshold", type: "uint8", indexed: false }, { name: "destinations", type: "address[]", indexed: false }, { name: "destinationLabels", type: "bytes32[]", indexed: false }, { name: "destinationCaps", type: "uint256[]", indexed: false }, { name: "endTime", type: "uint64", indexed: false }] },
  { type: "event", name: "Funded", inputs: [{ name: "potId", type: "uint256", indexed: true }, { name: "funder", type: "address", indexed: true }, { name: "assets", type: "uint256", indexed: false }, { name: "sharesMinted", type: "uint256", indexed: false }] },
  { type: "event", name: "Proposed", inputs: [{ name: "proposalId", type: "uint256", indexed: true }, { name: "potId", type: "uint256", indexed: true }, { name: "proposer", type: "address", indexed: true }, { name: "kind", type: "uint8", indexed: false }, { name: "destIndex", type: "uint16", indexed: false }, { name: "amount", type: "uint256", indexed: false }, { name: "expiresAt", type: "uint64", indexed: false }] },
] as const;

const VIEWS = [
  { type: "function", name: "getPot", stateMutability: "view", inputs: [{ name: "potId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [{ name: "purpose", type: "bytes32" }, { name: "endTime", type: "uint64" }, { name: "threshold", type: "uint8" }, { name: "approverCount", type: "uint8" }, { name: "destinationCount", type: "uint8" }, { name: "closed", type: "bool" }, { name: "frozen", type: "bool" }, { name: "totalAssets", type: "uint256" }, { name: "totalShares", type: "uint256" }] }] },
  { type: "function", name: "getApprovers", stateMutability: "view", inputs: [{ name: "potId", type: "uint256" }], outputs: [{ name: "", type: "address[]" }] },
  { type: "function", name: "getDestinations", stateMutability: "view", inputs: [{ name: "potId", type: "uint256" }], outputs: [{ name: "", type: "tuple[]", components: [{ name: "to", type: "address" }, { name: "label", type: "bytes32" }, { name: "cap", type: "uint256" }, { name: "spent", type: "uint256" }] }] },
] as const;

// The proof: a copy of app/src/lib/proof.ts
export type ProofFields = { subject: "photo" | "city" | "request" | "inbox" | "push"; action: string; account: Address; pot?: string; data: string; time: number; site: string };

export function proofMessage(f: ProofFields): string {
  return [
    `NivPay ${f.subject}`,
    `Action: ${f.action}`,
    `Account: ${getAddress(f.account)}`,
    ...(f.pot !== undefined ? [`Pot: ${f.pot}`] : []),
    `Data: ${f.data}`,
    `Time: ${f.time}`,
    `Site: ${f.site}`,
  ].join("\n");
}

/** What this needs from the chain, all at finalized blocks. A public client in production; a stand-in in tests. */
export interface NotifyChain {
  receipt(tx: Hex): Promise<{ status: "success" | "reverted"; blockNumber: bigint; from: Address; logs: Log[] } | null>;
  finalized(): Promise<{ number: bigint; timestamp: bigint }>;
  blockTime(n: bigint): Promise<bigint>;
  members(pots: Address, potId: bigint, at: bigint): Promise<{ deciders: Address[]; payees: Address[] }>;
  potName(pots: Address, potId: bigint, at: bigint): Promise<string>;
}

/** Sends one push. Returns the push service's status. */
export type Sender = (sub: Subscription, payload: string) => Promise<number>;

/** Someone to tell, and what. */
export type Tell = { account: Address; kind: PushKind; pot?: string; potName?: string; ask?: string; amount?: bigint; decimals?: number; symbol?: string; maker?: Address; from?: Address };

/** Who a final receipt affects, from its events alone. */
export async function whoToTell(chain: NotifyChain, deployment: Deployment, logs: Log[], at: bigint): Promise<Tell[]> {
  const d = DEPLOYMENTS[deployment];
  const out: Tell[] = [];
  const names = new Map<string, string>();
  const nameOf = async (potId: bigint) => {
    const k = potId.toString();
    if (!names.has(k)) names.set(k, await chain.potName(d.pots, potId, at).catch(() => ""));
    return names.get(k)!;
  };
  const skipped = (a: Address) => isAddressEqual(a, d.pots) || isAddressEqual(a, SETTLEMENT_PAIR) || isAddressEqual(a, AUSD_FAUCET) || /^0x0{40}$/i.test(a);
  for (const token of d.tokens) {
    const mine = logs.filter((l) => isAddressEqual(l.address, token.address));
    for (const t of parseEventLogs({ abi: EVENTS, eventName: "Transfer", logs: mine })) {
      const { from, to, value } = t.args;
      const amount = { amount: value, decimals: token.decimals, symbol: token.symbol };
      if (!skipped(to)) out.push({ account: getAddress(to), kind: "received", ...amount });
      // Money into a pot is a chip-in, told below; money to the settlement pair is a payment in another currency.
      if (!skipped(from) && !isAddressEqual(to, d.pots)) out.push({ account: getAddress(from), kind: "sent", ...amount });
    }
  }
  const potLogs = logs.filter((l) => isAddressEqual(l.address, d.pots));
  for (const f of parseEventLogs({ abi: EVENTS, eventName: "Funded", logs: potLogs })) {
    const m = await chain.members(d.pots, f.args.potId, at);
    const potName = await nameOf(f.args.potId);
    for (const a of [...m.deciders, ...m.payees]) {
      if (!isAddressEqual(a, f.args.funder)) out.push({ account: getAddress(a), kind: "chippedIn", pot: f.args.potId.toString(), potName, amount: f.args.assets, decimals: 6, symbol: "$" });
    }
  }
  for (const p of parseEventLogs({ abi: EVENTS, eventName: "Proposed", logs: potLogs })) {
    const m = await chain.members(d.pots, p.args.potId, at);
    const potName = await nameOf(p.args.potId);
    for (const a of m.deciders) {
      if (!isAddressEqual(a, p.args.proposer)) {
        out.push({ account: getAddress(a), kind: "askYes", pot: p.args.potId.toString(), potName, ask: p.args.proposalId.toString(), ...(p.args.kind === 0 ? { amount: p.args.amount, decimals: 6, symbol: "$" } : {}) });
      }
    }
  }
  for (const c of parseEventLogs({ abi: EVENTS, eventName: "PotCreated", logs: potLogs })) {
    const potName = await nameOf(c.args.potId);
    for (const a of [...c.args.approvers, ...c.args.destinations]) {
      if (!isAddressEqual(a, c.args.creator)) out.push({ account: getAddress(a), kind: "potNamesYou", pot: c.args.potId.toString(), potName, maker: getAddress(c.args.creator) });
    }
  }
  // One of each kind per person and pot.
  const seen = new Set<string>();
  return out.filter((t) => {
    const k = `${t.account}:${t.kind}:${t.pot ?? ""}:${t.ask ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** What goes to one phone for one Tell, or null if that phone doesn't want it. Mirrors app/src/lib/push.ts PushPayload. */
export function payloadFor(sub: Subscription, t: Tell): string | null {
  const settings = cleanSettings(sub.settings);
  if (!settings.kinds[t.kind]) return null;
  if (t.kind === "request" && t.from && (sub.muted ?? []).some((m) => isAddressEqual(m, t.from!))) return null;
  if (t.kind === "potNamesYou" && (!t.maker || !(sub.trusted ?? []).some((m) => isAddressEqual(m, t.maker!)))) return null;
  const p: Record<string, unknown> = { k: t.kind, l: sub.lang };
  if (t.pot !== undefined) p.p = t.pot;
  if (t.potName) p.n = t.potName;
  if (t.ask !== undefined) p.r = t.ask;
  if (settings.amounts && t.amount !== undefined) Object.assign(p, { a: t.amount.toString(), d: t.decimals, s: t.symbol });
  return JSON.stringify(p);
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function originAllowed(request: Request, env: PushEnv): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const own = new URL(request.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return origin === own || extra.includes(origin);
}

let recent: { at: number; account: string }[] = [];
const handled = new Set<string>();
/** Clears this instance's memory. For tests. */
export function forgetRecent(): void {
  recent = [];
  handled.clear();
}

async function deliver(store: PushStore, send: Sender, tells: Tell[]): Promise<number> {
  let pushed = 0;
  const people = [...new Set(tells.map((t) => t.account))].slice(0, MAX_PEOPLE);
  for (const account of people) {
    const paths = await store.list(subsPrefix(account)).catch(() => [] as string[]);
    for (const path of paths) {
      const bytes = await store.read(path).catch(() => null);
      if (!bytes) continue;
      let sub: Subscription;
      try {
        sub = JSON.parse(new TextDecoder().decode(bytes)) as Subscription;
      } catch {
        continue;
      }
      for (const t of tells.filter((x) => x.account === account)) {
        const payload = payloadFor(sub, t);
        if (!payload) continue;
        const status = await send(sub, payload).catch((e: { statusCode?: number }) => e?.statusCode ?? 0);
        // Gone: the phone unsubscribed or the browser dropped it.
        if (status === 404 || status === 410) {
          await store.remove(path).catch(() => {});
          break;
        }
        if (status >= 200 && status < 300) pushed += 1;
      }
    }
  }
  return pushed;
}

export async function handleNotify(
  request: Request,
  env: PushEnv,
  chain: NotifyChain,
  makeStore: (env: PushEnv) => PushStore,
  send: Sender,
  log: (e: Record<string, string>) => void = (e) => console.log(JSON.stringify(e)),
  now: () => number = Date.now,
): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "use POST" });
  if (!pushEnabled(env)) return json(200, { enabled: false });
  if (!originAllowed(request, env)) return json(403, { error: "same origin only" });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(413, { error: "request too large" });
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: "request too large" });
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json(400, { error: "send JSON" });
  }
  const t = now();
  recent = recent.filter((r) => t - r.at < 60_000);
  const limited = (who: Address) => recent.filter((r) => r.account === who).length >= PER_ACCOUNT_PER_MINUTE;

  let tells: Tell[];
  if (body.kind === "tx") {
    const { deployment, tx } = body;
    if (deployment !== "ausd" && deployment !== "testusd") return json(400, { error: "which deployment?" });
    if (typeof tx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx)) return json(400, { error: "no transaction" });
    const key = tx.toLowerCase();
    if (handled.has(key)) return json(200, { ok: true, pushed: 0 });
    const receipt = await chain.receipt(tx as Hex).catch(() => null);
    if (!receipt) return json(202, { ignored: "unknown" });
    const fin = await chain.finalized();
    if (receipt.blockNumber > fin.number) return json(202, { ignored: "not final" });
    if (receipt.status !== "success") return json(202, { ignored: "failed" });
    const when = await chain.blockTime(receipt.blockNumber);
    if (BigInt(Math.floor(t / 1000)) - when > BigInt(MAX_AGE_S)) return json(202, { ignored: "too old" });
    if (limited(getAddress(receipt.from))) return json(429, { error: "too many, try again in a minute" });
    recent.push({ at: t, account: getAddress(receipt.from) });
    handled.add(key);
    tells = await whoToTell(chain, deployment, receipt.logs, receipt.blockNumber);
  } else if (body.kind === "request") {
    const { from, to, time, signature, digest } = body;
    if (typeof from !== "string" || !isAddress(from) || typeof to !== "string" || !isAddress(to)) return json(400, { error: "not an account" });
    if (typeof time !== "number" || !Number.isInteger(time) || Math.abs(t / 1000 - time) > PROOF_WINDOW_S) return json(401, { error: "the proof is too old or from the future" });
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest) || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return json(400, { error: "no proof" });
    const message = proofMessage({ subject: "request", action: "send", account: getAddress(from), data: `to:${getAddress(to)};sha256:${digest}`, time, site: new URL(request.url).host });
    let signer: Address;
    try {
      signer = await recoverMessageAddress({ message, signature: signature as Hex });
    } catch {
      return json(401, { error: "the proof doesn't check out" });
    }
    if (!isAddressEqual(signer, from)) return json(401, { error: "the proof doesn't check out" });
    if (handled.has(digest)) return json(200, { ok: true, pushed: 0 });
    if (limited(getAddress(from))) return json(429, { error: "too many, try again in a minute" });
    recent.push({ at: t, account: getAddress(from) });
    handled.add(digest);
    tells = [{ account: getAddress(to), kind: "request", from: getAddress(from) }];
  } else {
    return json(400, { error: "unknown kind" });
  }
  const pushed = await deliver(makeStore(env), send, tells);
  log({ event: String(body.kind), pushed: String(pushed) });
  return json(200, { ok: true, pushed });
}

/** The public testnet RPC, reads at finalized blocks. */
export function liveChain(): NotifyChain {
  const client = createPublicClient({ transport: http(RPC_URL, { retryCount: 2, timeout: 8_000 }) });
  const members = async (pots: Address, potId: bigint, at: bigint) => {
    const [deciders, dests] = await Promise.all([
      client.readContract({ address: pots, abi: VIEWS, functionName: "getApprovers", args: [potId], blockNumber: at }),
      client.readContract({ address: pots, abi: VIEWS, functionName: "getDestinations", args: [potId], blockNumber: at }),
    ]);
    return { deciders: deciders.map((a) => getAddress(a)), payees: dests.map((x) => getAddress(x.to)) };
  };
  return {
    async receipt(tx) {
      const r = await client.getTransactionReceipt({ hash: tx }).catch(() => null);
      return r ? { status: r.status, blockNumber: r.blockNumber, from: getAddress(r.from), logs: r.logs } : null;
    },
    async finalized() {
      const b = await client.getBlock({ blockTag: "finalized" });
      return { number: b.number, timestamp: b.timestamp };
    },
    blockTime: async (n) => (await client.getBlock({ blockNumber: n })).timestamp,
    members,
    async potName(pots, potId, at) {
      const p = await client.readContract({ address: pots, abi: VIEWS, functionName: "getPot", args: [potId], blockNumber: at });
      return hexToString(p.purpose, { size: 32 }).replace(/\u0000+$/u, "").slice(0, 32);
    },
  };
}

export function webPushSender(env: PushEnv): Sender {
  return async (sub, payload) => {
    const res = await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
      TTL: 24 * 60 * 60,
      urgency: "normal",
      vapidDetails: { subject: env.VAPID_SUBJECT!, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! },
    });
    return res.statusCode;
  };
}

/** Vercel Blob, private: subscriptions as /api/push keeps them. Only read and removed here. */
export function blobStore(env: PushEnv): PushStore {
  const token = env.BLOB_READ_WRITE_TOKEN;
  return {
    put: async () => {
      throw new Error("not written here");
    },
    remove: async (path) => {
      await del(path, { token });
    },
    list: async (prefix) => (await list({ prefix, limit: 100, token })).blobs.map((b) => b.pathname),
    read: async (path) => {
      const found = await get(path, { access: "private", token, useCache: false });
      if (!found || found.statusCode !== 200) return null;
      return new Uint8Array(await new Response(found.stream).arrayBuffer());
    },
  };
}

export function POST(request: Request): Promise<Response> {
  const env = process.env as PushEnv;
  return handleNotify(request, env, liveChain(), blobStore, webPushSender(env));
}
