import { PAID_MOTION } from "./payout.ts";

/**
 * Reduced motion (docs/MOTION.md): no flights and no loops; what changes
 * cross-fades. Every motion here is started by its screen only once what it
 * shows is final, and reduced motion only shortens what comes after that
 * start, so a reduced motion never lands anything earlier than the full one.
 */
export function prefersReducedMotion(match: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia?.bind(globalThis)): boolean {
  return Boolean(match?.("(prefers-reduced-motion: reduce)").matches);
}

/** A step of a motion, `at` ms after the screen starts it. */
export type Timed<K extends string> = { at: number; kind: K };

/**
 * "Payment approved and paid", started once the paying yes is final: the pot
 * tips, the stream leaves (and the numbers read at Finalized land with it),
 * the payee is checked, the pot rights itself. Reduced: the numbers land and
 * the payee is checked at once.
 */
export type PaidStep = "tilt" | "stream" | "check" | "upright" | "done";
export function paidSchedule(reduced: boolean): Timed<PaidStep>[] {
  if (reduced) return [{ at: 0, kind: "stream" }, { at: 0, kind: "check" }, { at: 0, kind: "done" }];
  return [
    { at: 0, kind: "tilt" },
    { at: PAID_MOTION.stream, kind: "stream" },
    { at: PAID_MOTION.check, kind: "check" },
    { at: PAID_MOTION.upright, kind: "upright" },
    { at: PAID_MOTION.done, kind: "done" },
  ];
}

/**
 * "Pot created", started once the pot is made and final: the lid drops and
 * the lock pops, an invite flies out to each city, then each ring lights up.
 * Reduced: the made pot is shown at once.
 */
export type CreatePhase = "locked" | "flying" | "landed";
export const LID_DROP_MS = 380;
export function createSchedule(reduced: boolean, deciders: number): Timed<CreatePhase>[] {
  if (reduced) return [{ at: 0, kind: "landed" }];
  return [
    { at: 0, kind: "locked" },
    { at: LID_DROP_MS, kind: "flying" },
    { at: LID_DROP_MS + 900 + 140 * Math.max(0, deciders - 1), kind: "landed" },
  ];
}
