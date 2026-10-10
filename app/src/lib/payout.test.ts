import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address, Hex } from "viem";
import { ERROR_CODES } from "../copy.ts";
import type { PotEvent } from "./feed.ts";
import {
  askedAt,
  askLabel,
  askView,
  feeFor,
  isExpired,
  localTime,
  refusalFor,
  requestsFrom,
  requestView,
  statusFrom,
  takeBackLabel,
  ttlDays,
  PAID_MOTION,
  waitingRequests,
  yesLabel,
  type PotFacts,
  type RequestFacts,
} from "./payout.ts";

// Mama's 60th, in base units of a 6 decimal dollar.
const $ = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;
const IDARA = "0x1111111111111111111111111111111111111111" as Address;
const UBONG = "0x2222222222222222222222222222222222222222" as Address;
const ANIEKAN = "0x3333333333333333333333333333333333333333" as Address;
const STRANGER = "0x4444444444444444444444444444444444444444" as Address;
const FEE_BPS = 50n;
const FEE_CAP = $(50);
const TTL = 604_800n;
const ASKED = 1_800_000_000n;

const pot = (over: Partial<PotFacts> = {}): PotFacts => ({
  closed: false,
  frozen: false,
  totalAssets: $(1000),
  threshold: 2,
  deciders: [IDARA, UBONG, ANIEKAN],
  payees: [
    { name: "Caterer", cap: $(700), spent: 0n },
    { name: "Event hall", cap: $(300), spent: 0n },
  ],
  decimals: 6,
  ...over,
});

const request = (over: Partial<RequestFacts> = {}): RequestFacts => ({
  proposalId: 7n,
  potId: 0n,
  kind: 0,
  payee: 0,
  amount: $(600),
  fee: $(3),
  asker: ANIEKAN,
  createdAt: ASKED,
  expiresAt: ASKED + TTL,
  yes: [ANIEKAN],
  threshold: 2,
  status: "waiting",
  ...over,
});

test("the fee matches the contract: 50 bps, floored, then capped", () => {
  assert.equal(feeFor($(600), FEE_BPS, FEE_CAP), $(3));
  assert.equal(feeFor($(280), FEE_BPS, FEE_CAP), $(1.4));
  assert.equal(feeFor(199n, FEE_BPS, FEE_CAP), 0n, "under a cent of fee floors to nothing");
  assert.equal(feeFor($(1_000_000), FEE_BPS, FEE_CAP), FEE_CAP);
  assert.equal(ttlDays(TTL), 7);
});

test("labels for a reload name the pot or the request", () => {
  assert.equal(askLabel(3n), "ask 3");
  assert.equal(yesLabel(7n), "yes 7");
  assert.equal(takeBackLabel(7n), "take back 7");
});

test("ask: the fee and what is left are shown before the asker's own yes, and asking counts as one yes", () => {
  const v = askView(pot(), ANIEKAN, 0, $(600), FEE_BPS, FEE_CAP);
  assert.equal(v.refusal, null);
  assert.equal(v.fee, $(3));
  assert.equal(v.leftAfter, $(397));
  assert.equal(v.limitAfter, $(600));
  assert.equal(v.more, 1);
  assert.equal(askView(pot({ threshold: 1 }), ANIEKAN, 0, $(600), FEE_BPS, FEE_CAP).more, 0, "1 of n pays on asking");
});

test("ask: each refusal has its own code, found before anything is signed", () => {
  const code = (v: ReturnType<typeof askView>) => v.refusal?.code;
  assert.equal(code(askView(pot(), STRANGER, 0, $(600), FEE_BPS, FEE_CAP)), ERROR_CODES.NOT_DECIDER);
  assert.equal(code(askView(pot({ closed: true }), ANIEKAN, 0, $(600), FEE_BPS, FEE_CAP)), ERROR_CODES.PAY_POT_STOPPED);
  assert.equal(code(askView(pot({ frozen: true }), ANIEKAN, 0, $(600), FEE_BPS, FEE_CAP)), ERROR_CODES.PAY_POT_STOPPED);
  assert.equal(code(askView(pot(), ANIEKAN, 0, null, FEE_BPS, FEE_CAP)), ERROR_CODES.PAY_NO_AMOUNT);
  assert.equal(code(askView(pot(), ANIEKAN, 0, 0n, FEE_BPS, FEE_CAP)), ERROR_CODES.PAY_NO_AMOUNT);
  assert.equal(code(askView(pot(), ANIEKAN, 0, $(700.01), FEE_BPS, FEE_CAP)), ERROR_CODES.PAY_OVER_LIMIT);
  const spent = pot({ payees: [{ name: "Caterer", cap: $(700), spent: $(600) }, { name: "Event hall", cap: $(300), spent: 0n }] });
  const over = askView(spent, ANIEKAN, 0, $(101), FEE_BPS, FEE_CAP).refusal;
  assert.equal(over?.code, ERROR_CODES.PAY_OVER_LIMIT);
  assert.match(over!.message, /Caterer can still be paid from this pot: \$100 left/);
  // Exactly the limit is fine; the fee doesn't count against it.
  assert.equal(askView(pot(), ANIEKAN, 0, $(700), FEE_BPS, FEE_CAP).refusal, null);
  // The pot must cover the amount and the fee together.
  assert.equal(code(askView(pot({ totalAssets: $(602) }), ANIEKAN, 0, $(600), FEE_BPS, FEE_CAP)), ERROR_CODES.PAY_POT_SHORT);
  assert.equal(askView(pot({ totalAssets: $(603) }), ANIEKAN, 0, $(600), FEE_BPS, FEE_CAP).refusal, null);
});

test("request: waiting for my yes, and my yes is the one that pays", () => {
  const v = requestView(request(), pot(), UBONG, ASKED + 60n);
  assert.equal(v.stage, "can-say-yes");
  assert.equal(v.needed, 1);
  assert.equal(v.paysOnMyYes, true);
  assert.equal(v.leftAfter, $(397));
  assert.equal(v.limitAfter, $(600));
  assert.equal(v.canTakeBack, false);
});

test("request: waiting for my yes in a pot that needs more than one more", () => {
  const v = requestView(request({ threshold: 3 }), pot({ threshold: 3 }), UBONG, ASKED);
  assert.equal(v.stage, "can-say-yes");
  assert.equal(v.needed, 2);
  assert.equal(v.paysOnMyYes, false);
});

test("request: I already said yes, so I can take it back", () => {
  const asker = requestView(request({ threshold: 3 }), pot({ threshold: 3 }), ANIEKAN, ASKED);
  assert.equal(asker.stage, "said-yes", "asking counts as the asker's yes");
  assert.equal(asker.canTakeBack, true);
  assert.equal(asker.refusal?.code, ERROR_CODES.REQUEST_DECIDED);
});

test("request: my yes would pay it but the pot can't cover it yet, or it's over the payee's limit", () => {
  const short = requestView(request(), pot({ totalAssets: $(500) }), UBONG, ASKED);
  assert.equal(short.stage, "cannot-pay-yet");
  assert.equal(short.refusal?.code, ERROR_CODES.PAY_POT_SHORT);
  const limit = requestView(request(), pot({ payees: [{ name: "Caterer", cap: $(700), spent: $(200) }] }), UBONG, ASKED);
  assert.equal(limit.stage, "cannot-pay-yet");
  assert.equal(limit.refusal?.code, ERROR_CODES.PAY_OVER_LIMIT);
  // Not my yes that pays: saying yes is still fine, the check comes at the last one.
  assert.equal(requestView(request({ threshold: 3 }), pot({ threshold: 3, totalAssets: $(500) }), UBONG, ASKED).stage, "can-say-yes");
});

test("request: paid, withdrawn and expired are final, and only a waiting yes can be taken back", () => {
  const paid = requestView(request({ status: "paid", yes: [ANIEKAN, UBONG] }), pot({ totalAssets: $(397) }), UBONG, ASKED);
  assert.equal(paid.stage, "paid");
  assert.equal(paid.canTakeBack, false);
  assert.equal(paid.leftAfter, $(397), "after paying, what is left is what the pot holds");
  const withdrawn = requestView(request({ status: "withdrawn" }), pot(), ANIEKAN, ASKED);
  assert.equal(withdrawn.stage, "withdrawn");
  assert.equal(withdrawn.canTakeBack, false);
  const expired = requestView(request(), pot(), ANIEKAN, ASKED + TTL + 1n);
  assert.equal(expired.stage, "expired");
  assert.equal(expired.refusal?.code, ERROR_CODES.REQUEST_EXPIRED);
  assert.equal(expired.canTakeBack, false);
});

test("request: expiry uses the contract's strict 'after', at the finalized block's time", () => {
  assert.equal(isExpired(request(), ASKED + TTL), false);
  assert.equal(isExpired(request(), ASKED + TTL + 1n), true);
  assert.equal(isExpired(request({ status: "paid" }), ASKED + TTL + 1n), false);
  assert.equal(requestView(request(), pot(), UBONG, ASKED + TTL).stage, "can-say-yes");
});

test("request: someone who doesn't decide can follow it but not answer it", () => {
  const v = requestView(request(), pot(), STRANGER, ASKED);
  assert.equal(v.stage, "watching");
  assert.equal(v.refusal?.code, ERROR_CODES.NOT_DECIDER);
});

test("request: a paused or closed pot stops every yes, but a yes already given can still be taken back", () => {
  const paused = requestView(request({ threshold: 3 }), pot({ threshold: 3, frozen: true }), ANIEKAN, ASKED);
  assert.equal(paused.stage, "stopped");
  assert.equal(paused.canTakeBack, true);
  assert.equal(requestView(request(), pot({ closed: true }), UBONG, ASKED).stage, "stopped");
});

test("proposalInfo's status codes: Pending, Executed, Cancelled, and Expired read as waiting until timed", () => {
  assert.deepEqual([0, 1, 2, 3].map(statusFrom), ["waiting", "paid", "withdrawn", "waiting"]);
});

test("every contract refusal maps to a payment code, and anything unknown to 29", () => {
  const cases: [string | undefined, number][] = [
    ["NotApprover", ERROR_CODES.NOT_DECIDER],
    ["ZeroAmount", ERROR_CODES.PAY_NO_AMOUNT],
    ["CapExceeded", ERROR_CODES.PAY_OVER_LIMIT],
    ["InsufficientPotAssets", ERROR_CODES.PAY_POT_SHORT],
    ["PotClosed", ERROR_CODES.PAY_POT_STOPPED],
    ["PotFrozen", ERROR_CODES.PAY_POT_STOPPED],
    ["ProposalExpired", ERROR_CODES.REQUEST_EXPIRED],
    ["ProposalNotPending", ERROR_CODES.REQUEST_DECIDED],
    ["AlreadyApproved", ERROR_CODES.REQUEST_DECIDED],
    ["NotApproved", ERROR_CODES.REQUEST_DECIDED],
    ["SafeERC20FailedOperation", ERROR_CODES.REQUEST_REFUSED],
    [undefined, ERROR_CODES.REQUEST_REFUSED],
  ];
  for (const [name, code] of cases) assert.equal(refusalFor(name).code, code, String(name));
  assert.match(refusalFor("CapExceeded", pot({ payees: [{ name: "Caterer", cap: $(700), spent: $(600) }] }), { payee: 0 }).message, /\$100 left/);
});

const ev = (name: string, block: number, logIndex: number, args: Record<string, unknown>, tx: Hex = `0x${String(block).padStart(64, "0")}`): PotEvent => ({
  name,
  block: BigInt(block),
  logIndex,
  tx,
  args: { potId: 0n, ...args },
});

test("requests are read from the feed: who said yes, taken back, paid with its fee, or withdrawn", () => {
  const events: PotEvent[] = [
    ev("Funded", 10, 0, { funder: IDARA, assets: $(500) }),
    ev("Proposed", 20, 0, { proposalId: 0n, proposer: ANIEKAN, kind: 0, destIndex: 0, amount: $(600), expiresAt: ASKED + TTL }),
    ev("Approved", 20, 1, { proposalId: 0n, approver: ANIEKAN, approvals: 1 }),
    ev("Proposed", 21, 0, { proposalId: 1n, proposer: IDARA, kind: 1, destIndex: 0, amount: 0n, expiresAt: ASKED + TTL }),
    ev("Approved", 22, 0, { proposalId: 0n, approver: IDARA, approvals: 2 }),
    ev("ApprovalRevoked", 23, 0, { proposalId: 0n, approver: IDARA, approvals: 1 }),
    ev("Approved", 24, 0, { proposalId: 0n, approver: UBONG, approvals: 2 }, "0xabc0000000000000000000000000000000000000000000000000000000000000"),
    ev("PayoutExecuted", 24, 1, { proposalId: 0n, destination: STRANGER, destIndex: 0, amount: $(600), fee: $(3) }, "0xabc0000000000000000000000000000000000000000000000000000000000000"),
    ev("Proposed", 30, 0, { proposalId: 2n, proposer: UBONG, kind: 0, destIndex: 1, amount: $(280), expiresAt: ASKED + TTL }),
    ev("Approved", 30, 1, { proposalId: 2n, approver: UBONG, approvals: 1 }),
    ev("Proposed", 31, 0, { proposalId: 3n, proposer: UBONG, kind: 0, destIndex: 1, amount: $(1), expiresAt: ASKED + TTL }),
    ev("ProposalCancelled", 32, 0, { proposalId: 3n, proposer: UBONG }),
  ];
  const all = requestsFrom(events);
  assert.deepEqual(all.map((r) => r.proposalId), [3n, 2n, 0n], "payments only, newest first; the close request is left out");
  const [withdrawn, waiting, paid] = all;
  assert.equal(withdrawn!.status, "withdrawn");
  assert.equal(waiting!.status, "waiting");
  assert.deepEqual(waiting!.yes, [UBONG]);
  assert.equal(waiting!.payee, 1);
  assert.equal(paid!.status, "paid");
  assert.equal(paid!.fee, $(3));
  assert.deepEqual(paid!.yes, [ANIEKAN, UBONG], "Idara's yes was taken back");
  assert.equal(paid!.paidIn, "0xabc0000000000000000000000000000000000000000000000000000000000000");
  assert.deepEqual(waitingRequests(all, ASKED).map((r) => r.proposalId), [2n]);
  assert.deepEqual(waitingRequests(all, ASKED + TTL + 1n), [], "expired requests stop marching");
});

test("times show in each person's own zone", () => {
  const t = BigInt(Date.UTC(2026, 9, 14, 8, 12) / 1000);
  assert.equal(askedAt(t, "Africa/Lagos"), "14 Oct, 09:12");
  assert.equal(askedAt(t, "America/Chicago"), "14 Oct, 03:12");
  assert.equal(localTime(Date.UTC(2026, 9, 14, 11, 40), "Europe/London"), "12:40");
});

test("the paid motion: the check lands as the stream arrives, the drain ends before the line, about 2.2 s in all", () => {
  const m = PAID_MOTION;
  assert.ok(m.stream + m.flight <= m.check, "the payee is checked only once the stream reaches it");
  assert.ok(m.check - (m.stream + m.flight) <= 100, "and right then");
  assert.ok(m.stream + m.drain <= m.done, "the level has settled before the line says so");
  assert.ok(m.upright > m.check && m.upright < m.done);
  assert.ok(m.done >= 2_000 && m.done <= 2_400, "about 2.2 s");
});
