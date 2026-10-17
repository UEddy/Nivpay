import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import { approvedNote, CHANGE_KINDS, CHANGE_STATUSES, changeStatusLine, changeTitle, changeWhat, choicesFor, fromChain, isComing, limitWithRoom, openChanges, widens, type PotChange } from "./changes.ts";
import { changeRefusalFor } from "./changesLive.ts";
import { ERROR_CODES } from "../copy.ts";

const ana = getAddress("0x00000000000000000000000000000000000000a1");
const ben = getAddress("0x00000000000000000000000000000000000000b2");
const dj = getAddress("0x00000000000000000000000000000000000000d3");

const words = {
  payeeName: (i: number) => ["Caterer", "Hall"][i] ?? "someone",
  money: (u: bigint) => `$${(Number(u) / 1e6).toFixed(2)}`,
  when: (s: bigint) => (s === 1_760_950_800n ? "Mon 20 Oct, 09:00" : `t${s}`),
};

function change(over: Partial<PotChange>): PotChange {
  return {
    id: 0n,
    kind: "add",
    status: "pending",
    destIndex: 0,
    to: dj,
    label: "DJ",
    limit: 300_000_000n,
    endTime: 0n,
    proposer: ana,
    expiresAt: 0n,
    appliesAt: 0n,
    lapsesAt: 0n,
    approvals: 1,
    threshold: 2,
    approvedBy: [ana],
    ...over,
  };
}

test("the kinds and statuses are in the contract's order", () => {
  // NivPayPotsV2.ChangeKind and ChangeStatus: a wrong order would show one change as another.
  assert.deepEqual(CHANGE_KINDS, ["add", "raise", "later", "lower", "remove"]);
  assert.deepEqual(CHANGE_STATUSES, ["pending", "waiting", "ready", "applied", "withdrawn", "expired", "lapsed"]);
  assert.deepEqual(CHANGE_KINDS.filter(widens), ["add", "raise", "later"]);
});

test("each change reads as what it does", () => {
  assert.equal(changeTitle(change({}), words), "Add DJ, up to $300.00");
  assert.equal(changeWhat(change({ kind: "raise", destIndex: 0, limit: 660_000_000n }), words), "raise Caterer's limit to $660.00");
  assert.equal(changeWhat(change({ kind: "lower", destIndex: 1, limit: 200_000_000n }), words), "lower Hall's limit to $200.00");
  assert.equal(changeWhat(change({ kind: "remove", destIndex: 1 }), words), "remove Hall");
  assert.equal(changeWhat(change({ kind: "later", endTime: 1_760_950_800n }), words), "close later, on Mon 20 Oct, 09:00");
  assert.equal(changeWhat(change({ label: "" }), words), "add someone it can pay, up to $300.00", "an added payee with no name");
});

test("everyone with money in is told what changes, when, and that they can leave first", () => {
  const agreed = change({ status: "waiting", appliesAt: 1_760_950_800n, approvals: 2, approvedBy: [ana, ben] });
  assert.equal(approvedNote(agreed, words), "Change agreed: add DJ, up to $300.00. Takes effect Mon 20 Oct, 09:00. If you disagree, take your part out before then.");
  assert.ok(isComing(agreed));
  assert.ok(isComing({ ...agreed, status: "ready" }));
  assert.ok(!isComing({ ...agreed, status: "applied" }));
  assert.ok(!isComing(change({})), "not before it is agreed");
});

test("where a change stands", () => {
  assert.equal(changeStatusLine(change({}), words), "1 of 2 yeses so far.");
  assert.equal(changeStatusLine(change({ status: "waiting", appliesAt: 1_760_950_800n }), words), "Agreed. Takes effect Mon 20 Oct, 09:00.");
  assert.match(changeStatusLine(change({ status: "ready" }), words), /Anyone can make the change now/);
  for (const status of CHANGE_STATUSES) assert.ok(changeStatusLine(change({ status }), words).length > 0, status);
});

test("only open changes are listed, oldest first", () => {
  const all = [change({ id: 3n, status: "waiting" }), change({ id: 1n }), change({ id: 2n, status: "applied" }), change({ id: 4n, status: "lapsed" }), change({ id: 5n, status: "ready" })];
  assert.deepEqual(openChanges(all).map((c) => c.id), [1n, 3n, 5n]);
});

test("what each person may do with a change", () => {
  const pending = change({});
  assert.deepEqual(choicesFor(pending, ben, true), { yes: true, withdraw: false, apply: false });
  assert.deepEqual(choicesFor(pending, ana, true), { yes: false, withdraw: true, apply: false }, "the proposer's yes is already in");
  assert.deepEqual(choicesFor(pending, dj, false), { yes: false, withdraw: false, apply: false }, "someone who doesn't decide just sees it");
  const ready = change({ status: "ready", approvals: 2, approvedBy: [ana, ben] });
  assert.deepEqual(choicesFor(ready, dj, false), { yes: false, withdraw: false, apply: true }, "anyone can make a ready change");
  assert.deepEqual(choicesFor(ready, ana, true), { yes: false, withdraw: true, apply: true });
  assert.deepEqual(choicesFor(change({ status: "applied" }), ana, true), { yes: false, withdraw: false, apply: false });
});

test("a limit with room: 10% more, up to the next whole dollar", () => {
  const $ = (d: number) => BigInt(Math.round(d * 1e6));
  assert.equal(limitWithRoom($(600), 6), $(660));
  assert.equal(limitWithRoom($(450), 6), $(495));
  assert.equal(limitWithRoom($(99.5), 6), $(110), "109.45 rounds up to 110");
  assert.equal(limitWithRoom($(0.01), 6), $(1));
  assert.equal(limitWithRoom(0n, 6), 0n);
  assert.ok(limitWithRoom($(1234.56), 6) >= ($(1234.56) * 11n) / 10n);
});

test("a change read from the chain", () => {
  const c = fromChain(7n, {
    kind: 1,
    status: 1,
    destIndex: 0,
    to: "0x00000000000000000000000000000000000000c4" as Address,
    label: "",
    limit: 660_000_000n,
    endTime: 0n,
    proposer: ana,
    expiresAt: 100n,
    appliesAt: 200n,
    lapsesAt: 300n,
    approvals: 2,
    threshold: 2,
    approvedBy: [ana, ben],
  });
  assert.equal(c.kind, "raise");
  assert.equal(c.status, "waiting");
  assert.equal(c.id, 7n);
  assert.throws(() => fromChain(1n, { ...c, kind: 9, status: 0, approvedBy: [] }), /unknown change/);
});

test("every refusal has a neutral code and says nothing was sent", () => {
  for (const name of ["NotApprover", "PotClosed", "TooManyOpenChanges", "ChangeNotReady", "ChangeNotPending", "ChangeNotOpen", "ProposalExpired", "PotFrozen", "LimitBelowSpent", "NotWider", "NotNarrower", "Whatever", undefined]) {
    const e = changeRefusalFor(name);
    assert.ok(Object.values(ERROR_CODES).includes(e.code as never), String(name));
    assert.match(e.message, /Nothing was sent/, String(name));
  }
  assert.equal(changeRefusalFor("ChangeNotReady").code, ERROR_CODES.CHANGE_NOT_READY);
  assert.equal(changeRefusalFor("TooManyOpenChanges").code, ERROR_CODES.CHANGE_REFUSED);
});
