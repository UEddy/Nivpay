import { copy } from "../copy.ts";

/**
 * How long a step before the passkey may run before the screen says what it
 * is waiting for. Before the passkey every step is reads from the RPC (and,
 * for "getting-ready", a fee grant); a slow or unanswered read can take a
 * read's full retries, about 10 s a try (rpc.ts), so a silent "Getting
 * ready…" can sit for many seconds with no sign of why.
 */
export const SLOW_AFTER_MS = 3_000;

/** The line under the button once a step has run SLOW_AFTER_MS, or null. Only steps before anything is signed. */
export function slowStepLine(step: string | null, elapsedMs: number): string | null {
  if (elapsedMs < SLOW_AFTER_MS) return null;
  if (step === "preparing") return copy.slowPreparing;
  if (step === "getting-ready") return copy.slowGettingReady;
  return null;
}
