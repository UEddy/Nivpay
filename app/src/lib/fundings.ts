import { getAddress, isAddress, type Address } from "viem";
import type { Funding } from "./notes.ts";

/**
 * Money put into this account's own pots by the people in them: the
 * deciders and the people the pot can pay, whom its maker invited. Read from
 * the pots' Funded events, from where the last read stopped up to the block
 * discovery read the totals at, so the notes for that rise (notes.ts) name
 * them and say nothing twice.
 *
 * eth_getLogs on the public RPC allows 100 blocks a call, so one read covers
 * at most MAX_PAGES pages. A phone that was away longer skips ahead: what it
 * missed still shows, as "someone put", from the pot's total.
 */

export const MAX_PAGES = 30;

export type FundedLog = { tx: string; logIndex: number; potId: bigint; funder: Address; assets: bigint };

export interface FundingsReader {
  /** Funded events for these pots in blocks from..to, both included, to - from < page size. */
  funded(potIds: bigint[], from: bigint, to: bigint): Promise<FundedLog[]>;
  /** A pot's deciders and the accounts it can pay. Fixed once the pot is made. */
  members(potId: bigint, at: bigint): Promise<{ deciders: Address[]; payees: Address[] }>;
}

export type FundingsResult = { readTo: bigint; fundings: Funding[] };

/**
 * Reads from `readTo + 1` up to `at`. `readTo` null is the first read: it
 * starts at `at` and says nothing about what came before.
 */
export async function readFundings(
  reader: FundingsReader,
  me: Address,
  myPots: string[],
  readTo: bigint | null,
  at: bigint,
  pageBlocks: bigint,
  memberCache: Map<string, Address[]>,
): Promise<FundingsResult> {
  if (readTo === null || at <= readTo || !myPots.length) return { readTo: readTo === null || at > readTo ? at : readTo, fundings: [] };
  let from = readTo + 1n;
  const earliest = at - pageBlocks * BigInt(MAX_PAGES) + 1n;
  if (from < earliest) from = earliest;
  const ids = myPots.map((p) => BigInt(p));
  const logs: FundedLog[] = [];
  for (let start = from; start <= at; start += pageBlocks) {
    const end = start + pageBlocks - 1n < at ? start + pageBlocks - 1n : at;
    logs.push(...(await reader.funded(ids, start, end)));
  }
  const fundings: Funding[] = [];
  for (const l of logs) {
    const potId = l.potId.toString();
    if (!myPots.includes(potId) || !isAddress(l.funder) || l.funder.toLowerCase() === me.toLowerCase()) continue;
    let members = memberCache.get(potId);
    if (!members) {
      const m = await reader.members(l.potId, at);
      members = [...m.deciders, ...m.payees].map((a) => getAddress(a));
      memberCache.set(potId, members);
    }
    if (!members.some((m) => m.toLowerCase() === l.funder.toLowerCase())) continue;
    fundings.push({ id: `${l.tx}:${l.logIndex}`, potId, from: getAddress(l.funder), amount: l.assets.toString() });
  }
  return { readTo: at, fundings };
}

/** Pots' members by pot number, for readFundings to fill and reuse. */
export const memberCache = () => new Map<string, Address[]>();

type KeyValue = Pick<Storage, "getItem" | "setItem">;

/** Where the last read stopped, per deployment and account. */
export class FundingsCursor {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string, account: Address) {
    this.kv = kv;
    this.key = `nivpay.fundings.v1.${deployment}.${getAddress(account)}`;
  }

  get(): bigint | null {
    try {
      const v = this.kv.getItem(this.key);
      return v && /^\d+$/.test(v) ? BigInt(v) : null;
    } catch {
      return null;
    }
  }

  set(block: bigint): void {
    try {
      this.kv.setItem(this.key, block.toString());
    } catch {
      // Storage refused: the next read starts fresh.
    }
  }
}
