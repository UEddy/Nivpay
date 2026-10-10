import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { AskScanStore, EMPTY_ASK_SCAN, findOpenRequests, learnPotBlocks, needingMyYes, PotBlocks, type AskReader, type RequestInfo } from "./waiting.ts";

const IDARA = "0x1111111111111111111111111111111111111111" as Address;
const UBONG = "0x2222222222222222222222222222222222222222" as Address;
const ANIEKAN = "0x3333333333333333333333333333333333333333" as Address;
const NOW = 1_800_000_000n;

const info = (over: Partial<RequestInfo> = {}): RequestInfo => ({
  potId: 0n,
  kind: 0,
  status: 0,
  payee: 0,
  amount: 600_000_000n,
  asker: ANIEKAN,
  expiresAt: NOW + 1_000n,
  yes: [ANIEKAN],
  threshold: 2,
  ...over,
});

function reader(all: RequestInfo[], now = NOW): AskReader & { reads: number[][] } {
  const reads: number[][] = [];
  return {
    reads,
    finalized: async () => ({ number: 100n, timestamp: now }),
    proposalCount: async () => all.length,
    infos: async (ids) => {
      reads.push(ids);
      return ids.map((id) => all[id]!);
    },
  };
}

class Memory {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
}

test("a decider finds a request waiting for their yes with no link, and only on pots they decide on", async () => {
  const r = reader([info(), info({ potId: 5n }), info({ kind: 2 }), info({ kind: 1, amount: 0n })]);
  const scan = await findOpenRequests(r, EMPTY_ASK_SCAN, new Set(["0"]));
  assert.deepEqual(scan.open.map((x) => [x.proposalId, x.kind]), [["3", 1], ["0", 0]], "payments and early closes; not another pot's, not lifting a pause");
  assert.equal(scan.checkedUpTo, 4);
  assert.deepEqual(needingMyYes(scan, UBONG).map((x) => x.proposalId), ["3", "0"]);
  assert.deepEqual(needingMyYes(scan, ANIEKAN), [], "the asker's own yes already counts");
});

test("open requests are read again each poll and drop off once paid, withdrawn or expired", async () => {
  const all = [info(), info(), info()];
  const first = await findOpenRequests(reader(all), EMPTY_ASK_SCAN, new Set(["0"]));
  assert.equal(first.open.length, 3);
  all[0] = info({ status: 1, yes: [ANIEKAN, UBONG] });
  all[1] = info({ status: 2 });
  const r = reader(all);
  const next = await findOpenRequests(r, first, new Set(["0"]));
  assert.deepEqual(next.open.map((x) => x.proposalId), ["2"]);
  assert.deepEqual(r.reads, [[2, 1, 0]], "only the open ones, nothing new");
  const later = await findOpenRequests(reader(all, NOW + 1_001n), next, new Set(["0"]));
  assert.deepEqual(later.open, [], "expired by the finalized block's time, strictly after expiresAt");
  assert.equal((await findOpenRequests(reader(all, NOW + 1_000n), next, new Set(["0"]))).open.length, 1);
});

test("a taken back yes puts the request back in front of that decider", async () => {
  const all = [info({ yes: [ANIEKAN, IDARA], threshold: 3 })];
  const scan = await findOpenRequests(reader(all), EMPTY_ASK_SCAN, new Set(["0"]));
  assert.deepEqual(needingMyYes(scan, IDARA), []);
  all[0] = info({ yes: [ANIEKAN], threshold: 3 });
  assert.equal(needingMyYes(await findOpenRequests(reader(all), scan, new Set(["0"])), IDARA).length, 1);
});

test("new request numbers are read a page at a time", async () => {
  const all = Array.from({ length: 450 }, () => info({ potId: 9n }));
  let scan = await findOpenRequests(reader(all), EMPTY_ASK_SCAN, new Set(["0"]));
  assert.equal(scan.checkedUpTo, 200);
  scan = await findOpenRequests(reader(all), scan, new Set(["0"]));
  scan = await findOpenRequests(reader(all), scan, new Set(["0"]));
  assert.equal(scan.checkedUpTo, 450);
});

test("what was found is kept per account and survives a bad stored value", () => {
  const kv = new Memory();
  const store = new AskScanStore(kv, "ausd", UBONG);
  assert.deepEqual(store.load(), EMPTY_ASK_SCAN);
  store.save({ checkedUpTo: 3, open: [] });
  assert.equal(store.load().checkedUpTo, 3);
  assert.deepEqual(new AskScanStore(kv, "ausd", IDARA).load(), EMPTY_ASK_SCAN);
  kv.setItem("nivpay.asks.v1.ausd.0x2222222222222222222222222222222222222222", "{");
  assert.deepEqual(store.load(), EMPTY_ASK_SCAN);
});

test("a pot's creation block is found once by bisecting the pot count, then remembered", async () => {
  const kv = new Memory();
  const blocks = new PotBlocks(kv, "ausd");
  let reads = 0;
  const made = [1_000n, 5_000n];
  const r = {
    finalized: async () => 9_000n,
    potCountAt: async (b: bigint) => {
      reads++;
      return made.filter((m) => m <= b).length;
    },
  };
  await learnPotBlocks(blocks, ["0", "1"], r, 500n);
  assert.deepEqual(blocks.all(), { "0": "1000", "1": "5000" });
  const before = reads;
  await learnPotBlocks(blocks, ["0", "1"], r, 500n);
  assert.equal(reads, before, "never read again");
  kv.setItem("nivpay.potblocks.v1.ausd", JSON.stringify({ "0": "1000", x: "1", "2": 7 }));
  assert.deepEqual(blocks.all(), { "0": "1000" }, "anything malformed is ignored");
});
