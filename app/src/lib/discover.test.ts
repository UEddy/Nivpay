import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import { EMPTY_SCAN, findPots, NEW_PER_POLL, PUT_IN_WINDOW, ScanStore, type PotsReader, type PotView } from "./discover.ts";

const IDARA = getAddress("0x725c9a4bb4c3de2f11ac0e7c9b1e8f0d3a2b7bc1");
const UBONG = getAddress("0x1111111111111111111111111111111111111111");
const CATERER = getAddress("0x3333333333333333333333333333333333333333");
const STRANGER = getAddress("0x5555555555555555555555555555555555555555");

type FakePot = { deciders: Address[]; payees: Address[]; shares?: Record<string, bigint>; view?: Partial<PotView> };

/** A chain of pots, counting every view call so the tests can see what each poll reads. */
function fakeChain(pots: FakePot[]) {
  const calls = { members: [] as number[], shares: [] as number[], views: [] as number[], decimals: 0 };
  const reader: PotsReader = {
    finalized: async () => 1_000n,
    potCount: async () => pots.length,
    decimals: async () => (calls.decimals++, 6),
    members: async (ids) => (calls.members.push(...ids), ids.map((id) => ({ deciders: pots[id]!.deciders, payees: pots[id]!.payees }))),
    shares: async (ids, who) => (calls.shares.push(...ids), ids.map((id) => pots[id]!.shares?.[who.toLowerCase()] ?? 0n)),
    views: async (ids) =>
      (calls.views.push(...ids),
      ids.map((id) => ({ name: `Pot ${id}`, totalAssets: 900_000_000n, endTime: 1_798_000_000n, closed: false, ...pots[id]!.view }))),
  };
  return { reader, calls, pots };
}

const mamas60th: FakePot = { deciders: [IDARA, UBONG], payees: [CATERER], view: { name: "Mama’s 60th" } };
const someoneElses: FakePot = { deciders: [STRANGER], payees: [STRANGER] };

test("a decider finds the pot from the chain, with its name and live numbers, without any link", async () => {
  const { reader } = fakeChain([someoneElses, mamas60th]);
  const scan = await findPots(reader, EMPTY_SCAN, UBONG);
  assert.deepEqual(scan.found, [
    { potId: "1", roles: ["decides"], name: "Mama’s 60th", totalAssets: "900000000", endTime: "1798000000", closed: false },
  ]);
  assert.equal(scan.decimals, 6);
});

test("a payee finds it too, whatever the casing of the account", async () => {
  const { reader } = fakeChain([mamas60th]);
  const scan = await findPots(reader, EMPTY_SCAN, CATERER.toLowerCase() as Address);
  assert.deepEqual(scan.found.map((p) => [p.potId, p.roles]), [["0", ["paid"]]]);
});

test("someone who only put money in finds it, and someone named nowhere finds nothing", async () => {
  const { reader } = fakeChain([{ ...someoneElses, shares: { [UBONG.toLowerCase()]: 5n } }]);
  assert.deepEqual((await findPots(reader, EMPTY_SCAN, UBONG)).found.map((p) => p.roles), [["putIn"]]);
  assert.deepEqual((await findPots(reader, EMPTY_SCAN, IDARA)).found, []);
});

test("a decider who also put money in has both roles", async () => {
  const { reader } = fakeChain([{ ...mamas60th, shares: { [IDARA.toLowerCase()]: 500n } }]);
  assert.deepEqual((await findPots(reader, EMPTY_SCAN, IDARA)).found[0]!.roles, ["decides", "putIn"]);
});

test("members are read once per pot; later polls read only new pots, and the live numbers again", async () => {
  const chain = fakeChain([mamas60th, someoneElses]);
  let scan = await findPots(chain.reader, EMPTY_SCAN, UBONG);
  assert.deepEqual(chain.calls.members, [0, 1]);

  chain.calls.members.length = 0;
  chain.calls.views.length = 0;
  chain.pots.push({ deciders: [STRANGER], payees: [UBONG], view: { name: "School fees" } });
  chain.pots[0]!.view = { ...chain.pots[0]!.view, totalAssets: 1_000_000_000n };
  scan = await findPots(chain.reader, scan, UBONG);

  assert.deepEqual(chain.calls.members, [2], "only the new pot's members");
  assert.deepEqual(chain.calls.views, [2, 0], "every found pot's numbers, newest first");
  assert.deepEqual(scan.found.map((p) => [p.potId, p.name, p.totalAssets]), [
    ["2", "School fees", "900000000"],
    ["0", "Mama’s 60th", "1000000000"],
  ]);
  assert.equal(chain.calls.decimals, 1, "decimals are read once and remembered");
});

test("a long backlog is read a page at a time, and nothing is missed", async () => {
  const pots: FakePot[] = Array.from({ length: NEW_PER_POLL * 2 + 5 }, () => someoneElses);
  pots[NEW_PER_POLL + 3] = mamas60th;
  const chain = fakeChain(pots);
  let scan = await findPots(chain.reader, EMPTY_SCAN, UBONG);
  assert.equal(scan.checkedUpTo, NEW_PER_POLL);
  assert.deepEqual(scan.found, []);
  scan = await findPots(chain.reader, scan, UBONG);
  assert.deepEqual(scan.found.map((p) => p.potId), [String(NEW_PER_POLL + 3)]);
  scan = await findPots(chain.reader, scan, UBONG);
  assert.equal(scan.checkedUpTo, pots.length);
  assert.deepEqual(chain.calls.members, [...pots.keys()], "every pot's members read exactly once");
});

test("money put in is checked only for the most recent pots, and a pot once found that way stays", async () => {
  const total = PUT_IN_WINDOW + 10;
  const pots: FakePot[] = Array.from({ length: total }, () => ({ ...someoneElses }));
  pots[0] = { ...someoneElses, shares: { [UBONG.toLowerCase()]: 7n } };
  const chain = fakeChain(pots);
  // An earlier poll, when pot 0 was still recent, found it.
  const earlier = { ...EMPTY_SCAN, checkedUpTo: total, found: [{ potId: "0", roles: ["putIn" as const], name: "Pot 0", totalAssets: "1", endTime: "1", closed: false }] };
  const scan = await findPots(chain.reader, earlier, UBONG);
  assert.equal(Math.min(...chain.calls.shares), total - PUT_IN_WINDOW);
  assert.deepEqual(scan.found.map((p) => p.potId), ["0"]);
});

test("no pots on the chain at all is not an error", async () => {
  const { reader, calls } = fakeChain([]);
  const scan = await findPots(reader, EMPTY_SCAN, UBONG);
  assert.deepEqual(scan, { checkedUpTo: 0, named: {}, found: [], decimals: 6 });
  assert.deepEqual([calls.members, calls.shares, calls.views], [[], [], []]);
});

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
}

test("what was found is kept per deployment and account, and bad stored data starts afresh", async () => {
  const kv = memory();
  const { reader } = fakeChain([mamas60th]);
  const store = new ScanStore(kv, "ausd", UBONG);
  store.save(await findPots(reader, EMPTY_SCAN, UBONG));
  assert.equal(new ScanStore(kv, "ausd", UBONG.toLowerCase() as Address).load().found.length, 1);
  assert.deepEqual(new ScanStore(kv, "testusd", UBONG).load(), EMPTY_SCAN);
  assert.deepEqual(new ScanStore(kv, "ausd", IDARA).load(), EMPTY_SCAN);
  kv.setItem(`nivpay.found.v1.ausd.${IDARA}`, "{not json");
  assert.deepEqual(new ScanStore(kv, "ausd", IDARA).load(), EMPTY_SCAN);
});
