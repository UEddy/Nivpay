/**
 * The one place token amounts become text, and text becomes amounts.
 * Amounts are bigint base units end to end; no float ever holds money.
 */

export type AmountStyle =
  /** Always two decimals: "$3.00", "$115.60". */
  | "cents"
  /** Two decimals, dropped when they are .00: "$400", "$115.60". */
  | "auto"
  /** Whole dollars, for numbers in motion: "$116". Rounds half up. */
  | "whole";

const groups = new Intl.NumberFormat("en-US", { useGrouping: true, maximumFractionDigits: 0 });

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
  const sign = negative ? "-" : "";

  if (style === "whole") {
    const dollars = (abs + unit / 2n) / unit;
    return `${sign}$${groups.format(dollars)}`;
  }

  const cents = abs / 10n ** BigInt(decimals - 2);
  const dollars = cents / 100n;
  const rest = cents % 100n;
  if (style === "auto" && rest === 0n) return `${sign}$${groups.format(dollars)}`;
  return `${sign}$${groups.format(dollars)}.${rest.toString().padStart(2, "0")}`;
}

/**
 * Parses what a person typed ("400", "400.5", "1,000.25", "$12") into base
 * units. Returns null for anything that is not a plain non-negative amount
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
  const shown = formatAmount(value, decimals, "cents").replace("$", "");
  return `${shown} ${symbol}`;
}
