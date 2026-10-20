import { test } from "node:test";
import assert from "node:assert/strict";
import { THRESHOLD } from "../../api/fund/index.ts";
import { askGrantEarly, forgetGrants, grantFor, GRANT_MIN_AGE_S, GRANT_THRESHOLD, GRANT_WAIT_MAX_MS, waitForBalance, waitForGrantAge } from "./grantWait.ts";

const ME = "0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1";
const HASH = `0x${"cd".repeat(32)}` as const;
/** A clock that moves only when the code waits, so no test sleeps. */
function clock() {
  let ms = 0;
  return { nowMs: () => ms, wait: async (d: number) => void (ms += d), waited: () => ms };
}

test("a young grant waits until it is 15 s old by block time; the write goes on as soon as it is", async () => {
  const c = clock();
  // The grant is in block time 1000; blocks advance a second for each second waited.
  const r = await waitForGrantAge({ grantTime: async () => 1000n, latestTime: async () => 1002n + BigInt(Math.floor(c.waited() / 1000)), ...c });
  assert.equal(r, "old enough");
  assert.ok(c.waited() >= 13_000 && c.waited() < 15_000, `waited ${c.waited()} ms`);
});

test("an old grant goes straight through, with no wait at all", async () => {
  const c = clock();
  assert.equal(await waitForGrantAge({ grantTime: async () => 1000n, latestTime: async () => 1000n + GRANT_MIN_AGE_S, ...c }), "old enough");
  assert.equal(c.waited(), 0);
});

test("a grant not found yet counts as young; the wait gives up after its limit and lets the write try, as before", async () => {
  const c = clock();
  assert.equal(await waitForGrantAge({ grantTime: async () => null, latestTime: async () => 5000n, ...c }), "gave up");
  assert.ok(c.waited() >= GRANT_WAIT_MAX_MS);
  const d = clock();
  assert.equal(await waitForGrantAge({ grantTime: async () => { throw new Error("read failed"); }, latestTime: async () => 5000n, ...d }), "gave up");
});

test("the balance wait ends as soon as it covers the write", async () => {
  const c = clock();
  let reads = 0;
  assert.equal(await waitForBalance({ balance: async () => (++reads >= 3 ? 10n : 0n), needed: 5n, ...c }), true);
  assert.equal(reads, 3);
});

test("the grant is asked for early only under the grant threshold, the same as /api/fund's, and remembered for the write", async () => {
  assert.equal(GRANT_THRESHOLD, THRESHOLD);
  forgetGrants();
  const calls: string[] = [];
  const fetch = async (url: string) => (calls.push(url), new Response(JSON.stringify({ hash: HASH }), { status: 200 }));
  assert.equal(await askGrantEarly(ME, { balance: async () => GRANT_THRESHOLD, fetch }), null);
  assert.deepEqual(calls, [], "holding enough: not asked");
  assert.equal(await askGrantEarly(ME, { balance: async () => 0n, fetch }), HASH);
  assert.deepEqual(calls, ["/api/fund"]);
  assert.equal(grantFor(ME), HASH, "the write will wait for its age");
  // A refusal or no answer never throws: the write asks again itself, as before.
  forgetGrants();
  assert.equal(await askGrantEarly(ME, { balance: async () => 0n, fetch: async () => new Response("{}", { status: 503 }) }), null);
  assert.equal(await askGrantEarly(ME, { balance: async () => 0n, fetch: async () => { throw new TypeError("offline"); } }), null);
  assert.equal(grantFor(ME), undefined);
});
