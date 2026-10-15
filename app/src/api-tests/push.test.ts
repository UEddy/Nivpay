import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as server from "../../api/push/index.ts";
import * as notifyServer from "../../api/notify/index.ts";
import { forgetRecentWrites, handlePush, MAX_PHONES, type PushStore, type Subscription } from "../../api/push/index.ts";
import * as phone from "../lib/proof.ts";
import * as rules from "../lib/push.ts";

const me = privateKeyToAccount(generatePrivateKey());
const someoneElse = privateKeyToAccount(generatePrivateKey());
const SITE = "https://nivpay.example";
const NOW = 1_800_000_000_000;
const ENV = { BLOB_STORE_ID: "store_test", VAPID_PUBLIC_KEY: "BPub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "https://nivpay.example" };
const KEYS = { p256dh: "B".repeat(87), auth: "a".repeat(22) };

function memoryStore() {
  const m = new Map<string, Uint8Array>();
  const store: PushStore = {
    put: async (p, b) => void m.set(p, b),
    remove: async (p) => void m.delete(p),
    list: async (prefix) => [...m.keys()].filter((k) => k.startsWith(prefix)).sort(),
    read: async (p) => m.get(p) ?? null,
  };
  const subs = () => [...m.values()].map((b) => JSON.parse(new TextDecoder().decode(b)) as Subscription);
  return { m, store, subs };
}

const post = (body: unknown, origin = SITE) => new Request(`${SITE}/api/push`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
async function run(r: Request, store: PushStore, env: server.PushEnv = ENV, now = NOW) {
  const res = await handlePush(r, env, () => store, () => {}, () => now);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
async function subscribe(endpoint = "https://push.example/abc", signer = me, extra: Record<string, unknown> = {}) {
  const message = phone.proofMessage({ subject: "push", action: "subscribe", account: me.address, data: `sha256:${createHash("sha256").update(endpoint).digest("hex")}`, time: NOW / 1000, site: "nivpay.example" });
  return { action: "subscribe", account: me.address, time: NOW / 1000, signature: await signer.signMessage({ message }), subscription: { endpoint, keys: KEYS }, lang: "fr", ...extra };
}

beforeEach(() => forgetRecentWrites());

test("the server's copies of the proof and the push rules match the phone's", () => {
  const f = { subject: "push" as const, action: "subscribe", account: me.address, data: "sha256:ab", time: 5, site: "x" };
  assert.equal(server.proofMessage(f), phone.proofMessage(f));
  assert.equal(notifyServer.proofMessage(f), phone.proofMessage(f));
  for (const s of [server, notifyServer]) {
    assert.deepEqual(s.PUSH_KINDS, rules.PUSH_KINDS);
    assert.deepEqual(s.DEFAULT_SETTINGS, rules.DEFAULT_SETTINGS);
    for (const raw of [null, { kinds: { sent: true, nope: true }, amounts: "yes" }, { kinds: { received: false }, amounts: true }]) assert.deepEqual(s.cleanSettings(raw), rules.cleanSettings(raw));
  }
  assert.deepEqual(server.cleanAccounts([me.address.toLowerCase(), "nope", me.address]), rules.cleanAccounts([me.address.toLowerCase(), "nope", me.address]));
});

test("hidden until the VAPID keys and a Blob store are set; the public key is given out, never the private one", async () => {
  const { store } = memoryStore();
  assert.deepEqual((await run(new Request(`${SITE}/api/push`), store, { BLOB_STORE_ID: "x" })).body, { enabled: false });
  assert.deepEqual((await run(new Request(`${SITE}/api/push`), store, { VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b", VAPID_SUBJECT: "c" })).body, { enabled: false });
  const on = (await run(new Request(`${SITE}/api/push`), store)).body;
  assert.deepEqual(on, { enabled: true, publicKey: "BPub" });
  assert.equal((await run(post(await subscribe()), store, {})).status, 503);
});

test("a phone subscribes with one fingerprint; nobody can subscribe their phone to someone else's account", async () => {
  const { store, subs } = memoryStore();
  assert.equal((await run(post(await subscribe("https://push.example/abc", someoneElse)), store)).status, 401);
  assert.equal((await run(post({ ...(await subscribe()), subscription: { endpoint: "https://push.example/other", keys: KEYS } }), store)).status, 401, "a proof for one phone is no good for another");
  assert.equal((await run(post({ ...(await subscribe()), subscription: { endpoint: "http://push.example/abc", keys: KEYS } }), store)).status, 400);
  assert.equal((await run(post(await subscribe(), "https://evil.example"), store)).status, 403);
  assert.equal(subs().length, 0);
  assert.equal((await run(post(await subscribe("https://push.example/abc", me, { settings: { kinds: { sent: true }, amounts: true }, muted: [someoneElse.address], trusted: [someoneElse.address] })), store)).status, 200);
  const [s] = subs();
  assert.equal(s!.lang, "fr");
  assert.deepEqual(s!.settings, { kinds: { ...rules.DEFAULT_SETTINGS.kinds, sent: true }, amounts: true });
  assert.deepEqual(s!.muted, [someoneElse.address]);
  assert.deepEqual(s!.trusted, [], "contacts are kept only while pots made with you in them is on");
});

test("settings and turning off need the phone's own endpoint, and no fingerprint", async () => {
  const { store, subs } = memoryStore();
  await run(post(await subscribe()), store);
  const change = { action: "settings", account: me.address, endpoint: "https://push.example/abc", settings: { kinds: { potNamesYou: true } }, trusted: [someoneElse.address], lang: "pt" };
  assert.equal((await run(post({ ...change, endpoint: "https://push.example/guess" }), store)).status, 404);
  assert.equal((await run(post(change), store)).status, 200);
  assert.deepEqual([subs()[0]!.lang, subs()[0]!.trusted], ["pt", [someoneElse.address]]);
  assert.equal((await run(post({ action: "unsubscribe", account: me.address, endpoint: "https://push.example/abc" }), store)).status, 200);
  assert.equal(subs().length, 0);
});

test("at most a few phones per account, the oldest going first", async () => {
  const { store, subs } = memoryStore();
  for (let i = 0; i < MAX_PHONES + 2; i++) {
    forgetRecentWrites();
    assert.equal((await run(post(await subscribe(`https://push.example/${i}`)), store, ENV, NOW + i)).status, 200);
  }
  const kept = subs().map((s) => s.endpoint).sort();
  assert.equal(kept.length, MAX_PHONES);
  assert.ok(!kept.includes("https://push.example/0") && !kept.includes("https://push.example/1"));
});
