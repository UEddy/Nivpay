import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonical, keyId, MutedStore, newInboxKey, openRequest, REQUEST_TTL_MS, requestDigest, requestProof, sealRequest, type PersonRequest } from "./inbox.ts";

const SITE = "nivpay.example";
const NOW = 1_800_000_000_000;
const asker = privateKeyToAccount(generatePrivateKey());
const someoneElse = privateKeyToAccount(generatePrivateKey());
const ME = getAddress("0x4444444444444444444444444444444444444444");
const OTHER = getAddress("0x5555555555555555555555555555555555555555");

const request = (over: Partial<PersonRequest> = {}): PersonRequest => ({ v: 1, deployment: "ausd", from: asker.address, to: ME, name: "Idara", amount: "20000000", at: NOW, nonce: "n1", ...over });

async function signed(r: PersonRequest, by = asker) {
  return by.signMessage({ message: requestProof(r, await requestDigest(r), SITE) });
}
async function phoneKey() {
  const k = await newInboxKey();
  return { id: await keyId(k.raw), privateKey: k.privateKey, raw: k.raw };
}

test("a request sealed to two phones opens on each, checked, and on no other", async () => {
  const [a, b, c] = [await phoneKey(), await phoneKey(), await phoneKey()];
  const r = request();
  const bytes = await sealRequest(r, await signed(r), [a, b]);
  for (const k of [a, b]) {
    const got = await openRequest(bytes, k, ME, "ausd", SITE, NOW);
    assert.deepEqual(got?.request, r);
    assert.equal(got?.digest, await requestDigest(r));
  }
  assert.equal(await openRequest(bytes, c, ME, "ausd", SITE, NOW), null, "a phone it wasn't sealed to");
  assert.ok(!new TextDecoder().decode(bytes).includes("Idara") && !new TextDecoder().decode(bytes).includes("20000000"), "nothing readable in what the server keeps");
});

test("refused: signed by someone else, for someone else, another deployment, another site, too old, or tampered with", async () => {
  const k = await phoneKey();
  const r = request();
  const open = async (bytes: Uint8Array, me = ME, deployment = "ausd", site = SITE, now = NOW) => openRequest(bytes, k, me, deployment, site, now);
  assert.equal(await open(await sealRequest(r, await signed(r, someoneElse), [k])), null, "not signed by its requester");
  assert.equal(await open(await sealRequest(r, await signed(r), [k]), OTHER), null, "not for this account");
  assert.equal(await open(await sealRequest(r, await signed(r), [k]), ME, "testusd"), null);
  assert.equal(await open(await sealRequest(r, await signed(r), [k]), ME, "ausd", "evil.example"), null);
  assert.equal(await open(await sealRequest(r, await signed(r), [k]), ME, "ausd", SITE, NOW + REQUEST_TTL_MS + 1), null);
  const changed = { ...r, amount: "99000000" };
  assert.equal(await open(await sealRequest(changed, await signed(r), [k])), null, "the amount changed after signing");
  const self = request({ from: asker.address, to: asker.address });
  assert.equal(await openRequest(await sealRequest(self, await signed(self), [k]), k, asker.address, "ausd", SITE, NOW), null, "a request to yourself");
  const bytes = await sealRequest(r, await signed(r), [k]);
  bytes[bytes.length - 20]! ^= 1;
  assert.equal(await open(bytes), null, "damaged bytes");
  assert.equal(await open(new TextEncoder().encode("not json")), null);
});

test("the name is cleaned when read, and the record is the same however it was built", async () => {
  const k = await phoneKey();
  const r = request({ name: "  Idara​  " });
  const got = await openRequest(await sealRequest(r, await signed(r), [k]), k, ME, "ausd", SITE, NOW);
  assert.equal(got?.request.name, "Idara");
  assert.equal(canonical({ ...r, from: r.from.toLowerCase() as typeof r.from }), canonical(r));
});

test("muted accounts are kept per account and survive damage", () => {
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
  const m = new MutedStore(store, "ausd", ME);
  m.mute(OTHER.toLowerCase() as typeof OTHER);
  m.mute(OTHER);
  assert.deepEqual(m.list(), [OTHER]);
  assert.ok(m.has(OTHER));
  assert.deepEqual(new MutedStore(store, "ausd", OTHER).list(), []);
  m.unmute(OTHER);
  assert.equal(m.has(OTHER), false);
  kv.set([...kv.keys()][0]!, "{");
  assert.deepEqual(m.list(), []);
});
