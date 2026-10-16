// GET /api/name/<account>: an account's display name, from Vercel Blob,
// where it is stored private. Returns { name }, null when the account has
// none or names aren't set up (no BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN).
// Read from the origin, not a cache, so a name changed on one phone is the
// one the next phone gets. Nothing is logged.

import { get } from "@vercel/blob";
import { getAddress, isAddress } from "viem";

export type ServeEnv = { BLOB_STORE_ID?: string; BLOB_READ_WRITE_TOKEN?: string };

/** Reads a stored name's JSON. Vercel Blob in production; a map in tests. */
export type NameReader = (path: string, env: ServeEnv) => Promise<string | null>;

const NAME_MAX = 40;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export async function serveName(request: Request, env: ServeEnv, read: NameReader): Promise<Response> {
  if (request.method !== "GET") return json(405, { error: "use GET" });
  const raw = new URL(request.url).pathname.split("/").pop() ?? "";
  if (!isAddress(raw)) return json(404, { error: "not an account" });
  if (!env.BLOB_STORE_ID && !env.BLOB_READ_WRITE_TOKEN) return json(200, { name: null });
  let text: string | null;
  try {
    text = await read(`names/${getAddress(raw)}.json`, env);
  } catch {
    return json(502, { error: "try again" });
  }
  if (text === null) return json(200, { name: null });
  try {
    const name = (JSON.parse(text) as { name?: unknown }).name;
    // Only what /api/name stored: a short string.
    return json(200, { name: typeof name === "string" && name && Array.from(name).length <= NAME_MAX ? name : null });
  } catch {
    return json(200, { name: null });
  }
}

export const blobReader: NameReader = async (path, env) => {
  const found = await get(path, { access: "private", useCache: false, token: env.BLOB_READ_WRITE_TOKEN });
  if (!found || found.statusCode !== 200 || !found.stream) return null;
  return await new Response(found.stream).text();
};

export function GET(request: Request): Promise<Response> {
  return serveName(request, process.env as ServeEnv, blobReader);
}
