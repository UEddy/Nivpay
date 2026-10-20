import { getAddress, parseTransaction, type Address, type Hex } from "viem";
import type { PendingWrite } from "./writes.ts";

/**
 * A write left stuck (lib/writes.ts: replaceable, never mined) blocks every
 * new write for the account until it is retried, so a screen that makes
 * writes must offer Try again for its own. These helpers let any screen do
 * that through retryStuckWrite, which signs again at the same nonce and so
 * can only ever replace that one write.
 */

/** The call a saved write was made from, read back from its own signed bytes. */
export function callOf(w: Pick<PendingWrite, "address" | "raw" | "label">): { from: Address; to: Address; data: Hex; label: string } | null {
  try {
    const tx = parseTransaction(w.raw);
    if (!tx.to) return null;
    return { from: w.address, to: getAddress(tx.to), data: tx.data ?? "0x", label: w.label };
  } catch {
    return null;
  }
}

/** What a screen does with this phone's saved write: follow one still on its way, offer Try again for a stuck one, or nothing if it isn't the screen's own. */
export function recoveryFor(w: Pick<PendingWrite, "label" | "replaceable"> | null | undefined, owns: (label: string) => boolean): "follow" | "retry" | null {
  if (!w || !owns(w.label)) return null;
  return w.replaceable ? "retry" : "follow";
}
