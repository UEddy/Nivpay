import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Address, type Hex } from "viem";
import {
  checkDraft,
  confirmsAccount,
  DraftStore,
  endTimeFor,
  labelsFor,
  majority,
  newDraft,
  normalizeSending,
  parseAccountId,
  potRecipients,
  signedShares,
  withAttempt,
  withDeciderShare,
  withPayeeShare,
  withDecider,
  withoutDecider,
  withPayeeAccount,
  withSentTo,
  type Draft,
} from "./draft.ts";
import { fromText32, toText32, utf8Length } from "./text32.ts";

const IDARA = getAddress("0x725c9a4bb4c3de2f11ac0e7c9b1e8f0d3a2b7bc1");
const UBONG = getAddress("0x1111111111111111111111111111111111111111");
const ANIEKAN = getAddress("0x2222222222222222222222222222222222222222");
const CATERER = getAddress("0x3333333333333333333333333333333333333333");
const HALL = getAddress("0x4444444444444444444444444444444444444444");
const POTS = getAddress("0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB");
const LIMITS = { maxDeciders: 10, maxPayees: 10 };
const NOW = 1_791_000_000n; // Oct 2026

let counter = 0;
const random = (n: number) => Uint8Array.from({ length: n }, (_, i) => (counter++ * 7 + i) & 0xff);

const person = (account: Address, name: string, city: string, timeZone: string) => ({ account, name, city, timeZone });

function mamas60th(): Draft {
  let d = newDraft(IDARA, "Europe/London", 0, random);
  d = { ...d, name: "Mama’s 60th", me: { city: "London", timeZone: "Europe/London" }, closes: "2026-12-31" };
  d = withDecider(d, person(UBONG, "Ubong", "Houston", "America/Chicago"));
  d = withDecider(d, person(ANIEKAN, "Aniekan", "Uyo", "Africa/Lagos"));
  d = {
    ...d,
    payees: [
      { slot: "0x0101010101010101", name: "Caterer", cap: "700000000" },
      { slot: "0x0202020202020202", name: "Event hall", cap: "300000000" },
    ],
  };
  d = withPayeeAccount(d, "0x0101010101010101", CATERER, "reply");
  return withPayeeAccount(d, "0x0202020202020202", HALL, "pasted");
}

test("names are bytes32 text: up to 32 bytes of UTF-8, counted in bytes", () => {
  assert.equal(utf8Length("Mama’s 60th"), 13);
  assert.equal(fromText32(toText32("Mama’s 60th")), "Mama’s 60th");
  assert.equal(fromText32(toText32("x".repeat(32))), "x".repeat(32));
  assert.throws(() => toText32("x".repeat(33)));
  assert.throws(() => toText32("é".repeat(17)), "34 bytes, though 17 characters");
  assert.throws(() => toText32("   "));
});

test("the pot closes at the end of the chosen day, in the creator's time zone", () => {
  assert.equal(endTimeFor("2026-12-31", "Europe/London"), BigInt(Date.UTC(2027, 0, 1) / 1000));
  assert.equal(endTimeFor("2026-12-31", "America/Chicago"), BigInt(Date.UTC(2027, 0, 1, 6) / 1000));
  assert.equal(endTimeFor("2026-12-31", "Africa/Lagos"), BigInt(Date.UTC(2026, 11, 31, 23) / 1000));
  // London's clocks go forward at 01:00 on 29 March 2026; midnight is still GMT.
  assert.equal(endTimeFor("2026-03-28", "Europe/London"), BigInt(Date.UTC(2026, 2, 29) / 1000));
  // And on the night they go forward, the next midnight is BST.
  assert.equal(endTimeFor("2026-03-29", "Europe/London"), BigInt(Date.UTC(2026, 2, 29, 23) / 1000));
  for (const bad of ["", "2026-02-30", "2026-13-01", "31/12/2026"]) assert.equal(endTimeFor(bad, "Europe/London"), null, bad);
});

test("deciders: the creator decides too, and the rule follows a majority until changed", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(majority), [1, 2, 2, 3, 3]);
  const d = mamas60th();
  assert.equal(d.deciders.length, 2);
  assert.equal(d.threshold, 2, "2 of 3");
  assert.equal(withDecider(d, person(IDARA, "Idara", "London", "Europe/London")), d, "the creator is never added twice");
  const again = withDecider(d, person(UBONG, "Ubong E.", "Houston", "America/Chicago"));
  assert.equal(again.deciders.length, 2, "a second reply updates, not duplicates");
  assert.equal(again.deciders.find((p) => p.account === UBONG)?.name, "Ubong E.");
  const custom = { ...d, threshold: 3 };
  assert.equal(withoutDecider(custom, ANIEKAN).threshold, 2, "never above the number of deciders");
  assert.equal(withoutDecider(d, ANIEKAN).threshold, 2, "majority of 2 is 2");
});

test("pasted Account IDs: valid, right checksum, confirmed by their last 4 characters", () => {
  assert.equal(parseAccountId(" 0x725c9a4bb4c3de2f11ac0e7c9b1e8f0d3a2b7bc1 "), IDARA);
  assert.equal(parseAccountId(IDARA), IDARA);
  const i = IDARA.search(/[a-fA-F]/);
  const flipped = IDARA.slice(0, i) + (IDARA[i] === IDARA[i]!.toUpperCase() ? IDARA[i]!.toLowerCase() : IDARA[i]!.toUpperCase()) + IDARA.slice(i + 1);
  assert.equal(parseAccountId(flipped), null, "mixed case with a broken checksum");
  assert.equal(parseAccountId("0x1234"), null);
  assert.equal(parseAccountId("Idara"), null);
  assert.ok(confirmsAccount(IDARA, "7bc1"));
  assert.ok(confirmsAccount(IDARA, "7BC1"));
  assert.ok(!confirmsAccount(IDARA, "7bc"));
  assert.ok(!confirmsAccount(IDARA, "bc17"));
});

test("a complete draft becomes exactly the createPot arguments", () => {
  const { missing, args } = checkDraft(mamas60th(), LIMITS, NOW, POTS);
  assert.deepEqual(missing, []);
  assert.ok(args);
  const [purpose, approvers, threshold, destinations, labels, caps, endTime] = args;
  assert.equal(fromText32(purpose), "Mama’s 60th");
  assert.deepEqual(approvers, [IDARA, UBONG, ANIEKAN]);
  assert.equal(threshold, 2);
  assert.deepEqual(destinations, [CATERER, HALL]);
  assert.deepEqual(labels.map(fromText32), ["Caterer", "Event hall"]);
  assert.deepEqual(caps, [700_000_000n, 300_000_000n]);
  assert.equal(endTime, BigInt(Date.UTC(2027, 0, 1) / 1000));
});

test("what's missing is listed, and nothing the contract would refuse gets through", () => {
  const blank = newDraft(IDARA, "Europe/London", 0, random);
  assert.deepEqual(checkDraft(blank, LIMITS, NOW, POTS).missing, ["name", "city", "payees", "closes"]);

  const d = mamas60th();
  const noAccount = { ...d, payees: d.payees.map((p, i) => (i === 1 ? { ...p, account: undefined } : p)) };
  assert.deepEqual(checkDraft(noAccount, LIMITS, NOW, POTS).missing, ["payee-account"]);
  const payPots = withPayeeAccount(d, "0x0202020202020202", POTS, "pasted");
  assert.deepEqual(checkDraft(payPots, LIMITS, NOW, POTS).missing, ["payee-account"], "the pots contract itself");
  const zeroCap = { ...d, payees: d.payees.map((p) => ({ ...p, cap: "0" })) };
  assert.deepEqual(checkDraft(zeroCap, LIMITS, NOW, POTS).missing, ["payees"]);
  const longName = { ...d, payees: d.payees.map((p) => ({ ...p, name: "A very long payee name over 32 bytes" })) };
  assert.deepEqual(checkDraft(longName, LIMITS, NOW, POTS).missing, ["payees"]);
  assert.deepEqual(checkDraft({ ...d, threshold: 4 }, LIMITS, NOW, POTS).missing, ["deciders"]);
  assert.deepEqual(checkDraft({ ...d, threshold: 0 }, LIMITS, NOW, POTS).missing, ["deciders"]);
  assert.deepEqual(checkDraft(d, { maxDeciders: 2, maxPayees: 10 }, NOW, POTS).missing, ["deciders"]);
  assert.deepEqual(checkDraft(d, { maxDeciders: 10, maxPayees: 1 }, NOW, POTS).missing, ["payees"]);
  const past = BigInt(Date.UTC(2027, 0, 1) / 1000);
  assert.deepEqual(checkDraft(d, LIMITS, past, POTS).missing, ["closes-past"]);
  assert.deepEqual(checkDraft(d, LIMITS, past - 601n, POTS).missing, []);
});

test("suggested shares: per decider and per payee, signed once per account, zero means none", () => {
  let d = mamas60th();
  assert.deepEqual(signedShares(d), [], "none set");
  d = withDeciderShare(d, IDARA, 500_000_000n);
  d = withDeciderShare(d, UBONG, 400_000_000n);
  d = withDeciderShare(d, ANIEKAN, 100_000_000n);
  d = withPayeeShare(d, "0x0202020202020202", 20_000_000n);
  assert.deepEqual(signedShares(d), [
    { account: IDARA, amount: 500_000_000n },
    { account: UBONG, amount: 400_000_000n },
    { account: ANIEKAN, amount: 100_000_000n },
    { account: HALL, amount: 20_000_000n },
  ]);
  // Cleared with zero; dropped with the decider; a payee with no account yet isn't signed.
  d = withDeciderShare(d, ANIEKAN, 0n);
  d = withoutDecider(d, UBONG);
  assert.deepEqual(signedShares(d).map((s) => s.account), [IDARA, HALL]);
  const noAccount = { ...d, payees: d.payees.map((p) => ({ ...p, account: undefined })) };
  assert.deepEqual(signedShares(noAccount).map((s) => s.account), [IDARA]);
  // A decider who is also a payee is signed once, with the decider's share.
  const both = withPayeeShare(withPayeeAccount(d, "0x0101010101010101", IDARA, "pasted"), "0x0101010101010101", 9n);
  assert.deepEqual(signedShares(both).filter((s) => s.account === IDARA), [{ account: IDARA, amount: 500_000_000n }]);
});

test("a stuck pot keeps the names for every attempt, so whichever lands can be shared", () => {
  const people = [person(IDARA, "Idara", "London", "Europe/London")];
  const shares = [{ account: IDARA, amount: "500000000" }];
  const first = { hash: `0x${"a1".repeat(32)}`, labelsSignature: `0x${"b1".repeat(65)}` } as const;
  const retry = { hash: `0x${"a2".repeat(32)}`, labelsSignature: `0x${"b2".repeat(65)}` } as const;

  // The first attempt is signed and sent, then gets stuck.
  let sending = withAttempt(undefined, people, shares, first);
  // A retry is signed (its names saved before broadcast), then fails before it is sent.
  sending = withAttempt(sending, people, shares, retry);
  assert.equal(sending.attempts.length, 2);

  // The first attempt lands after all: its own names are still there.
  assert.equal(labelsFor(sending, first.hash), first.labelsSignature);
  // Or the retry is the one that lands.
  assert.equal(labelsFor(sending, retry.hash), retry.labelsSignature);
  assert.equal(labelsFor(sending, retry.hash.toUpperCase().replace("0X", "0x") as Hex), retry.labelsSignature, "any case");
  // A transaction this phone never signed names for has none, and the screen asks to sign again.
  assert.equal(labelsFor(sending, `0x${"cc".repeat(32)}`), undefined);

  // Signing the same attempt twice doesn't duplicate it.
  assert.equal(withAttempt(sending, people, shares, retry).attempts.length, 2);
});

test("a pot being made, saved by the earlier version, still resolves its names", () => {
  const legacy = {
    hash: `0x${"a1".repeat(32)}` as Hex,
    labelsSignature: `0x${"b1".repeat(65)}` as Hex,
    people: [person(IDARA, "Idara", "London", "Europe/London")],
  };
  const sending = normalizeSending(legacy);
  assert.deepEqual(sending.shares, []);
  assert.equal(labelsFor(legacy, legacy.hash), legacy.labelsSignature);
  const next = withAttempt(legacy, legacy.people, [], { hash: `0x${"a2".repeat(32)}`, labelsSignature: `0x${"b2".repeat(65)}` });
  assert.deepEqual(next.attempts.map((a) => a.hash), [legacy.hash, `0x${"a2".repeat(32)}`]);
});

test("drafts are stored per creator and found by id from any account", () => {
  const map = new Map<string, string>();
  const store = new DraftStore({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) });
  const a = mamas60th();
  const b = { ...newDraft(UBONG, "America/Chicago", 5, random), name: "Rent" };
  store.put(a);
  store.put(b);
  store.put({ ...a, name: "Mama’s 60th!" });
  assert.equal(store.all().length, 2);
  assert.deepEqual(store.forOwner(IDARA).map((d) => d.name), ["Mama’s 60th!"]);
  assert.equal(store.get(b.id)?.owner, UBONG);
  store.delete(a.id);
  assert.equal(store.get(a.id), undefined);
  map.set("nivpay.drafts.v1", "not json");
  assert.deepEqual(store.all(), []);
});

test("after the pot is made, every other decider and every payee is someone to send the link to", () => {
  const made: Draft = { ...mamas60th(), made: { potId: "3", block: "100", fragment: "abc" } };
  assert.deepEqual(
    potRecipients(made).map((r) => [r.name, r.role, r.sent]),
    [
      ["Ubong", "decider", false],
      ["Aniekan", "decider", false],
      ["Caterer", "payee", false],
      ["Event hall", "payee", false],
    ],
  );
});

test("the creator is never listed, and someone both deciding and paid is listed once", () => {
  const d = mamas60th();
  const both: Draft = {
    ...d,
    payees: [...d.payees, { slot: "0x0303030303030303", name: "Ubong's shop", cap: "1", account: UBONG, via: "pasted" }, { slot: "0x0404040404040404", name: "Me", cap: "1", account: IDARA, via: "pasted" }],
    made: { potId: "3", block: "100", fragment: "abc" },
  };
  const names = potRecipients(both).map((r) => r.name);
  assert.deepEqual(names, ["Ubong", "Aniekan", "Caterer", "Event hall"]);
});

test("a payee with no account yet has no link to send", () => {
  const d = mamas60th();
  const open: Draft = { ...d, payees: [d.payees[0]!, { slot: "0x0505050505050505", name: "Florist", cap: "1" }], made: { potId: "3", block: "100", fragment: "abc" } };
  assert.ok(!potRecipients(open).some((r) => r.name === "Florist"));
});

test("sending is remembered per person, whatever the casing, and only on a made pot", () => {
  const made: Draft = { ...mamas60th(), made: { potId: "3", block: "100", fragment: "abc" } };
  let d = withSentTo(made, UBONG.toLowerCase() as Address);
  d = withSentTo(d, UBONG);
  d = withSentTo(d, CATERER);
  assert.deepEqual(d.made?.sentTo, [UBONG.toLowerCase(), CATERER.toLowerCase()]);
  assert.deepEqual(potRecipients(d).filter((r) => r.sent).map((r) => r.name), ["Ubong", "Caterer"]);
  assert.equal(withSentTo(mamas60th(), UBONG).made, undefined);
});
