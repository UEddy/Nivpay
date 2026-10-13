import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENCIES,
  currencyFor,
  defaultCurrency,
  formatLocal,
  isReference,
  limitFor,
  MAX_DOLLARS,
  MIN_DOLLARS,
  parseLocal,
  quoteAdd,
  quoteCashOut,
  RATES_ARE_LIVE,
  referenceForTx,
  referenceFrom,
  type Currency,
} from "./ramp.ts";

const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;
const c = (code: string): Currency => currencyFor(code)!;

test("eighteen currencies, each once, with whole-unit ones at 0 digits", () => {
  const codes = CURRENCIES.map((x) => x.code);
  assert.equal(codes.length, 18);
  assert.equal(new Set(codes).size, 18);
  for (const code of ["NGN", "GBP", "USD", "EUR", "GHS", "KES", "ZAR", "XOF", "EGP", "CAD", "AUD", "INR", "CNY", "AED", "BRL", "MXN", "PHP", "JPY"]) {
    assert.ok(codes.includes(code), code);
  }
  assert.equal(c("JPY").digits, 0);
  assert.equal(c("XOF").digits, 0);
  for (const x of CURRENCIES) {
    assert.ok(x.testMinorPerDollar > 0n, x.code);
    assert.ok(["ramp", "local", "aggregator"].includes(x.route), x.code);
  }
  assert.equal(RATES_ARE_LIVE, false, "the rates are test rates, labelled as not live");
});

test("adding money: dollars gross, a 1% fee rounded up, the rest received", () => {
  const q = quoteAdd(c("NGN"), 7_750_000n); // ₦77,500.00 at ₦1,550 a dollar
  assert.equal(q.gross, usd(50));
  assert.equal(q.fee, usd(0.5));
  assert.equal(q.received, usd(49.5));
  assert.equal(q.limit, null);
  const pounds = quoteAdd(c("GBP"), 1_000n); // £10.00 at 79p a dollar: $12.658..., down to $12.65
  assert.equal(pounds.gross, usd(12.65));
  assert.equal(pounds.fee, usd(0.13));
  assert.equal(pounds.received, usd(12.52));
});

test("cashing out: the fee comes off the dollars, the bank gets the rest in local money, rounded down", () => {
  const q = quoteCashOut(c("NGN"), usd(50));
  assert.equal(q.fee, usd(0.5));
  assert.equal(q.bankGets, 7_672_500n);
  assert.equal(formatLocal(c("NGN"), q.bankGets), "₦76,725.00");
  const yen = quoteCashOut(c("JPY"), usd(10.11)); // fee $0.11, $10.00 at ¥150
  assert.equal(yen.bankGets, 1_500n);
  assert.equal(formatLocal(c("JPY"), yen.bankGets), "¥1,500");
});

test("a round trip always returns less than went in, in every currency, and never creates money", () => {
  for (const cur of CURRENCIES) {
    const unit = 10n ** BigInt(cur.digits);
    for (const whole of [1n, 7n, 99n, 1_234n, 55_555n, 155_000n]) {
      const paid = whole * unit + (cur.digits > 0 ? 37n : 0n);
      const added = quoteAdd(cur, paid);
      assert.ok(added.gross * cur.testMinorPerDollar <= paid * 1_000_000n, `${cur.code} gross never above what was paid`);
      assert.equal(added.gross - added.fee, added.received);
      const back = quoteCashOut(cur, added.received);
      assert.ok(back.bankGets < paid, `${cur.code} ${paid}: ${back.bankGets} back`);
      assert.ok(back.fee + (back.bankGets * 1_000_000n) / cur.testMinorPerDollar <= added.received);
    }
  }
});

test("limits: $1 to $100 a request, on the dollar side", () => {
  assert.equal(limitFor(MIN_DOLLARS - 1n), "too-small");
  assert.equal(limitFor(MIN_DOLLARS), null);
  assert.equal(limitFor(MAX_DOLLARS), null);
  assert.equal(limitFor(MAX_DOLLARS + 1n), "too-large");
  assert.equal(quoteAdd(c("NGN"), 15_400n).limit, "too-small"); // ₦154 is under a dollar
  assert.equal(quoteAdd(c("NGN"), 15_600_000n).limit, "too-large"); // ₦156,000 is over $100
  assert.equal(quoteCashOut(c("GBP"), usd(100.01)).limit, "too-large");
  assert.equal(quoteAdd(c("USD"), 0n).received, 0n);
  assert.equal(quoteAdd(c("USD"), -5n).received, 0n);
  assert.equal(quoteCashOut(c("USD"), -5n).bankGets, 0n);
});

test("the starting currency comes from the time zone, then the languages, then dollars", () => {
  assert.equal(defaultCurrency("Africa/Lagos"), "NGN");
  assert.equal(defaultCurrency("Europe/London"), "GBP");
  assert.equal(defaultCurrency("Europe/Berlin"), "EUR");
  assert.equal(defaultCurrency("Asia/Tokyo"), "JPY");
  assert.equal(defaultCurrency("Australia/Sydney"), "AUD");
  assert.equal(defaultCurrency("America/Chicago", ["en-US"]), "USD");
  assert.equal(defaultCurrency("Etc/UTC", ["en-NG", "en"]), "NGN");
  assert.equal(defaultCurrency(undefined, ["fr-SN"]), "XOF");
  assert.equal(defaultCurrency(undefined, ["zh-Hans-CN"]), "CNY");
  assert.equal(defaultCurrency("Etc/UTC", ["en"]), "USD");
  for (const zone of ["Africa/Lagos", "Europe/Paris", "Asia/Dubai", "America/Sao_Paulo"]) assert.ok(currencyFor(defaultCurrency(zone)), zone);
});

test("local money is shown exactly from the bigint", () => {
  assert.equal(formatLocal(c("NGN"), 7_672_500n), "₦76,725.00");
  assert.equal(formatLocal(c("JPY"), 1_500n), "¥1,500");
  assert.equal(formatLocal(c("KES"), 129_000n), "KSh 1,290.00");
  assert.equal(formatLocal(c("XOF"), 6_050n), "CFA 6,050");
  assert.equal(formatLocal(c("GBP"), 5n), "£0.05");
  assert.equal(formatLocal(c("USD"), 123_456_789_01n), "$123,456,789.01");
  assert.equal(formatLocal(c("NGN"), 0n), "₦0.00");
});

test("typed local money becomes minor units, or null", () => {
  assert.equal(parseLocal(c("NGN"), "77,500"), 7_750_000n);
  assert.equal(parseLocal(c("NGN"), "77500.5"), 7_750_050n);
  assert.equal(parseLocal(c("JPY"), "1500"), 1_500n);
  assert.equal(parseLocal(c("JPY"), "1500.5"), null);
  assert.equal(parseLocal(c("GBP"), "10.123"), null);
  assert.equal(parseLocal(c("GBP"), "abc"), null);
  assert.equal(parseLocal(c("GBP"), ""), null);
});

test("references are short, readable, and the same for the same cash out", () => {
  const ref = referenceFrom(new Uint8Array([5, 17, 1, 22, 29, 7]));
  assert.equal(ref, "NVP-7K3QX9");
  assert.ok(isReference(ref));
  assert.ok(!isReference("NVP-0O1I23"));
  const tx = "0x" + "ab".repeat(26) + "0512011d1d07";
  assert.equal(referenceForTx(tx), referenceForTx(tx.toUpperCase().replace("0X", "0x")));
  assert.ok(isReference(referenceForTx(tx)));
  assert.notEqual(referenceForTx(tx), referenceForTx("0x" + "cd".repeat(32)));
  assert.throws(() => referenceForTx("0x1234"));
  assert.throws(() => referenceFrom(new Uint8Array(3)));
});
