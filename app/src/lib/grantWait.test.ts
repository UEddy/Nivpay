import { test } from "node:test";
import assert from "node:assert/strict";
import { THRESHOLD } from "../../api/fund/index.ts";
import { ERROR_CODES } from "../copy.ts";
import { NotEnoughGasError } from "./errors.ts";
import { askGrantEarly, ensureGasWith, forgetGrants, grantFor, GRANT_MIN_AGE_S, GRANT_THRESHOLD, GRANT_WAIT_MAX_MS, waitForBalance, waitForGrantAge } from "./grantWait.ts";

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

/** A promise resolved from outside: an answer still on its way. */
function later<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const answer = (status: number, body: object) => new Response(JSON.stringify(body), { status });
const ON_ITS_WAY = { error: "a grant for this address is already on its way" };

test("asks once: a double tap on Turn on while the early ask is on its way gets that same ask, and a tap after it is answered asks nothing", async () => {
  forgetGrants();
  const calls: string[] = [];
  const res = later<Response>();
  const fetch = async (url: string) => (calls.push(url), res.promise);
  const first = askGrantEarly(ME, { balance: async () => 0n, fetch });
  const second = askGrantEarly(ME, { balance: async () => 0n, fetch });
  assert.equal(second, first, "the second tap waits for the first ask");
  res.resolve(answer(200, { hash: HASH }));
  assert.equal(await first, HASH);
  assert.equal(await askGrantEarly(ME, { balance: async () => 0n, fetch }), HASH, "a third tap: the grant is remembered");
  assert.deepEqual(calls, ["/api/fund"]);
});

test("asks once: a write that starts while the early ask is on its way waits for it, never asks /api/fund itself, and waits for that grant's age", async () => {
  forgetGrants();
  const c = clock();
  const early = later<Response>();
  let earlyAsks = 0;
  let funds = 0;
  let answered = false;
  void askGrantEarly(ME, { balance: async () => 0n, fetch: async () => (earlyAsks++, early.promise) });
  const settled: string[] = [];
  await ensureGasWith(ME, 1000n, {
    // The grant lands only after the early ask is answered.
    balance: async () => (answered ? 5000n : 0n),
    fund: async () => (funds++, answer(409, ON_ITS_WAY)),
    finalized: async () => "success",
    settled: async (h) => void settled.push(h),
    nowMs: c.nowMs,
    // The early ask is answered three seconds into the write's wait.
    wait: async (d) => {
      await c.wait(d);
      if (c.waited() >= 3000 && !answered) (answered = true), early.resolve(answer(200, { hash: HASH }));
    },
  });
  assert.equal(earlyAsks, 1);
  assert.equal(funds, 0, "the write never asks beside the early ask");
  assert.deepEqual(settled, [HASH], "the write waits for the early grant's age");
  assert.equal(grantFor(ME), undefined, "used, then forgotten");
});

test("/api/fund's 409 \"already on its way\" or \"just sent\" is a grant coming: the write waits for the balance and goes through", async () => {
  for (const error of ["a grant for this address is already on its way", "a grant for this address was just sent"]) {
    forgetGrants();
    const c = clock();
    let reads = 0;
    let funds = 0;
    await ensureGasWith(ME, 1000n, {
      balance: async () => (++reads >= 4 ? 1000n : 0n),
      fund: async () => (funds++, answer(409, { error })),
      finalized: async () => "success",
      settled: async () => undefined,
      ...c,
    });
    assert.equal(funds, 1, error);
    assert.ok(c.waited() < GRANT_WAIT_MAX_MS, error);
  }
});

test("a 409 \"already on its way\" where the balance never arrives: Code 19 after 30 s at most, as before", async () => {
  forgetGrants();
  const c = clock();
  await assert.rejects(
    ensureGasWith(ME, 1000n, { balance: async () => 0n, fund: async () => answer(409, ON_ITS_WAY), finalized: async () => "success", settled: async () => undefined, ...c }),
    (e: unknown) => e instanceof NotEnoughGasError && e.code === ERROR_CODES.SETUP_REFUSED && e.code === 19,
  );
  assert.equal(c.waited(), GRANT_WAIT_MAX_MS);
});

test("the 30 s cap is firm across both waits: an early ask that never answers, then a 409, is Code 19 at 30 s in all", async () => {
  forgetGrants();
  const c = clock();
  void askGrantEarly(ME, { balance: async () => 0n, fetch: () => new Promise<Response>(() => {}) });
  await assert.rejects(
    ensureGasWith(ME, 1000n, { balance: async () => 0n, fund: async () => answer(409, ON_ITS_WAY), finalized: async () => "success", settled: async () => undefined, ...c }),
    (e: unknown) => e instanceof NotEnoughGasError && e.code === ERROR_CODES.SETUP_REFUSED,
  );
  assert.ok(c.waited() <= GRANT_WAIT_MAX_MS, `waited ${c.waited()} ms`);
  forgetGrants();
});
