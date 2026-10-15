// /api/push: this phone's notifications (Web Push), per account.
//
// GET returns { enabled, publicKey }: enabled once the VAPID keys and a Blob
//   store are set, with the public key the phone subscribes with.
// POST { action: "subscribe", account, time, signature, subscription, lang,
//   settings, muted, trusted } keeps this phone's subscription for the
//   account. Proved by the account's passkey over the endpoint's SHA-256, so
//   nobody can send someone else's notifications to their own phone.
// POST { action: "settings", account, endpoint, ... } changes the kinds, the
//   lock screen amounts, the muted accounts and who counts as known. POST
//   { action: "unsubscribe", account, endpoint } removes it. Both need the
//   endpoint itself, which only that phone's browser knows.
//
// Stored private in Vercel Blob, keyed by account: the endpoint and its keys,
// the language, the settings, the accounts muted, and, only while "Pots made
// with me in them" is on, the Account IDs of the person's contacts, never
// their names. Logs carry the action only.
//
// proofMessage is a copy of app/src/lib/proof.ts, and the settings rules of
// app/src/lib/push.ts; app/src/api-tests/push.test.ts fails if they differ.

import { createHash } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";

export const MAX_BODY_BYTES = 16 * 1024;
export const PROOF_WINDOW_S = 300;
export const WRITES_PER_MINUTE = 60;
export const PER_ACCOUNT_PER_MINUTE = 10;
export const MAX_PHONES = 10;

export type PushEnv = { BLOB_STORE_ID?: string; BLOB_READ_WRITE_TOKEN?: string; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string; ALLOWED_ORIGINS?: string };

/** Where subscriptions live. Vercel Blob in production; a map in tests. */
export interface PushStore {
  put(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  read(path: string): Promise<Uint8Array | null>;
}

export type Logger = (entry: Record<string, string>) => void;

// A copy of app/src/lib/push.ts
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
export function cleanAccounts(raw: unknown, max = 200): Address[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((a): a is string => typeof a === "string" && isAddress(a)).map((a) => getAddress(a)))].slice(0, max) : [];
}

/** One phone's subscription for one account, as stored. */
export type Subscription = {
  account: Address;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  lang: string;
  settings: PushSettings;
  muted: Address[];
  /** Contacts' Account IDs, only while potNamesYou is on. */
  trusted: Address[];
  at: number;
};

export const subsPrefix = (account: Address) => `push/${getAddress(account)}/`;
export const endpointId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
const subPath = (account: Address, endpoint: string) => `${subsPrefix(account)}${endpointId(endpoint)}.json`;

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

export const pushEnabled = (env: PushEnv) => Boolean((env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN) && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

let recent: { at: number; account: string }[] = [];
/** Clears this instance's counts. For tests. */
export function forgetRecentWrites(): void {
  recent = [];
}

const LANGS = ["en", "fr", "es", "pt"];
const isB64url = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+=*$/.test(v);
const validEndpoint = (v: unknown): v is string => {
  if (typeof v !== "string" || v.length > 1000) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

async function readSub(store: PushStore, path: string): Promise<Subscription | null> {
  const bytes = await store.read(path);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as Subscription;
  } catch {
    return null;
  }
}

export async function handlePush(
  request: Request,
  env: PushEnv,
  makeStore: (env: PushEnv) => PushStore,
  log: Logger = (e) => console.log(JSON.stringify(e)),
  now: () => number = Date.now,
): Promise<Response> {
  const enabled = pushEnabled(env);
  if (request.method === "GET") return json(200, enabled ? { enabled: true, publicKey: env.VAPID_PUBLIC_KEY } : { enabled: false });
  if (request.method !== "POST") return json(405, { error: "use GET or POST" });
  if (!enabled) return json(503, { error: "notifications are not set up" });
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
  const { action, account } = body ?? {};
  if (typeof account !== "string" || !isAddress(account)) return json(400, { error: "not an account" });
  const who = getAddress(account);

  const t = now();
  recent = recent.filter((r) => t - r.at < 60_000);
  if (recent.length >= WRITES_PER_MINUTE || recent.filter((r) => r.account === who).length >= PER_ACCOUNT_PER_MINUTE) {
    return json(429, { error: "too many changes, try again in a minute" });
  }

  const store = makeStore(env);
  const settingsOf = (b: Record<string, unknown>) => {
    const settings = cleanSettings(b.settings);
    return {
      lang: typeof b.lang === "string" && LANGS.includes(b.lang) ? b.lang : "en",
      settings,
      muted: cleanAccounts(b.muted),
      trusted: settings.kinds.potNamesYou ? cleanAccounts(b.trusted) : [],
    };
  };

  try {
    if (action === "subscribe") {
      const { time, signature, subscription } = body;
      const sub = (subscription ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
      if (!validEndpoint(sub.endpoint) || !isB64url(sub.keys?.p256dh, 80, 100) || !isB64url(sub.keys?.auth, 16, 30)) return json(400, { error: "that isn't a push subscription" });
      if (typeof time !== "number" || !Number.isInteger(time)) return json(400, { error: "no time" });
      if (Math.abs(t / 1000 - time) > PROOF_WINDOW_S) return json(401, { error: "the proof is too old or from the future" });
      if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return json(400, { error: "no signature" });
      const message = proofMessage({ subject: "push", action: "subscribe", account: who, data: `sha256:${createHash("sha256").update(sub.endpoint).digest("hex")}`, time, site: new URL(request.url).host });
      let signer: Address;
      try {
        signer = await recoverMessageAddress({ message, signature: signature as Hex });
      } catch {
        return json(401, { error: "the proof doesn't check out" });
      }
      if (getAddress(signer) !== who) return json(401, { error: "the proof doesn't check out" });
      recent.push({ at: t, account: who });
      const record: Subscription = { account: who, endpoint: sub.endpoint, keys: { p256dh: sub.keys!.p256dh as string, auth: sub.keys!.auth as string }, ...settingsOf(body), at: t };
      const others = (await store.list(subsPrefix(who))).filter((p) => p !== subPath(who, sub.endpoint as string));
      await store.put(subPath(who, sub.endpoint), new TextEncoder().encode(JSON.stringify(record)));
      // The oldest phones go first past MAX_PHONES.
      const dated = await Promise.all(others.map(async (p) => ({ p, at: (await readSub(store, p))?.at ?? 0 })));
      dated.sort((a, b) => a.at - b.at);
      for (const d of dated.slice(0, Math.max(0, dated.length + 1 - MAX_PHONES))) await store.remove(d.p);
      log({ event: "subscribe" });
      return json(200, { ok: true });
    }
    if (action === "settings" || action === "unsubscribe") {
      const { endpoint } = body;
      if (!validEndpoint(endpoint)) return json(400, { error: "which phone?" });
      recent.push({ at: t, account: who });
      const path = subPath(who, endpoint);
      const existing = await readSub(store, path);
      // Only the phone that subscribed knows its endpoint.
      if (!existing || existing.endpoint !== endpoint) return json(404, { error: "not subscribed" });
      if (action === "unsubscribe") await store.remove(path);
      else await store.put(path, new TextEncoder().encode(JSON.stringify({ ...existing, ...settingsOf(body) })));
      log({ event: action });
      return json(200, { ok: true });
    }
  } catch {
    log({ event: "failed", action: String(action) });
    return json(502, { error: "couldn't store it, try again" });
  }
  return json(400, { error: "unknown action" });
}

/** Vercel Blob, private: read only by these functions. */
export function blobStore(env: PushEnv): PushStore {
  const token = env.BLOB_READ_WRITE_TOKEN;
  return {
    put: async (path, bytes) => {
      await put(path, Buffer.from(bytes), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, token });
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

export function GET(request: Request): Promise<Response> {
  return handlePush(request, process.env as PushEnv, blobStore);
}

export function POST(request: Request): Promise<Response> {
  return handlePush(request, process.env as PushEnv, blobStore);
}
