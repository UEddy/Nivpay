import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { ContactStore, NamePairStore, nameKey, namePairCheck, PaidStore, sendWarnings, type Contact } from "./contacts.ts";

const ME = getAddress("0x1A9A136f1cf59899C6b8cfE84ac4df388620467d");
const IDARA = getAddress("0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1");
const FAKE = getAddress("0x7EAf7f3e330ac388A0e951e80957B7274597297c");

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) } as Storage;
}

test("a contact is saved with a cleaned name, renamed in place, and never for your own account", () => {
  const kv = memory();
  const store = new ContactStore(kv, "ausd", ME);
  assert.equal(store.save(IDARA, "  Idara​  ", 1), true);
  assert.deepEqual(store.get(IDARA.toLowerCase() as typeof IDARA), { account: IDARA, name: "Idara", addedAt: 1 });
  assert.equal(store.save(IDARA, "Idara E.", 5), true);
  assert.deepEqual(store.list(), [{ account: IDARA, name: "Idara E.", addedAt: 1 }], "renaming keeps when it was added");
  assert.equal(store.save(ME, "Me", 2), false);
  assert.equal(store.save(FAKE, " ‮ ", 2), false, "a name that cleans to nothing");
  store.remove(IDARA);
  assert.deepEqual(store.list(), []);
});

test("contacts are kept per account and per deployment, and a damaged row is dropped", () => {
  const kv = memory();
  new ContactStore(kv, "ausd", ME).save(IDARA, "Idara", 1);
  assert.equal(new ContactStore(kv, "testusd", ME).list().length, 0);
  assert.equal(new ContactStore(kv, "ausd", FAKE).list().length, 0);
  kv.setItem(`nivpay.contacts.v1.ausd.${ME}`, JSON.stringify([{ account: "nope", name: "X", addedAt: 1 }, { account: IDARA, name: "Idara", addedAt: 2 }]));
  assert.deepEqual(new ContactStore(kv, "ausd", ME).list().map((c) => c.name), ["Idara"]);
  kv.setItem(`nivpay.contacts.v1.ausd.${ME}`, "{not json");
  assert.deepEqual(new ContactStore(kv, "ausd", ME).list(), []);
});

test("accounts paid are remembered per account, once each", () => {
  const kv = memory();
  const paid = new PaidStore(kv, "ausd", ME);
  assert.equal(paid.has(IDARA), false);
  paid.add(IDARA);
  paid.add(IDARA.toLowerCase() as typeof IDARA);
  assert.deepEqual(paid.all(), [IDARA]);
  assert.equal(new PaidStore(kv, "ausd", FAKE).has(IDARA), false);
});

test("names match ignoring case and spacing, after cleaning", () => {
  assert.equal(nameKey("Idara"), nameKey(" i D a r a "));
  assert.equal(nameKey("Event hall"), nameKey("EVENTHALL​"));
  assert.notEqual(nameKey("Idara"), nameKey("Idaraa"));
});

const contacts: Contact[] = [{ account: IDARA, name: "Idara", addedAt: 1 }];

test("the first payment to an account is flagged until one reaches final", () => {
  assert.equal(sendWarnings(FAKE, null, [], false).firstTime, true);
  assert.equal(sendWarnings(FAKE, null, [], true).firstTime, false);
});

test("a link that uses a contact's name with another account is a clash", () => {
  const w = sendWarnings(FAKE, "  idara ", contacts, false);
  assert.deepEqual(w.clash, contacts[0]);
  assert.equal(w.savedAs, null);
  assert.equal(sendWarnings(IDARA, "Idara", contacts, true).clash, null, "the real Idara");
  assert.equal(sendWarnings(FAKE, null, contacts, false).clash, null, "a pasted account has no name to clash");
});

test("a contact's account under another name on the link shows the saved name first", () => {
  const w = sendWarnings(IDARA, "Event hall", contacts, true);
  assert.deepEqual(w.savedAs, contacts[0]);
  assert.equal(w.clash, null);
  assert.equal(sendWarnings(IDARA, "IDARA", contacts, true).savedAs, null, "same name, nothing to say");
});

test("a username paid before is remembered with its account, per account and deployment", () => {
  const kv = memory();
  const pairs = new NamePairStore(kv, "ausd", ME);
  assert.equal(pairs.get("idara"), undefined);
  pairs.remember("idara", IDARA.toLowerCase() as typeof IDARA);
  assert.equal(pairs.get("idara"), IDARA);
  assert.equal(new NamePairStore(kv, "testusd", ME).get("idara"), undefined);
  assert.equal(new NamePairStore(kv, "ausd", FAKE).get("idara"), undefined);
  kv.setItem(`nivpay.namepairs.v1.ausd.${ME}`, JSON.stringify({ idara: "nope", "Bad Name": IDARA, ubong: FAKE }));
  assert.deepEqual([pairs.get("idara"), pairs.get("ubong")], [undefined, FAKE], "damaged rows are dropped");
});

test("a username is asked about the first time, passes when unchanged, and stops when it points elsewhere", () => {
  assert.equal(namePairCheck(IDARA, undefined), "first");
  assert.equal(namePairCheck(IDARA, IDARA.toLowerCase() as typeof IDARA), "same");
  // The stop that can't happen live for 90 days: the name was let go, held, and claimed by someone else.
  assert.equal(namePairCheck(FAKE, IDARA), "changed");
});
