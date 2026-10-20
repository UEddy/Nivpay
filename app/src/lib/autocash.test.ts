import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, getAddress } from "viem";
import { allowanceToSign, deskCanMove, amountToMove, cancelPending, change, cleanBankName, cleanRequest, cleanSettings, DAY_MS, DEFAULT_CAP, lastFour, movedToday, settle, turnOff, WAIT_MS, type AutoCashRequest } from "./autocash.ts";
import { ALLOWANCE_ABI, allowanceFor } from "./autocashLive.ts";

const $ = (n: number) => BigInt(Math.round(n * 100)) * 10_000n;
const FIRST = { name: "First Bank", last4: "6789" };
const GT = { name: "GTBank", last4: "1234" };
const ask = (extra: Partial<AutoCashRequest> = {}): AutoCashRequest => ({ currency: "NGN", bank: FIRST, keep: null, cap: DEFAULT_CAP.toString(), ...extra });
const T0 = Date.UTC(2026, 9, 20, 9, 40);

test("only the bank's name and the last 4 digits are kept, never a full account number", () => {
  assert.equal(lastFour("0123456789"), "6789");
  assert.equal(lastFour("0123 4567-89"), "6789");
  assert.equal(lastFour("GB29 NWBK 6016 1331 9268 19"), "6819");
  for (const bad of ["123", "12345", "ABCDEFGH", "01234567ab", "1234567890123456789012345678901234567"]) assert.equal(lastFour(bad), null, bad);
  assert.equal(cleanBankName("  First   Bank "), "First Bank");
  for (const bad of ["F", "First Bank 0123456789", "x".repeat(41), "<b>Bank</b>"]) assert.equal(cleanBankName(bad), null, bad);
  // A request carrying anything more than the four fields, or a longer number, is refused whole.
  assert.equal(cleanRequest({ ...ask(), accountNumber: "0123456789" }, ["NGN"]), null);
  assert.equal(cleanRequest(ask({ bank: { name: "First Bank", last4: "456789" } }), ["NGN"]), null);
  assert.equal(cleanRequest(ask({ bank: { name: "First Bank", last4: "6789", number: "0123456789" } as never }), ["NGN"]), null);
  assert.deepEqual(cleanRequest(ask(), ["NGN"]), ask());
});

test("a request needs a known currency and a cap of $1 to $1,000", () => {
  assert.equal(cleanRequest(ask({ currency: "XYZ" }), ["NGN"]), null);
  assert.equal(cleanRequest(ask({ cap: "999999" }), ["NGN"]), null);
  assert.equal(cleanRequest(ask({ cap: $(1000.01).toString() }), ["NGN"]), null);
  assert.ok(cleanRequest(ask({ cap: $(1).toString(), keep: $(100).toString() }), ["NGN"]));
});

test("never more than arrived, never past the cap, the balance to keep, or the allowance", () => {
  const base = { arrived: $(50), balance: $(50), keep: null, capLeft: $(500), allowance: $(500) };
  assert.deepEqual(amountToMove(base), { amount: $(50), held: null });
  // Money already there is left alone: only what arrived moves.
  assert.deepEqual(amountToMove({ ...base, balance: $(350) }), { amount: $(50), held: null });
  // Spent since: only what is still there.
  assert.deepEqual(amountToMove({ ...base, balance: $(30) }), { amount: $(30), held: "kept" });
  // Keep $100. Holding $170 after $50 arrived: all $50 move. Holding $130: only the $30 above $100. Holding $90: nothing.
  assert.deepEqual(amountToMove({ ...base, balance: $(170), keep: $(100) }), { amount: $(50), held: null });
  assert.deepEqual(amountToMove({ ...base, balance: $(130), keep: $(100) }), { amount: $(30), held: "kept" });
  assert.deepEqual(amountToMove({ ...base, balance: $(90), keep: $(100) }), { amount: 0n, held: "kept" });
  assert.deepEqual(amountToMove({ ...base, capLeft: $(20) }), { amount: $(20), held: "cap" });
  assert.deepEqual(amountToMove({ ...base, capLeft: 0n }), { amount: 0n, held: "cap" });
  assert.deepEqual(amountToMove({ ...base, allowance: $(10) }), { amount: $(10), held: "allowance" });
  assert.deepEqual(amountToMove({ ...base, arrived: $(0.5), balance: $(0.5) }), { amount: 0n, held: "small" });
  // Whatever the inputs, the amount is never more than arrived, the room, the cap or the allowance.
  for (let i = 0; i < 2000; i++) {
    const r = () => BigInt(Math.floor(Math.random() * 600_000_000));
    const x = { arrived: r(), balance: r(), keep: Math.random() < 0.5 ? null : r(), capLeft: r(), allowance: r() };
    const { amount } = amountToMove(x);
    const room = x.keep === null ? x.balance : x.balance > x.keep ? x.balance - x.keep : 0n;
    assert.ok(amount <= x.arrived && amount <= room && amount <= x.capLeft && amount <= x.allowance, JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  }
});

test("the cap counts what moved in the last 24 hours", () => {
  const moves = [
    { dollars: $(200).toString(), at: T0 - DAY_MS - 1 },
    { dollars: $(150).toString(), at: T0 - DAY_MS + 1 },
    { dollars: $(50).toString(), at: T0 },
  ];
  assert.equal(movedToday(moves, T0), $(200));
  assert.equal(movedToday(moves, T0 + DAY_MS), 0n);
});

test("the first time, everything applies at once", () => {
  const s = change(null, ask(), T0);
  assert.deepEqual(s, { on: true, currency: "NGN", bank: FIRST, keep: null, cap: DEFAULT_CAP.toString(), since: T0, pending: null });
});

test("a lower cap, a higher balance to keep and a currency apply at once", () => {
  const s = change(null, ask(), T0);
  const next = change(s, ask({ cap: $(200).toString(), keep: $(100).toString(), currency: "GHS" }), T0 + 1000);
  assert.deepEqual(next, { ...s, cap: $(200).toString(), keep: $(100).toString(), currency: "GHS" });
});

test("a new bank or a higher cap waits 24 hours, and the old ones are used until then", () => {
  const s = change(null, ask(), T0);
  const next = change(s, ask({ bank: GT, cap: $(800).toString() }), T0 + 1000);
  assert.deepEqual(next.bank, FIRST);
  assert.equal(next.cap, DEFAULT_CAP.toString());
  assert.deepEqual(next.pending, { bank: GT, cap: $(800).toString(), startsAt: T0 + 1000 + WAIT_MS });
  assert.deepEqual(settle(next, T0 + 1000 + WAIT_MS - 1), next);
  const later = settle(next, T0 + 1000 + WAIT_MS);
  assert.deepEqual([later.bank, later.cap, later.pending], [GT, $(800).toString(), null]);
  // Cancel: the bank and cap in force stay.
  assert.deepEqual(cancelPending(next), { ...next, pending: null });
  // Asking again for what is in force drops what waits.
  assert.equal(change(next, ask(), T0 + 2000).pending, null);
  // A lower cap while a raise waits: lower at once, the raise dropped.
  const lower = change(next, ask({ cap: $(100).toString() }), T0 + 3000);
  assert.deepEqual([lower.cap, lower.pending], [$(100).toString(), null]);
});

test("off at once; on again keeps its first time, and a new bank still waits", () => {
  const s = change(null, ask(), T0);
  const off = turnOff(change(s, ask({ bank: GT }), T0 + 1));
  assert.deepEqual([off.on, off.pending], [false, null]);
  const again = change(off, ask({ bank: GT }), T0 + 5000);
  assert.deepEqual([again.on, again.since, again.bank, again.pending?.bank], [true, T0 + 5000, FIRST, GT]);
  // Still on: switched on time stays, so money that arrived while on still counts.
  assert.equal(change(s, ask({ keep: $(10).toString() }), T0 + 9).since, T0);
});

test("stored settings are read back only if every field is well formed", () => {
  const s = change(change(null, ask(), T0), ask({ bank: GT }), T0 + 1);
  assert.deepEqual(cleanSettings(JSON.parse(JSON.stringify(s)), ["NGN"]), s);
  assert.equal(cleanSettings({ ...s, bank: { name: "First Bank", last4: "0123456789" } }, ["NGN"]), null);
  assert.equal(cleanSettings({ ...s, pending: { bank: { name: "x", last4: "1" }, startsAt: 1 } }, ["NGN"]), null);
  assert.equal(cleanSettings(null, ["NGN"]), null);
});

test("the allowance signed is exactly the cap in force, a total: never a cap still waiting, never more", () => {
  const desk = getAddress("0x7EAf7f3e330ac388A0e951e80957B7274597297c");
  const signed = (cap: string) => {
    const { amount, data } = allowanceFor(desk, cap);
    const call = decodeFunctionData({ abi: ALLOWANCE_ABI, data });
    assert.equal(call.functionName, "approve");
    assert.deepEqual(call.args, [desk, amount]);
    return amount;
  };
  const on = change(null, ask(), T0);
  assert.equal(signed(on.cap), DEFAULT_CAP);
  assert.equal(allowanceToSign(on), DEFAULT_CAP);
  // A higher cap waits 24 hours: the allowance stays the cap in force until it applies.
  const raised = change(on, ask({ cap: $(800).toString() }), T0 + 1);
  assert.equal(signed(raised.cap), DEFAULT_CAP);
  assert.equal(signed(settle(raised, T0 + 1 + WAIT_MS).cap), $(800));
  // A lower cap applies at once, and so does the allowance.
  assert.equal(signed(change(on, ask({ cap: $(100).toString() }), T0 + 2).cap), $(100));
  for (const cap of [$(1), $(37.5), $(1000)]) assert.equal(signed(cap.toString()), cap);
});

test("the desk can move nothing while the allowance is 0 or under $1, and the screen must say so", () => {
  assert.equal(deskCanMove(0n), false);
  assert.equal(deskCanMove($(0.99)), false);
  assert.equal(deskCanMove($(1)), true);
  assert.equal(deskCanMove($(480)), true);
  // Not read yet: never shown as stopped on a guess.
  assert.equal(deskCanMove(null), true);
});
