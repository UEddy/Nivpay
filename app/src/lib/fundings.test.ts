import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import { FundingsCursor, MAX_PAGES, readFundings, type FundedLog, type FundingsReader } from "./fundings.ts";

const ME = getAddress("0x4444444444444444444444444444444444444444");
const IDARA = getAddress("0x5555555555555555555555555555555555555555");
const OUTSIDER = getAddress("0x6666666666666666666666666666666666666666");

function reader(logs: (FundedLog & { block: bigint })[]) {
  const pages: [bigint, bigint][] = [];
  let memberReads = 0;
  const r: FundingsReader = {
    async funded(ids, from, to) {
      assert.ok(to - from < 100n, "one page is at most 100 blocks");
      pages.push([from, to]);
      return logs.filter((l) => l.block >= from && l.block <= to && ids.includes(l.potId));
    },
    async members() {
      memberReads += 1;
      return { deciders: [ME, IDARA], payees: [] as Address[] };
    },
  };
  return { r, pages, reads: () => memberReads };
}
const log = (block: bigint, funder: Address, potId = 1n, assets = 50n): FundedLog & { block: bigint } => ({ block, tx: `0x${block.toString(16)}`, logIndex: 0, potId, funder, assets });

test("the first read starts where things stand and says nothing", async () => {
  const { r, pages } = reader([log(5n, IDARA)]);
  assert.deepEqual(await readFundings(r, ME, ["1"], null, 1000n, 100n, new Map()), { readTo: 1000n, fundings: [] });
  assert.equal(pages.length, 0);
});

test("money from someone in the pot is named; your own and an outsider's are not, and members are read once", async () => {
  const { r, pages, reads } = reader([log(1001n, IDARA), log(1050n, ME), log(1150n, OUTSIDER), log(1180n, IDARA, 1n, 7n), log(1190n, IDARA, 9n)]);
  const res = await readFundings(r, ME, ["1"], 1000n, 1200n, 100n, new Map());
  assert.equal(res.readTo, 1200n);
  assert.deepEqual(res.fundings.map((f) => [f.from, f.amount]), [[IDARA, "50"], [IDARA, "7"]], "not pot 9, which isn't yours");
  assert.deepEqual(pages, [[1001n, 1100n], [1101n, 1200n]]);
  assert.equal(reads(), 1);
});

test("a phone away a long time reads at most the last pages, and nothing with no pots of its own", async () => {
  const { r, pages } = reader([]);
  await readFundings(r, ME, ["1"], 10n, 100_000n, 100n, new Map());
  assert.equal(pages.length, MAX_PAGES);
  assert.equal(pages.at(-1)![1], 100_000n);
  assert.deepEqual(await readFundings(r, ME, [], 10n, 500n, 100n, new Map()), { readTo: 500n, fundings: [] });
  assert.deepEqual(await readFundings(r, ME, ["1"], 500n, 400n, 100n, new Map()), { readTo: 500n, fundings: [] }, "never goes back");
});

test("the cursor is kept per account and survives damage", () => {
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
  const c = new FundingsCursor(store, "ausd", ME);
  assert.equal(c.get(), null);
  c.set(42n);
  assert.equal(c.get(), 42n);
  assert.equal(new FundingsCursor(store, "ausd", IDARA).get(), null);
  kv.set([...kv.keys()][0]!, "junk");
  assert.equal(c.get(), null);
});
