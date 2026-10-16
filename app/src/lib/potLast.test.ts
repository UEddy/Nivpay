import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, stringToHex, type Hex } from "viem";
import type { PotEvent } from "./feed.ts";
import { lastOf, PotLastStore, timeAgo } from "./potLast.ts";

const UBONG = getAddress("0x1111111111111111111111111111111111111111");
const ev = (name: string, block: number, args: Record<string, unknown>, logIndex = 0): PotEvent => ({ name, block: BigInt(block), logIndex, tx: `0x${"ab".repeat(32)}` as Hex, args });
const made = ev("PotCreated", 10, { destinationLabels: [stringToHex("Caterer", { size: 32 })] });

test("the last thing a row shows, newest first, from the pot's own events", () => {
  assert.deepEqual(lastOf([made]), { kind: "made", block: "10" });
  assert.deepEqual(lastOf([made, ev("Funded", 12, { funder: UBONG.toLowerCase(), assets: 50_000_000n })]), { kind: "putIn", block: "12", who: UBONG, amount: "50000000" });
  assert.deepEqual(lastOf([made, ev("Proposed", 14, { kind: 0, destIndex: 0, amount: 600_000_000n })]), { kind: "asked", block: "14", payee: "Caterer", amount: "600000000" });
  assert.deepEqual(lastOf([made, ev("Proposed", 14, { kind: 1, destIndex: 0, amount: 0n })]), { kind: "askedClose", block: "14" });
  assert.deepEqual(lastOf([made, ev("PayoutExecuted", 16, { destIndex: 0, amount: 600_000_000n }), ev("Approved", 16, { approver: UBONG }, 0)]), { kind: "paid", block: "16", payee: "Caterer", amount: "600000000" }, "a later log in the same block wins");
  assert.deepEqual(lastOf([made, ev("Closed", 20, {}), ev("ApprovalRevoked", 21, {})]), { kind: "closed", block: "20" }, "a revoked yes isn't what a row leads with");
  assert.equal(lastOf([]), null);
});

test("how long ago, in the reader's language", () => {
  const now = 1_800_000_000;
  assert.equal(timeAgo(now - 2 * 3600, now, "en"), "2h ago");
  assert.equal(timeAgo(now - 86_400, now, "en"), "yesterday");
  assert.equal(timeAgo(now - 3 * 86_400, now, "en"), "3d ago");
  assert.equal(timeAgo(now - 10, now, "en"), "now");
  assert.match(timeAgo(now - 2 * 3600, now, "fr"), /^il y a 2\s?h$/);
  assert.match(timeAgo(now - 37 * 60, now, "es"), /^hace 37\s?min/);
  assert.match(timeAgo(now - 37 * 60, now, "pt"), /^há 37\s?min/);
  assert.equal(timeAgo(now - 86_400, now, "fr"), "hier");
  assert.equal(timeAgo(now - 86_400, now, "es"), "ayer");
  assert.equal(timeAgo(now - 86_400, now, "pt"), "ontem");
  assert.equal(timeAgo(now + 50, now, "en"), "now", "a block a little ahead of this phone's clock");
});

test("the store keeps the newest per pot and survives damage", () => {
  const kv = new Map<string, string>();
  const s = new PotLastStore({ getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => void kv.set(k, v) }, "ausd");
  assert.equal(s.put("3", { kind: "made", block: "10" }), true);
  assert.equal(s.put("3", { kind: "closed", block: "20" }), true);
  assert.equal(s.put("3", { kind: "made", block: "10" }), false, "never older");
  assert.equal(s.put("3", { kind: "closed", block: "20" }), false, "nothing new");
  assert.deepEqual(s.all(), { "3": { kind: "closed", block: "20" } });
  kv.set([...kv.keys()][0]!, "{");
  assert.deepEqual(s.all(), {});
});

test("the second line: who did what, how long ago, and a closed pot with your share", async () => {
  const { lastLine } = await import("./potLast.ts");
  const me = getAddress("0x2222222222222222222222222222222222222222");
  const n = { me, who: () => "Ubong", money: (u: bigint) => `$${Number(u) / 1e6}`, when: "2h ago", shareReady: false };
  assert.equal(lastLine({ kind: "putIn", block: "1", who: UBONG, amount: "50000000" }, n), "Ubong put in $50 · 2h ago");
  assert.equal(lastLine({ kind: "putIn", block: "1", who: me, amount: "50000000" }, n), "You put in $50 · 2h ago");
  assert.equal(lastLine({ kind: "asked", block: "1", payee: "Caterer", amount: "600000000" }, { ...n, when: "yesterday" }), "Asked to pay Caterer $600 · yesterday");
  assert.equal(lastLine({ kind: "paid", block: "1", payee: "Caterer", amount: "600000000" }, { ...n, when: "3d ago" }), "Caterer paid $600 · 3d ago");
  assert.equal(lastLine({ kind: "made", block: "1" }, { ...n, when: "5d ago" }), "Made · 5d ago");
  assert.equal(lastLine({ kind: "closed", block: "1" }, { ...n, shareReady: true }), "Closed · your share is ready");
  assert.equal(lastLine({ kind: "made", block: "1" }, { ...n, when: null }), "Made", "no time yet: just what happened");
});
