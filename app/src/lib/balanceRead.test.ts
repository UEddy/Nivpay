import { test } from "node:test";
import assert from "node:assert/strict";
import { copy } from "../copy.ts";
import { LastBalanceStore, SingleRead, SLOW_READ_MS } from "./balanceRead.ts";
import { balanceNote } from "./connection.ts";
import { READ_RETRY, readTimeoutFor, worstCaseReadMs } from "./rpc.ts";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
}

const A = "0x1a9a136f1cf59899c6b8cfe84ac4df388620467d" as const;

test("a balance read still waiting is never joined by another, so slow reads can't pile up", async () => {
  const single = new SingleRead();
  let started = 0;
  let answer!: (v: number) => void;
  const read = () => (started++, new Promise<number>((r) => (answer = r)));
  const first = single.run(read);
  for (let tick = 0; tick < 10; tick++) assert.equal(single.run(read), null, "every 5 s refresh while it waits starts nothing");
  assert.equal(started, 1);
  answer(5);
  assert.equal(await first, 5);
  assert.ok(single.run(read), "once it answers, the next refresh reads again");
  assert.equal(started, 2);
});

test("a failed read frees the way for the next one, which keeps trying in the background", async () => {
  const single = new SingleRead();
  await assert.rejects(single.run(() => Promise.reject(new Error("timeout")))!);
  assert.ok(single.run(() => Promise.resolve(1)));
});

test("the last balance known is kept by account and read back exactly, and a damaged one reads as none", () => {
  const kv = memory();
  const store = new LastBalanceStore(kv);
  const last = { dollars: { decimals: 6, balance: 20_000_000_000n }, testDollars: { decimals: 18, balance: 10n ** 30n }, readAt: 1_760_000_000_000 };
  store.put(A, last);
  assert.deepEqual(store.get(A), last);
  assert.equal(store.get("0x0710Ade1Cf20E4A85a775c3A01dfdAead0579B20"), undefined);
  kv.setItem("nivpay.lastBalance.v1", JSON.stringify({ "0x1A9A136f1cf59899C6b8cfE84ac4df388620467d": { dollars: { decimals: 6, balance: "-1" }, readAt: 1 } }));
  assert.equal(store.get(A), undefined);
  kv.setItem("nivpay.lastBalance.v1", "{not json");
  assert.equal(store.get(A), undefined);
});

test("after about 12 seconds a slow read says Taking longer than usual, with when the balance was last checked", () => {
  assert.equal(SLOW_READ_MS, 12_000);
  const at = Date.UTC(2026, 9, 11, 19, 29);
  assert.equal(balanceNote(false, at, "Africa/Lagos", true), "Taking longer than usual. Last checked at 20:29.");
  assert.equal(balanceNote(true, at, "Africa/Lagos", true), copy.balanceNotLive("20:29"), "offline says offline");
  assert.equal(balanceNote(false, at, "Africa/Lagos", false), null, "a live balance has no note");
  assert.equal(copy.readingBalanceSlow, "Taking longer than usual…");
});

test("worst case for one read: 54.5 s before, 29.5 s now, with the same backoff", () => {
  // Before: 5 tries of 10 s, and up to 0.3 + 0.6 + 1.2 + 2.4 s between them.
  assert.deepEqual(READ_RETRY, { attempts: 5, baseMs: 300, capMs: 4_000 });
  assert.equal(5 * 10_000 + 300 + 600 + 1_200 + 2_400, 54_500);
  assert.equal(readTimeoutFor("eth_call"), 5_000);
  assert.equal(worstCaseReadMs("eth_call"), 29_500);
  assert.equal(worstCaseReadMs("eth_getBalance"), 29_500);
  // Log scans span thousands of blocks and keep 10 s a try.
  assert.equal(worstCaseReadMs("eth_getLogs"), 54_500);
});
