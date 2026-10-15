import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as server from "../../api/inbox/index.ts";
import { forgetRecentWrites, handleInbox, KEEP_MS, MAX_KEYS, MAX_WAITING, PER_ACCOUNT_PER_MINUTE, type InboxStore } from "../../api/inbox/index.ts";
import { keyId, newInboxKey, openRequest, requestDigest, requestProof, sealRequest, type PersonRequest } from "../lib/inbox.ts";
import * as phone from "../lib/proof.ts";

// Throwaway keys made fresh on every run.
const asker = privateKeyToAccount(generatePrivateKey());
const asked = privateKeyToAccount(generatePrivateKey());
const someoneElse = privateKeyToAccount(generatePrivateKey());
const SITE = "https://nivpay.example";
const HOST = "nivpay.example";
const NOW = 1_800_000_000_000;
const ENV = { BLOB_STORE_ID: "store_test" };

function memoryStore() {
  const m = new Map<string, Uint8Array>();
  const store: InboxStore = {
    put: async (p, b) => void m.set(p, b),
    remove: async (p) => void m.delete(p),
    list: async (prefix) => [...m.keys()].filter((k) => k.startsWith(prefix)).sort(),
    read: async (p) => m.get(p) ?? null,
  };
  return { m, store };
}

const post = (body: unknown, origin = SITE) => new Request(`${SITE}/api/inbox`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (account: string, what = "") => new Request(`${SITE}/api/inbox?account=${account}${what ? `&what=${what}` : ""}`);

async function run(r: Request, store: InboxStore, env: server.InboxEnv = ENV, now = NOW) {
  const lines: Record<string, string>[] = [];
  const res = await handleInbox(r, env, () => store, (e) => lines.push(e), () => now);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, lines };
}

async function publish(signer = asked, raw?: Uint8Array, account = asked.address) {
  const k = raw ? { raw, privateKey: null as unknown as CryptoKey } : await newInboxKey();
  const message = phone.proofMessage({ subject: "inbox", action: "key", account, data: `sha256:${await phone.sha256Hex(k.raw)}`, time: NOW / 1000, site: HOST });
  return { key: k, body: { action: "key", account, time: NOW / 1000, signature: await signer.signMessage({ message }), key: phone.toBase64(k.raw) } };
}

const req = (over: Partial<PersonRequest> = {}): PersonRequest => ({ v: 1, deployment: "ausd", from: asker.address, to: asked.address, name: "Idara", amount: "20000000", at: NOW, nonce: "n1", ...over });

async function sendBody(r: PersonRequest, keys: { id: string; raw: Uint8Array }[], signer = asker) {
  const digest = await requestDigest(r);
  const signature = await signer.signMessage({ message: requestProof(r, digest, HOST) });
  const sealed = await sealRequest(r, signature, keys);
  return { action: "send", from: r.from, to: r.to, time: Math.floor(r.at / 1000), signature, digest, data: phone.toBase64(sealed) };
}

beforeEach(() => forgetRecentWrites());

test("the phone and the server write the proof the same way", () => {
  for (const subject of ["request", "inbox"] as const) {
    const f = { subject, action: "send", account: asker.address, data: "to:x;sha256:ab", time: 5, site: "x" };
    assert.equal(server.proofMessage(f), phone.proofMessage(f));
  }
});

test("hidden until a Blob store is connected", async () => {
  const { store } = memoryStore();
  assert.deepEqual((await run(get(asked.address), store, {})).body, { enabled: false });
  assert.equal((await run(post((await publish()).body), store, {})).status, 503);
});

test("a phone publishes its key; a request sealed to it is stored as ciphertext only, and opens on that phone", async () => {
  const { m, store } = memoryStore();
  const { key, body } = await publish();
  assert.equal((await run(post(body), store)).status, 200);
  const keys = (await run(get(asked.address, "keys"), store)).body.keys as { id: string; key: string }[];
  assert.equal(keys.length, 1);
  const id = await keyId(key.raw);
  assert.equal(keys[0]!.id, id);
  const r = req();
  const sent = await run(post(await sendBody(r, [{ id, raw: phone.fromBase64(keys[0]!.key) }])), store);
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.lines, [{ event: "send" }], "logs never say who asked whom");
  const stored = [...m.entries()].find(([p]) => p.startsWith("inbox/"))!;
  const text = new TextDecoder().decode(stored[1]);
  assert.ok(!text.includes("Idara") && !text.includes("20000000") && !stored[0].includes(asker.address), "no name, amount or asker on the server");
  const entries = (await run(get(asked.address), store)).body.entries as { id: string; data: string }[];
  assert.equal(entries.length, 1);
  const opened = await openRequest(phone.fromBase64(entries[0]!.data), { id, privateKey: key.privateKey }, asked.address, "ausd", HOST, NOW);
  assert.deepEqual(opened?.request, r);
});

test("nobody can publish a key, or send a request, as someone else", async () => {
  const { m, store } = memoryStore();
  assert.equal((await run(post((await publish(someoneElse)).body), store)).status, 401);
  const forged = await sendBody(req(), [], someoneElse);
  assert.equal((await run(post(forged), store)).status, 401);
  const moved = { ...(await sendBody(req(), [])), to: someoneElse.address };
  assert.equal((await run(post(moved), store)).status, 401, "a proof for one person is no good for another");
  assert.equal((await run(post(await sendBody(req({ to: asker.address }), [])), store)).status, 400, "not to yourself");
  assert.equal(m.size, 0);
  assert.equal((await run(post((await publish()).body, "https://evil.example"), store)).status, 403);
  assert.equal((await run(post((await publish(asked, new Uint8Array(33).fill(2))).body), store)).status, 400, "only an uncompressed P-256 key");
});

test("at most a few keys per account and requests per person, old ones dropped, and a few writes a minute", async () => {
  const { m, store } = memoryStore();
  for (let i = 0; i < MAX_KEYS + 2; i++) {
    forgetRecentWrites();
    assert.equal((await run(post((await publish()).body), store, ENV, NOW + i)).status, 200);
  }
  assert.equal([...m.keys()].filter((p) => p.startsWith("inbox-keys/")).length, MAX_KEYS);
  for (let i = 0; i < MAX_WAITING + 3; i++) {
    forgetRecentWrites();
    assert.equal((await run(post(await sendBody(req({ nonce: `n${i}` }), [])), store, ENV, NOW + i)).status, 200);
  }
  assert.equal([...m.keys()].filter((p) => p.startsWith("inbox/")).length, MAX_WAITING);
  const later = await run(get(asked.address), store, ENV, NOW + KEEP_MS + 1000);
  assert.deepEqual(later.body.entries, [], "older than a month: dropped when read");
  forgetRecentWrites();
  let last = 0;
  for (let i = 0; i <= PER_ACCOUNT_PER_MINUTE; i++) last = (await run(post(await sendBody(req({ nonce: `x${i}` }), [])), store)).status;
  assert.equal(last, 429);
});

test("a key can be taken back, proved the same way", async () => {
  const { m, store } = memoryStore();
  const { key, body } = await publish();
  await run(post(body), store);
  const id = await keyId(key.raw);
  const message = phone.proofMessage({ subject: "inbox", action: "unkey", account: asked.address, data: `key:${id}`, time: NOW / 1000, site: HOST });
  const unkey = { action: "unkey", account: asked.address, time: NOW / 1000, keyId: id, signature: await asked.signMessage({ message }) };
  assert.equal((await run(post({ ...unkey, signature: await someoneElse.signMessage({ message }) }), store)).status, 401);
  assert.equal((await run(post(unkey), store)).status, 200);
  assert.equal(m.size, 0);
});
