// /api/city: where people in a pot are chipping in from, a city each, opt in.
//
// The phone encrypts each city with a key made from the pot link's fragment,
// which never reaches any server (app/src/lib/cityShare.ts). So this stores
// and returns only ciphertext it can't read, and only people with the pot's
// link can read the cities. Never a position: the phone sends a city and a
// country, sealed. Nothing here touches the chain.
//
// GET ?deployment=&pot= returns { enabled, entries: [{ account, data }] }.
// POST { action: "share", deployment, potId, account, time, signature, data }
//   stores this account's sealed city for this pot. POST { action: "remove",
//   ... } removes it. Each is proved by the account's passkey over the same
//   message as /api/photo, naming the pot and the data's SHA-256: nobody can
//   share or remove a city for someone else.
//
// Limits: same origin only, bodies over MAX_BODY_BYTES refused unread, sealed
// cities over MAX_DATA_BYTES refused, at most WRITES_PER_MINUTE writes a minute
// on one instance and PER_ACCOUNT_PER_MINUTE for one account, at most
// MAX_ENTRIES cities read back for a pot. Stored private in Vercel Blob;
// hidden until BLOB_READ_WRITE_TOKEN is set. Logs carry the action, the pot
// and the account, never the data.
//
// proofMessage is a copy of app/src/lib/proof.ts; app/src/api-tests/city.test.ts
// fails if the two ever differ.

import { createHash } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";

export const MAX_BODY_BYTES = 4 * 1024;
export const MAX_DATA_BYTES = 512;
export const PROOF_WINDOW_S = 300;
export const WRITES_PER_MINUTE = 60;
export const PER_ACCOUNT_PER_MINUTE = 6;
export const MAX_ENTRIES = 50;
const DEPLOYMENTS = ["ausd", "testusd"];

export type CityEnv = { BLOB_READ_WRITE_TOKEN?: string; ALLOWED_ORIGINS?: string };

/** Where sealed cities live. Vercel Blob in production; a map in tests. */
export interface CityStore {
  put(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  /** Paths under a prefix, at most `limit`. */
  list(prefix: string, limit: number): Promise<string[]>;
  read(path: string): Promise<Uint8Array | null>;
}

export type Logger = (entry: Record<string, string>) => void;

export const potPrefix = (deployment: string, potId: string) => `cities/${deployment}/${potId}/`;
const cityPath = (deployment: string, potId: string, account: Address) => `${potPrefix(deployment, potId)}${getAddress(account)}.bin`;

// The proof: a copy of app/src/lib/proof.ts
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

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function originAllowed(request: Request, env: CityEnv): boolean {
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

const validPot = (deployment: unknown, potId: unknown): deployment is string =>
  typeof deployment === "string" && DEPLOYMENTS.includes(deployment) && typeof potId === "string" && /^\d{1,20}$/.test(potId);

export async function handleCity(
  request: Request,
  env: CityEnv,
  makeStore: (env: CityEnv) => CityStore,
  log: Logger = (e) => console.log(JSON.stringify(e)),
  now: () => number = Date.now,
): Promise<Response> {
  const enabled = Boolean(env.BLOB_READ_WRITE_TOKEN);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const deployment = url.searchParams.get("deployment");
    const potId = url.searchParams.get("pot");
    if (!enabled) return json(200, { enabled: false, entries: [] });
    if (!validPot(deployment, potId)) return json(400, { error: "which pot?" });
    try {
      const store = makeStore(env);
      const paths = await store.list(potPrefix(deployment, potId!), MAX_ENTRIES);
      const entries = [];
      for (const p of paths) {
        const account = p.slice(p.lastIndexOf("/") + 1).replace(/\.bin$/, "");
        const bytes = isAddress(account) ? await store.read(p) : null;
        if (bytes) entries.push({ account: getAddress(account), data: Buffer.from(bytes).toString("base64") });
      }
      return json(200, { enabled: true, entries });
    } catch {
      return json(502, { error: "couldn't read the cities, try again" });
    }
  }
  if (request.method !== "POST") return json(405, { error: "use GET or POST" });
  if (!enabled) return json(503, { error: "cities are not set up" });
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
  const { action, deployment, potId, account, time, signature, data } = body ?? {};
  if (action !== "share" && action !== "remove") return json(400, { error: "unknown action" });
  if (!validPot(deployment, potId)) return json(400, { error: "which pot?" });
  if (typeof account !== "string" || !isAddress(account)) return json(400, { error: "not an account" });
  if (typeof time !== "number" || !Number.isInteger(time)) return json(400, { error: "no time" });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return json(400, { error: "no signature" });
  const who = getAddress(account);
  if (Math.abs(now() / 1000 - time) > PROOF_WINDOW_S) return json(401, { error: "the proof is too old or from the future" });

  let bytes: Uint8Array | null = null;
  let digest = "none";
  if (action === "share") {
    if (typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return json(400, { error: "no data" });
    bytes = new Uint8Array(Buffer.from(data, "base64"));
    if (bytes.length < 13 || bytes.length > MAX_DATA_BYTES) return json(413, { error: "that isn't a sealed city" });
    digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  }
  const message = proofMessage({ subject: "city", action, account: who, pot: `${deployment}:${potId as string}`, data: digest, time, site: url.host });
  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message, signature: signature as Hex });
  } catch {
    return json(401, { error: "the proof doesn't check out" });
  }
  if (getAddress(signer) !== who) return json(401, { error: "the proof doesn't check out" });

  const t = now();
  recent = recent.filter((r) => t - r.at < 60_000);
  if (recent.length >= WRITES_PER_MINUTE || recent.filter((r) => r.account === who).length >= PER_ACCOUNT_PER_MINUTE) {
    return json(429, { error: "too many changes, try again in a minute" });
  }
  recent.push({ at: t, account: who });

  const store = makeStore(env);
  try {
    if (action === "share") await store.put(cityPath(deployment, potId as string, who), bytes!);
    else await store.remove(cityPath(deployment, potId as string, who));
  } catch {
    log({ event: "failed", action, deployment, potId: potId as string, account: who });
    return json(502, { error: "couldn't store it, try again" });
  }
  log({ event: action, deployment, potId: potId as string, account: who });
  return json(200, { ok: true });
}

/** Vercel Blob, private: read only through this API. */
export function blobStore(env: CityEnv): CityStore {
  const token = env.BLOB_READ_WRITE_TOKEN;
  return {
    put: async (path, bytes) => {
      await put(path, Buffer.from(bytes), { access: "private", contentType: "application/octet-stream", addRandomSuffix: false, allowOverwrite: true, token });
    },
    remove: async (path) => {
      await del(path, { token });
    },
    list: async (prefix, limit) => (await list({ prefix, limit, token })).blobs.map((b) => b.pathname),
    read: async (path) => {
      const found = await get(path, { access: "private", token, useCache: false });
      if (!found || found.statusCode !== 200) return null;
      return new Uint8Array(await new Response(found.stream).arrayBuffer());
    },
  };
}

export function GET(request: Request): Promise<Response> {
  return handleCity(request, process.env as CityEnv, blobStore);
}

export function POST(request: Request): Promise<Response> {
  return handleCity(request, process.env as CityEnv, blobStore);
}
