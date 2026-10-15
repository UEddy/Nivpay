import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import { potRisks } from "./potRisks.ts";

const A = getAddress("0x1A9A136f1cf59899C6b8cfE84ac4df388620467d");
const B = getAddress("0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1");
const C = getAddress("0x7EAf7f3e330ac388A0e951e80957B7274597297c");
const HALL = getAddress("0x00000000000000000000000000000000000Fa11a");
const pay = (to: Address, cap = 700n) => ({ to, cap });

test("a fair pot raises nothing: 2 of 3 decide, and none of them can be paid", () => {
  assert.deepEqual(potRisks({ deciders: [A, B, C], threshold: 2, payees: [pay(HALL)], maker: A }), {
    oneCanPay: false,
    deciderPayees: [],
    makerIsPayee: false,
    payeesCanPayThemselves: false,
  });
});

test("one yes is enough to pay", () => {
  assert.equal(potRisks({ deciders: [A, B], threshold: 1, payees: [pay(HALL)], maker: null }).oneCanPay, true);
  assert.equal(potRisks({ deciders: [A], threshold: 1, payees: [pay(HALL)], maker: null }).oneCanPay, true);
  assert.equal(potRisks({ deciders: [A, B], threshold: 0, payees: [pay(HALL)], maker: null }).oneCanPay, true, "never below one");
});

test("a decider who can also be paid is named, once, whatever the letter case", () => {
  const r = potRisks({ deciders: [A, B, C], threshold: 2, payees: [pay(HALL), pay(B.toLowerCase() as Address), pay(B, 5n)], maker: A });
  assert.deepEqual(r.deciderPayees, [B]);
  assert.equal(r.payeesCanPayThemselves, false, "B alone can't reach 2");
});

test("the deciders who can be paid can reach the rule on their own", () => {
  assert.equal(potRisks({ deciders: [A, B, C], threshold: 2, payees: [pay(A), pay(B)], maker: C }).payeesCanPayThemselves, true);
  assert.equal(potRisks({ deciders: [A, B, C], threshold: 3, payees: [pay(A), pay(B)], maker: C }).payeesCanPayThemselves, false);
  // The classic fake fundraiser: one person decides alone and is the only payee.
  const solo = potRisks({ deciders: [A], threshold: 1, payees: [pay(A)], maker: A });
  assert.deepEqual(solo, { oneCanPay: true, deciderPayees: [A], makerIsPayee: true, payeesCanPayThemselves: true });
});

test("the maker can be paid, and an unknown maker is skipped, not cleared", () => {
  assert.equal(potRisks({ deciders: [B], threshold: 1, payees: [pay(A)], maker: A }).makerIsPayee, true);
  assert.equal(potRisks({ deciders: [B], threshold: 1, payees: [pay(HALL)], maker: A }).makerIsPayee, false);
  assert.equal(potRisks({ deciders: [B], threshold: 1, payees: [pay(A)], maker: null }).makerIsPayee, null);
});
