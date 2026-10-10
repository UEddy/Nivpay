/**
 * When each finalized block was made, for the dates on the pot's story. A
 * finalized block's time never changes, so each is read once and kept on the
 * phone. Only block numbers and times are stored, both public.
 */

type KeyValue = Pick<Storage, "getItem" | "setItem">;

/** The most kept; the oldest are dropped past this. */
export const MAX_KEPT = 2_000;

export class BlockTimes {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string) {
    this.kv = kv;
    this.key = `nivpay.blocktimes.v1.${deployment}`;
  }

  all(): Map<bigint, bigint> {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "[]") as unknown;
      if (!Array.isArray(raw)) return new Map();
      const out = new Map<bigint, bigint>();
      for (const pair of raw) {
        if (Array.isArray(pair) && /^\d+$/.test(String(pair[0])) && /^\d+$/.test(String(pair[1]))) out.set(BigInt(pair[0]), BigInt(pair[1]));
      }
      return out;
    } catch {
      return new Map();
    }
  }

  putMany(times: Map<bigint, bigint>): void {
    const merged = [...this.all(), ...times].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-MAX_KEPT);
    try {
      this.kv.setItem(this.key, JSON.stringify(merged.map(([b, t]) => [b.toString(), t.toString()])));
    } catch {
      // Storage full: the dates are read again next time.
    }
  }
}

/** Times for these blocks: from the phone where known, the rest read a few at a time and kept. */
export async function timesFor(blocks: bigint[], store: BlockTimes, read: (block: bigint) => Promise<bigint>, parallel = 6): Promise<Map<bigint, bigint>> {
  const known = store.all();
  const todo = [...new Set(blocks)].filter((b) => !known.has(b));
  const fresh = new Map<bigint, bigint>();
  for (let i = 0; i < todo.length; i += parallel) {
    const batch = todo.slice(i, i + parallel);
    const results = await Promise.allSettled(batch.map(read));
    results.forEach((r, j) => r.status === "fulfilled" && fresh.set(batch[j]!, r.value));
  }
  if (fresh.size) store.putMany(fresh);
  return new Map([...known, ...fresh]);
}
