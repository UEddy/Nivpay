// /api/photo: profile photos, stored in Vercel Blob.
//
// GET returns { enabled }: false until a Blob store is connected
// (BLOB_STORE_ID, or BLOB_READ_WRITE_TOKEN), and the app shows no photos at
// all until then.
// POST { action: "upload", account, time, signature, image } stores a JPEG
//   as this account's photo. POST { action: "remove", account, time,
//   signature } removes it. Each is proved by the account itself: its passkey
//   signs a short message (proofMessage) naming the account, the image's
//   SHA-256 and the time, one fingerprint. The server checks the signature
//   belongs to that account, the time is within 5 minutes and the hash matches
//   the image. Nobody can set or remove another account's photo.
// GET /api/photo/<account> serves it ([account].ts), so the page's img-src
// can stay 'self'.
//
// Limits, in the style of /api/fund:
//  * Same origin only, by the Origin header.
//  * Bodies over MAX_BODY_BYTES (200 KB) are refused unread. JPEG only, by
//    its first and last bytes, and no larger than MAX_IMAGE_BYTES decoded.
//  * At most UPLOADS_PER_MINUTE writes a minute on one server instance, and
//    PER_ACCOUNT_PER_MINUTE for one account.
//
// Photos are stored private: the only way to read one is through this API.
// Logs carry the action, the account and the size, nothing else.
//
// proofMessage is a copy of app/src/lib/proof.ts: this folder builds with
// NodeNext and doesn't import from src. app/src/api-tests/photo.test.ts fails
// if the two ever differ.

import { createHash } from "node:crypto";
import { del, put } from "@vercel/blob";
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";

export const MAX_BODY_BYTES = 200 * 1024;
export const MAX_IMAGE_BYTES = 140 * 1024;
export const PROOF_WINDOW_S = 300;
export const UPLOADS_PER_MINUTE = 30;
export const PER_ACCOUNT_PER_MINUTE = 4;

// A Blob store connected to the project sets BLOB_STORE_ID, and @vercel/blob
// then signs in with the OIDC token Vercel issues and rotates for each
// function; no token is passed, so it is never one that has expired. A
// BLOB_READ_WRITE_TOKEN, if set, is used instead.
export type PhotoEnv = { BLOB_STORE_ID?: string; BLOB_READ_WRITE_TOKEN?: string; ALLOWED_ORIGINS?: string };

/** Where photos live. Vercel Blob in production; a map in tests. */
export interface PhotoStore {
  put(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

export type Logger = (entry: Record<string, string>) => void;

export const photoPath = (account: Address) => `photos/${getAddress(account)}.jpg`;

// ---------------------------------------------------------------------------
// The proof: a copy of app/src/lib/proof.ts
// ---------------------------------------------------------------------------

export type ProofFields = { subject: "photo" | "city"; action: string; account: Address; pot?: string; data: string; time: number; site: string };

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

// ---------------------------------------------------------------------------

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function originAllowed(request: Request, env: PhotoEnv): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const own = new URL(request.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return origin === own || extra.includes(origin);
}

export const isJpeg = (b: Uint8Array) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;

function fromBase64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  return new Uint8Array(Buffer.from(text, "base64"));
}

let recent: { at: number; account: string }[] = [];
/** Clears this instance's counts. For tests. */
export function forgetRecentUploads(): void {
  recent = [];
}

export async function handlePhoto(
  request: Request,
  env: PhotoEnv,
  makeStore: (env: PhotoEnv) => PhotoStore,
  log: Logger = (e) => console.log(JSON.stringify(e)),
  now: () => number = Date.now,
): Promise<Response> {
  const enabled = Boolean(env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN);
  if (request.method === "GET") return json(200, { enabled });
  if (request.method !== "POST") return json(405, { error: "use GET or POST" });
  if (!enabled) return json(503, { error: "photos are not set up" });
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
  const { action, account, time, signature, image } = body ?? {};
  if (action !== "upload" && action !== "remove") return json(400, { error: "unknown action" });
  if (typeof account !== "string" || !isAddress(account)) return json(400, { error: "not an account" });
  if (typeof time !== "number" || !Number.isInteger(time)) return json(400, { error: "no time" });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return json(400, { error: "no signature" });
  const who = getAddress(account);
  if (Math.abs(now() / 1000 - time) > PROOF_WINDOW_S) return json(401, { error: "the proof is too old or from the future" });

  let bytes: Uint8Array | null = null;
  let data = "none";
  if (action === "upload") {
    bytes = typeof image === "string" ? fromBase64(image) : null;
    if (!bytes || !isJpeg(bytes)) return json(415, { error: "JPEG only" });
    if (bytes.length > MAX_IMAGE_BYTES) return json(413, { error: "image too large" });
    data = `sha256:${await sha256Hex(bytes)}`;
  }

  const message = proofMessage({ subject: "photo", action, account: who, data, time, site: new URL(request.url).host });
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
  if (recent.length >= UPLOADS_PER_MINUTE || recent.filter((r) => r.account === who).length >= PER_ACCOUNT_PER_MINUTE) {
    return json(429, { error: "too many changes, try again in a minute" });
  }
  recent.push({ at: t, account: who });

  const store = makeStore(env);
  try {
    if (action === "upload") await store.put(photoPath(who), bytes!);
    else await store.remove(photoPath(who));
  } catch {
    log({ event: "failed", action, account: who });
    return json(502, { error: "couldn't store it, try again" });
  }
  log({ event: action, account: who, bytes: String(bytes?.length ?? 0) });
  return json(200, { ok: true });
}

/** Vercel Blob, private: read only through GET /api/photo/<account>. */
export function blobStore(env: PhotoEnv): PhotoStore {
  const token = env.BLOB_READ_WRITE_TOKEN;
  return {
    put: async (path, bytes) => {
      await put(path, Buffer.from(bytes), { access: "private", contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: true, token });
    },
    remove: async (path) => {
      await del(path, { token });
    },
  };
}

export function GET(request: Request): Promise<Response> {
  return handlePhoto(request, process.env as PhotoEnv, blobStore);
}

export function POST(request: Request): Promise<Response> {
  return handlePhoto(request, process.env as PhotoEnv, blobStore);
}
