import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeAbiParameters, getAddress, pad, toEventSelector, type Log } from "viem";
import { ERROR_CODES } from "../copy.ts";
import { ERC20_ALLOWANCE_ABI, SETTLEMENT_PAIR_ABI, SETTLEMENT_WHITELISTER_ABI } from "./abi.ts";
import { AppError } from "./errors.ts";
import { formatCurrency } from "./money.ts";
import {
  amountOut,
  assertSameQuote,
  currencyLabel,
  EXCHANGE_GAS,
  fromCurrencyLabel,
  quote,
  received,
  settlementCalls,
  stepOf,
  type SettlementState,
} from "./settle.ts";

const ME = getAddress("0x725c9a4bb4c3de2f11ac0e7c9b1e8f0d3a2b7bc1");
const UBONG = getAddress("0x1111111111111111111111111111111111111111");
const S = {
  pair: getAddress("0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae"),
  whitelister: getAddress("0x7c10F56d6f04a51376393a1C3670e966863F6BD5"),
  dollar: getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC"),
  other: getAddress("0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D"),
};
/** The live pair on 9 Oct 2026: 1:1, no fee, about 981,616 CTK. */
const ONE_TO_ONE = 10n ** 30n;
const TEN = 10_000_000n;
const live: SettlementState = {
  paused: false,
  price: ONE_TO_ONE,
  priceAtDeadline: ONE_TO_ONE,
  fee: 0n,
  quotedOut: 10n * 10n ** 18n,
  reserveOut: 981_615_630_000_000_000_000_000n,
  isSetUp: false,
  allowance: 0n,
  inDecimals: 6,
  outDecimals: 18,
  outSymbol: "CTK",
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : "not an app error";
  }
  return null;
};

test("the formula is the pair's: 10 AUSD buys exactly 10 CTK at 1:1 with no fee", () => {
  assert.deepEqual(amountOut(TEN, ONE_TO_ONE, 0n), { out: 10n * 10n ** 18n, fee: 0n });
});

test("a fee comes out of what the recipient gets and is rounded up, as the pair rounds it", () => {
  // 0.05 percent, the most the pair's admin may set today.
  const { out, fee } = amountOut(TEN, ONE_TO_ONE, 5n * 10n ** 14n);
  assert.equal(fee, 5n * 10n ** 15n);
  assert.equal(out, 10n * 10n ** 18n - fee);
  assert.equal(amountOut(1n, ONE_TO_ONE, 1n).fee, 1n, "a fraction of a unit still costs a unit");
});

test("a quote shows both amounts, the rate, and a minimum no lower than what's promised", () => {
  const q = quote(live, TEN, 1_800_000_000n);
  assert.equal(q.out, 10n * 10n ** 18n);
  assert.equal(q.minOut, q.out);
  assert.equal(q.rate, 10n ** 18n, "one dollar buys one CTK");
  assert.equal(formatCurrency(q.out, q.outDecimals, q.outSymbol), "10.00 CTK");
  assert.deepEqual([q.needsSetup, q.needsAllowance], [true, true]);
});

test("if the price could fall before the deadline, the minimum is the lower of the two", () => {
  const q = quote({ ...live, priceAtDeadline: (ONE_TO_ONE * 99n) / 100n }, TEN, 1n);
  assert.equal(q.minOut, (10n * 10n ** 18n * 99n) / 100n);
  assert.equal(q.out, 10n * 10n ** 18n);
});

test("paused, nothing to send, and more than the pair holds are refused with their own codes", () => {
  assert.equal(code(() => quote({ ...live, paused: true }, TEN, 1n)), ERROR_CODES.PAIR_PAUSED);
  assert.equal(code(() => quote(live, 0n, 1n)), ERROR_CODES.SEND_NO_AMOUNT);
  assert.equal(code(() => quote({ ...live, reserveOut: 9n * 10n ** 18n }, TEN, 1n)), ERROR_CODES.LOW_LIQUIDITY);
});

test("a quote that changed in any way before signing is refused, so the person sees the new one", () => {
  const shown = quote(live, TEN, 1n);
  assert.doesNotThrow(() => assertSameQuote(shown, quote(live, TEN, 2n)));
  assert.equal(code(() => assertSameQuote(shown, quote({ ...live, quotedOut: shown.out - 1n }, TEN, 1n))), ERROR_CODES.QUOTE_CHANGED);
  assert.equal(code(() => assertSameQuote(shown, quote({ ...live, fee: 10n ** 14n, quotedOut: amountOut(TEN, ONE_TO_ONE, 10n ** 14n).out }, TEN, 1n))), ERROR_CODES.QUOTE_CHANGED);
});

test("the first time: setup, then the allowance for exactly this amount, then the exchange to the recipient", () => {
  const q = quote(live, TEN, 1_800_000_000n);
  const calls = settlementCalls(S, q, ME, UBONG);
  assert.deepEqual(calls.map((c) => c.to), [S.whitelister, S.dollar, S.pair]);

  const setup = decodeFunctionData({ abi: SETTLEMENT_WHITELISTER_ABI, data: calls[0]!.data });
  assert.deepEqual([setup.functionName, setup.args], ["setApprovedSwapper", [ME]]);
  const allow = decodeFunctionData({ abi: ERC20_ALLOWANCE_ABI, data: calls[1]!.data });
  assert.deepEqual([allow.functionName, allow.args], ["approve", [S.pair, TEN]]);
  const exchange = decodeFunctionData({ abi: SETTLEMENT_PAIR_ABI, data: calls[2]!.data });
  assert.equal(exchange.functionName, "swapExactTokensForTokens");
  assert.deepEqual(exchange.args, [TEN, q.minOut, [S.dollar, S.other], UBONG, 1_800_000_000n]);
  assert.equal(calls[2]!.gas, EXCHANGE_GAS);
  assert.equal(calls[0]!.gas, undefined, "the setup and the allowance are estimated");
});

test("once set up and with enough allowed, it's the exchange alone", () => {
  const calls = settlementCalls(S, quote({ ...live, isSetUp: true, allowance: TEN }, TEN, 1n), ME, UBONG);
  assert.deepEqual(calls.map((c) => c.to), [S.pair]);
  assert.deepEqual(settlementCalls(S, quote({ ...live, isSetUp: true }, TEN, 1n), ME, UBONG).map((c) => c.to), [S.dollar, S.pair]);
});

test("every step's label says who and how much, so a reload can resume it", () => {
  const q = quote(live, TEN, 1n);
  for (const step of ["setup", "allow", "send"] as const) {
    assert.deepEqual(fromCurrencyLabel(currencyLabel(UBONG, q, step)), { to: UBONG, amountIn: TEN, minOut: q.minOut });
  }
  assert.equal(fromCurrencyLabel("send 0x1111111111111111111111111111111111111111 1"), null);
});

test("what the recipient received is read from the exchange's receipt, in the other currency only", () => {
  const topic = toEventSelector("Transfer(address,address,uint256)");
  const log = (token: `0x${string}`, from: `0x${string}`, to: `0x${string}`, value: bigint) =>
    ({ address: token, topics: [topic, pad(from, { size: 32 }), pad(to, { size: 32 })], data: encodeAbiParameters([{ type: "uint256" }], [value]) }) as unknown as Log;
  const logs = [log(S.dollar, ME, S.pair, TEN), log(S.other, S.pair, UBONG, 10n * 10n ** 18n), log(S.other, S.pair, ME, 1n)];
  assert.equal(received(logs, S.other, UBONG), 10n * 10n ** 18n);
  assert.equal(received(logs, S.dollar, UBONG), 0n);
});

test("each step is told apart by its label", () => {
  const q = quote(live, TEN, 1n);
  assert.deepEqual((["setup", "allow", "send"] as const).map((s) => stepOf(currencyLabel(UBONG, q, s))), ["setup", "allow", "send"]);
  assert.equal(stepOf("send 0x1 2"), null);
});
