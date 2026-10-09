import { getAddress, isAddress, isAddressEqual, type Address, type Hex } from "viem";
import { LOG_PAGE_BLOCKS, type Deployment } from "./config.ts";
import type { FoundPot } from "./discover.ts";
import { ROLE, type Invite, type Role } from "./invites.ts";

/**
 * Invites this phone has answered, so an invitee needs no pot link to see the
 * pot they were named on. Answering is the moment the invitee learns the pot's
 * name and who is making it; the pot itself only exists once the creator makes
 * it, later and on their own phone.
 *
 * Until then Home shows "Invited to <name> by <inviter>". Discovery
 * (discover.ts) then finds every pot that names this account; one of those is
 * matched to the invite only if it names this account in the invited role AND
 * its PotCreated event names the inviter's account as creator. A pot name is
 * never used to match: anyone can make a pot with any name. Rows that are
 * still waiting after STALE_MS are dropped: the creator never made the pot,
 * or made it without this account.
 *
 * Only labels and public numbers live here. Nothing secret.
 */

/** A pot that is still waiting after this long is dropped from Home. */
export const STALE_MS = 14 * 24 * 60 * 60 * 1000;

export type AnsweredInvite = {
  deployment: Deployment;
  /** The account on this phone that answered. */
  account: Address;
  draftId: Hex;
  role: Role;
  slot: Hex;
  potName: string;
  /** The inviter's name, as they wrote it. */
  from: string;
  /** The account making the pot. Null for invites made before they carried it: those are never matched. */
  inviter: Address | null;
  /** Suggested share in base units, as a decimal string. "0" means none. */
  share: string;
  answeredAt: number;
  /**
   * The finalized block and pot count when the invite was answered, if they
   * could be read. The pot is made after the answer, so it is made after
   * this block and its number is at least this count.
   */
  since?: { block: string; potCount: number };
  /** The pot this invite turned into, once matched. */
  match?: Match;
  /** Pots naming this account that were checked and were not made by the inviter. */
  notFrom?: string[];
  /** How far the slow search for the inviter's pots has read, when the quick one can't run. */
  scannedTo?: string;
  /** Pots the slow search saw the inviter make, with their blocks, by pot number. */
  seen?: Record<string, string>;
};

/**
 * A made pot matched to an answered invite. Its members are fixed once it is
 * made, so they are read once, for showing as "account ending" until a pot
 * link with names is opened. The creation block lets the pot open with no
 * link at all.
 */
export type Match = { potId: string; block: string; deciders: Address[]; payees: Address[] };

export function answered(
  invite: Invite,
  deployment: Deployment,
  account: Address,
  now: number,
  since?: { block: bigint; potCount: number },
): AnsweredInvite {
  return {
    deployment,
    account: getAddress(account),
    draftId: invite.draftId,
    role: invite.role,
    slot: invite.slot,
    potName: invite.potName,
    from: invite.from,
    inviter: invite.inviter ? getAddress(invite.inviter) : null,
    share: invite.share.toString(),
    answeredAt: now,
    ...(since ? { since: { block: since.block.toString(), potCount: since.potCount } } : {}),
  };
}

/** The same invite answered by the same account. Answering it again replaces the row. */
export function sameInvite(a: AnsweredInvite, b: AnsweredInvite): boolean {
  return a.deployment === b.deployment && isAddressEqual(a.account, b.account) && a.draftId === b.draftId && a.role === b.role && a.slot === b.slot;
}

/** Still waiting for its pot, and old enough to drop. A matched row is never stale. */
export function isStale(row: AnsweredInvite, now: number): boolean {
  return !row.match && now - row.answeredAt > STALE_MS;
}

/** What matching needs from the chain. */
export interface CreatorReader {
  finalized(): Promise<bigint>;
  /** potCount() at a past block. May fail where the node no longer keeps that state. */
  potCountAt(block: bigint): Promise<number>;
  /** PotCreated events with this creator, and this pot number if given, in [from, to]; to - from is at most 100. */
  created(from: bigint, to: bigint, creator: Address, potId?: bigint): Promise<{ potId: bigint; block: bigint }[]>;
  members(potId: bigint, at: bigint): Promise<{ deciders: Address[]; payees: Address[] }>;
}

/** Pages of the slow search per poll, per invite: about 3,000 blocks, which is 15 minutes of activity. */
export const SCAN_PAGES_PER_POLL = 30;

/**
 * The block pot `potId` was made in, by bisecting potCount() between `lo`,
 * where fewer than potId + 1 pots existed, and `hi`, where it existed. About
 * 25 reads for a month of history. Needs past state; throws where the node
 * has none.
 */
export async function creationBlock(reader: Pick<CreatorReader, "potCountAt">, potId: bigint, lo: bigint, hi: bigint): Promise<bigint> {
  if (hi <= lo) throw new Error("empty range");
  while (hi - lo > 1n) {
    const mid = lo + (hi - lo) / 2n;
    if (BigInt(await reader.potCountAt(mid)) > potId) hi = mid;
    else lo = mid;
  }
  return hi;
}

const wanted = (role: Role) => (role === ROLE.decider ? "decides" : "paid");

/**
 * Matches answered invites to the pots discovery found. For each waiting row
 * with an inviter account, the candidates are found pots that name this
 * account in the invited role, numbered at or after the pot count when the
 * invite was answered, not already checked, and not matched to another row.
 * Each candidate's PotCreated event is looked up: at its exact block when
 * past state can be read (bisecting potCount), otherwise by reading the
 * inviter's PotCreated events forward from the answer, a few pages per poll.
 * Returns the rows, changed where something was learned.
 */
export async function matchInvites(
  rows: AnsweredInvite[],
  found: FoundPot[],
  reader: CreatorReader,
  deployBlock: bigint,
): Promise<AnsweredInvite[]> {
  const claimed = new Set(rows.flatMap((r) => (r.match ? [r.match.potId] : [])));
  let at: bigint | null = null;
  const out: AnsweredInvite[] = [];
  for (const row of rows) {
    if (row.match || !row.inviter) {
      out.push(row);
      continue;
    }
    const notFrom = new Set(row.notFrom ?? []);
    const candidates = found
      .filter((f) => f.roles.includes(wanted(row.role)))
      .filter((f) => !row.since || Number(f.potId) >= row.since.potCount)
      .filter((f) => !notFrom.has(f.potId) && !claimed.has(f.potId))
      .map((f) => BigInt(f.potId))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (!candidates.length) {
      out.push(row);
      continue;
    }
    at ??= await reader.finalized();
    const from = row.since ? BigInt(row.since.block) : deployBlock;
    const next = await matchOne(row, row.inviter, candidates, notFrom, reader, from, at, deployBlock);
    if (next.match) claimed.add(next.match.potId);
    out.push(next);
  }
  return out;
}

async function matchOne(
  row: AnsweredInvite,
  inviter: Address,
  candidates: bigint[],
  notFrom: Set<string>,
  reader: CreatorReader,
  from: bigint,
  at: bigint,
  deployBlock: bigint,
): Promise<AnsweredInvite> {
  const matched = async (potId: bigint, block: bigint): Promise<AnsweredInvite> => {
    const m = await reader.members(potId, at);
    const match: Match = { potId: potId.toString(), block: block.toString(), deciders: m.deciders.map((a) => getAddress(a)), payees: m.payees.map((a) => getAddress(a)) };
    return { ...row, match, notFrom: [...notFrom] };
  };

  // Quick: find each candidate's block from past state, then read that one block.
  let quick = true;
  for (const potId of candidates) {
    let block: bigint;
    try {
      const lo = row.since && BigInt(row.since.potCount) <= potId ? from : deployBlock;
      block = await creationBlock(reader, potId, lo, at);
    } catch {
      quick = false;
      break;
    }
    if ((await reader.created(block, block, inviter, potId)).length) return matched(potId, block);
    notFrom.add(potId.toString());
  }
  if (quick) return { ...row, notFrom: [...notFrom] };

  // Slow: read the inviter's PotCreated events forward, a few pages per poll,
  // remembering every pot they made so one found later by discovery still matches.
  const seen = { ...row.seen };
  const fromSeen = () => candidates.find((c) => seen[c.toString()] !== undefined);
  let cursor = row.scannedTo ? BigInt(row.scannedTo) + 1n : from;
  for (let page = 0; page < SCAN_PAGES_PER_POLL && cursor <= at && fromSeen() === undefined; page++) {
    const to = cursor + LOG_PAGE_BLOCKS - 1n < at ? cursor + LOG_PAGE_BLOCKS - 1n : at;
    for (const c of await reader.created(cursor, to, inviter)) seen[c.potId.toString()] = c.block.toString();
    cursor = to + 1n;
  }
  const hit = fromSeen();
  if (hit !== undefined) return { ...(await matched(hit, BigInt(seen[hit.toString()]!))), seen, scannedTo: (cursor - 1n).toString() };
  // Read up to where the candidates were found: none of them is the inviter's.
  if (cursor > at) for (const c of candidates) notFrom.add(c.toString());
  return { ...row, notFrom: [...notFrom], seen, scannedTo: (cursor - 1n).toString() };
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;
const INVITED_KEY = "nivpay.invited.v1";

export class InvitedStore {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  private read(): AnsweredInvite[] {
    try {
      const raw = JSON.parse(this.kv.getItem(INVITED_KEY) ?? "[]") as unknown;
      if (!Array.isArray(raw)) return [];
      return (raw as AnsweredInvite[]).filter(
        (r) => r && isAddress(r.account) && typeof r.draftId === "string" && typeof r.answeredAt === "number" && (r.inviter === null || isAddress(r.inviter)),
      );
    } catch {
      return [];
    }
  }

  private write(rows: AnsweredInvite[]): void {
    this.kv.setItem(INVITED_KEY, JSON.stringify(rows));
  }

  /** This account's rows on this deployment, newest first. Stale ones are removed from storage on the way. */
  forAccount(deployment: Deployment, account: Address, now: number): AnsweredInvite[] {
    const all = this.read();
    const kept = all.filter((r) => !isStale(r, now));
    if (kept.length !== all.length) this.write(kept);
    return kept
      .filter((r) => r.deployment === deployment && isAddressEqual(r.account, account))
      .sort((a, b) => b.answeredAt - a.answeredAt);
  }

  /** Adds the row, or replaces the same invite answered again. */
  put(row: AnsweredInvite): void {
    this.write([...this.read().filter((r) => !sameInvite(r, row)), row]);
  }
}
