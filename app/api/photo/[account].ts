// GET /api/photo/<account>: serves an account's profile photo from Vercel
// Blob, where it is stored private, so the page's img-src can stay 'self' and
// a photo can only be read here. 404 when the account has none, or photos
// aren't set up (no BLOB_READ_WRITE_TOKEN). JPEG only; nothing is logged.

import { get } from "@vercel/blob";
import { getAddress, isAddress } from "viem";

export type ServeEnv = { BLOB_READ_WRITE_TOKEN?: string };

/** Reads a stored photo's bytes. Vercel Blob in production; a map in tests. */
export type PhotoReader = (path: string, env: ServeEnv) => Promise<ReadableStream<Uint8Array> | null>;

const notFound = () => new Response("not found", { status: 404, headers: { "content-type": "text/plain", "cache-control": "public, max-age=60" } });

export async function servePhoto(request: Request, env: ServeEnv, read: PhotoReader): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("use GET", { status: 405 });
  if (!env.BLOB_READ_WRITE_TOKEN) return notFound();
  const raw = new URL(request.url).pathname.split("/").pop() ?? "";
  if (!isAddress(raw)) return notFound();
  let stream: ReadableStream<Uint8Array> | null;
  try {
    stream = await read(`photos/${getAddress(raw)}.jpg`, env);
  } catch {
    return new Response("try again", { status: 502, headers: { "cache-control": "no-store" } });
  }
  if (!stream) return notFound();
  return new Response(request.method === "HEAD" ? null : stream, {
    status: 200,
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" },
  });
}

export const blobReader: PhotoReader = async (path, env) => {
  const found = await get(path, { access: "private", token: env.BLOB_READ_WRITE_TOKEN });
  return found && found.statusCode === 200 ? found.stream : null;
};

export function GET(request: Request): Promise<Response> {
  return servePhoto(request, process.env as ServeEnv, blobReader);
}
