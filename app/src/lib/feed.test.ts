import { test } from "node:test";
import assert from "node:assert/strict";
import { catchUp, pages, PotFeed, type FeedSource, type FeedState, type PotEvent } from "./feed.ts";

const ev = (block: bigint, logIndex = 0, name = "Funded"): PotEvent => ({
  name,
  block,
  logIndex,
  tx: `0x${block.toString(16).padStart(64, "0")}`,
  args: {},
});

/** A chain with events at the given blocks, and a log of every range asked for. */
function fakeSource(eventsAt: PotEvent[], finalized: bigint, failRanges: Set<string> = new Set()) {
  const asked: [bigint, bigint][] = [];
  const source: FeedSource & { finalizedNow: bigint } = {
    finalizedNow: finalized,
    async finalized() {
      return this.finalizedNow;
    },
    async logs(from, to) {
      asked.push([from, to]);
      if (to - from + 1n > 101n) throw new Error("eth_getLogs is limited to a 100 range");
      if (failRanges.has(`${from}`)) throw new Error("timeout");
      return eventsAt.filter((e) => e.block >= from && e.block <= to);
    },
  };
  return { source, asked };
}

test("pages are inclusive and never wider than the measured limit", () => {
  assert.deepEqual(pages(100n, 100n, 101n), [[100n, 100n]]);
  assert.deepEqual(pages(0n, 201n, 101n), [[0n, 100n], [101n, 201n]]);
  assert.deepEqual(pages(0n, 202n, 101n), [[0n, 100n], [101n, 201n], [202n, 202n]]);
  assert.deepEqual(pages(5n, 4n, 101n), []);
  for (const [a, b] of pages(47_000_000n, 47_003_333n, 101n)) assert.ok(b - a <= 100n);
});

test("catching up reads every page once, in order, and moves the cursor past the finalized block", async () => {
  const events = [ev(1_000n), ev(1_150n, 3), ev(1_150n, 1), ev(1_420n)];
  const { source, asked } = fakeSource(events, 1_500n);
  const saves: FeedState[] = [];
  const { state, added } = await catchUp(source, { cursor: 1_000n, events: [] }, 1_500n, 101n, 4, async (s) => void saves.push(s));
  assert.equal(state.cursor, 1_501n);
  assert.deepEqual(added.map((e) => [e.block, e.logIndex]), [[1_000n, 0], [1_150n, 1], [1_150n, 3], [1_420n, 0]]);
  assert.equal(asked.length, 5, "1000 to 1500 is five pages");
  assert.ok(saves.length >= 2, "saved as it went");
});

test("a failed page is read again next time and nothing after it is skipped", async () => {
  const events = [ev(1_050n), ev(1_120n), ev(1_250n)];
  const { source } = fakeSource(events, 1_300n, new Set(["1101"]));
  const first = await catchUp(source, { cursor: 1_000n, events: [] }, 1_300n, 101n, 4, async () => {});
  assert.equal(first.state.cursor, 1_101n, "stopped before the failed page");
  assert.deepEqual(first.added.map((e) => e.block), [1_050n]);

  const { source: healthy } = fakeSource(events, 1_300n);
  const second = await catchUp(healthy, first.state, 1_300n, 101n, 4, async () => {});
  assert.equal(second.state.cursor, 1_301n);
  assert.deepEqual(second.added.map((e) => e.block), [1_120n, 1_250n]);
});

test("the same log is never added twice", async () => {
  const events = [ev(10n), ev(20n)];
  const { source } = fakeSource(events, 30n);
  const { state } = await catchUp(source, { cursor: 0n, events: [ev(10n)] }, 30n, 101n, 1, async () => {});
  assert.deepEqual(state.events.map((e) => e.block), [10n, 20n]);
});

test("the feed reports history first, then only what is new, and resumes from its saved cursor", async () => {
  const events = [ev(10n), ev(40n)];
  const { source, asked } = fakeSource(events, 30n);
  let saved: FeedState | undefined = { cursor: 0n, events: [] };
  const store = { load: async () => saved, save: async (s: FeedState) => void (saved = s) };
  const calls: [number, number][] = [];
  const feed = new PotFeed(source, store, 0n, { pageSize: 101n, parallel: 2, everyMs: 5 });
  await new Promise<void>((resolve) => {
    feed.start((all, fresh) => {
      calls.push([all.length, fresh.length]);
      if (calls.length === 2) source.finalizedNow = 50n;
      if (all.length === 2) resolve();
    });
  });
  feed.stop();
  assert.deepEqual(calls[0], [0, 0], "what was stored, before reading");
  assert.deepEqual(calls[1], [1, 0], "history is not fresh");
  assert.deepEqual(calls.at(-1), [2, 1], "a new event is fresh");
  assert.equal(saved?.cursor, 51n);
  asked.length = 0;

  // Reopened later: starts from the saved cursor, not the pot's first block.
  const again = new PotFeed(source, store, 0n, { pageSize: 101n, parallel: 2, everyMs: 5 });
  await new Promise<void>((resolve) => again.start((all) => all.length === 2 && resolve()));
  again.stop();
  assert.ok(asked.every(([from]) => from >= 51n), "nothing read twice");
});

// ---------------------------------------------------------------------------
// First open of an old pot: newest history first, in the background
// ---------------------------------------------------------------------------

import { fillTop, pagesDown, type FeedProgress } from "./feed.ts";

const fast = { pageSize: 101n, parallel: 2, everyMs: 5, backParallel: 2, pauseMs: 1, retryMs: 5 };

function memoryStore(initial?: FeedState) {
  let saved = initial;
  return { load: async () => saved, save: async (s: FeedState) => void (saved = s), get: () => saved };
}

test("pages down from the top of a gap are newest first and never wider than the limit", () => {
  assert.deepEqual(pagesDown(0n, 300n, 101n, 2), [[200n, 300n], [99n, 199n]]);
  assert.deepEqual(pagesDown(250n, 300n, 101n, 3), [[250n, 300n]]);
  assert.deepEqual(pagesDown(5n, 4n, 101n, 2), []);
});

test("a gap's pages are used only while they run unbroken from the top", async () => {
  const { source } = fakeSource([ev(290n), ev(150n), ev(20n)], 300n, new Set(["99"]));
  const first = await fillTop(source, [0n, 300n], 101n, 3);
  assert.deepEqual(first.rest, [0n, 199n], "the failed page and everything under it stay to read");
  assert.deepEqual(first.added.map((e) => e.block), [290n]);
  const { source: down } = fakeSource([], 300n, new Set(["200"]));
  await assert.rejects(fillTop(down, [0n, 300n], 101n, 2), /timeout/, "nothing read at all is a failure, tried again later");
});

test("first open: nothing waits for old history, newest entries come first, and none of it is new", async () => {
  // A pot made at block 0, now 5,000 blocks old, with events near both ends.
  const events = [ev(10n, 0, "PotCreated"), ev(20n), ev(4_900n), ev(4_990n)];
  const { source, asked } = fakeSource(events, 5_000n);
  const store = memoryStore();
  const seen: { all: bigint[]; fresh: number; progress: FeedProgress }[] = [];
  const feed = new PotFeed(source, store, 0n, fast);
  await new Promise<void>((resolve) => {
    feed.start((all, fresh, progress) => {
      seen.push({ all: all.map((e) => e.block), fresh: fresh.length, progress });
      if (progress.complete && all.length === 4) resolve();
    });
  });
  feed.stop();
  assert.deepEqual(seen[0], { all: [], fresh: 0, progress: { complete: false } }, "shown at once, before any history");
  assert.deepEqual(asked[0], [4_900n, 5_000n], "the first page read is the newest");
  const firstWithEvents = seen.find((s) => s.all.length > 0)!;
  assert.deepEqual(firstWithEvents.all, [4_900n, 4_990n], "the newest entries arrive first");
  assert.ok(seen.every((s) => s.fresh === 0), "history found in the background is never new");
  assert.deepEqual(store.get()?.gaps, [], "complete, and saved so");
  assert.equal(store.get()?.cursor, 5_001n);
});

test("history fills two pages at a time, so the RPC sees at most a few requests at once", async () => {
  let inFlight = 0;
  let most = 0;
  const source = {
    finalized: async () => 2_000n,
    logs: async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return [];
    },
  };
  const feed = new PotFeed(source, memoryStore(), 0n, fast);
  await new Promise<void>((resolve) => feed.start((_, __, p) => p.complete && resolve()));
  feed.stop();
  assert.ok(most <= 2, `at most 2 at once, saw ${most}`);
});

test("something new while history is still filling is new, and lands with what was found", async () => {
  const { source } = fakeSource([ev(100n), ev(5_050n, 0, "Approved")], 5_000n);
  const feed = new PotFeed(source, memoryStore(), 0n, { ...fast, pauseMs: 20 });
  const fresh: bigint[] = [];
  await new Promise<void>((resolve) => {
    let calls = 0;
    feed.start((all, f, p) => {
      fresh.push(...f.map((e) => e.block));
      // After the first forward read, while history is still filling.
      if (++calls === 3) source.finalizedNow = 5_060n;
      if (p.complete && all.length === 2) resolve();
    });
  });
  feed.stop();
  assert.deepEqual(fresh, [5_050n]);
});

test("a phone away for a long time fills what it missed newest first, and none of it is new", async () => {
  const { source, asked } = fakeSource([ev(1_500n)], 2_000n);
  const store = memoryStore({ cursor: 1_000n, events: [] });
  const fresh: number[] = [];
  const feed = new PotFeed(source, store, 0n, fast);
  await new Promise<void>((resolve) => feed.start((all, f, p) => (fresh.push(f.length), p.complete && all.length === 1 && resolve())));
  feed.stop();
  assert.deepEqual(asked[0], [1_900n, 2_000n], "from the top of what was missed");
  assert.ok(fresh.every((n) => n === 0));
  assert.equal(store.get()?.cursor, 2_001n);
});

test("a history fill cut short resumes from its saved gap, and nothing is read twice", async () => {
  const { source, asked } = fakeSource([ev(50n), ev(450n)], 500n);
  const store = memoryStore({ cursor: 501n, events: [ev(450n)], gaps: [[0n, 300n]] });
  const feed = new PotFeed(source, store, 0n, fast);
  await new Promise<void>((resolve) => feed.start((all, _, p) => p.complete && all.length === 2 && resolve()));
  feed.stop();
  assert.ok(asked.every(([, to]) => to <= 300n || to >= 501n), "only the gap and what is new");
  assert.deepEqual(store.get()?.events.map((e) => e.block), [50n, 450n]);
});
