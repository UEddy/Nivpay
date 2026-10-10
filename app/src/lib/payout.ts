import { isAddressEqual, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { AppError } from "./errors.ts";
import type { PotEvent } from "./feed.ts";
import { formatAmount } from "./money.ts";

/**
 * Paying from a pot (docs/APP-CONTRACT-MAP.md, screen 3). A decider asks for
 * a payment to one of the pot's fixed payees with proposePayout; asking
 * counts as their own yes. Other deciders say yes with approve, and the yes
 * that reaches the pot's rule pays in that same request. A yes can be taken
 * back with revokeApproval until the payment is made.
 *
 * The contract checks the payee's limit and what the pot holds only when the
 * payment is made, so a request could be asked that can never be paid. The
 * phone checks both before anyone asks or says yes (gap G8), and runs every
 * request as a call before anything is signed, so a refusal costs no gas
 * grant and no passkey prompt. Nothing here reads the chain.
 */

/** Pending write labels, so a reload resumes the right request on the right screen. */
export const askLabel = (potId: bigint) => `ask ${potId}`;
export const yesLabel = (proposalId: bigint) => `yes ${proposalId}`;
export const takeBackLabel = (proposalId: bigint) => `take back ${proposalId}`;

/** The fee a payment costs the pot on top of the amount, exactly as the contract's _feeOn: floor, then capped. */
export function feeFor(amount: bigint, feeBps: bigint, feeCap: bigint): bigint {
  const fee = (amount * feeBps) / 10_000n;
  return fee > feeCap ? feeCap : fee;
}

/** Whole days in the request lifetime the contract allows, for the copy. */
export function ttlDays(ttlSeconds: bigint): number {
  return Number(ttlSeconds / 86_400n);
}

export type PayeeLimit = { name: string; cap: bigint; spent: bigint };

/** What the pot looks like at the finalized block, as far as paying from it goes. */
export type PotFacts = {
  closed: boolean;
  frozen: boolean;
  totalAssets: bigint;
  threshold: number;
  deciders: Address[];
  payees: PayeeLimit[];
  decimals: number;
};

const refuse = {
  notDecider: () => new AppError(copy.errNotDecider, ERROR_CODES.NOT_DECIDER),
  noAmount: () => new AppError(copy.errPayNoAmount, ERROR_CODES.PAY_NO_AMOUNT),
  overLimit: (payee: PayeeLimit, decimals: number) =>
    new AppError(copy.errOverLimit(formatAmount(payee.cap - payee.spent, decimals, "auto"), payee.name), ERROR_CODES.PAY_OVER_LIMIT),
  potShort: (holds: bigint, decimals: number) => new AppError(copy.errPotShort(formatAmount(holds, decimals, "cents")), ERROR_CODES.PAY_POT_SHORT),
  stopped: () => new AppError(copy.errPotStopped, ERROR_CODES.PAY_POT_STOPPED),
  expired: () => new AppError(copy.errRequestExpired, ERROR_CODES.REQUEST_EXPIRED),
  decided: () => new AppError(copy.errRequestDecided, ERROR_CODES.REQUEST_DECIDED),
  other: () => new AppError(copy.errRequestRefused, ERROR_CODES.REQUEST_REFUSED),
};

const isDecider = (pot: PotFacts, me: Address) => pot.deciders.some((d) => isAddressEqual(d, me));

/** Whether this payment, made now, would pass the checks the contract runs only when paying. */
function payable(pot: PotFacts, payeeIndex: number, amount: bigint, fee: bigint): AppError | null {
  const payee = pot.payees[payeeIndex];
  if (!payee) return refuse.other();
  if (payee.spent + amount > payee.cap) return refuse.overLimit(payee, pot.decimals);
  if (amount + fee > pot.totalAssets) return refuse.potShort(pot.totalAssets, pot.decimals);
  return null;
}

export type AskView = {
  fee: bigint;
  /** What the pot would hold after this payment and its fee. Negative when it can't cover them. */
  leftAfter: bigint;
  /** What the payee will have been paid in all, after this. */
  limitAfter: bigint;
  /** Yeses still needed after the asker's own. 0 means asking pays at once. */
  more: number;
  refusal: AppError | null;
};

/**
 * The ask sheet, before anything is signed. The fee is shown here because
 * asking is already a yes: the asker sees what it costs before they agree.
 */
export function askView(pot: PotFacts, me: Address, payeeIndex: number, amount: bigint | null, feeBps: bigint, feeCap: bigint): AskView {
  const value = amount ?? 0n;
  const fee = feeFor(value, feeBps, feeCap);
  const payee = pot.payees[payeeIndex];
  const view = {
    fee,
    leftAfter: pot.totalAssets - value - fee,
    limitAfter: (payee?.spent ?? 0n) + value,
    more: Math.max(0, pot.threshold - 1),
  };
  let refusal: AppError | null = null;
  if (!isDecider(pot, me)) refusal = refuse.notDecider();
  else if (pot.closed || pot.frozen) refusal = refuse.stopped();
  else if (value <= 0n) refusal = refuse.noAmount();
  else refusal = payable(pot, payeeIndex, value, fee);
  return { ...view, refusal };
}

export type RequestStatus = "waiting" | "paid" | "withdrawn";

/** One payment request, as proposalInfo reads it at the finalized block. */
export type RequestFacts = {
  proposalId: bigint;
  potId: bigint;
  /** 0 for a payment. Closing early and lifting a pause are requests too, never shown here. */
  kind: number;
  payee: number;
  amount: bigint;
  fee: bigint;
  asker: Address;
  createdAt: bigint;
  expiresAt: bigint;
  yes: Address[];
  threshold: number;
  status: RequestStatus;
};

/** proposalInfo's status enum: Pending, Executed, Cancelled, Expired. Expired is worked out from time, not stored. */
export function statusFrom(code: number): RequestStatus {
  return code === 1 ? "paid" : code === 2 ? "withdrawn" : "waiting";
}

/** Expired exactly when the contract's approve would say so: after expiresAt, at the finalized block's time. */
export function isExpired(request: Pick<RequestFacts, "status" | "expiresAt">, nowSeconds: bigint): boolean {
  return request.status === "waiting" && nowSeconds > request.expiresAt;
}

export type RequestStage =
  | "paid"
  | "withdrawn"
  | "expired"
  /** This account doesn't decide on the pot: it can follow the request, not answer it. */
  | "watching"
  /** The pot is closed or paused: nobody can say yes to a payment now. */
  | "stopped"
  /** This account's yes counts; waiting for others. */
  | "said-yes"
  /** This account's yes would pay it, but the payee's limit or the pot can't cover it now. */
  | "cannot-pay-yet"
  | "can-say-yes";

export type RequestView = {
  stage: RequestStage;
  /** Yeses still needed, counting this account's if it hasn't said yes. */
  needed: number;
  /** This account's yes is the one that pays. */
  paysOnMyYes: boolean;
  leftAfter: bigint;
  limitAfter: bigint;
  /** A yes can be taken back until the payment is made, even while the pot is paused. */
  canTakeBack: boolean;
  /** Why saying yes isn't offered, when it would be refused. */
  refusal: AppError | null;
};

/** The request screen, from what was read at one finalized block. */
export function requestView(request: RequestFacts, pot: PotFacts, me: Address, nowSeconds: bigint): RequestView {
  const iSaid = request.yes.some((a) => isAddressEqual(a, me));
  const needed = Math.max(0, request.threshold - request.yes.length);
  const payee = pot.payees[request.payee];
  const expired = isExpired(request, nowSeconds);
  const base = {
    needed,
    paysOnMyYes: !iSaid && needed === 1,
    leftAfter: pot.totalAssets - request.amount - request.fee,
    limitAfter: (payee?.spent ?? 0n) + (request.status === "paid" ? 0n : request.amount),
    canTakeBack: iSaid && request.status === "waiting" && !expired,
  };
  const at = (stage: RequestStage, refusal: AppError | null = null): RequestView => ({ ...base, stage, refusal });
  if (request.status === "paid") return { ...at("paid"), leftAfter: pot.totalAssets, canTakeBack: false };
  if (request.status === "withdrawn") return at("withdrawn", refuse.decided());
  if (expired) return at("expired", refuse.expired());
  if (!isDecider(pot, me)) return at("watching", refuse.notDecider());
  if (pot.closed || pot.frozen) return at("stopped", refuse.stopped());
  if (iSaid) return at("said-yes", refuse.decided());
  if (base.paysOnMyYes) {
    const blocked = payable(pot, request.payee, request.amount, request.fee);
    if (blocked) return at("cannot-pay-yet", blocked);
  }
  return at("can-say-yes");
}

/**
 * The code for a request the contract refused when it was run as a call.
 * Only the contract's own error names come in here; anything else is 29.
 */
export function refusalFor(errorName: string | undefined, pot?: PotFacts, request?: Pick<RequestFacts, "payee">): AppError {
  switch (errorName) {
    case "NotApprover":
      return refuse.notDecider();
    case "ZeroAmount":
      return refuse.noAmount();
    case "CapExceeded": {
      const payee = pot && request ? pot.payees[request.payee] : undefined;
      return payee && pot ? refuse.overLimit(payee, pot.decimals) : new AppError(copy.errOverLimitPlain, ERROR_CODES.PAY_OVER_LIMIT);
    }
    case "InsufficientPotAssets":
      return pot ? refuse.potShort(pot.totalAssets, pot.decimals) : new AppError(copy.errPotShortPlain, ERROR_CODES.PAY_POT_SHORT);
    case "PotClosed":
    case "PotFrozen":
      return refuse.stopped();
    case "ProposalExpired":
      return refuse.expired();
    case "ProposalNotPending":
    case "AlreadyApproved":
    case "NotApproved":
      return refuse.decided();
    default:
      return refuse.other();
  }
}

/** A payment request as the pot's event feed tells it, from finalized blocks only. */
export type AskedRequest = {
  proposalId: bigint;
  payee: number;
  amount: bigint;
  asker: Address;
  expiresAt: bigint;
  block: bigint;
  yes: Address[];
  status: RequestStatus;
  /** Set once paid: the fee taken, and the request that paid it. */
  fee: bigint | null;
  paidIn: Hex | null;
};

/**
 * Every payment request in a pot's history, newest first. Who said yes is
 * the Approved events less the ApprovalRevoked ones (gap G11).
 */
export function requestsFrom(events: PotEvent[]): AskedRequest[] {
  const byId = new Map<bigint, AskedRequest>();
  for (const e of events) {
    const id = e.args.proposalId as bigint | undefined;
    if (id === undefined) continue;
    if (e.name === "Proposed") {
      if (Number(e.args.kind) !== 0) continue;
      byId.set(id, {
        proposalId: id,
        payee: Number(e.args.destIndex),
        amount: e.args.amount as bigint,
        asker: e.args.proposer as Address,
        expiresAt: e.args.expiresAt as bigint,
        block: e.block,
        yes: [],
        status: "waiting",
        fee: null,
        paidIn: null,
      });
      continue;
    }
    const r = byId.get(id);
    if (!r) continue;
    if (e.name === "Approved") {
      const who = e.args.approver as Address;
      if (!r.yes.some((a) => isAddressEqual(a, who))) r.yes.push(who);
    } else if (e.name === "ApprovalRevoked") {
      const who = e.args.approver as Address;
      r.yes = r.yes.filter((a) => !isAddressEqual(a, who));
    } else if (e.name === "PayoutExecuted") {
      r.status = "paid";
      r.fee = e.args.fee as bigint;
      r.paidIn = e.tx;
    } else if (e.name === "ProposalCancelled") {
      r.status = "withdrawn";
    }
  }
  return [...byId.values()].sort((a, b) => (a.proposalId > b.proposalId ? -1 : 1));
}

/** Requests still waiting for a yes and not expired. Their payees' routes march and rings pulse until decided. */
export function waitingRequests(requests: AskedRequest[], nowSeconds: bigint): AskedRequest[] {
  return requests.filter((r) => !isExpired(r, nowSeconds) && r.status === "waiting");
}

const askedAtFormats = new Map<string, Intl.DateTimeFormat>();

/** When a request was asked, in the asker's own time zone: "14 Oct, 09:12". */
export function askedAt(seconds: bigint, timeZone: string): string {
  let f = askedAtFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
    askedAtFormats.set(timeZone, f);
  }
  return f.format(new Date(Number(seconds) * 1000));
}

/** A person's local time now, "12:40", for the map. */
export function localTime(nowMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(nowMs));
}

/**
 * "Payment approved and paid" (docs/MOTION.md), started only once the payment
 * is final: the pot tips, then a stream runs down the payee's route (850 ms)
 * while every layer drains (1,100 ms), the payee fills with a check when the
 * stream arrives, the pot rights itself, and the line saying it is paid shows
 * at about 2.2 s. Milliseconds from the start.
 */
export const PAID_MOTION = { stream: 350, flight: 850, drain: 1_100, check: 1_250, upright: 1_600, done: 2_200 } as const;
