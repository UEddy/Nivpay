import { getAddress, isAddress, isAddressEqual, type Address, type Hex } from "viem";
import type { Deployment } from "./config.ts";
import type { Invite, Role } from "./invites.ts";

/**
 * Invites this phone has answered, so an invitee needs no pot link to see the
 * pot they were named on. Answering is the moment the invitee learns the pot's
 * name and who is making it; the pot itself only exists once the creator makes
 * it, later and on their own phone.
 *
 * Until then Home shows "Invited to <name> by <inviter>". Rows that are still
 * waiting after STALE_MS are dropped: the creator never made the pot, or made
 * it without this account.
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
};

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

/** Still waiting for its pot, and old enough to drop. */
export function isStale(row: AnsweredInvite, now: number): boolean {
  return now - row.answeredAt > STALE_MS;
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
