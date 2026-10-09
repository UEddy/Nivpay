import { getAddress, isAddress, type Address } from "viem";

/**
 * Finds the pots an account is named on, from the chain alone, so a pot shows
 * up on every phone of everyone in it even if its link never arrived.
 *
 * The contract numbers pots 0 to potCount - 1 and has a view for each part of
 * a pot, so this reads views at one finalized block rather than scanning
 * history (eth_getLogs allows only 100 blocks per call). Deciders and payees
 * are fixed when a pot is made, so each pot's members are read once and
 * remembered; only new pots are read on later polls. Whether the account has
 * put money in can change, so that is read again for the most recent pots on
 * every poll, along with the live numbers of every pot found.
 */

export type Role = "decides" | "paid" | "putIn";

export type FoundPot = {
  potId: string;
  roles: Role[];
  /** The pot's name as stored on chain. */
  name: string;
  /** Base units of the pot's dollar, as a decimal string. */
  totalAssets: string;
  endTime: string;
  closed: boolean;
};

export type ScanState = {
  /** Pots below this number have had their members read. */
  checkedUpTo: number;
  /** Pots where the account decides or can be paid, which never changes, by pot number. */
  named: Record<string, Role[]>;
  found: FoundPot[];
  decimals: number | null;
};

export const EMPTY_SCAN: ScanState = { checkedUpTo: 0, named: {}, found: [], decimals: null };

/** New pots whose members are read in one poll. More are read on the next. */
export const NEW_PER_POLL = 200;
/** The most recent pots checked each poll for money this account has put in. */
export const PUT_IN_WINDOW = 500;

export type PotView = { name: string; totalAssets: bigint; endTime: bigint; closed: boolean };

/** Everything discovery needs from the chain, all read at one block. */
export interface PotsReader {
  finalized(): Promise<bigint>;
  potCount(at: bigint): Promise<number>;
  decimals(at: bigint): Promise<number>;
  members(potIds: number[], at: bigint): Promise<{ deciders: Address[]; payees: Address[] }[]>;
  shares(potIds: number[], account: Address, at: bigint): Promise<bigint[]>;
  views(potIds: number[], at: bigint): Promise<PotView[]>;
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();

export async function findPots(reader: PotsReader, previous: ScanState, account: Address): Promise<ScanState> {
  const at = await reader.finalized();
  const [count, decimals] = await Promise.all([reader.potCount(at), previous.decimals ?? reader.decimals(at)]);

  const from = Math.min(previous.checkedUpTo, count);
  const to = Math.min(count, from + NEW_PER_POLL);
  const fresh = range(from, to);
  const named = { ...previous.named };
  const members = fresh.length ? await reader.members(fresh, at) : [];
  fresh.forEach((potId, i) => {
    const m = members[i]!;
    const roles: Role[] = [];
    if (m.deciders.some((d) => same(d, account))) roles.push("decides");
    if (m.payees.some((p) => same(p, account))) roles.push("paid");
    if (roles.length) named[potId] = roles;
  });

  const window = range(Math.max(0, to - PUT_IN_WINDOW), to);
  const held = window.length ? await reader.shares(window, account, at) : [];
  const roles = new Map<number, Role[]>(Object.entries(named).map(([id, r]) => [Number(id), [...r]]));
  window.forEach((potId, i) => {
    if ((held[i] ?? 0n) > 0n) roles.set(potId, [...(roles.get(potId) ?? []), "putIn"]);
  });
  // Pots older than the window aren't checked for money put in on every
  // poll, so one found that way stays listed.
  for (const p of previous.found) {
    const id = Number(p.potId);
    if (!roles.has(id) && id < to - PUT_IN_WINDOW && p.roles.includes("putIn")) roles.set(id, ["putIn"]);
  }

  const ids = [...roles.keys()].sort((a, b) => b - a);
  const views = ids.length ? await reader.views(ids, at) : [];
  return {
    checkedUpTo: to,
    named,
    decimals,
    found: ids.map((id, i) => ({
      potId: id.toString(),
      roles: roles.get(id)!,
      name: views[i]!.name,
      totalAssets: views[i]!.totalAssets.toString(),
      endTime: views[i]!.endTime.toString(),
      closed: views[i]!.closed,
    })),
  };
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;

/**
 * What discovery has learned, per deployment and account, so a reopened app
 * shows the pots at once and reads only what is new. Holds pot numbers, roles
 * and public numbers only.
 */
export class ScanStore {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string, account: Address) {
    if (!isAddress(account)) throw new Error("not an account");
    this.kv = kv;
    this.key = `nivpay.found.v1.${deployment}.${getAddress(account)}`;
  }

  load(): ScanState {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "null") as Partial<ScanState> | null;
      if (!raw || typeof raw.checkedUpTo !== "number" || !Array.isArray(raw.found) || typeof raw.named !== "object" || !raw.named) return EMPTY_SCAN;
      return { checkedUpTo: raw.checkedUpTo, named: raw.named, found: raw.found, decimals: typeof raw.decimals === "number" ? raw.decimals : null };
    } catch {
      return EMPTY_SCAN;
    }
  }

  save(state: ScanState): void {
    this.kv.setItem(this.key, JSON.stringify(state));
  }
}
