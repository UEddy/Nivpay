import { getAddress, isAddress, isAddressEqual, type Address } from "viem";
import { creationBlock } from "./invited.ts";

/**
 * Requests waiting for this account's yes, found from the chain alone, so a
 * named decider sees them on Home without any link (the friction rule). A
 * share link is only ever a nudge.
 *
 * Request numbers are global and only grow, so like discovery this reads
 * proposalInfo for numbers it hasn't seen yet, at one finalized block, and
 * keeps only requests on pots this account decides on. Requests still open
 * are read again on every poll, since a yes, a payment or a withdrawal can
 * end them. Expiry is judged at the finalized block's time, as the contract
 * judges it.
 */

export type OpenRequest = {
  proposalId: string;
  potId: string;
  /** 0 a payment, 1 closing early. */
  kind: number;
  payee: number;
  amount: string;
  asker: Address;
  expiresAt: string;
  yes: Address[];
  threshold: number;
};

export type AskScan = {
  /** Requests below this number have been read once. */
  checkedUpTo: number;
  open: OpenRequest[];
};

export const EMPTY_ASK_SCAN: AskScan = { checkedUpTo: 0, open: [] };

/** New request numbers read in one poll. More are read on the next. */
export const NEW_REQUESTS_PER_POLL = 200;

export type RequestInfo = {
  potId: bigint;
  kind: number;
  /** proposalInfo's status: 0 Pending, 1 Executed, 2 Cancelled, 3 Expired. */
  status: number;
  payee: number;
  amount: bigint;
  asker: Address;
  expiresAt: bigint;
  yes: Address[];
  threshold: number;
};

export interface AskReader {
  /** The finalized block and its time in seconds. */
  finalized(): Promise<{ number: bigint; timestamp: bigint }>;
  proposalCount(at: bigint): Promise<number>;
  infos(ids: number[], at: bigint): Promise<RequestInfo[]>;
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

/**
 * One poll. `decides` is the set of pot numbers this account decides on;
 * requests on other pots are never kept. Close requests (kind 1) are kept as
 * well as payments; a request to lift a pause (kind 2) is not shown.
 */
export async function findOpenRequests(reader: AskReader, previous: AskScan, decides: Set<string>): Promise<AskScan> {
  const at = await reader.finalized();
  const count = await reader.proposalCount(at.number);
  const from = Math.min(previous.checkedUpTo, count);
  const to = Math.min(count, from + NEW_REQUESTS_PER_POLL);
  const ids = [...new Set([...previous.open.map((r) => Number(r.proposalId)), ...range(from, to)])];
  const infos = ids.length ? await reader.infos(ids, at.number) : [];
  const open: OpenRequest[] = [];
  ids.forEach((id, i) => {
    const r = infos[i]!;
    const live = r.status === 0 && at.timestamp <= r.expiresAt;
    if (!live || r.kind > 1 || !decides.has(r.potId.toString())) return;
    open.push({
      proposalId: id.toString(),
      potId: r.potId.toString(),
      kind: r.kind,
      payee: r.payee,
      amount: r.amount.toString(),
      asker: getAddress(r.asker),
      expiresAt: r.expiresAt.toString(),
      yes: r.yes.map((a) => getAddress(a)),
      threshold: r.threshold,
    });
  });
  open.sort((a, b) => Number(b.proposalId) - Number(a.proposalId));
  return { checkedUpTo: to, open };
}

/** Open requests this account hasn't said yes to: the ones Home asks it about. */
export function needingMyYes(scan: AskScan, me: Address): OpenRequest[] {
  return scan.open.filter((r) => !r.yes.some((a) => isAddressEqual(a, me)));
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;

/** What was found, per deployment and account, so Home shows it at once next time. Public numbers only. */
export class AskScanStore {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string, account: Address) {
    if (!isAddress(account)) throw new Error("not an account");
    this.kv = kv;
    this.key = `nivpay.asks.v1.${deployment}.${getAddress(account)}`;
  }

  load(): AskScan {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "null") as Partial<AskScan> | null;
      if (!raw || typeof raw.checkedUpTo !== "number" || !Array.isArray(raw.open)) return EMPTY_ASK_SCAN;
      return { checkedUpTo: raw.checkedUpTo, open: raw.open };
    } catch {
      return EMPTY_ASK_SCAN;
    }
  }

  save(scan: AskScan): void {
    this.kv.setItem(this.key, JSON.stringify(scan));
  }
}

/**
 * The block each pot was made in, found once by bisecting potCount() over
 * past state and remembered, so a pot found by discovery opens with no link.
 * Blocks are public and never change.
 */
export class PotBlocks {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string) {
    this.kv = kv;
    this.key = `nivpay.potblocks.v1.${deployment}`;
  }

  all(): Record<string, string> {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "{}") as unknown;
      if (!raw || typeof raw !== "object") return {};
      return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k, v]) => /^\d+$/.test(k) && typeof v === "string" && /^\d+$/.test(v))) as Record<string, string>;
    } catch {
      return {};
    }
  }

  get(potId: string): string | undefined {
    return this.all()[potId];
  }

  put(potId: string, block: string): void {
    this.kv.setItem(this.key, JSON.stringify({ ...this.all(), [potId]: block }));
  }
}

/** Finds and remembers the creation block of each pot not yet known, at most `limit` per call. */
export async function learnPotBlocks(
  store: PotBlocks,
  potIds: string[],
  reader: { potCountAt(block: bigint): Promise<number>; finalized(): Promise<bigint> },
  deployBlock: bigint,
  limit = 2,
): Promise<void> {
  const known = store.all();
  const todo = potIds.filter((id) => !known[id]).slice(0, limit);
  if (!todo.length) return;
  const hi = await reader.finalized();
  for (const id of todo) store.put(id, (await creationBlock(reader, BigInt(id), deployBlock, hi)).toString());
}
