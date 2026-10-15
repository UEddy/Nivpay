import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as server from "../../api/photo/index.ts";
import { forgetRecentUploads, handlePhoto, MAX_BODY_BYTES, MAX_IMAGE_BYTES, PER_ACCOUNT_PER_MINUTE, PROOF_WINDOW_S, type PhotoStore } from "../../api/photo/index.ts";
import { servePhoto } from "../../api/photo/[account].ts";
import * as phone from "../lib/proof.ts";

// Throwaway keys made fresh on every run: nothing secret is ever written down.
const me = privateKeyToAccount(generatePrivateKey());
const someoneElse = privateKeyToAccount(generatePrivateKey());
const SITE = "https://nivpay.example";
const NOW = 1_800_000_000_000;
const ENV = { BLOB_READ_WRITE_TOKEN: "test-token" };
const jpeg = (size = 1000) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  b.set([0xff, 0xd9], size - 2);
  return b;
};

function memoryStore() {
  const m = new Map<string, Uint8Array>();
  const store: PhotoStore = { put: async (p, b) => void m.set(p, b), remove: async (p) => void m.delete(p) };
  return { m, store };
}

async function proof(action: "upload" | "remove", bytes: Uint8Array | null, signer = me, account = me.address, time = NOW / 1000) {
  const data = bytes ? `sha256:${await phone.sha256Hex(bytes)}` : "none";
  const message = phone.proofMessage({ subject: "photo", action, account, data, time, site: "nivpay.example" });
  return { action, account, time, signature: await signer.signMessage({ message }), ...(bytes ? { image: phone.toBase64(bytes) } : {}) };
}

function req(body: unknown, origin: string | null = SITE, method = "POST", raw?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request(`${SITE}/api/photo`, { method, headers, body: method === "POST" ? (raw ?? JSON.stringify(body)) : undefined });
}

async function run(r: Request, store: PhotoStore, env: server.PhotoEnv = ENV, now = NOW) {
  const lines: Record<string, string>[] = [];
  const res = await handlePhoto(r, env, () => store, (e) => lines.push(e), () => now);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, lines };
}

beforeEach(() => forgetRecentUploads());

test("the phone and the server write the proof the same way, and hash the same way", async () => {
  const f = { subject: "photo" as const, action: "upload", account: me.address, data: "sha256:ab", time: 5, site: "x" };
  assert.equal(server.proofMessage(f), phone.proofMessage(f));
  assert.equal(server.proofMessage({ ...f, pot: "ausd:7" }), phone.proofMessage({ ...f, pot: "ausd:7" }));
  const b = jpeg(77);
  assert.equal(await server.sha256Hex(b), await phone.sha256Hex(b));
});

test("hidden until a Blob store is connected", async () => {
  const { store } = memoryStore();
  assert.deepEqual((await run(req(null, SITE, "GET"), store, {})).body, { enabled: false });
  assert.deepEqual((await run(req(null, SITE, "GET"), store)).body, { enabled: true });
  assert.equal((await run(req(await proof("upload", jpeg())), store, {})).status, 503);
});

test("an account uploads and removes its own photo, each proved with one signature", async () => {
  const { m, store } = memoryStore();
  const up = await run(req(await proof("upload", jpeg())), store);
  assert.equal(up.status, 200);
  assert.ok(m.has(`photos/${me.address}.jpg`));
  assert.deepEqual(up.lines, [{ event: "upload", account: me.address, bytes: "1000" }], "the account and the size, nothing else");
  const down = await run(req(await proof("remove", null)), store);
  assert.equal(down.status, 200);
  assert.equal(m.size, 0);
});

test("nobody can set or remove another account's photo", async () => {
  const { m, store } = memoryStore();
  m.set(`photos/${me.address}.jpg`, jpeg());
  const forged = await proof("remove", null, someoneElse, me.address);
  assert.equal((await run(req(forged), store)).status, 401);
  assert.ok(m.has(`photos/${me.address}.jpg`));
  const swapped = await proof("upload", jpeg(), me);
  assert.equal((await run(req({ ...swapped, image: phone.toBase64(jpeg(1200)) }), store)).status, 401, "the hash must match the image");
  const otherSite = { ...(await proof("upload", jpeg())) };
  assert.equal((await run(new Request("https://elsewhere.example/api/photo", { method: "POST", headers: { origin: "https://elsewhere.example" }, body: JSON.stringify(otherSite) }), store)).status, 401, "a proof for one site is no good on another");
});

test("a proof goes stale after 5 minutes", async () => {
  const { store } = memoryStore();
  const p = await proof("upload", jpeg());
  assert.equal((await run(req(p), store, ENV, NOW + PROOF_WINDOW_S * 1000 + 1000)).status, 401);
  assert.equal((await run(req(p), store, ENV, NOW - PROOF_WINDOW_S * 1000 - 1000)).status, 401);
  assert.equal((await run(req(p), store, ENV, NOW + PROOF_WINDOW_S * 1000 - 1000)).status, 200);
});

test("JPEG only, small, same origin, and a few changes a minute", async () => {
  const { store } = memoryStore();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  assert.equal((await run(req(await proof("upload", png)), store)).status, 415);
  assert.equal((await run(req(await proof("upload", jpeg(MAX_IMAGE_BYTES + 1))), store)).status, 413);
  assert.equal((await run(req(null, SITE, "POST", "x".repeat(MAX_BODY_BYTES + 1)), store)).status, 413);
  assert.equal((await run(req(await proof("upload", jpeg()), "https://evil.example"), store)).status, 403);
  assert.equal((await run(req(await proof("upload", jpeg()), null), store)).status, 403);
  for (let i = 0; i < PER_ACCOUNT_PER_MINUTE; i++) assert.equal((await run(req(await proof("upload", jpeg())), store)).status, 200);
  assert.equal((await run(req(await proof("upload", jpeg())), store)).status, 429);
});

test("photos are served from this site, and only JPEGs that exist", async () => {
  const stored = new Map<string, Uint8Array>([[`photos/${me.address}.jpg`, jpeg(10)]]);
  const read = async (path: string) => {
    const b = stored.get(path);
    return b ? new Blob([b as Uint8Array<ArrayBuffer>]).stream() : null;
  };
  const ok = await servePhoto(new Request(`${SITE}/api/photo/${me.address.toLowerCase()}`), ENV, read);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.equal(new Uint8Array(await ok.arrayBuffer()).length, 10);
  assert.equal((await servePhoto(new Request(`${SITE}/api/photo/${someoneElse.address}`), ENV, read)).status, 404);
  assert.equal((await servePhoto(new Request(`${SITE}/api/photo/not-an-account`), ENV, read)).status, 404);
  assert.equal((await servePhoto(new Request(`${SITE}/api/photo/${me.address}`), {}, read)).status, 404, "nothing while photos aren't set up");
});
