// /api/name: display names, stored in Vercel Blob, so a name chosen on one
// phone comes back on another when the same passkey signs in.
//
// GET returns { enabled }: false until a Blob store is connected
// (BLOB_STORE_ID, or BLOB_READ_WRITE_TOKEN), and the app then keeps the name
// on the phone only, as before.
// POST { action: "set", account, time, signature, name } stores the name.
//   POST { action: "remove", account, time, signature } removes it. Each is
//   proved by the account itself: its passkey signs a short message
//   (proofMessage) naming the account, the name's SHA-256 and the time, one
//   fingerprint. The server checks the signature belongs to that account, the
//   time is within 5 minutes and the hash matches the name. Nobody can set or
//   remove another account's name.
// GET /api/name/<account> returns { name } ([account].ts).
//
// The name must already be clean (cleanName, copied below): Unicode
// normalised, no control or invisible formatting characters, single spaces,
// trimmed, 1 to NAME_MAX characters. Anything else is refused, not cleaned
// here, so what is stored is what the phone showed.
//
// Limits, in the style of /api/photo: same origin only; bodies over
// MAX_BODY_BYTES refused unread; at most CHANGES_PER_MINUTE writes a minute on
// one server instance, and PER_ACCOUNT_PER_MINUTE for one account. Stored
// private: the only way to read a name is through this API. Logs carry the
// action and the account, never the name.
//
// proofMessage and cleanName are copies of app/src/lib/proof.ts and
// app/src/lib/accounts.ts: this folder builds with NodeNext and doesn't
// import from src. app/src/api-tests/name.test.ts fails if they ever differ.

import { createHash } from "node:crypto";
import { del, put } from "@vercel/blob";
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";

export const MAX_BODY_BYTES = 2 * 1024;
export const NAME_MAX = 40;
export const PROOF_WINDOW_S = 300;
export const CHANGES_PER_MINUTE = 30;
export const PER_ACCOUNT_PER_MINUTE = 4;

export type NameEnv = { BLOB_STORE_ID?: string; BLOB_READ_WRITE_TOKEN?: string; ALLOWED_ORIGINS?: string };

/** Where names live. Vercel Blob in production; a map in tests. */
export interface NameStore {
  put(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export type Logger = (entry: Record<string, string>) => void;

export const namePath = (account: Address) => `names/${getAddress(account)}.json`;

// ---------------------------------------------------------------------------
// Copies of app/src/lib/proof.ts and app/src/lib/accounts.ts (cleanName)
// ---------------------------------------------------------------------------

export type ProofFields = { subject: "name"; action: string; account: Address; pot?: string; data: string; time: number; site: string };

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

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return createHash("sha256").update(bytes).digest("hex");
}

const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

export function cleanName(raw: string): string {
  const visible = raw.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/gu, " ").trim();
  return Array.from(visible).slice(0, NAME_MAX).join("").trim();
}

// ---------------------------------------------------------------------------

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function originAllowed(request: Request, env: NameEnv): boolean {
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
export function forgetRecentChanges(): void {
  recent = [];
}

export async function handleName(
  request: Request,
  env: NameEnv,
  makeStore: (env: NameEnv) => NameStore,
  log: Logger = (e) => console.log(JSON.stringify(e)),
  now: () => number = Date.now,
): Promise<Response> {
  const enabled = Boolean(env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN);
  if (request.method === "GET") return json(200, { enabled });
  if (request.method !== "POST") return json(405, { error: "use GET or POST" });
  if (!enabled) return json(503, { error: "names are not set up" });
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
  const { action, account, time, signature, name } = body ?? {};
  if (action !== "set" && action !== "remove") return json(400, { error: "unknown action" });
  if (typeof account !== "string" || !isAddress(account)) return json(400, { error: "not an account" });
  if (typeof time !== "number" || !Number.isInteger(time)) return json(400, { error: "no time" });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return json(400, { error: "no signature" });
  const who = getAddress(account);
  if (Math.abs(now() / 1000 - time) > PROOF_WINDOW_S) return json(401, { error: "the proof is too old or from the future" });

  let data = "none";
  let stored = "";
  if (action === "set") {
    if (typeof name !== "string" || !name || cleanName(name) !== name) return json(400, { error: "not a clean name" });
    stored = name;
    data = `sha256:${await sha256Hex(new TextEncoder().encode(name))}`;
  }

  const message = proofMessage({ subject: "name", action, account: who, data, time, site: new URL(request.url).host });
  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message, signature: signature as Hex });
  } catch {
    return json(401, { error: "the proof doesn't check out" });
  }
  if (getAddress(signer) !== who) {
    log({ event: "refused", reason: "signature", account: who });
    return json(401, { error: "the proof doesn't check out" });
  }

  const t = now();
  recent = recent.filter((r) => t - r.at < 60_000);
  if (recent.length >= CHANGES_PER_MINUTE || recent.filter((r) => r.account === who).length >= PER_ACCOUNT_PER_MINUTE) {
    return json(429, { error: "too many changes, try again in a minute" });
  }
  recent.push({ at: t, account: who });

  const store = makeStore(env);
  try {
    if (action === "set") await store.put(namePath(who), JSON.stringify({ name: stored }));
    else await store.remove(namePath(who));
  } catch {
    log({ event: "failed", action, account: who });
    return json(502, { error: "couldn't store it, try again" });
  }
  log({ event: action, account: who });
  return json(200, { ok: true });
}

/** Vercel Blob, private: read only through GET /api/name/<account>. */
export function blobStore(env: NameEnv): NameStore {
  const token = env.BLOB_READ_WRITE_TOKEN;
  return {
    put: async (path, text) => {
      // The shortest cache Blob allows, so a new name reaches another phone within a minute.
      await put(path, text, { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60, token });
    },
    remove: async (path) => {
      await del(path, { token });
    },
  };
}

export function GET(request: Request): Promise<Response> {
  return handleName(request, process.env as NameEnv, blobStore);
}

export function POST(request: Request): Promise<Response> {
  return handleName(request, process.env as NameEnv, blobStore);
}
