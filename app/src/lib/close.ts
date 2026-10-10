import { copy, ERROR_CODES } from "../copy.ts";
import { AppError } from "./errors.ts";
import type { PotEvent } from "./feed.ts";

/**
 * Closing a pot and taking a share out (Live-Close), read from the contract:
 *
 *  - A pot is closed when a close request is agreed, or from its closing
 *    time on (endTime), whether or not anyone records it. Then nothing can go
 *    in or be paid out.
 *  - Nothing is sent to anyone at close. Each person takes their own share:
 *    exit(potId, shares) before close, claim(potId) after. Exit works in
 *    every state (open, paused, closed, with a payment waiting); after close
 *    it is told as a claim.
 *  - A share is shares, not dollars put in: shares are minted at the value
 *    per share when money goes in, and burned when someone takes theirs out.
 *    Its worth is funderInfo's redeemable, the contract's own rounding down.
 *
 * Nothing here reads the chain.
 */

export const takeLabel = (potId: bigint) => `take ${potId}`;
export const askCloseLabel = (potId: bigint) => `ask close ${potId}`;

export type ShareFacts = {
  closed: boolean;
  /** This account's shares and what they are worth now (funderInfo). */
  myShares: bigint;
  myWorth: bigint;
};

export type TakeView = {
  /** exit before close, claim after. Null when there is nothing to take. */
  action: "exit" | "claim" | null;
  amount: bigint;
  refusal: AppError | null;
};

export function takeView(f: ShareFacts): TakeView {
  if (f.myShares === 0n) return { action: null, amount: 0n, refusal: new AppError(copy.errNothingToTake, ERROR_CODES.NOTHING_TO_TAKE) };
  return { action: f.closed ? "claim" : "exit", amount: f.myWorth, refusal: null };
}

/** The code for taking a share out, or asking to close, that the contract refused as a call. */
export function closeRefusalFor(errorName: string | undefined): AppError {
  switch (errorName) {
    case "ZeroShares":
    case "InsufficientShares":
      return new AppError(copy.errNothingToTake, ERROR_CODES.NOTHING_TO_TAKE);
    case "PotNotClosed":
      return new AppError(copy.errNotClosedYet, ERROR_CODES.NOT_CLOSED_YET);
    case "PotClosed":
      return new AppError(copy.errAlreadyClosed, ERROR_CODES.POT_ALREADY_CLOSED);
    case "NotApprover":
      return new AppError(copy.errNotDeciderClose, ERROR_CODES.NOT_DECIDER);
    default:
      return new AppError(copy.errTakeRefused, ERROR_CODES.TAKE_REFUSED);
  }
}

/** What went in, was paid out, went on fees and was taken out, from the pot's finalized events. */
export function totalsOf(events: PotEvent[]): { wentIn: bigint; paid: bigint; fees: bigint; takenOut: bigint; anyTaken: boolean } {
  let wentIn = 0n;
  let paid = 0n;
  let fees = 0n;
  let takenOut = 0n;
  for (const e of events) {
    if (e.name === "Funded") wentIn += e.args.assets as bigint;
    else if (e.name === "PayoutExecuted") {
      paid += e.args.amount as bigint;
      fees += e.args.fee as bigint;
    } else if (e.name === "Exited" || e.name === "Claimed") takenOut += e.args.assets as bigint;
  }
  return { wentIn, paid, fees, takenOut, anyTaken: events.some((e) => e.name === "Exited" || e.name === "Claimed") };
}

/** Dollars each account put in, from Funded events. */
export function putInBy(events: PotEvent[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const e of events) {
    if (e.name !== "Funded") continue;
    const a = String(e.args.funder).toLowerCase();
    out.set(a, (out.get(a) ?? 0n) + (e.args.assets as bigint));
  }
  return out;
}

/**
 * Why a share is what it is, said only when it is true. "You put in $500,
 * half the pot, so half of what's left is yours" holds exactly when this
 * account's part of all shares equals its part of all money put in, which is
 * the case when every pour came before any payment and nobody has taken a
 * share out. Otherwise the share is told without a reason that would mislead.
 * Returns the fraction in words, or null.
 */
export function shareFraction(myPut: bigint, totalPut: bigint, myShares: bigint, totalShares: bigint, anyTaken: boolean): string | null {
  if (anyTaken || myPut === 0n || totalPut === 0n || totalShares === 0n || myShares === 0n) return null;
  // Equal to within one part in a million: rounding when shares are minted moves the last digits only.
  const a = myShares * totalPut;
  const b = myPut * totalShares;
  const diff = a > b ? a - b : b - a;
  if (diff * 1_000_000n > b) return null;
  if (myPut * 2n === totalPut) return copy.fractionHalf;
  if (myPut === totalPut) return copy.fractionAll;
  if (myPut * 4n === totalPut) return copy.fractionQuarter;
  const tenths = (myPut * 1_000n + totalPut / 2n) / totalPut;
  return copy.fractionPercent(`${tenths / 10n}${tenths % 10n ? `.${tenths % 10n}` : ""}`);
}

export type CloseState = "open" | "closed-early" | "closed-on-date";

/**
 * getPot's closed is the contract's _isClosed: agreed early, or from endTime
 * on. Before endTime a closed pot can only have been closed early.
 */
export function closeState(closed: boolean, endTime: bigint, now: bigint): CloseState {
  if (!closed) return "open";
  return now < endTime ? "closed-early" : "closed-on-date";
}

/** Each named person's share now, and what is left for anyone not named or held back as rounding. */
export function splitNow(people: { account: string; worth: bigint }[], totalAssets: bigint): { rows: { account: string; worth: bigint }[]; rest: bigint } {
  const rows = people.filter((p) => p.worth > 0n);
  const sum = rows.reduce((a, p) => a + p.worth, 0n);
  return { rows, rest: totalAssets > sum ? totalAssets - sum : 0n };
}
