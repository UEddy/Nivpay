import { dollarsIn, groupedIn, numberLocale, parseAmountIn, separators, type Parsed } from "./locale.ts";

/**
 * The one place token amounts become text, and text becomes amounts.
 * Amounts are bigint base units end to end; no float ever holds money.
 * Both follow the reader's language and region (lib/locale.ts): "$1,050.00"
 * in English, "1 050,00 $US" in French.
 */

export type AmountStyle =
  /** Always two decimals: "$3.00", "$115.60". */
  | "cents"
  /** Two decimals, dropped when they are .00: "$400", "$115.60". */
  | "auto"
  /** Whole dollars, for numbers in motion: "$116". Rounds half up. */
  | "whole";

/**
 * Formats base units of a token with `decimals` decimals as dollars.
 * Sub-cent remainders are truncated, never rounded up, so a balance is never
 * shown as more than it is. "whole" rounds half up because it is only used
 * while a number is animating.
 */
export function formatAmount(value: bigint, decimals: number, style: AmountStyle = "auto"): string {
  if (!Number.isInteger(decimals) || decimals < 2) throw new Error(`unsupported decimals ${decimals}`);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(decimals);

  const locale = numberLocale();
  if (style === "whole") return dollarsIn(locale, (abs + unit / 2n) / unit, null, negative);

  const cents = abs / 10n ** BigInt(decimals - 2);
  const dollars = cents / 100n;
  const rest = cents % 100n;
  if (style === "auto" && rest === 0n) return dollarsIn(locale, dollars, null, negative);
  return dollarsIn(locale, dollars, rest.toString().padStart(2, "0"), negative);
}

/**
 * What a person typed in an amount field, read their way (lib/locale.ts): at
 * most 2 decimals, groups of three, anything ambiguous refused. Every amount
 * field uses this, never parseAmount.
 */
export function readAmount(text: string, decimals: number, maxFraction = Math.min(2, decimals)): Parsed {
  return parseAmountIn(text, decimals, numberLocale(), maxFraction);
}

/** The value readAmount found, or null. */
export function amountIn(text: string, decimals: number): bigint | null {
  const r = readAmount(text, decimals);
  return "value" in r ? r.value : null;
}

/** An amount as it is typed into a field, the reader's way, with no currency: "1,050.5" or "1 050,5". */
export function amountForField(value: bigint, decimals: number): string {
  const cents = value / 10n ** BigInt(decimals - 2);
  const whole = groupedIn(numberLocale(), cents / 100n);
  const rest = cents % 100n;
  return rest === 0n ? whole : `${whole}${separators(numberLocale()).decimal}${rest.toString().padStart(2, "0")}`;
}

/**
 * The machine form, for numbers that are not typed by a person: "400",
 * "400.5", "1,000.25", "$12" into base units. Returns null for anything that is not a plain non-negative amount
 * with at most `decimals` decimal places.
 */
export function parseAmount(text: string, decimals: number): bigint | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/**
 * Formats an amount of a currency other than dollars, such as CTK, as
 * "10.00 CTK": two decimals, truncated like dollar amounts, with its symbol.
 */
export function formatCurrency(value: bigint, decimals: number, symbol: string): string {
  const cents = (value < 0n ? -value : value) / 10n ** BigInt(decimals - 2);
  const locale = numberLocale();
  const shown = `${groupedIn(locale, cents / 100n)}${separators(locale).decimal}${(cents % 100n).toString().padStart(2, "0")}`;
  return `${value < 0n ? "-" : ""}${shown} ${symbol}`;
}
