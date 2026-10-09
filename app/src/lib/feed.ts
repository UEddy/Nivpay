import type { Hex } from "viem";

/**
 * One event feed per pot (docs/BUILD-APP.md, Live data). History comes from
 * events, never from old eth_calls, and only from FINALIZED blocks, so
 * nothing the feed reports can be taken back. Every second it pages
 * eth_getLogs from its cursor up to the finalized block, in pages no larger
 * than the RPC's measured limit (101 blocks inclusive), a few pages at a time,
 * and saves the cursor and the events after each page that lands in order.
 *
 * The animations never know where events came from; a WebSocket source can
 * replace the polling later behind the same FeedSource.
 */

export type PotEvent = {
  name: string;
  block: bigint;
  logIndex: number;
  tx: Hex;
  args: Record<string, unknown>;
};

export interface FeedSource {
  finalized(): Promise<bigint>;
  /** Every event of this pot in [from, to], both inclusive. */
  logs(from: bigint, to: bigint): Promise<PotEvent[]>;
}

export type FeedState = { cursor: bigint; events: PotEvent[] };

export interface FeedStore {
  load(): Promise<FeedState | undefined>;
  save(state: FeedState): Promise<void>;
}

/** Inclusive [from, to] pages of at most `size` blocks. */
export function pages(from: bigint, to: bigint, size: bigint): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    out.push([start, end < to ? end : to]);
  }
  return out;
}

const key = (e: PotEvent) => `${e.tx}:${e.logIndex}`;

export function byChainOrder(a: PotEvent, b: PotEvent): number {
  return a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1;
}

/**
 * Reads from the cursor (the first block not yet read) up to `finalized`.
 * Pages run `parallel` at a time; the cursor only moves past pages that all
 * succeeded in order, so a failed page is read again next time and nothing
 * is skipped. Returns the new state and the events it added.
 */
export async function catchUp(
  source: FeedSource,
  state: FeedState,
  finalized: bigint,
  pageSize: bigint,
  parallel: number,
  save: (s: FeedState) => Promise<void>,
): Promise<{ state: FeedState; added: PotEvent[] }> {
  let current = state;
  const added: PotEvent[] = [];
  const todo = pages(state.cursor, finalized, pageSize);
  for (let i = 0; i < todo.length; i += parallel) {
    const batch = todo.slice(i, i + parallel);
    const results = await Promise.allSettled(batch.map(([from, to]) => source.logs(from, to)));
    let progressed = false;
    for (let j = 0; j < batch.length; j++) {
      const r = results[j]!;
      if (r.status === "rejected") break;
      const seen = new Set(current.events.map(key));
      const fresh = r.value.filter((e) => !seen.has(key(e))).sort(byChainOrder);
      current = { cursor: batch[j]![1] + 1n, events: [...current.events, ...fresh] };
      added.push(...fresh);
      progressed = true;
    }
    if (progressed) await save(current);
    if (results.some((r) => r.status === "rejected")) break;
  }
  return { state: current, added };
}

/**
 * Polls a pot's events. `onEvents` gets every event so far and, separately,
 * the ones that are new since the last call; the first call after start
 * reports history as not new.
 */
export class PotFeed {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private state: FeedState | undefined;

  private readonly source: FeedSource;
  private readonly store: FeedStore;
  private readonly fromBlock: bigint;
  private readonly options: { pageSize: bigint; parallel: number; everyMs: number };

  constructor(source: FeedSource, store: FeedStore, fromBlock: bigint, options: { pageSize: bigint; parallel: number; everyMs: number }) {
    this.source = source;
    this.store = store;
    this.fromBlock = fromBlock;
    this.options = options;
  }

  start(onEvents: (all: PotEvent[], fresh: PotEvent[]) => void, onError?: (e: unknown) => void): void {
    this.running = true;
    let first = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        if (!this.state) {
          const saved = await this.store.load();
          this.state = saved && saved.cursor >= this.fromBlock ? saved : { cursor: this.fromBlock, events: [] };
          onEvents(this.state.events, []);
        }
        const finalized = await this.source.finalized();
        if (finalized >= this.state.cursor) {
          const { state, added } = await catchUp(this.source, this.state, finalized, this.options.pageSize, this.options.parallel, (s) =>
            this.store.save(s),
          );
          this.state = state;
          if (this.running && (added.length > 0 || first)) onEvents(state.events, first ? [] : added);
        }
        first = false;
      } catch (e) {
        onError?.(e);
      }
      if (this.running) this.timer = setTimeout(tick, this.options.everyMs);
    };
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }
}
