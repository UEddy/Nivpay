import { useCallback, useEffect, useRef, useState } from "react";
import { paidSchedule, prefersReducedMotion, type PaidStep } from "../lib/reduced.ts";
import type { Stream } from "./PotMap.tsx";

export type PayMotion = {
  tilt: boolean;
  draining: boolean;
  stream: Stream | null;
  /** The payee the running motion is paying, and whether the stream has reached it. */
  payee: number | null;
  arrived: boolean;
};

const IDLE: PayMotion = { tilt: false, draining: false, stream: null, payee: null, arrived: false };

/**
 * Runs "Payment approved and paid" on the pot map. The caller starts it only
 * once the payment is final, with the numbers already read at Finalized:
 * `land` puts them on screen as the stream leaves, so the layers drain with
 * it, and `done` runs when the motion ends. With reduced motion the numbers
 * land and the payee is checked at once.
 */
export function usePayMotion() {
  const [motion, setMotion] = useState<PayMotion>(IDLE);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  const run = useCallback((payee: number, land: () => void, done: () => void) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    // Reduced (paidSchedule(true)): the numbers land and the payee is checked at once, with no stream drawn.
    const reduced = prefersReducedMotion();
    const steps: Record<PaidStep, () => void> = {
      tilt: () => setMotion({ ...IDLE, tilt: true, payee }),
      stream: reduced
        ? land
        : () => {
            setMotion((m) => ({ ...m, stream: { payee, at: "start" } }));
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                setMotion((m) => ({ ...m, stream: { payee, at: "end" }, draining: true }));
                land();
              }),
            );
          },
      check: () => setMotion((m) => ({ ...m, payee, arrived: true })),
      upright: () => setMotion((m) => ({ ...m, tilt: false })),
      done: () => {
        setMotion({ ...IDLE, payee, arrived: true });
        done();
      },
    };
    for (const { at, kind } of paidSchedule(reduced)) {
      if (at === 0) steps[kind]();
      else timers.current.push(setTimeout(steps[kind], at));
    }
  }, []);

  return { motion, run };
}
