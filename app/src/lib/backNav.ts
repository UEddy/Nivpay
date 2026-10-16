/**
 * Back from a Profile detail screen, by its back arrow or by the phone's own
 * back (Android's gesture, or the browser's button). Opening a detail screen
 * adds one history entry marked with its name; going back pops it, and the
 * page shows Profile again. So the phone's back never leaves the app from a
 * detail screen, and the arrow and the gesture do the same thing.
 */

export type HistoryLike = { readonly state: unknown; pushState(data: unknown, unused: string): void; back(): void };

const KEY = "nivpayProfile";

/** The detail screen a history entry is for, or null for none. */
export function detailIn(state: unknown): string | null {
  const v = state && typeof state === "object" ? (state as Record<string, unknown>)[KEY] : undefined;
  return typeof v === "string" ? v : null;
}

/** Opening a detail screen: one entry, so the phone's back returns to Profile. */
export function openDetail(h: HistoryLike, view: string): void {
  if (detailIn(h.state) === view) return;
  const base = h.state && typeof h.state === "object" ? (h.state as Record<string, unknown>) : {};
  h.pushState({ ...base, [KEY]: view }, "");
}

/**
 * Leaving it by the arrow: pop the entry if it is there (the page then hears
 * popstate and shows Profile), else just show Profile. Returns which.
 */
export function closeDetail(h: HistoryLike): "popped" | "shown" {
  if (detailIn(h.state) === null) return "shown";
  h.back();
  return "popped";
}
