import { getAddress, type Address } from "viem";
import { copy } from "../copy.ts";

/**
 * Changes to a pot on NivPayPotsV2 (README, "Pots that can change"): what
 * each one is, how it reads, and where it stands. Nothing here reads the
 * chain; lib/changesLive.ts does.
 *
 * A change that widens what can be spent (a new payee, a higher limit, a
 * later closing date) waits 72 hours after the yes that agrees it, so
 * everyone who put money in can see it coming and take their part out. One
 * that narrows it (a lower limit, a payee removed) applies with that yes.
 */

/** In the contract's order (NivPayPotsV2.ChangeKind). */
export const CHANGE_KINDS = ["add", "raise", "later", "lower", "remove"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** In the contract's order (NivPayPotsV2.ChangeStatus). */
export const CHANGE_STATUSES = ["pending", "waiting", "ready", "applied", "withdrawn", "expired", "lapsed", "overridden"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export const widens = (kind: ChangeKind) => kind === "add" || kind === "raise" || kind === "later";

/** A change as the app shows it, read from changeInfo at the finalized block. */
export type PotChange = {
  id: bigint;
  kind: ChangeKind;
  status: ChangeStatus;
  /** The payee it is about; for an added payee, its index once applied. */
  destIndex: number;
  to: Address;
  /** The new payee's name as the pot has it. Empty for the other kinds. */
  label: string;
  limit: bigint;
  endTime: bigint;
  proposer: Address;
  expiresAt: bigint;
  /** Once agreed: when it may be applied, and when it lapses. 0 before. */
  appliesAt: bigint;
  lapsesAt: bigint;
  approvals: number;
  threshold: number;
  approvedBy: Address[];
};

/** The shape changeInfo returns, as viem decodes it. */
export type ChangeInfo = {
  kind: number;
  status: number;
  destIndex: number;
  to: Address;
  label: string;
  limit: bigint;
  endTime: bigint;
  proposer: Address;
  expiresAt: bigint;
  appliesAt: bigint;
  lapsesAt: bigint;
  approvals: number;
  threshold: number;
  approvedBy: readonly Address[];
};

export function fromChain(id: bigint, v: ChangeInfo): PotChange {
  const kind = CHANGE_KINDS[v.kind];
  const status = CHANGE_STATUSES[v.status];
  if (!kind || !status) throw new Error("unknown change");
  return {
    id,
    kind,
    status,
    destIndex: Number(v.destIndex),
    to: getAddress(v.to),
    label: v.label,
    limit: v.limit,
    endTime: BigInt(v.endTime),
    proposer: getAddress(v.proposer),
    expiresAt: BigInt(v.expiresAt),
    appliesAt: BigInt(v.appliesAt),
    lapsesAt: BigInt(v.lapsesAt),
    approvals: Number(v.approvals),
    threshold: Number(v.threshold),
    approvedBy: v.approvedBy.map((a) => getAddress(a)),
  };
}

/** Still to happen: gathering yeses, waiting out its 72 hours, or ready to apply. Oldest first. */
export function openChanges(changes: readonly PotChange[]): PotChange[] {
  return changes.filter((c) => c.status === "pending" || c.status === "waiting" || c.status === "ready").sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Agreed, widening, and not yet in force: the ones funders are told about, with time to leave. */
export const isComing = (c: PotChange) => c.status === "waiting" || c.status === "ready";

export type ChangeWords = {
  /** A payee's name by its index on the pot. */
  payeeName: (index: number) => string;
  money: (units: bigint) => string;
  /** A time, in seconds, as the phone shows dates. */
  when: (seconds: bigint) => string;
};

/** What a change does, as the middle of a sentence: "add DJ, up to $300". */
export function changeWhat(c: Pick<PotChange, "kind" | "destIndex" | "label" | "limit" | "endTime">, w: ChangeWords): string {
  switch (c.kind) {
    case "add":
      return copy.changeAdd(c.label || copy.unnamedPayee, w.money(c.limit));
    case "raise":
      return copy.changeRaise(w.payeeName(c.destIndex), w.money(c.limit));
    case "later":
      return copy.changeLater(w.when(c.endTime));
    case "lower":
      return copy.changeLower(w.payeeName(c.destIndex), w.money(c.limit));
    case "remove":
      return copy.changeRemove(w.payeeName(c.destIndex));
  }
}

/** The same, starting a line: "Add DJ, up to $300". */
export const changeTitle = (c: Pick<PotChange, "kind" | "destIndex" | "label" | "limit" | "endTime">, w: ChangeWords) => capFirst(changeWhat(c, w));

/** A wait, as "72 hours" or "5 minutes", in the language in use: a pot's EXIT_WINDOW is set when its contract is deployed. */
export function waitText(seconds: bigint, locale: string): string {
  const s = Number(seconds);
  const [value, unit] = s % 3600 === 0 ? [s / 3600, "hour"] : s % 60 === 0 ? [s / 60, "minute"] : [s, "second"];
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value);
}

export function capFirst(s: string): string {
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/** Where a change stands, in one line: yeses so far, when it takes effect, or that it can be applied now. */
export function changeStatusLine(c: PotChange, w: ChangeWords): string {
  switch (c.status) {
    case "pending":
      return copy.changeYeses(c.approvals, c.threshold);
    case "waiting":
      return copy.changeTakesEffect(w.when(c.appliesAt));
    case "ready":
      return copy.changeReady;
    case "applied":
      return copy.changeApplied;
    case "withdrawn":
      return copy.changeWithdrawn;
    case "expired":
      return copy.changeExpired;
    case "lapsed":
      return copy.changeLapsed;
    case "overridden":
      return copy.changeOverridden;
  }
}

/**
 * What everyone with money in is told once a widening change is agreed:
 * "Change approved: add DJ, up to $300. Takes effect Mon 20 Oct, 09:00. If
 * you disagree, take your part out before then."
 */
export function approvedNote(c: PotChange, w: ChangeWords): string {
  return copy.changeApprovedNote(changeWhat(c, w), w.when(c.appliesAt));
}

/**
 * A limit with room in it for a quote: 10% more, up to the next whole
 * dollar ("Caterer quoted $600? Set up to $660 in case prices move."). In
 * base units of a dollar with `decimals` decimals.
 */
export function limitWithRoom(quote: bigint, decimals: number): bigint {
  if (quote <= 0n) return 0n;
  const dollar = 10n ** BigInt(decimals);
  const raised = (quote * 110n + 99n) / 100n;
  return ((raised + dollar - 1n) / dollar) * dollar;
}

/** What a decider may do with a change now, as the screen offers it. */
export function choicesFor(c: PotChange, me: Address, iDecide: boolean): { yes: boolean; withdraw: boolean; apply: boolean } {
  const mine = c.proposer.toLowerCase() === me.toLowerCase();
  const said = c.approvedBy.some((a) => a.toLowerCase() === me.toLowerCase());
  return {
    yes: iDecide && c.status === "pending" && !said,
    withdraw: mine && (c.status === "pending" || c.status === "waiting" || c.status === "ready"),
    apply: c.status === "ready",
  };
}

/** A new pending write's label, so a write left in flight is known again on reopening. */
export const changeLabel = (potId: bigint, what: string) => `change ${potId} ${what}`;
