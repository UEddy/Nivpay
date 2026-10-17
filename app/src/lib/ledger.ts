import type { PotEvent } from "./feed.ts";

/**
 * Where each person's money went (README, "Where your money went"), worked
 * out by replaying a pot's finalized events with the contract's own numbers.
 * Nothing here reads the chain.
 *
 * The contract keeps money as shares (src/NivPayPots.sol, _fund, _redeem,
 * _executePayout): putting money in mints shares at the value per share at
 * that moment; a payment and its fee lower what the pot holds without
 * burning any share; taking money out burns shares. So each payment, and its
 * fee, is borne by everyone in proportion to the shares they hold at that
 * moment: someone who joined after a payment bears none of it, and someone
 * who had already taken their part out bears none of what came after. Every
 * conversion acts as if the pot held 10^3 more shares and 1 more unit than it
 * does (DECIMALS_OFFSET), so those count here too; their part is tiny and
 * ends up in the rounding.
 *
 * Each card's lines are in whole cents and always add up exactly to what is
 * left: whatever the cents leave over is the Rounding line, never a sum that
 * doesn't add up. "Left for you" is the contract's own number
 * (funderInfo.redeemable) wherever the app has read it.
 */

/** The contract's virtual shares (10 ** DECIMALS_OFFSET) and virtual assets. */
export const VIRTUAL_SHARES = 1_000n;
export const VIRTUAL_ASSETS = 1n;

export type LedgerPayment = {
  /** Order among the pot's payments, from 0. */
  index: number;
  destIndex: number;
  amount: bigint;
  fee: bigint;
  block: bigint;
};

export type PaymentPart = {
  payment: number;
  /** This person's part of the payment, in cents. */
  cents: bigint;
};

export type PersonLedger = {
  /** Lowercase account. */
  account: string;
  /** Lines in cents. left = putIn - payments - fees - takenOut + rounding, exactly. */
  putIn: bigint;
  payments: bigint;
  fees: bigint;
  takenOut: bigint;
  rounding: bigint;
  left: bigint;
  /** Every payment made while this person had money in, with their part of it. */
  parts: PaymentPart[];
  /** True while the person still has shares in the pot. */
  inPot: boolean;
  /** The contract's own "left", in units, when it was given; else the replay's. */
  leftUnits: bigint;
  /** The replay's "left", in units, worked out as funderInfo would. */
  replayedLeftUnits: bigint;
};

export type Ledger = {
  payments: LedgerPayment[];
  /** One per account that ever put money in, in the order they first did. */
  people: PersonLedger[];
  /** What the pot holds and its shares after the last event, as the contract has them. */
  totalAssets: bigint;
  totalShares: bigint;
};

const mulDivFloor = (a: bigint, b: bigint, d: bigint) => (a * b) / d;

/** Units in cents, cut down to the cent, as formatAmount shows them. */
const floorCents = (units: bigint, unitsPerCent: bigint) => units / unitsPerCent;

/** Extra digits kept below the cent while adding fractions, so a sum is rounded once, not each part. */
const FINE = 10n ** 18n;

/**
 * Fractions of units, in cents: the total rounded to the nearest cent once,
 * and each part given whole cents that add up to exactly that total (the
 * cents left over go to the parts with the largest remainders).
 */
function centsSummingTo(parts: readonly Fraction[], unitsPerCent: bigint): { each: bigint[]; total: bigint } {
  const fine = parts.map((f) => (f.num * FINE) / (f.den * unitsPerCent));
  const total = (fine.reduce((a, x) => a + x, 0n) + FINE / 2n) / FINE;
  const each = fine.map((x) => x / FINE);
  let short = total - each.reduce((a, x) => a + x, 0n);
  const order = fine.map((x, i) => ({ i, rest: x % FINE })).sort((a, b) => (a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1));
  for (const { i } of order) {
    if (short <= 0n) break;
    each[i]! += 1n;
    short -= 1n;
  }
  return { each, total };
}

type Fraction = { num: bigint; den: bigint };
type Running = { shares: bigint; putIn: bigint; takenOut: bigint; fees: Fraction[]; parts: (Fraction & { payment: number })[] };

/**
 * The ledger of a pot from all its finalized events, in chain order. `left`
 * gives the contract's funderInfo.redeemable by lowercase account where it
 * was read; anyone else's is worked out the way the contract does it.
 */
export function ledgerOf(events: readonly PotEvent[], decimals: number, left: Readonly<Record<string, bigint>> = {}): Ledger {
  if (!Number.isInteger(decimals) || decimals < 2) throw new Error(`unsupported decimals ${decimals}`);
  const unitsPerCent = 10n ** BigInt(decimals - 2);
  let assets = 0n;
  let shares = 0n;
  const people = new Map<string, Running>();
  const payments: LedgerPayment[] = [];

  for (const e of events) {
    if (e.name === "Funded") {
      const who = String(e.args.funder).toLowerCase();
      const amount = e.args.assets as bigint;
      const minted = e.args.sharesMinted as bigint;
      const p = people.get(who) ?? { shares: 0n, putIn: 0n, takenOut: 0n, fees: [], parts: [] };
      p.shares += minted;
      p.putIn += amount;
      people.set(who, p);
      assets += amount;
      shares += minted;
    } else if (e.name === "Exited" || e.name === "Claimed") {
      const who = String(e.args.funder).toLowerCase();
      const burned = e.args.sharesBurned as bigint;
      const out = e.args.assets as bigint;
      const p = people.get(who);
      if (p) {
        p.shares -= burned;
        p.takenOut += out;
      }
      assets -= out;
      shares -= burned;
    } else if (e.name === "PayoutExecuted") {
      const amount = e.args.amount as bigint;
      const fee = e.args.fee as bigint;
      const payment: LedgerPayment = { index: payments.length, destIndex: Number(e.args.destIndex), amount, fee, block: e.block };
      payments.push(payment);
      // Borne by the shares held at this moment, virtual ones included.
      const den = shares + VIRTUAL_SHARES;
      for (const p of people.values()) {
        if (p.shares === 0n) continue;
        p.parts.push({ payment: payment.index, num: amount * p.shares, den });
        p.fees.push({ num: fee * p.shares, den });
      }
      assets -= amount + fee;
    }
  }

  const out: PersonLedger[] = [];
  for (const [account, p] of people) {
    const replayedLeftUnits = mulDivFloor(p.shares, assets + VIRTUAL_ASSETS, shares + VIRTUAL_SHARES);
    const leftUnits = left[account] ?? replayedLeftUnits;
    const paid = centsSummingTo(p.parts, unitsPerCent);
    const parts = p.parts.map((x, i) => ({ payment: x.payment, cents: paid.each[i]! }));
    const fees = centsSummingTo(p.fees, unitsPerCent).total;
    const putIn = floorCents(p.putIn, unitsPerCent);
    const takenOut = floorCents(p.takenOut, unitsPerCent);
    const leftCents = floorCents(leftUnits, unitsPerCent);
    out.push({
      account,
      putIn,
      payments: paid.total,
      fees,
      takenOut,
      rounding: leftCents - (putIn - paid.total - fees - takenOut),
      left: leftCents,
      parts,
      inPot: p.shares > 0n,
      leftUnits,
      replayedLeftUnits,
    });
  }
  return { payments, people: out, totalAssets: assets, totalShares: shares };
}

/**
 * Whether the replay agrees with the contract for every account whose number
 * was read: the events and the numbers are from the same moment. Until they
 * are (a new event not yet read, or the history not complete), the cards wait.
 */
export function agreesWithContract(ledger: Ledger, left: Readonly<Record<string, bigint>>): boolean {
  return ledger.people.every((p) => left[p.account] === undefined || left[p.account] === p.replayedLeftUnits);
}

/** The order the cards are shown in: mine first, then everyone else as they first put money in. */
export function cardsFor(ledger: Ledger, me: string): PersonLedger[] {
  const mine = me.toLowerCase();
  return [...ledger.people.filter((p) => p.account === mine), ...ledger.people.filter((p) => p.account !== mine)];
}

/** Whether any payment has been made from the pot yet. */
export const anyPaymentMade = (events: readonly PotEvent[]) => events.some((e) => e.name === "PayoutExecuted");
