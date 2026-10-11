import { copy } from "../copy.ts";

/**
 * The one line that says what CTK (or whatever the other currency's symbol
 * is) means, for the first place a person sees it: the sender's currency
 * choice, the recipient's Payments in. Null until a symbol other than
 * dollars is on screen. "$" is how dollars are keyed.
 */
export function otherCurrencyNote(symbols: (string | null | undefined)[]): string | null {
  const symbol = symbols.find((s): s is string => typeof s === "string" && s !== "" && s !== "$");
  return symbol ? copy.otherCurrencyExplainer(symbol) : null;
}
