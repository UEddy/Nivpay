/**
 * Which loops may run on a screen with the pot map (docs/MOTION.md: no more
 * than two loops on screen). A loop is one rhythm, however many elements
 * share it: every marching route is the one march, the live badge and a
 * payee's ring are the one ping.
 *
 * When more would run, the most telling wins, in this order:
 * 1. hold: your own coin at the rim, waiting for Finalized,
 * 2. a loop outside the map, such as your yes pulsing while it lands,
 * 3. march: a payment waiting for a yes (its payee's route), or people not
 *    in yet (their routes),
 * 4. ping: the payee's ring while a payment waits, else the live badge.
 * A loop that loses still shows its state, standing still.
 */
export type Loop = "hold" | "outside" | "march" | "ping";

export type LoopWants = {
  /** A coin of yours waits at the rim for its block to be final. */
  coinHolding: boolean;
  /** Something on the screen but off the map loops, such as a pulsing yes or the fingerprint icon. */
  outside: boolean;
  /** A payment from the pot waits for a yes. */
  asked: boolean;
  /** Someone's route marches because they haven't put in yet. */
  peopleMarch: boolean;
  /** The badge says Live, and not a replay's date. */
  badgeLive: boolean;
};

export type LoopsOn = {
  loops: Loop[];
  payeeMarch: boolean;
  peopleMarch: boolean;
  payeePing: boolean;
  badgePing: boolean;
};

export const MAX_LOOPS = 2;

export function loopsOn(w: LoopWants): LoopsOn {
  const loops: Loop[] = [];
  const room = () => loops.length < MAX_LOOPS;
  if (w.coinHolding) loops.push("hold");
  if (w.outside) loops.push("outside");
  const marchWanted = w.asked || w.peopleMarch;
  if (marchWanted && room()) loops.push("march");
  const marching = loops.includes("march");
  const pingWanted = w.asked || w.badgeLive;
  if (pingWanted && room()) loops.push("ping");
  const pinging = loops.includes("ping");
  return {
    loops,
    payeeMarch: marching && w.asked,
    peopleMarch: marching && w.peopleMarch,
    payeePing: pinging && w.asked,
    badgePing: pinging && !w.asked,
  };
}
