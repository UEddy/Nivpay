import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import type { Role } from "./discover.ts";
import { learnPotMakers, PotChoiceStore, PotMakers, sortFound, type SortFacts } from "./potSort.ts";

const ME = getAddress("0x1A9A136f1cf59899C6b8cfE84ac4df388620467d");
const FRIEND = getAddress("0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1");
const STRANGER = getAddress("0x7EAf7f3e330ac388A0e951e80957B7274597297c");

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) } as Storage;
}

const none: SortFacts = { madeHere: new Set(), opened: new Set(), answered: new Set(), kept: new Set(), hidden: new Set(), trusted: [ME], makers: {} };
const pot = (potId: string, roles: Role[] = ["decides"]) => ({ potId, roles });
const ids = (pots: { potId: string }[]) => pots.map((p) => p.potId);

test("a pot found only from the chain, made by a stranger, is new to you", () => {
  const s = sortFound([pot("7")], { ...none, makers: { "7": STRANGER } });
  assert.deepEqual([ids(s.yours), ids(s.fresh), ids(s.hidden)], [[], ["7"], []]);
});

test("a pot whose maker isn't known yet is new to you", () => {
  assert.deepEqual(ids(sortFound([pot("7", ["paid"])], none).fresh), ["7"]);
});

test("each reason on its own makes a pot yours", () => {
  const cases: [string, Partial<SortFacts>, Role[]][] = [
    ["this phone made it", { madeHere: new Set(["7"]) }, ["decides"]],
    ["its link was opened here", { opened: new Set(["7"]) }, ["decides"]],
    ["you answered its invite", { answered: new Set(["7"]) }, ["paid"]],
    ["you chose Keep", { kept: new Set(["7"]) }, ["decides"]],
    ["you put money in", {}, ["decides", "putIn"]],
    ["its maker is a contact", { trusted: [ME, FRIEND], makers: { "7": FRIEND } }, ["decides"]],
    ["its maker is this phone's account, in any letter case", { makers: { "7": ME.toLowerCase() as Address } }, ["paid"]],
  ];
  for (const [why, facts, roles] of cases) assert.deepEqual(ids(sortFound([pot("7", roles)], { ...none, ...facts }).yours), ["7"], why);
});

test("Hide takes a new pot off Home, but never one that is yours", () => {
  const facts = { ...none, hidden: new Set(["7", "8"]), opened: new Set(["8"]) };
  const s = sortFound([pot("7"), pot("8"), pot("9")], facts);
  assert.deepEqual([ids(s.yours), ids(s.fresh), ids(s.hidden)], [["8"], ["9"], ["7"]]);
});

test("Keep and Hide are stored per account and deployment, exclusive, and Hide can be undone", () => {
  const kv = memory();
  const mine = new PotChoiceStore(kv, "ausd", ME);
  mine.hide("7", " Mama​'s 60th ", 10);
  mine.hide("9", "", 20);
  assert.deepEqual(mine.hidden(), [
    { potId: "9", name: "", hiddenAt: 20 },
    { potId: "7", name: "Mama's 60th", hiddenAt: 10 },
  ]);
  mine.keep("7");
  assert.deepEqual([...mine.kept()], ["7"]);
  assert.deepEqual(ids(mine.hidden()), ["9"], "Keep undoes Hide");
  mine.hide("7", "x", 30);
  assert.deepEqual([...mine.kept()], [], "Hide undoes Keep");
  mine.unhide("7");
  mine.unhide("9");
  assert.deepEqual(mine.hidden(), []);
  new PotChoiceStore(kv, "ausd", ME).keep("3");
  assert.deepEqual([...new PotChoiceStore(kv, "testusd", ME).kept()], []);
  assert.deepEqual([...new PotChoiceStore(kv, "ausd", FRIEND).kept()], []);
  kv.setItem(`nivpay.potchoices.v1.ausd.${ME}`, JSON.stringify({ kept: ["1", "x", 2], hidden: [{ potId: "nope", hiddenAt: 1 }] }));
  assert.deepEqual([...mine.kept()], ["1"]);
  assert.deepEqual(mine.hidden(), []);
});

test("makers are learned once, only where the creation block is known, a few per call", async () => {
  const kv = memory();
  const store = new PotMakers(kv, "ausd");
  const asked: string[] = [];
  const reader = {
    makerAt: async (potId: bigint, block: bigint) => {
      asked.push(`${potId}@${block}`);
      return potId === 3n ? null : STRANGER;
    },
  };
  await learnPotMakers(store, { "1": "100", "3": "300", "4": "400" }, ["1", "2", "3", "4"], reader, 2);
  assert.deepEqual(asked, ["1@100", "3@300"]);
  assert.deepEqual(store.all(), { "1": STRANGER });
  await learnPotMakers(store, { "1": "100", "3": "300", "4": "400" }, ["1", "2", "4"], reader, 2);
  assert.deepEqual(asked.slice(2), ["4@400"], "1 is known, 2 has no block yet");
  assert.deepEqual(new PotMakers(kv, "testusd").all(), {});
});
