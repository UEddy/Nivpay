// POST /api/fund: tops up a NivPay account with a little testnet MON so that
// people never see gas. Vercel function, Web API signature.
//
// Abuse limits, stated honestly (also in the README):
//  * An address gets a grant only while it holds under THRESHOLD, has sent
//    fewer than MAX_SENT_TXS transactions, and has no contract code.
//  * The worst case per address is about MAX_SENT_TXS grants, 3 MON, if
//    someone deliberately spends each grant away.
//  * New addresses cost nothing to make, so a determined abuser with many
//    addresses can drain the funder down to FLOOR, where granting stops.
//  * Same-origin only, by the Origin header. That stops other websites from
//    using a visitor's browser; it does not stop scripts, which can send any
//    Origin they like.
//  * Two requests for the same address on different server instances at the
//    same moment can both pass the balance check, so one address can get two
//    grants in a race. Nonces never clash: sends are serialized per instance
//    and a nonce conflict is retried with a fresh nonce. On one instance, an
//    address granted in the last RECENT_MS is refused while its grant lands.
//  * At most GRANTS_PER_HOUR grants in all, counted from the funder's own
//    nonce now and about an hour of blocks ago, so the limit holds across
//    every instance with no storage. Fresh addresses can still take that
//    many an hour, but no faster: draining the funder to its floor takes
//    hours, not seconds, which leaves time for the kill switch.
//  * Request bodies over MAX_BODY_BYTES are refused unread.
//
// A broadcast that times out or errors may still have gone out. The grant is
// signed first, so its hash is known before it is sent, and on any broadcast
// error the handler looks for that hash (mined, or pending) and, if it isn't
// seen, sends the same signed bytes once more, which can only ever be that one
// grant. Only when it truly didn't go out is SEND_FAILED answered. One request
// is one signed grant at one nonce: a nonce conflict moves to the next nonce
// only after checking that this request's own grant isn't the one that took it.
//
// The funder key is read only after every check has passed, never when
// FUNDING_ENABLED is off, and never logged. Logs carry the address, the
// amount and the transaction hash, and nothing else from the request.

import {
  createPublicClient,
  formatEther,
  keccak256,
  getAddress,
  http,
  isAddress,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

export const CHAIN_ID = 10143;
export const RPC_URL = "https://testnet-rpc.monad.xyz";
export const GRANT = parseEther("0.1");
export const THRESHOLD = parseEther("0.075");
export const MAX_SENT_TXS = 30;
export const FLOOR = parseEther("1");
export const GRANT_GAS = 21_000n;
/** The most grants in about an hour, from every instance together. A full demo take uses 5. */
export const GRANTS_PER_HOUR = 20;
/** About an hour of Monad testnet blocks, at 0.31 s a block (docs/APP-CONTRACT-MAP.md section 6). */
export const BLOCKS_PER_HOUR = 11_600n;
/** An address granted this recently is refused on the same instance while its grant lands. */
export const RECENT_MS = 120_000;
/** A request is one address in JSON: far under this. */
export const MAX_BODY_BYTES = 1_024;

export type FundEnv = {
  FUNDING_ENABLED?: string;
  FUNDER_PRIVATE_KEY?: string;
  FUNDER_ADDRESS?: string;
  /** Optional, comma separated. For local testing, for example http://localhost:5173. */
  ALLOWED_ORIGINS?: string;
};

export type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

/** Everything the handler needs from the chain, so tests can script it. */
export interface FundChain {
  chainId(): Promise<number>;
  hasCode(address: Address): Promise<boolean>;
  balance(address: Address): Promise<bigint>;
  /** Transactions this address has sent, counting pending ones. */
  sentCount(address: Address): Promise<number>;
  fees(): Promise<Fees>;
  /** Signs GRANT from the funder at this nonce, without sending it: its raw bytes and its hash. The key is read here. */
  signGrant(to: Address, nonce: number, fees: Fees): Promise<{ raw: Hex; hash: Hex }>;
  /** Sends signed bytes. Throws on a nonce conflict, a timeout or any refusal. */
  broadcast(raw: Hex): Promise<void>;
  /** Whether a transaction is mined, waiting to be (pending), or not seen at all. Read failures count as not seen. */
  grantSeen(hash: Hex): Promise<"mined" | "pending" | null>;
  funderNonce(): Promise<number>;
  /** The newest block number. */
  latestBlock(): Promise<bigint>;
  /** Transactions the funder had sent by this block: past state, which the public RPC serves. */
  funderNonceAt(block: bigint): Promise<number>;
}

export type Logger = (entry: Record<string, string>) => void;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function originAllowed(request: Request, env: FundEnv): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const own = new URL(request.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return origin === own || extra.includes(origin);
}

function isNonceConflict(error: unknown): boolean {
  const text = String((error as { details?: string; message?: string })?.details ?? (error as Error)?.message ?? error);
  return /nonce too low|nonce.*(already|used)|already known|replacement transaction underpriced/i.test(text);
}

// Serializes sends within one server instance, so two requests handled by the
// same instance never pick the same nonce.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}
const inFlight = new Set<Address>();
const recent = new Map<Address, number>();
/** Clears the recent grants this instance remembers. For tests, which reuse addresses. */
export function forgetRecentGrants(): void {
  recent.clear();
}

/** How many times, and how far apart, a grant whose broadcast failed is looked for before answering. */
export const LOOKS = 3;
export const LOOK_EVERY_MS = 2_000;

/**
 * After a broadcast that errored: did this grant go out? Looks for its hash a
 * few times, then sends the same signed bytes once more (the same grant, so
 * never a second one) and looks again. "mined" or "pending" if it went out;
 * null only if it truly didn't.
 */
async function wentOut(chain: FundChain, grant: { raw: Hex; hash: Hex }, pause: (ms: number) => Promise<void>): Promise<"mined" | "pending" | null> {
  for (let i = 0; i < LOOKS; i++) {
    const seen = await chain.grantSeen(grant.hash).catch(() => null);
    if (seen) return seen;
    await pause(LOOK_EVERY_MS);
  }
  try {
    await chain.broadcast(grant.raw);
    return "pending";
  } catch (error) {
    // The node already holds these exact bytes: it went out.
    if (/already known/i.test(String((error as { details?: string; message?: string })?.details ?? (error as Error)?.message ?? error))) return "pending";
  }
  return chain.grantSeen(grant.hash).catch(() => null);
}

export async function handleFund(
  request: Request,
  env: FundEnv,
  makeChain: (env: FundEnv) => FundChain,
  log: Logger = (e) => console.log(JSON.stringify(e)),
  now: () => number = Date.now,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "use POST" });

  // Kill switch first: the key is never touched while funding is off.
  if (env.FUNDING_ENABLED !== "true") return json(503, { error: "funding is paused" });

  if (!originAllowed(request, env)) return json(403, { error: "same origin only" });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(413, { error: "request too large" });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: "request too large" });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "send JSON with an address" });
  }
  const raw = (body as { address?: unknown })?.address;
  if (typeof raw !== "string" || !isAddress(raw)) {
    log({ event: "refused", reason: "bad address" });
    return json(400, { error: "not a valid address" });
  }
  const address = getAddress(raw);
  const refuse = (status: number, reason: string) => {
    log({ event: "refused", address, reason });
    return json(status, { error: reason });
  };
  if (address === "0x0000000000000000000000000000000000000000") return refuse(400, "not a valid address");

  if (inFlight.has(address)) return refuse(409, "a grant for this address is already on its way");
  for (const [a, at] of recent) if (now() - at > RECENT_MS) recent.delete(a);
  if (recent.has(address)) return refuse(409, "a grant for this address was just sent");
  inFlight.add(address);
  let stage: "checks" | "send" = "checks";
  try {
    const chain = makeChain(env);
    if ((await chain.chainId()) !== CHAIN_ID) return refuse(503, "wrong chain, refusing to fund");
    if (await chain.hasCode(address)) return refuse(409, "only personal accounts can be funded");
    if ((await chain.balance(address)) >= THRESHOLD) return refuse(409, "this account already has enough");
    if ((await chain.sentCount(address)) >= MAX_SENT_TXS) return refuse(409, "this account has reached its limit");
    // Every instance together: grants in about the last hour, from the funder's own nonce.
    const [latest, nowNonce] = await Promise.all([chain.latestBlock(), chain.funderNonce()]);
    const hourAgo = latest > BLOCKS_PER_HOUR ? latest - BLOCKS_PER_HOUR : 0n;
    if (nowNonce - (await chain.funderNonceAt(hourAgo)) >= GRANTS_PER_HOUR) return refuse(503, "funding is busy, try again later");

    const funder = env.FUNDER_ADDRESS && isAddress(env.FUNDER_ADDRESS) ? getAddress(env.FUNDER_ADDRESS) : undefined;
    if (!funder) return refuse(503, "funding is not configured");
    const fees = await chain.fees();
    const cost = GRANT + GRANT_GAS * fees.maxFeePerGas;
    if ((await chain.balance(funder)) - cost < FLOOR) return refuse(503, "funding is paused, the funder is at its floor");

    stage = "send";
    const { hash, state } = await serialized(async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        const nonce = await chain.funderNonce();
        const grant = await chain.signGrant(address, nonce, fees);
        try {
          await chain.broadcast(grant.raw);
          return { hash: grant.hash, state: "sent" as const };
        } catch (error) {
          lastError = error;
          // A timeout or any other error: it may have gone out all the same. Look before answering.
          // A nonce conflict too: if it was this request's own grant that took the nonce, it is the one.
          const seen = isNonceConflict(error) ? await chain.grantSeen(grant.hash).catch(() => null) : await wentOut(chain, grant, pause);
          if (seen) return { hash: grant.hash, state: seen };
          if (!isNonceConflict(error)) break;
        }
      }
      throw lastError;
    });

    recent.set(address, now());
    log({ event: "grant", address, amountWei: GRANT.toString(), hash, ...(state === "sent" ? {} : { after: `the broadcast errored, then found ${state}` }) });
    // Mined or pending, the app waits for it to be final (app/src/lib/send.ts ensureGas), as for any grant.
    return json(200, { hash, ...(state === "pending" ? { pending: true } : {}) });
  } catch (error) {
    // Only a short category and a sanitized one line detail are logged and
    // returned, never the raw error: it could carry configuration details.
    const code =
      error instanceof FundConfigError ? error.code : stage === "checks" ? "RPC_FAILED" : "SEND_FAILED";
    const detail = error instanceof FundConfigError ? "" : safeDetail(error);
    log({ event: "failed", address, code, detail });
    return json(502, { error: "could not send the grant, try again in a minute", code });
  } finally {
    inFlight.delete(address);
  }
}

/** A configuration problem, with a code that is safe to log and return. */
export class FundConfigError extends Error {
  readonly code: "FUNDER_KEY_MALFORMED" | "FUNDER_KEY_MISMATCH";
  constructor(code: "FUNDER_KEY_MALFORMED" | "FUNDER_KEY_MISMATCH") {
    super(code);
    this.name = "FundConfigError";
    this.code = code;
  }
}

/**
 * Accepts the key as pasted into Vercel: surrounding spaces or newlines, with
 * or without 0x. Anything else is malformed. The key itself never appears in
 * any error.
 */
export function normalizeFunderKey(raw: string | undefined): Hex {
  const key = (raw ?? "").trim();
  const withPrefix = /^[0-9a-fA-F]{64}$/.test(key) ? `0x${key}` : key;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) throw new FundConfigError("FUNDER_KEY_MALFORMED");
  return withPrefix as Hex;
}

/** One short line about a failure, with anything long and hex removed. */
export function safeDetail(error: unknown): string {
  const e = error as { shortMessage?: unknown; message?: unknown; name?: unknown };
  const text = String(e?.shortMessage ?? e?.message ?? e?.name ?? "unknown").split("\n")[0] ?? "";
  return text.replace(/0x[0-9a-fA-F]{40,}/g, "0x…").replace(/[0-9a-fA-F]{40,}/g, "…").slice(0, 120);
}

/** The real chain, on the public testnet RPC. The key is read here, and only here. */
export function liveChain(env: FundEnv): FundChain {
  const transport = http(RPC_URL, { timeout: 10_000, retryCount: 1 });
  const client = createPublicClient({ chain: monadTestnet, transport });
  const funderAddress = getAddress(env.FUNDER_ADDRESS ?? "");
  let signer: ReturnType<typeof privateKeyToAccount> | undefined;
  const funderSigner = () => {
    if (signer) return signer;
    const account = privateKeyToAccount(normalizeFunderKey(env.FUNDER_PRIVATE_KEY));
    if (account.address !== funderAddress) throw new FundConfigError("FUNDER_KEY_MISMATCH");
    signer = account;
    return signer;
  };
  // Broadcasts: one attempt per call, so a timeout is answered by looking for the grant, never by a blind resend.
  const broadcaster = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL, { timeout: 10_000, retryCount: 0 }) });
  return {
    chainId: () => client.getChainId(),
    hasCode: async (a) => ((await client.getCode({ address: a })) ?? "0x") !== "0x",
    balance: (a) => client.getBalance({ address: a }),
    sentCount: (a) => client.getTransactionCount({ address: a, blockTag: "pending" }),
    funderNonce: () => client.getTransactionCount({ address: funderAddress, blockTag: "pending" }),
    latestBlock: () => client.getBlockNumber(),
    funderNonceAt: (block) => client.getTransactionCount({ address: funderAddress, blockNumber: block }),
    fees: async () => {
      const [price, tip] = await Promise.all([client.getGasPrice(), client.estimateMaxPriorityFeePerGas()]);
      const maxFeePerGas = (price * 105n) / 100n;
      return { maxFeePerGas, maxPriorityFeePerGas: tip < maxFeePerGas ? tip : maxFeePerGas };
    },
    signGrant: async (to, nonce, fees) => {
      const raw = await funderSigner().signTransaction({ chainId: CHAIN_ID, type: "eip1559", to, value: GRANT, gas: GRANT_GAS, nonce, ...fees });
      return { raw, hash: keccak256(raw) };
    },
    broadcast: async (raw) => {
      await broadcaster.sendRawTransaction({ serializedTransaction: raw });
    },
    grantSeen: async (hash) => {
      try {
        const tx = await client.getTransaction({ hash });
        return tx.blockNumber === null ? "pending" : "mined";
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// GET /api/fund/status: whether funding is on, the funder's balance, and
// whether the funder key parses and belongs to FUNDER_ADDRESS. Nothing else.
//
// keyMatches is only ever true or false. The key is read to derive its
// address and compare it, and nothing about it (not its length, not why it
// failed) is returned or logged. It exists because "enabled" and a healthy
// balance said nothing about whether grants could actually be signed.
//
// It is answered by this function's GET (vercel.json rewrites
// /api/fund/status here), not a function of its own: the Hobby plan allows
// 12 to a deployment (src/api-tests/functions.test.ts).
// ---------------------------------------------------------------------------

export type StatusEnv = { FUNDING_ENABLED?: string; FUNDER_ADDRESS?: string; FUNDER_PRIVATE_KEY?: string };

/**
 * True only when the key parses the same way /api/fund parses it (surrounding
 * whitespace allowed, 0x optional) and derives FUNDER_ADDRESS. A test keeps
 * this in step with normalizeFunderKey above.
 */
export function funderKeyMatches(env: StatusEnv): boolean {
  try {
    if (!env.FUNDER_ADDRESS || !isAddress(env.FUNDER_ADDRESS)) return false;
    const key = (env.FUNDER_PRIVATE_KEY ?? "").trim();
    const withPrefix = /^[0-9a-fA-F]{64}$/.test(key) ? `0x${key}` : key;
    if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) return false;
    return privateKeyToAccount(withPrefix as Hex).address === getAddress(env.FUNDER_ADDRESS);
  } catch {
    return false;
  }
}

export async function handleStatus(
  env: StatusEnv,
  balanceOf: (address: `0x${string}`) => Promise<bigint>,
): Promise<Response> {
  const enabled = env.FUNDING_ENABLED === "true";
  const keyMatches = funderKeyMatches(env);
  let funderBalance: string | null = null;
  if (env.FUNDER_ADDRESS && isAddress(env.FUNDER_ADDRESS)) {
    try {
      funderBalance = `${formatEther(await balanceOf(getAddress(env.FUNDER_ADDRESS)))} MON`;
    } catch {
      funderBalance = null;
    }
  }
  return new Response(JSON.stringify({ enabled, keyMatches, funderBalance }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function POST(request: Request): Promise<Response> {
  return handleFund(request, process.env as FundEnv, liveChain);
}

/** GET /api/fund/status, rewritten here by vercel.json (handleStatus above). */
export function GET(): Promise<Response> {
  const client = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL, { timeout: 10_000, retryCount: 1 }) });
  return handleStatus(process.env as StatusEnv, (address) => client.getBalance({ address }));
}
