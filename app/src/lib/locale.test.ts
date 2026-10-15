import { test } from "node:test";
import assert from "node:assert/strict";
import { dollarsIn, LANGS, parseAmountIn, readPick, resolveLanguage, separators, writePick } from "./locale.ts";

test("the first language the app has, else English; a pick wins; the phone's region stays", () => {
  assert.deepEqual(resolveLanguage(["de-DE", "fr-CA", "en-US"], null), { lang: "fr", numberLocale: "fr-CA", dateLocale: "fr-CA" });
  assert.deepEqual(resolveLanguage(["es-MX"], null), { lang: "es", numberLocale: "es-MX", dateLocale: "es-MX" });
  assert.deepEqual(resolveLanguage(["pt"], null), { lang: "pt", numberLocale: "pt-BR", dateLocale: "pt-BR" });
  assert.deepEqual(resolveLanguage(["yo-NG", "de"], null), { lang: "en", numberLocale: "en-US", dateLocale: "en-GB" });
  assert.deepEqual(resolveLanguage([], null).lang, "en");
  assert.deepEqual(resolveLanguage(["en-NG"], null), { lang: "en", numberLocale: "en-US", dateLocale: "en-GB" }, "English as it always was");
  assert.deepEqual(resolveLanguage(["es-MX"], "fr"), { lang: "fr", numberLocale: "fr-FR", dateLocale: "fr-FR" });
  assert.deepEqual(resolveLanguage(["es-MX", "en"], "es"), { lang: "es", numberLocale: "es-MX", dateLocale: "es-MX" }, "picked, with the phone's region");
  assert.deepEqual(resolveLanguage(["not a tag!!", "pt-PT"], "xx"), { lang: "pt", numberLocale: "pt-PT", dateLocale: "pt-PT" }, "bad tags and picks ignored");
});

test("the pick is kept on this phone, and cleared to follow the phone again", () => {
  const m = new Map<string, string>();
  const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  assert.equal(readPick(kv), null);
  writePick(kv, "pt");
  assert.equal(readPick(kv), "pt");
  writePick(kv, null);
  assert.equal(readPick(kv), null);
  m.set("nivpay.language.v1", "klingon");
  assert.equal(readPick(kv), null);
});

const usd = (cents: number) => BigInt(cents) * 10_000n; // 6 decimals
const read = (text: string, locale: string) => {
  const r = parseAmountIn(text, 6, locale);
  return "value" in r ? r.value : r.problem;
};

test("separators come from the region", () => {
  assert.deepEqual(separators("en-US"), { group: ",", decimal: "." });
  assert.deepEqual(separators("fr-FR"), { group: " ", decimal: "," });
  assert.deepEqual(separators("es-ES"), { group: ".", decimal: "," });
  assert.deepEqual(separators("es-MX"), { group: ",", decimal: "." });
  assert.deepEqual(separators("pt-BR"), { group: ".", decimal: "," });
  assert.deepEqual(separators("pt-PT"), { group: " ", decimal: "," });
});

test("amounts are read the reader's way, in every language and region", () => {
  const cases: [string, string, bigint | string][] = [
    // English, as always, except a comma that isn't a group is refused, never read as $1,050.
    ["en-US", "10.50", usd(1050)],
    ["en-US", "1,000", usd(100000)],
    ["en-US", "1,000.25", usd(100025)],
    ["en-US", "$12", usd(1200)],
    ["en-US", "10,50", "format"],
    ["en-US", "1.000", "decimals"],
    ["en-US", "10.505", "decimals"],
    // French: the comma is the decimal mark, groups are spaces.
    ["fr-FR", "10,50", usd(1050)],
    ["fr-FR", "1 000,50", usd(100050)],
    ["fr-FR", "1 000", usd(100000)],
    ["fr-FR", "1,000", "decimals"],
    ["fr-FR", "10.50", "format"],
    ["fr-FR", "10,5 $", usd(1050)],
    // Spain and Brazil: point for groups, comma for decimals.
    ["es-ES", "10,50", usd(1050)],
    ["es-ES", "1.000", usd(100000)],
    ["es-ES", "1.000,5", usd(100050)],
    ["es-ES", "1,000", "decimals"],
    ["es-ES", "10.50", "format"],
    ["pt-BR", "10,50", usd(1050)],
    ["pt-BR", "US$ 2.500,00", usd(250000)],
    ["pt-BR", "2,500", "decimals"],
    // Mexico: the English way.
    ["es-MX", "10.50", usd(1050)],
    ["es-MX", "10,50", "format"],
    ["es-MX", "1,000", usd(100000)],
    // Portugal: spaces for groups.
    ["pt-PT", "1 000,25", usd(100025)],
    // Never anything strange.
    ["fr-FR", "", "empty"],
    ["fr-FR", "  ", "empty"],
    ["en-US", "-5", "format"],
    ["en-US", "1e3", "format"],
    ["en-US", "10.", "format"],
    ["en-US", "12,34,567", "format"],
    ["en-US", "١٢", "format"],
  ];
  for (const [locale, text, want] of cases) assert.equal(read(text, locale), want, `${locale} ${JSON.stringify(text)}`);
});

test("a currency with no decimals takes none", () => {
  const r = parseAmountIn("1500,5", 0, "fr-FR", 0);
  assert.deepEqual(r, { problem: "decimals" });
  assert.deepEqual(parseAmountIn("1 500", 0, "fr-FR", 0), { value: 1500n });
});

test("dollars are shown the reader's way, from exact digits", () => {
  assert.equal(dollarsIn("en-US", 1050n, "00"), "$1,050.00");
  assert.equal(dollarsIn("en-US", 400n, null), "$400");
  assert.equal(dollarsIn("en-US", 1234567n, "89", true), "-$1,234,567.89");
  assert.match(dollarsIn("fr-FR", 1050n, "50"), /^1\s050,50\s\$US$/);
  assert.match(dollarsIn("pt-BR", 1050n, "50"), /^US\$\s1\.050,50$/);
  assert.match(dollarsIn("es-ES", 10500n, "00"), /^10\.500,00\sUS\$$/);
  assert.match(dollarsIn("es-MX", 1050n, "50"), /^USD\s1,050\.50$/);
  for (const lang of LANGS) assert.ok(dollarsIn(resolveLanguage([lang], null).numberLocale, 9_007_199_254_740_993n, "01").includes("01"), "bigger than a float holds");
});
