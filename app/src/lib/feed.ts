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
 *
 * A phone that has never opened a pot does not read it oldest first. It
 * starts at the finalized block and fills the history below it in the
 * background, newest page first, a couple of pages at a time, so the newest
 * entries come first and the screen shows the pot's numbers (read separately
 * at the finalized block) at once, whatever the pot's age. Only what arrives
 * going forward is new; what the background fill finds is history.
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

/**
 * `cursor` is the first block not read going forward. `gaps` are ranges below
 * it not read yet, newest first, filled from their top down. A state saved
 * before gaps existed has none: everything below its cursor was read.
 */
export type FeedState = { cursor: bigint; events: PotEvent[]; gaps?: [bigint, bigint][] };

/** Whether the whole history from the first block is read. Totals and replays wait for it. */
export type FeedProgress = { complete: boolean };

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

/** At most this many pages behind, the feed reads forward and what it finds is new; further behind, the span becomes a gap. */
export const LIVE_PAGES = 3n;

/** Pages from the top of [from, to] downward, at most `count`, newest first. */
export function pagesDown(from: bigint, to: bigint, size: bigint, count: number): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let top = to; top >= from && out.length < count; top -= size) {
    const bottom = top - size + 1n;
    out.push([bottom > from ? bottom : from, top]);
  }
  return out;
}

/** Events from both, each once, in chain order. */
export function mergeEvents(a: PotEvent[], b: PotEvent[]): PotEvent[] {
  const out = new Map<string, PotEvent>();
  for (const e of [...a, ...b]) out.set(key(e), e);
  return [...out.values()].sort(byChainOrder);
}

/**
 * Reads the top of a gap: up to `parallel` pages downward. Pages that came
 * back are used only while they run unbroken from the top, so a failed page
 * is read again and nothing below it is taken as read. Returns what is left
 * of the gap (null when it is all read) and the events found. Throws when
 * not even the top page came back.
 */
export async function fillTop(source: FeedSource, gap: [bigint, bigint], size: bigint, parallel: number): Promise<{ rest: [bigint, bigint] | null; added: PotEvent[] }> {
  const todo = pagesDown(gap[0], gap[1], size, parallel);
  const results = await Promise.allSettled(todo.map(([from, to]) => source.logs(from, to)));
  let top = gap[1];
  let read = 0;
  const added: PotEvent[] = [];
  for (let i = 0; i < todo.length; i++) {
    const r = results[i]!;
    if (r.status === "rejected") break;
    added.push(...r.value);
    top = todo[i]![0] - 1n;
    read++;
  }
  if (read === 0) throw (results[0] as PromiseRejectedResult).reason;
  return { rest: top >= gap[0] ? [gap[0], top] : null, added };
}

const sameGap = (a: [bigint, bigint], b: [bigint, bigint]) => a[0] === b[0] && a[1] === b[1];

export type FeedOptions = {
  pageSize: bigint;
  /** Pages read at a time going forward. */
  parallel: number;
  everyMs: number;
  /** Pages read at a time filling history. Kept low, under the RPC's 15 a second. */
  backParallel?: number;
  /** Pause between batches of history, so live reads always get through. */
  pauseMs?: number;
  /** Wait after a failed batch of history before trying it again. */
  retryMs?: number;
};

/**
 * Polls a pot's events. `onEvents` gets every event so far, separately the
 * ones that are new since the last call, and whether the history is
 * complete. The first call after start reports what was saved; history the
 * background fill finds is never new.
 */
export class PotFeed {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private filling = false;
  private state: FeedState | undefined;
  private emit: (fresh: PotEvent[]) => void = () => {};

  private readonly source: FeedSource;
  private readonly store: FeedStore;
  private readonly fromBlock: bigint;
  private readonly options: FeedOptions;

  constructor(source: FeedSource, store: FeedStore, fromBlock: bigint, options: FeedOptions) {
    this.source = source;
    this.store = store;
    this.fromBlock = fromBlock;
    this.options = options;
  }

  private progress(): FeedProgress {
    return { complete: (this.state?.gaps?.length ?? 0) === 0 };
  }

  private save(): Promise<void> {
    return this.state ? this.store.save(this.state) : Promise.resolve();
  }

  start(onEvents: (all: PotEvent[], fresh: PotEvent[], progress: FeedProgress) => void, onError?: (e: unknown) => void): void {
    this.running = true;
    this.emit = (fresh) => {
      if (this.running && this.state) onEvents(this.state.events, fresh, this.progress());
    };
    let first = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        if (!this.state) {
          const saved = await this.store.load();
          if (saved && saved.cursor >= this.fromBlock) {
            this.state = { ...saved, gaps: saved.gaps ?? [] };
          } else {
            // Never opened here: start at the finalized block and fill what is below it, newest first.
            const finalized = await this.source.finalized();
            this.state = { cursor: finalized + 1n, events: [], gaps: finalized >= this.fromBlock ? [[this.fromBlock, finalized]] : [] };
            await this.save();
          }
          this.emit([]);
          void this.fill(onError);
        }
        const finalized = await this.source.finalized();
        const state = this.state;
        if (finalized >= state.cursor) {
          if (finalized - state.cursor + 1n > LIVE_PAGES * this.options.pageSize) {
            // Away for a while: the missed span is filled newest first too, and none of it is new.
            this.state = { ...state, cursor: finalized + 1n, gaps: [[state.cursor, finalized], ...(state.gaps ?? [])] };
            await this.save();
            this.emit([]);
            void this.fill(onError);
          } else {
            const read = await catchUp(this.source, { cursor: state.cursor, events: [] }, finalized, this.options.pageSize, this.options.parallel, async () => {});
            const now = this.state;
            const seen = new Set(now.events.map(key));
            const added = read.added.filter((e) => !seen.has(key(e)));
            this.state = { ...now, cursor: read.state.cursor > now.cursor ? read.state.cursor : now.cursor, events: mergeEvents(now.events, added) };
            await this.save();
            if (added.length > 0 || first) this.emit(first ? [] : added);
          }
        }
        first = false;
      } catch (e) {
        onError?.(e);
      }
      if (this.running) this.timer = setTimeout(tick, this.options.everyMs);
    };
    void tick();
  }

  /** Fills the gaps from their top down, a couple of pages at a time, while running. */
  private async fill(onError?: (e: unknown) => void): Promise<void> {
    if (this.filling) return;
    this.filling = true;
    const parallel = this.options.backParallel ?? 2;
    const pause = this.options.pauseMs ?? 100;
    const retry = this.options.retryMs ?? 1_000;
    try {
      while (this.running && this.state?.gaps?.length) {
        const gap = this.state.gaps[0]!;
        try {
          const { rest, added } = await fillTop(this.source, gap, this.options.pageSize, parallel);
          const now = this.state;
          const gaps = (now.gaps ?? []).flatMap((g) => (sameGap(g, gap) ? (rest ? [rest] : []) : [g]));
          this.state = { ...now, events: mergeEvents(now.events, added), gaps };
          await this.save();
          this.emit([]);
          await new Promise((r) => setTimeout(r, pause));
        } catch (e) {
          onError?.(e);
          await new Promise((r) => setTimeout(r, retry));
        }
      }
    } finally {
      this.filling = false;
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }
}
