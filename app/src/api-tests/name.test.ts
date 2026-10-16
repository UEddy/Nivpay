import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as server from "../../api/name/index.ts";
import { CHANGES_PER_MINUTE, forgetRecentChanges, handleName, MAX_BODY_BYTES, PER_ACCOUNT_PER_MINUTE, PROOF_WINDOW_S, type NameStore } from "../../api/name/index.ts";
import { serveName } from "../../api/name/[account].ts";
import * as phone from "../lib/proof.ts";
import { cleanName, NAME_MAX } from "../lib/accounts.ts";

// Throwaway keys made fresh on every run: nothing secret is ever written down.
const me = privateKeyToAccount(generatePrivateKey());
const someoneElse = privateKeyToAccount(generatePrivateKey());
const SITE = "https://nivpay.example";
const NOW = 1_800_000_000_000;
const ENV = { BLOB_READ_WRITE_TOKEN: "test-token" };

function memoryStore() {
  const m = new Map<string, string>();
  const store: NameStore = { put: async (p, t) => void m.set(p, t), remove: async (p) => void m.delete(p) };
  return { m, store };
}

async function proof(action: "set" | "remove", name: string | null, signer = me, account = me.address, time = NOW / 1000, signedName = name) {
  const data = signedName !== null ? `sha256:${await phone.sha256Hex(new TextEncoder().encode(signedName))}` : "none";
  const message = phone.proofMessage({ subject: "name", action, account, data, time, site: "nivpay.example" });
  return { action, account, time, signature: await signer.signMessage({ message }), ...(name !== null ? { name } : {}) };
}

function req(body: unknown, origin: string | null = SITE, method = "POST", raw?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request(`${SITE}/api/name`, { method, headers, body: method === "POST" ? (raw ?? JSON.stringify(body)) : undefined });
}

async function run(r: Request, store: NameStore, env: server.NameEnv = ENV, now = NOW) {
  const lines: Record<string, string>[] = [];
  const res = await handleName(r, env, () => store, (e) => lines.push(e), () => now);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, lines };
}

beforeEach(() => forgetRecentChanges());

test("the phone and the server write the proof the same way, hash the same way and clean names the same way", async () => {
  const f = { subject: "name" as const, action: "set", account: me.address, data: "sha256:ab", time: 5, site: "x" };
  assert.equal(server.proofMessage(f), phone.proofMessage(f));
  const b = new TextEncoder().encode("Ngozi Ẹ̀kọ́");
  assert.equal(await server.sha256Hex(b), await phone.sha256Hex(b));
  assert.equal(server.NAME_MAX, NAME_MAX);
  const odd = ["  Eddy  ", "Ed‮dy", "a​b", "é", "x".repeat(60), "👩🏽‍💻 Idara", "\n\tTab\u0000", " ", "Ana  María"];
  for (const s of odd) assert.equal(server.cleanName(s), cleanName(s), JSON.stringify(s));
});

test("hidden until a Blob store is connected", async () => {
  const { store } = memoryStore();
  assert.deepEqual((await run(req(null, SITE, "GET"), store, {})).body, { enabled: false });
  assert.deepEqual((await run(req(null, SITE, "GET"), store)).body, { enabled: true });
  assert.deepEqual((await run(req(null, SITE, "GET"), store, { BLOB_STORE_ID: "store_test" })).body, { enabled: true });
  assert.equal((await run(req(await proof("set", "Eddy")), store, {})).status, 503);
});

test("an account sets and removes its own name, and the log never carries the name", async () => {
  const { m, store } = memoryStore();
  const set = await run(req(await proof("set", "Eddy Ed")), store);
  assert.equal(set.status, 200);
  assert.deepEqual(JSON.parse(m.get(server.namePath(me.address))!), { name: "Eddy Ed" });
  assert.ok(!JSON.stringify(set.lines).includes("Eddy"), JSON.stringify(set.lines));
  assert.equal((await run(req(await proof("remove", null)), store)).status, 200);
  assert.equal(m.size, 0);
});

test("nobody sets another account's name, or a name other than the one signed", async () => {
  const { m, store } = memoryStore();
  assert.equal((await run(req(await proof("set", "Mallory", someoneElse, me.address)), store)).status, 401);
  assert.equal((await run(req(await proof("set", "Mallory", me, me.address, NOW / 1000, "Eddy")), store)).status, 401, "signed Eddy, sent Mallory");
  assert.equal((await run(req(await proof("remove", null, someoneElse, me.address)), store)).status, 401);
  assert.equal(m.size, 0);
});

test("a name must already be clean: no invisible characters, no outer spaces, not empty, not too long", async () => {
  const { m, store } = memoryStore();
  for (const bad of [" Eddy", "Ed‮dy", "a​b", "", "x".repeat(NAME_MAX + 1), "Ed  dy", "é"]) {
    assert.equal((await run(req(await proof("set", bad)), store)).status, 400, JSON.stringify(bad));
  }
  const body = await proof("set", "Eddy");
  assert.equal((await run(req({ ...body, name: 5 }), store)).status, 400);
  assert.equal((await run(req(await proof("set", "x".repeat(NAME_MAX))), store)).status, 200);
  assert.equal(m.size, 1);
});

test("same origin only, stale proofs refused, small bodies only, and a few changes a minute", async () => {
  const { store } = memoryStore();
  assert.equal((await run(req(await proof("set", "Eddy"), "https://elsewhere.example"), store)).status, 403);
  assert.equal((await run(req(await proof("set", "Eddy"), null), store)).status, 403);
  assert.equal((await run(req(await proof("set", "Eddy", me, me.address, NOW / 1000 - PROOF_WINDOW_S - 1)), store)).status, 401);
  assert.equal((await run(req(null, SITE, "POST", "x".repeat(MAX_BODY_BYTES + 1)), store)).status, 413);
  assert.equal((await run(req(null, SITE, "POST", "{not json"), store)).status, 400);
  assert.equal((await run(req({ ...(await proof("set", "Eddy")), action: "rename" }), store)).status, 400);
  for (let i = 0; i < PER_ACCOUNT_PER_MINUTE; i++) assert.equal((await run(req(await proof("set", `Eddy ${i}`)), store)).status, 200);
  assert.equal((await run(req(await proof("set", "Eddy again")), store)).status, 429);
  assert.equal((await run(req(await proof("set", "Ok", someoneElse, someoneElse.address)), store)).status, 200, "another account still can");
  assert.ok(CHANGES_PER_MINUTE > PER_ACCOUNT_PER_MINUTE);
});

test("a store that fails says so", async () => {
  const broken: NameStore = { put: async () => Promise.reject(new Error("down")), remove: async () => Promise.reject(new Error("down")) };
  assert.equal((await run(req(await proof("set", "Eddy")), broken)).status, 502);
});

test("GET /api/name/<account>: the name, null for none or when not set up, never cached", async () => {
  const kept = new Map([[`names/${me.address}.json`, JSON.stringify({ name: "Eddy" })]]);
  const read = async (path: string) => kept.get(path) ?? null;
  const get = (who: string, env: Record<string, string> = ENV) => serveName(new Request(`${SITE}/api/name/${who}`), env, read);
  const r = await get(me.address.toLowerCase());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { name: "Eddy" });
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await (await get(someoneElse.address)).json(), { name: null });
  assert.deepEqual(await (await get(me.address, {})).json(), { name: null });
  assert.equal((await get("nobody")).status, 404);
  const failing = await serveName(new Request(`${SITE}/api/name/${me.address}`), ENV, async () => Promise.reject(new Error("down")));
  assert.equal(failing.status, 502);
  const odd = await serveName(new Request(`${SITE}/api/name/${me.address}`), ENV, async () => JSON.stringify({ name: "x".repeat(80) }));
  assert.deepEqual(await odd.json(), { name: null });
  assert.equal((await serveName(new Request(`${SITE}/api/name/${me.address}`, { method: "POST" }), ENV, read)).status, 405);
});
