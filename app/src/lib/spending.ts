import type { Address } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { DEPLOYMENT } from "./deployment.ts";
import { AppError } from "./errors.ts";
import { checkSpend, finishSpend, LIMIT_DECIMALS, LimitStore, recordSpend, type SpendKind } from "./limits.ts";
import { formatAmount } from "./money.ts";

/**
 * The daily limit (lib/limits.ts) as the money screens use it, on this
 * phone's storage. Every way money leaves calls checkDailyLimit before the
 * confirm sheet and again right before signing, spendSent once a request is
 * sent, and spendEnded once it is final or failed.
 */
const store = (account: Address) => new LimitStore(localStorage, DEPLOYMENT, account);

/** Throws, with what is left today and that nothing was sent, if this would pass the limit. */
export function checkDailyLimit(account: Address, amount: bigint, now = Date.now()): void {
  let check;
  try {
    check = checkSpend(store(account).get(), amount, now);
  } catch {
    return;
  }
  if (!check.ok) throw new AppError(copy.errDailyLimit(formatAmount(check.left, LIMIT_DECIMALS, "cents")), ERROR_CODES.DAILY_LIMIT);
}

/** Counts a request from the moment it is sent, by its nonce, so a retry on the same nonce counts once. */
export function spendSent(account: Address, write: { nonce: number }, kind: SpendKind, amount: bigint, potId?: bigint): void {
  try {
    store(account).update((s) =>
      recordSpend(s, { id: String(write.nonce), kind, amount: amount.toString(), at: Date.now(), final: false, ...(potId !== undefined ? { potId: potId.toString() } : {}) }),
    );
  } catch {
    // Storage refused: the limit can't count this one. The payment itself is unaffected.
  }
}

/** Final keeps counting; reverted or replaced stops; still waiting changes nothing. */
export function spendEnded(account: Address, write: { nonce: number }, outcome: "final" | "reverted" | "superseded" | "stuck"): void {
  if (outcome === "stuck") return;
  try {
    store(account).update((s) => finishSpend(s, String(write.nonce), outcome === "final" ? "final" : "failed"));
  } catch {
    // As above.
  }
}
