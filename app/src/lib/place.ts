/**
 * Where the person is in the app, kept for this browser tab only
 * (sessionStorage), so a reload opens the same screen and tab, not Home.
 * Closing the tab forgets it, so opening the app fresh still starts on Home.
 * It is kept with the account it was for: another account signed in starts
 * on Home. Amounts and ids in links are bigints, kept as text.
 */

export type KeyValue = Pick<Storage, "getItem" | "setItem">;

const KEY = "nivpay.place.v1";

/** Keeps where the person is. Storage refused: a reload starts on Home, as before. */
export function keepPlace(kv: KeyValue, account: string, place: unknown): void {
  try {
    kv.setItem(KEY, JSON.stringify({ account: account.toLowerCase(), place }, (_, v: unknown) => (typeof v === "bigint" ? { $big: v.toString() } : v)));
  } catch {
    // Not kept.
  }
}

/** Where this account was before the reload, or null for none (or another account, or anything unreadable). */
export function readPlace(kv: KeyValue, account: string | undefined): unknown {
  if (!account) return null;
  try {
    const raw = kv.getItem(KEY);
    if (!raw) return null;
    const kept = JSON.parse(raw, (_, v: unknown) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        if (Object.keys(o).length === 1 && typeof o.$big === "string" && /^-?\d+$/.test(o.$big)) return BigInt(o.$big);
      }
      return v;
    }) as { account?: unknown; place?: unknown };
    return kept.account === account.toLowerCase() ? (kept.place ?? null) : null;
  } catch {
    return null;
  }
}
