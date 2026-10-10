import { isAddressEqual, type Address, type Hex } from "viem";
import { copy } from "../copy.ts";
import { byChainOrder, type PotEvent } from "./feed.ts";

/**
 * The pot's story (Live-Timeline), from its finalized events only. Every row
 * is something that happened in a finalized request, with that request's
 * receipt. Nothing here reads the chain.
 */

export type RowKind =
  | "made"
  | "added"
  | "asked"
  | "yes"
  | "took-back"
  | "withdrawn"
  | "paid"
  | "took-out"
  | "share"
  | "asked-close"
  | "closed"
  | "paused"
  | "asked-unpause"
  | "unpaused";

export type StoryRow = {
  key: string;
  kind: RowKind;
  block: bigint;
  logIndex: number;
  /** The request that did it, for its receipt. */
  tx: Hex;
  title: string;
  sub: string;
  /** Whose colour the dot takes: the person whose money moved. Null for the pot's own events. */
  who: Address | null;
};

export type StoryNames = {
  me: Address;
  /** A person's name, or "account ending 7bC1" when the labels don't name them. */
  nameOf: (account: Address) => string;
  cityOf: (account: Address) => string;
  payeeName: (index: number) => string;
  money: (amount: bigint) => string;
  /** The finalized block's time, so a request's status reads as the contract would judge it. */
  now: bigint;
};

const key = (e: PotEvent) => `${e.tx}:${e.logIndex}`;
const list = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

/** Rows in chain order, oldest first. */
export function storyRows(events: PotEvent[], n: StoryNames): StoryRow[] {
  const sorted = [...events].sort(byChainOrder);
  const isMe = (a: Address) => isAddressEqual(a, n.me);
  const who = (a: Address) => (isMe(a) ? copy.youCap : n.nameOf(a));
  /** The same, later in a sentence. */
  const whoIn = (a: Address) => (isMe(a) ? copy.you : n.nameOf(a));
  // What each request was, and who said yes, as the story goes along.
  const requests = new Map<bigint, { kind: number; asker: Address; payee: number; amount: bigint; yes: Address[]; askedIn: Hex; status: "waiting" | "paid" | "withdrawn" | "done"; expiresAt: bigint }>();
  for (const e of sorted) {
    if (e.name !== "Proposed") continue;
    requests.set(e.args.proposalId as bigint, {
      kind: Number(e.args.kind),
      asker: e.args.proposer as Address,
      payee: Number(e.args.destIndex),
      amount: e.args.amount as bigint,
      yes: [],
      askedIn: e.tx,
      status: "waiting",
      expiresAt: e.args.expiresAt as bigint,
    });
  }
  // Closed names no request: the request it ended is the one the yes in the same transaction was for.
  const closeRequestIn = new Map(sorted.filter((e) => e.name === "Approved").map((e) => [e.tx, e.args.proposalId as bigint]));
  for (const e of sorted) {
    const id = e.name === "Closed" ? closeRequestIn.get(e.tx) : (e.args.proposalId as bigint | undefined);
    const r = id === undefined ? undefined : requests.get(id);
    if (!r) continue;
    if (e.name === "PayoutExecuted") r.status = "paid";
    else if (e.name === "ProposalCancelled") r.status = "withdrawn";
    else if (e.name === "Unfrozen" || (e.name === "Closed" && e.args.viaProposal)) r.status = "done";
  }
  // Txs that ended a request: their yes is told in that row, not on its own.
  const endedIn = new Set(sorted.filter((e) => e.name === "PayoutExecuted" || e.name === "Unfrozen" || (e.name === "Closed" && e.args.viaProposal)).map((e) => e.tx));

  const rows: StoryRow[] = [];
  const add = (e: PotEvent, kind: RowKind, title: string, sub: string, person: Address | null) =>
    rows.push({ key: key(e), kind, block: e.block, logIndex: e.logIndex, tx: e.tx, title, sub, who: person });
  const yesAt = new Map<bigint, Address[]>();

  for (const e of sorted) {
    const id = e.args.proposalId as bigint | undefined;
    const r = id === undefined ? undefined : requests.get(id);
    switch (e.name) {
      case "PotCreated": {
        const by = e.args.creator as Address;
        add(e, "made", isMe(by) ? copy.storyMadeYou : copy.storyMade(n.nameOf(by)), n.cityOf(by) ? copy.storyFrom(n.cityOf(by)) : "", by);
        break;
      }
      case "Funded": {
        const by = e.args.funder as Address;
        add(e, "added", copy.storyAdded(who(by), n.money(e.args.assets as bigint)), n.cityOf(by) ? copy.storyFrom(n.cityOf(by)) : "", by);
        break;
      }
      case "Proposed": {
        if (!r) break;
        const by = r.asker;
        yesAt.set(id!, [by]);
        const status =
          r.status === "paid" || r.status === "done"
            ? copy.storyStatusDone
            : r.status === "withdrawn"
              ? copy.storyStatusWithdrawn
              : n.now > r.expiresAt
                ? copy.storyStatusExpired
                : copy.storyStatusWaiting;
        if (r.kind === 0) add(e, "asked", copy.storyAsked(who(by), n.money(r.amount), n.payeeName(r.payee)), status, null);
        else if (r.kind === 1) add(e, "asked-close", copy.storyAskedClose(who(by)), status, null);
        else add(e, "asked-unpause", copy.storyAskedUnpause(who(by)), status, null);
        break;
      }
      case "Approved": {
        if (!r) break;
        const by = e.args.approver as Address;
        const yes = yesAt.get(id!) ?? [];
        if (!yes.some((a) => isAddressEqual(a, by))) yes.push(by);
        yesAt.set(id!, yes);
        // The asker's own yes comes with the ask; the yes that ends a request is told with what it did.
        if (e.tx === r.askedIn || endedIn.has(e.tx)) break;
        add(e, "yes", isMe(by) ? copy.storyYesYou : copy.storyYes(n.nameOf(by)), subFor(r, n), null);
        break;
      }
      case "ApprovalRevoked": {
        if (!r) break;
        const by = e.args.approver as Address;
        yesAt.set(id!, (yesAt.get(id!) ?? []).filter((a) => !isAddressEqual(a, by)));
        add(e, "took-back", isMe(by) ? copy.storyTookBackYou : copy.storyTookBack(n.nameOf(by)), subFor(r, n), null);
        break;
      }
      case "ProposalCancelled": {
        if (!r) break;
        add(e, "withdrawn", copy.storyWithdrawn(who(r.asker)), subFor(r, n), null);
        break;
      }
      case "PayoutExecuted": {
        const amount = e.args.amount as bigint;
        const yes = (r ? (yesAt.get(id!) ?? []) : []).filter((a) => !r || !isAddressEqual(a, r.asker));
        const fee = n.money(e.args.fee as bigint);
        const sub = !r ? copy.storyFee(fee) : yes.length ? copy.storyPaidBy(who(r.asker), list.format(yes.map(whoIn)), fee) : copy.storyPaidByAsker(who(r.asker), fee);
        add(e, "paid", copy.storyPaid(n.money(amount), n.payeeName(Number(e.args.destIndex))), sub, null);
        break;
      }
      case "Exited": {
        const by = e.args.funder as Address;
        add(e, "took-out", isMe(by) ? copy.storyTookOutYou(n.money(e.args.assets as bigint)) : copy.storyTookOut(n.nameOf(by), n.money(e.args.assets as bigint)), copy.storyBeforeClose, by);
        break;
      }
      case "Claimed": {
        const by = e.args.funder as Address;
        add(e, "share", isMe(by) ? copy.storyShareYou(n.money(e.args.assets as bigint)) : copy.storyShare(n.nameOf(by), n.money(e.args.assets as bigint)), copy.storyAfterClose, by);
        break;
      }
      case "Closed": {
        const left = n.money(e.args.remainingAssets as bigint);
        if (e.args.viaProposal) {
          const reqId = closeRequestIn.get(e.tx);
          const cr = reqId === undefined ? undefined : requests.get(reqId);
          const yes = cr ? (yesAt.get(reqId!) ?? []).filter((a) => !isAddressEqual(a, cr.asker)) : [];
          add(e, "closed", copy.storyClosedEarly, cr && yes.length ? copy.storyClosedBy(who(cr.asker), list.format(yes.map(whoIn)), left) : copy.storyLeftToShare(left), null);
        } else add(e, "closed", copy.storyClosedOnDate, copy.storyLeftToShare(left), null);
        break;
      }
      case "Frozen":
        add(e, "paused", copy.storyPaused(who(e.args.approver as Address)), copy.storyPausedSub, null);
        break;
      case "Unfrozen":
        add(e, "unpaused", copy.storyUnpaused, "", null);
        break;
    }
  }
  return rows;
}

function subFor(r: { kind: number; payee: number; amount: bigint }, n: StoryNames): string {
  if (r.kind === 0) return copy.storyForPayment(n.money(r.amount), n.payeeName(r.payee));
  return r.kind === 1 ? copy.storyForClose : copy.storyForUnpause;
}

export type Order = "newest" | "oldest";

export function ordered(rows: StoryRow[], order: Order): StoryRow[] {
  const out = [...rows].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  return order === "newest" ? out.reverse() : out;
}

/**
 * One frame of the replay: what the pot held and what each person's shares
 * were worth right after a step, worked out with the contract's own
 * conversion (virtual offset 10**3, rounding down), from the amounts and
 * shares in the events. `payee` is set on a payment, `person` on money that
 * was theirs.
 */
export type ReplayStep = { key: string; block: bigint; assets: bigint; held: Record<string, bigint>; payee: number | null; person: Address | null };

const OFFSET = 1_000n;

export function replaySteps(events: PotEvent[]): ReplayStep[] {
  let assets = 0n;
  let supply = 0n;
  const shares = new Map<string, bigint>();
  const out: ReplayStep[] = [];
  const snapshot = (e: PotEvent, payee: number | null, person: Address | null) => {
    const held: Record<string, bigint> = {};
    for (const [a, s] of shares) held[a] = (s * (assets + 1n)) / (supply + OFFSET);
    out.push({ key: key(e), block: e.block, assets, held, payee, person });
  };
  for (const e of [...events].sort(byChainOrder)) {
    if (e.name === "Funded") {
      const a = (e.args.funder as string).toLowerCase();
      const minted = e.args.sharesMinted as bigint;
      assets += e.args.assets as bigint;
      supply += minted;
      shares.set(a, (shares.get(a) ?? 0n) + minted);
      snapshot(e, null, e.args.funder as Address);
    } else if (e.name === "PayoutExecuted") {
      assets -= (e.args.amount as bigint) + (e.args.fee as bigint);
      snapshot(e, Number(e.args.destIndex), null);
    } else if (e.name === "Exited" || e.name === "Claimed") {
      const a = (e.args.funder as string).toLowerCase();
      const burned = e.args.sharesBurned as bigint;
      assets -= e.args.assets as bigint;
      supply -= burned;
      shares.set(a, (shares.get(a) ?? 0n) - burned);
      snapshot(e, null, e.args.funder as Address);
    }
  }
  return out;
}

/** The whole story replays in about 7 s (docs/MOTION.md): each step gets an even part of it, never more than 1.1 s. */
export function replayStepMs(steps: number): number {
  if (steps <= 0) return 0;
  return Math.min(1_100, Math.floor(7_000 / steps));
}
