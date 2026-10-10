import { test } from "node:test";
import assert from "node:assert/strict";
import { BlockTimes, MAX_KEPT, timesFor } from "./blockTimes.ts";

class Memory {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
}

test("each block's time is read once, kept, and a failed read is tried again next time", async () => {
  const store = new BlockTimes(new Memory(), "ausd");
  const reads: bigint[] = [];
  let fail = true;
  const read = async (b: bigint) => {
    reads.push(b);
    if (b === 3n && fail) throw new Error("no answer");
    return 1_000n + b;
  };
  const first = await timesFor([1n, 2n, 2n, 3n], store, read);
  assert.deepEqual([...first.entries()], [[1n, 1_001n], [2n, 1_002n]]);
  fail = false;
  const second = await timesFor([1n, 2n, 3n], store, read);
  assert.equal(second.get(3n), 1_003n);
  assert.deepEqual(reads, [1n, 2n, 3n, 3n], "1 and 2 never read twice");
});

test("only the newest blocks are kept, and anything malformed is ignored", () => {
  const kv = new Memory();
  const store = new BlockTimes(kv, "ausd");
  store.putMany(new Map(Array.from({ length: MAX_KEPT + 10 }, (_, i) => [BigInt(i), 5n] as [bigint, bigint])));
  const all = store.all();
  assert.equal(all.size, MAX_KEPT);
  assert.equal(all.has(0n), false);
  kv.setItem("nivpay.blocktimes.v1.ausd", JSON.stringify([["7", "9"], ["x", "1"], [3]]));
  assert.deepEqual([...store.all().entries()], [[7n, 9n]]);
  kv.setItem("nivpay.blocktimes.v1.ausd", "{");
  assert.equal(store.all().size, 0);
});
