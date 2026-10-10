import { useCallback, useEffect, useRef, useState } from "react";
import { PAID_MOTION } from "../lib/payout.ts";
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
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      land();
      setMotion({ ...IDLE, payee, arrived: true });
      done();
      return;
    }
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    setMotion({ ...IDLE, tilt: true, payee });
    at(PAID_MOTION.stream, () => {
      setMotion((m) => ({ ...m, stream: { payee, at: "start" } }));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setMotion((m) => ({ ...m, stream: { payee, at: "end" }, draining: true }));
          land();
        }),
      );
    });
    at(PAID_MOTION.check, () => setMotion((m) => ({ ...m, arrived: true })));
    at(PAID_MOTION.upright, () => setMotion((m) => ({ ...m, tilt: false })));
    at(PAID_MOTION.done, () => {
      setMotion({ ...IDLE, payee, arrived: true });
      done();
    });
  }, []);

  return { motion, run };
}
