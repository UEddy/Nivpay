// /api/inbox: payment requests sent straight to a person, sealed so only
// their phones can read them (app/src/lib/inbox.ts).
//
// GET ?account=&what=keys returns { enabled, keys: [{ id, key }] }: the public
//   keys that account's phones published, for sealing a request to it.
// GET ?account= returns { enabled, entries: [{ id, data }] }: the sealed
//   requests waiting for it, newest first. Only ciphertext: no amount, no
//   name, and not who asked.
// POST { action: "key", account, time, signature, key } publishes a phone's
//   public key. POST { action: "unkey", account, time, signature, keyId }
//   removes one. Each is proved by the account's passkey.
// POST { action: "send", from, to, time, signature, digest, data } stores a
//   sealed request. The requester's passkey signed a proof naming them, the
//   person asked and the SHA-256 of the request; this checks that proof,
//   then keeps only the sealed bytes. The phone that opens it checks the same
//   proof again from inside.
//
// Limits: same origin only, bodies over MAX_BODY_BYTES refused unread, at
// most MAX_KEYS keys per account and MAX_WAITING requests per person (the
// oldest go first), requests older than KEEP_MS dropped when read, at most
// WRITES_PER_MINUTE writes a minute on one instance and PER_ACCOUNT_PER_MINUTE
// for one account. Stored private in Vercel Blob; hidden until a Blob store
// is connected. Logs carry the action only, never who asked whom.
//
// proofMessage is a copy of app/src/lib/proof.ts; app/src/api-tests/inbox.test.ts
// fails if the two ever differ.

import { createHash } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";

export const MAX_BODY_BYTES = 12 * 1024;
export const MAX_DATA_BYTES = 8 * 1024;
export const PROOF_WINDOW_S = 300;
export const WRITES_PER_MINUTE = 60;
export const PER_ACCOUNT_PER_MINUTE = 10;
export const MAX_KEYS = 5;
export const MAX_WAITING = 50;
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

// A Blob store connected to the project sets BLOB_STORE_ID, and @vercel/blob
// then signs in with the OIDC token Vercel issues and rotates for each
// function. A BLOB_READ_WRITE_TOKEN, if set, is used instead.
export type InboxEnv = { BLOB_STORE_ID?: string; BLOB_READ_WRITE_TOKEN?: string; ALLOWED_ORIGINS?: string };

/** Where keys and sealed requests live. Vercel Blob in production; a map in tests. */
export interface InboxStore {
  put(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  /** Paths under a prefix. */
  list(prefix: string): Promise<string[]>;
  read(path: string): Promise<Uint8Array | null>;
}

export type Logger = (entry: Record<string, string>) => void;

export const keysPrefix = (account: Address) => `inbox-keys/${getAddress(account)}/`;
export const waitingPrefix = (account: Address) => `inbox/${getAddress(account)}/`;
/** Named by time first, so a listing sorts oldest first. */
const named = (t: number, id: string) => `${String(t).padStart(15, "0")}-${id}.bin`;
const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.bin$/, "");
const timeOf = (path: string) => Number(idOf(path).split("-")[0]);

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

export function originAllowed(request: Request, env: InboxEnv): boolean {
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
/** Clears this instance's counts. For tests. */
export function forgetRecentWrites(): void {
  recent = [];
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const isBase64 = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(v);

async function signedBy(message: string, signature: unknown, who: Address): Promise<boolean> {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
  try {
    return getAddress(await recoverMessageAddress({ message, signature: signature as Hex })) === who;
  } catch {
    return false;
  }
}

export async function handleInbox(
  request: Request,
  env: InboxEnv,
  makeStore: (env: InboxEnv) => InboxStore,
  log: Logger = (e) => console.log(JSON.stringify(e)),
  now: () => number = Date.now,
): Promise<Response> {
  const enabled = Boolean(env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const account = url.searchParams.get("account");
    if (!enabled) return json(200, { enabled: false });
    if (!account || !isAddress(account)) return json(400, { error: "not an account" });
    const who = getAddress(account);
    try {
      const store = makeStore(env);
      if (url.searchParams.get("what") === "keys") {
        const keys = [];
        for (const p of (await store.list(keysPrefix(who))).slice(-MAX_KEYS)) {
          const bytes = await store.read(p);
          if (bytes) keys.push({ id: idOf(p).split("-")[1], key: Buffer.from(bytes).toString("base64") });
        }
        return json(200, { enabled: true, keys });
      }
      const entries = [];
      for (const p of (await store.list(waitingPrefix(who))).reverse()) {
        if (now() - timeOf(p) > KEEP_MS) {
          await store.remove(p).catch(() => {});
          continue;
        }
        const bytes = await store.read(p);
        if (bytes) entries.push({ id: idOf(p), data: Buffer.from(bytes).toString("base64") });
      }
      return json(200, { enabled: true, entries });
    } catch {
      return json(502, { error: "couldn't read, try again" });
    }
  }
  if (request.method !== "POST") return json(405, { error: "use GET or POST" });
  if (!enabled) return json(503, { error: "requests are not set up" });
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
  const { action, time, signature } = body ?? {};
  if (typeof time !== "number" || !Number.isInteger(time)) return json(400, { error: "no time" });
  if (Math.abs(now() / 1000 - time) > PROOF_WINDOW_S) return json(401, { error: "the proof is too old or from the future" });
  const site = url.host;

  let who: Address;
  let write: (store: InboxStore) => Promise<void>;
  if (action === "key" || action === "unkey") {
    const { account, key, keyId } = body;
    if (typeof account !== "string" || !isAddress(account)) return json(400, { error: "not an account" });
    who = getAddress(account);
    if (action === "key") {
      if (!isBase64(key)) return json(400, { error: "no key" });
      const raw = new Uint8Array(Buffer.from(key, "base64"));
      if (raw.length !== 65 || raw[0] !== 4) return json(400, { error: "that isn't a key" });
      const digest = sha256(raw);
      if (!(await signedBy(proofMessage({ subject: "inbox", action: "key", account: who, data: `sha256:${digest}`, time, site }), signature, who))) return json(401, { error: "the proof doesn't check out" });
      const id = digest.slice(0, 16);
      write = async (store) => {
        const existing = await store.list(keysPrefix(who));
        for (const p of existing.filter((p) => idOf(p).endsWith(`-${id}`))) await store.remove(p);
        await store.put(`${keysPrefix(who)}${named(now(), id)}`, raw);
        const kept = existing.filter((p) => !idOf(p).endsWith(`-${id}`));
        for (const p of kept.slice(0, Math.max(0, kept.length + 1 - MAX_KEYS))) await store.remove(p);
      };
    } else {
      if (typeof keyId !== "string" || !/^[0-9a-f]{16}$/.test(keyId)) return json(400, { error: "which key?" });
      if (!(await signedBy(proofMessage({ subject: "inbox", action: "unkey", account: who, data: `key:${keyId}`, time, site }), signature, who))) return json(401, { error: "the proof doesn't check out" });
      write = async (store) => {
        for (const p of (await store.list(keysPrefix(who))).filter((p) => idOf(p).endsWith(`-${keyId}`))) await store.remove(p);
      };
    }
  } else if (action === "send") {
    const { from, to, digest, data } = body;
    if (typeof from !== "string" || !isAddress(from) || typeof to !== "string" || !isAddress(to)) return json(400, { error: "not an account" });
    if (getAddress(from) === getAddress(to)) return json(400, { error: "not to yourself" });
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) return json(400, { error: "no digest" });
    if (!isBase64(data)) return json(400, { error: "no data" });
    const bytes = new Uint8Array(Buffer.from(data, "base64"));
    if (bytes.length < 16 || bytes.length > MAX_DATA_BYTES) return json(413, { error: "that isn't a sealed request" });
    who = getAddress(from);
    const target = getAddress(to);
    const message = proofMessage({ subject: "request", action: "send", account: who, data: `to:${target};sha256:${digest}`, time, site });
    if (!(await signedBy(message, signature, who))) return json(401, { error: "the proof doesn't check out" });
    write = async (store) => {
      const waiting = await store.list(waitingPrefix(target));
      for (const p of waiting.filter((p) => idOf(p).endsWith(`-${digest.slice(0, 32)}`))) await store.remove(p);
      await store.put(`${waitingPrefix(target)}${named(now(), digest.slice(0, 32))}`, bytes);
      for (const p of waiting.slice(0, Math.max(0, waiting.length + 1 - MAX_WAITING))) await store.remove(p);
    };
  } else {
    return json(400, { error: "unknown action" });
  }

  const t = now();
  recent = recent.filter((r) => t - r.at < 60_000);
  if (recent.length >= WRITES_PER_MINUTE || recent.filter((r) => r.account === who).length >= PER_ACCOUNT_PER_MINUTE) {
    return json(429, { error: "too many, try again in a minute" });
  }
  recent.push({ at: t, account: who });
  try {
    await write(makeStore(env));
  } catch {
    log({ event: "failed", action: action as string });
    return json(502, { error: "couldn't store it, try again" });
  }
  log({ event: action as string });
  return json(200, { ok: true });
}

/** Vercel Blob, private: read only through this API. */
export function blobStore(env: InboxEnv): InboxStore {
  const token = env.BLOB_READ_WRITE_TOKEN;
  return {
    put: async (path, bytes) => {
      await put(path, Buffer.from(bytes), { access: "private", contentType: "application/octet-stream", addRandomSuffix: false, allowOverwrite: true, token });
    },
    remove: async (path) => {
      await del(path, { token });
    },
    list: async (prefix) => {
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, token });
        out.push(...page.blobs.map((b) => b.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out.sort();
    },
    read: async (path) => {
      const found = await get(path, { access: "private", token, useCache: false });
      if (!found || found.statusCode !== 200) return null;
      return new Uint8Array(await new Response(found.stream).arrayBuffer());
    },
  };
}

export function GET(request: Request): Promise<Response> {
  return handleInbox(request, process.env as InboxEnv, blobStore);
}

export function POST(request: Request): Promise<Response> {
  return handleInbox(request, process.env as InboxEnv, blobStore);
}
