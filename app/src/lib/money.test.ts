import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAmount, parseAmount } from "./money.ts";

const D = 6;
function usd(s: string): bigint {
  const v = parseAmount(s, D);
  if (v === null) throw new Error(`bad fixture ${s}`);
  return v;
}

test("the design's figures format as the comps show them", () => {
  assert.equal(formatAmount(usd("1000"), D, "auto"), "$1,000");
  assert.equal(formatAmount(usd("400"), D, "auto"), "$400");
  assert.equal(formatAmount(usd("3"), D, "cents"), "$3.00");
  assert.equal(formatAmount(usd("1.40"), D, "cents"), "$1.40");
  assert.equal(formatAmount(usd("115.60"), D, "auto"), "$115.60");
  assert.equal(formatAmount(usd("57.80"), D, "cents"), "$57.80");
  assert.equal(formatAmount(usd("600"), D, "cents"), "$600.00");
});

test("sub-cent remainders are truncated, never rounded up", () => {
  assert.equal(formatAmount(57_809_999n, D, "cents"), "$57.80");
  assert.equal(formatAmount(1n, D, "cents"), "$0.00");
});

test("whole dollars for numbers in motion round half up", () => {
  assert.equal(formatAmount(usd("115.60"), D, "whole"), "$116");
  assert.equal(formatAmount(usd("115.49"), D, "whole"), "$115");
  assert.equal(formatAmount(usd("0.5"), D, "whole"), "$1");
});

test("large amounts keep every digit, no float anywhere", () => {
  assert.equal(formatAmount(10n ** 18n + 1n, D, "cents"), "$1,000,000,000,000.00");
  assert.equal(formatAmount(9_007_199_254_740_993_000_000n, D, "auto"), "$9,007,199,254,740,993");
});

test("parseAmount accepts plain amounts and rejects everything else", () => {
  assert.equal(parseAmount("400", D), 400_000000n);
  assert.equal(parseAmount("$1,000.25", D), 1_000_250000n);
  assert.equal(parseAmount(" 0.000001 ", D), 1n);
  assert.equal(parseAmount("12.", D), 12_000000n);
  for (const bad of ["", "-1", "1e3", "0.0000001", "abc", "1.2.3", "NaN", "Infinity", " . "]) {
    assert.equal(parseAmount(bad, D), null, bad);
  }
});
