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
