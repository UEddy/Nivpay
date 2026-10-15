import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as server from "../../api/city/index.ts";
import { forgetRecentWrites, handleCity, MAX_DATA_BYTES, PER_ACCOUNT_PER_MINUTE, type CityStore } from "../../api/city/index.ts";
import { keyFromFragment, open, seal } from "../lib/cityShare.ts";
import * as phone from "../lib/proof.ts";

// Throwaway keys made fresh on every run.
const me = privateKeyToAccount(generatePrivateKey());
const someoneElse = privateKeyToAccount(generatePrivateKey());
const SITE = "https://nivpay.example";
const NOW = 1_800_000_000_000;
const ENV = { BLOB_READ_WRITE_TOKEN: "test-token" };

function memoryStore() {
  const m = new Map<string, Uint8Array>();
  const store: CityStore = {
    put: async (p, b) => void m.set(p, b),
    remove: async (p) => void m.delete(p),
    list: async (prefix, limit) => [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit),
    read: async (p) => m.get(p) ?? null,
  };
  return { m, store };
}

async function proof(action: "share" | "remove", sealed: Uint8Array | null, signer = me, potId = "7") {
  const data = sealed ? `sha256:${await phone.sha256Hex(sealed)}` : "none";
  const message = phone.proofMessage({ subject: "city", action, account: me.address, pot: `ausd:${potId}`, data, time: NOW / 1000, site: "nivpay.example" });
  return { action, deployment: "ausd", potId, account: me.address, time: NOW / 1000, signature: await signer.signMessage({ message }), ...(sealed ? { data: phone.toBase64(sealed) } : {}) };
}

const post = (body: unknown, origin = SITE) => new Request(`${SITE}/api/city`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const getPot = (pot = "7") => new Request(`${SITE}/api/city?deployment=ausd&pot=${pot}`);

async function run(r: Request, store: CityStore, env: server.CityEnv = ENV) {
  const lines: Record<string, string>[] = [];
  const res = await handleCity(r, env, () => store, (e) => lines.push(e), () => NOW);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, lines };
}

beforeEach(() => forgetRecentWrites());

test("the phone and the server write the city proof the same way", () => {
  const f = { subject: "city" as const, action: "share", account: me.address, pot: "ausd:7", data: "sha256:ab", time: 5, site: "x" };
  assert.equal(server.proofMessage(f), phone.proofMessage(f));
});

test("a city is shared, read back by someone with the link, and removed: the server sees only ciphertext", async () => {
  const { m, store } = memoryStore();
  const key = (await keyFromFragment("pot-link-fragment"))!;
  const sealed = await seal(key, { account: me.address, city: "Houston", country: "US", at: 1 });
  const shared = await run(post(await proof("share", sealed)), store);
  assert.equal(shared.status, 200);
  assert.deepEqual(shared.lines, [{ event: "share", deployment: "ausd", potId: "7", account: me.address }], "never the data");
  const stored = [...m.values()][0]!;
  assert.ok(!new TextDecoder().decode(stored).includes("Houston"), "the server holds only ciphertext");
  const read = await run(getPot(), store);
  const entries = read.body.entries as { account: string; data: string }[];
  assert.equal(entries.length, 1);
  assert.deepEqual(await open(key, phone.fromBase64(entries[0]!.data), me.address), { account: me.address, city: "Houston", country: "US", at: 1 });
  assert.equal((await run(getPot("8"), store)).body.entries instanceof Array && ((await run(getPot("8"), store)).body.entries as unknown[]).length, 0, "another pot has none");
  assert.equal((await run(post(await proof("remove", null)), store)).status, 200);
  assert.equal(m.size, 0, "removed at any time");
});

test("nobody can share or remove a city for someone else", async () => {
  const { m, store } = memoryStore();
  const sealed = new Uint8Array(40).fill(7);
  const forged = await proof("share", sealed, someoneElse);
  assert.equal((await run(post(forged), store)).status, 401);
  assert.equal(m.size, 0);
  const otherPot = { ...(await proof("share", sealed)), potId: "8" };
  assert.equal((await run(post(otherPot), store)).status, 401, "a proof for one pot is no good for another");
});

test("hidden until a Blob store is connected, same origin, small, and a few changes a minute", async () => {
  const { store } = memoryStore();
  assert.deepEqual((await run(getPot(), store, {})).body, { enabled: false, entries: [] });
  const sealed = new Uint8Array(40).fill(7);
  assert.equal((await run(post(await proof("share", sealed)), store, {})).status, 503);
  assert.equal((await run(post(await proof("share", sealed), "https://evil.example"), store)).status, 403);
  assert.equal((await run(post(await proof("share", new Uint8Array(MAX_DATA_BYTES + 1).fill(1))), store)).status, 413);
  assert.equal((await run(getPot("not-a-pot"), store)).status, 400);
  for (let i = 0; i < PER_ACCOUNT_PER_MINUTE; i++) assert.equal((await run(post(await proof("share", sealed)), store)).status, 200);
  assert.equal((await run(post(await proof("share", sealed)), store)).status, 429);
});
