import { getAddress, type Address } from "viem";

/**
 * Home's balance reads. A read still waiting is never joined by another, so
 * slow reads cannot pile up behind the 5 s refresh. After SLOW_READ_MS
 * without an answer Home stops saying "Reading your balance…": it shows the
 * last balance it knows, dimmed, with when it was checked, and keeps trying.
 */
export const SLOW_READ_MS = 12_000;

/** Runs a read unless the last one is still waiting. */
export class SingleRead {
  private waiting = false;

  /** The read's promise, or null when one is still waiting and nothing new was started. */
  run<T>(read: () => Promise<T>): Promise<T> | null {
    if (this.waiting) return null;
    this.waiting = true;
    return read().finally(() => {
      this.waiting = false;
    });
  }
}

export type Holding = { decimals: number; balance: bigint };
export type LastBalance = { dollars: Holding; testDollars?: Holding; readAt: number };

type KeyValue = Pick<Storage, "getItem" | "setItem">;

/** By account, so a reload while reads are slow still has something true to show, marked as old. */
const LAST = "nivpay.lastBalance.v1";

type Raw = { dollars: { decimals: number; balance: string }; testDollars?: { decimals: number; balance: string }; readAt: number };

function holdingOf(raw: unknown): Holding | undefined {
  const r = raw as { decimals?: unknown; balance?: unknown } | null;
  if (!r || typeof r.decimals !== "number" || !Number.isInteger(r.decimals) || typeof r.balance !== "string" || !/^\d{1,78}$/.test(r.balance)) return undefined;
  return { decimals: r.decimals, balance: BigInt(r.balance) };
}

export class LastBalanceStore {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  get(address: Address): LastBalance | undefined {
    const raw = this.all()[getAddress(address)] as Partial<Raw> | undefined;
    const dollars = holdingOf(raw?.dollars);
    if (!raw || !dollars || typeof raw.readAt !== "number" || !Number.isFinite(raw.readAt)) return undefined;
    const testDollars = raw.testDollars === undefined ? undefined : holdingOf(raw.testDollars);
    return { dollars, ...(testDollars ? { testDollars } : {}), readAt: raw.readAt };
  }

  put(address: Address, last: LastBalance): void {
    const out = (h: Holding) => ({ decimals: h.decimals, balance: h.balance.toString() });
    const raw: Raw = { dollars: out(last.dollars), ...(last.testDollars ? { testDollars: out(last.testDollars) } : {}), readAt: last.readAt };
    this.kv.setItem(LAST, JSON.stringify({ ...this.all(), [getAddress(address)]: raw }));
  }

  private all(): Record<string, unknown> {
    try {
      const raw = JSON.parse(this.kv.getItem(LAST) ?? "{}") as unknown;
      return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}
