import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import type { FoundPot } from "./discover.ts";
import { EMPTY_NOTES, fromArrivals, fromPoll, markAllRead, markRead, MAX_NOTES, NotesStore, start, unread, type PollInputs } from "./notes.ts";

const T = 1_800_000_000_000;
const usd = (d: number) => (BigInt(Math.round(d * 100)) * 10_000n).toString();
const pot = (potId: string, total: number, over: Partial<FoundPot> = {}): FoundPot => ({
  potId,
  roles: ["decides"],
  name: "Birthday",
  totalAssets: usd(total),
  endTime: String((T + 30 * 86_400_000) / 1000),
  closed: false,
  ...over,
});
const poll = (over: Partial<PollInputs>): PollInputs => ({ now: T, found: [], waiting: [], ended: [], pours: [], raised: null, ...over });
const kinds = (s: { notes: { kind: string }[] }) => s.notes.map((n) => n.kind);

test("nothing is said before the first run, and the first run says nothing: the list starts there", () => {
  assert.deepEqual(fromPoll(EMPTY_NOTES, poll({ found: [pot("1", 100)] })), EMPTY_NOTES);
  const started = start(EMPTY_NOTES, T, 500n);
  assert.equal(started.startBlock, "500");
  const first = fromPoll(started, poll({ found: [pot("1", 100)] }));
  assert.deepEqual(first.notes, [], "a pot's total seen for the first time is no news");
  assert.equal(start(first, T + 9, 900n).startedAt, T, "started once");
});

test("someone chipping in is news; your own chipping in is not", () => {
  let s = fromPoll(start(EMPTY_NOTES, T, 1n), poll({ found: [pot("1", 100)] }));
  s = fromPoll(s, poll({ now: T + 1, found: [pot("1", 150)] }));
  assert.deepEqual(kinds(s), ["chippedIn"]);
  assert.equal(s.notes[0]!.amount, usd(50));
  const mine = { id: "9", kind: "pour" as const, amount: usd(30), at: T + 2, final: true, potId: "1" };
  s = fromPoll(s, poll({ now: T + 3, found: [pot("1", 180)], pours: [mine] }));
  assert.equal(s.notes.length, 1, "the rise was all yours");
  s = fromPoll(s, poll({ now: T + 4, found: [pot("1", 200)], pours: [mine] }));
  assert.equal(s.notes[0]!.amount, usd(20), "your pour is taken off once only");
  s = fromPoll(s, poll({ now: T + 5, found: [pot("1", 150)] }));
  assert.equal(s.notes.length, 2, "money going out is not chipping in");
});

test("a request waiting for your yes, and a payment paid out, each once", () => {
  const ask = { proposalId: "4", potId: "1", kind: 0, payee: 0, amount: usd(60), asker: getAddress("0x1111111111111111111111111111111111111111"), expiresAt: "0", yes: [], threshold: 2 };
  let s = fromPoll(start(EMPTY_NOTES, T, 1n), poll({ waiting: [ask, { ...ask, proposalId: "5", kind: 1, amount: "0" }] }));
  assert.deepEqual(kinds(s).sort(), ["askClose", "askYes"]);
  s = fromPoll(s, poll({ waiting: [ask] }));
  assert.equal(s.notes.length, 2, "not said again");
  s = fromPoll(s, poll({ ended: [{ proposalId: "4", potId: "1", kind: 0, payee: 0, amount: usd(60), status: 1 }, { proposalId: "6", potId: "1", kind: 0, payee: 0, amount: usd(5), status: 2 }] }));
  assert.equal(kinds(s).filter((k) => k === "paidOut").length, 1, "paid, not withdrawn");
});

test("a pot closing within a day, and a closed pot with your share to take, each once", () => {
  const soon = pot("1", 10, { endTime: String((T + 3_600_000) / 1000) });
  const done = pot("2", 10, { closed: true, roles: ["decides", "putIn"] });
  const pastNoShare = pot("3", 10, { endTime: String((T - 1000) / 1000), roles: ["paid"] });
  let s = fromPoll(start(EMPTY_NOTES, T, 1n), poll({ found: [soon, done, pastNoShare] }));
  assert.deepEqual(kinds(s).sort(), ["closedShare", "closingSoon"]);
  s = fromPoll(s, poll({ now: T + 10, found: [soon, done, pastNoShare] }));
  assert.equal(s.notes.length, 2);
  const passed = pot("4", 10, { endTime: String((T - 1000) / 1000), roles: ["putIn"] });
  assert.ok(kinds(fromPoll(s, poll({ found: [passed] }))).includes("closedShare"), "past its date counts as closed");
});

test("a raised limit now in effect, once, and only one that took effect after the start", () => {
  let s = start(EMPTY_NOTES, T, 1n);
  s = fromPoll(s, poll({ raised: { limit: usd(5000), at: T - 1 } }));
  assert.deepEqual(s.notes, []);
  s = fromPoll(s, poll({ raised: { limit: usd(5000), at: T + 5 } }));
  s = fromPoll(s, poll({ raised: { limit: usd(5000), at: T + 5 } }));
  assert.deepEqual(kinds(s), ["limitRaised"]);
});

test("money received, once per payment, newest first, read and unread", () => {
  const from = getAddress("0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1");
  let s = start(EMPTY_NOTES, T, 1n);
  s = fromArrivals(s, [{ tx: "0xa", logIndex: 1, from, amount: 25_000_000n, decimals: 6, symbol: "$" }], T + 1);
  s = fromArrivals(s, [{ tx: "0xa", logIndex: 1, from, amount: 25_000_000n, decimals: 6, symbol: "$" }, { tx: "0xb", logIndex: 0, from, amount: 1n, decimals: 6, symbol: "$" }], T + 2);
  assert.deepEqual(s.notes.map((n) => n.id), ["rx:0xb:0", "rx:0xa:1"]);
  assert.equal(unread(s), 2);
  s = markRead(s, "rx:0xa:1");
  assert.equal(unread(s), 1);
  assert.equal(unread(markAllRead(s)), 0);
});

test("the list is capped, and kept per account and deployment, surviving damage", () => {
  let s = start(EMPTY_NOTES, T, 1n);
  const from = getAddress("0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1");
  s = fromArrivals(s, Array.from({ length: MAX_NOTES + 20 }, (_, i) => ({ tx: `0x${i}`, logIndex: 0, from, amount: 1n, decimals: 6, symbol: "$" })), T);
  assert.equal(s.notes.length, MAX_NOTES);
  const m = new Map<string, string>();
  const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  const me = getAddress("0x1A9A136f1cf59899C6b8cfE84ac4df388620467d");
  const store = new NotesStore(kv, "ausd", me);
  store.set(s);
  assert.equal(store.get().notes.length, MAX_NOTES);
  assert.equal(new NotesStore(kv, "testusd", me).get().startedAt, null);
  m.set(`nivpay.notes.v1.ausd.${me}`, "{nope");
  assert.equal(store.get().startedAt, null);
});

test("a note says which pot by the name it has", () => {
  let s = fromPoll(start(EMPTY_NOTES, T, 1n), poll({ found: [pot("1", 100)] }));
  s = fromPoll(s, poll({ found: [pot("1", 150)] }));
  assert.equal(s.notes[0]!.name, "Birthday");
});

test("a poll that comes back empty doesn't forget what each pot held", () => {
  let s = fromPoll(start(EMPTY_NOTES, T, 1n), poll({ found: [pot("1", 100)] }));
  s = fromPoll(s, poll({ found: [] }));
  s = fromPoll(s, poll({ found: [pot("1", 130)] }));
  assert.deepEqual(kinds(s), ["chippedIn"]);
  assert.equal(s.notes[0]!.amount, usd(30));
});
