import { test } from "node:test";
import assert from "node:assert/strict";
import { RETRY_AFTER_MS, sendNotify } from "./notify.ts";

const tx = { kind: "tx", deployment: "ausd", tx: `0x${"ab".repeat(32)}` };
/** A server that answers each call in turn from `answers`: a status, or "down" for no answer at all. */
function server(answers: (number | "down")[]) {
  const calls: unknown[] = [];
  const fetcher = async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    if (a === "down") throw new TypeError("Failed to fetch");
    return new Response("{}", { status: a });
  };
  return { fetcher, calls };
}

test("a payment's call is tried again on 503 and stops at the first answer that isn't", async () => {
  const waits: number[] = [];
  const s = server([503, 200]);
  assert.equal(await sendNotify(tx, s.fetcher, async (ms) => void waits.push(ms)), 2);
  assert.deepEqual(waits, [RETRY_AFTER_MS[0]]);
  assert.deepEqual(s.calls, [tx, tx], "the same call each time");
});

test("no answer at all is tried again too, at most three times in all, 5 then 15 seconds apart", async () => {
  const waits: number[] = [];
  const s = server(["down", 503, 503, 503]);
  assert.equal(await sendNotify(tx, s.fetcher, async (ms) => void waits.push(ms)), 3);
  assert.deepEqual(waits, [5_000, 15_000]);
});

test("done, ignored or refused is final: never tried again", async () => {
  for (const status of [200, 202, 400, 403, 429]) {
    const s = server([status, 200]);
    assert.equal(await sendNotify(tx, s.fetcher, async () => {}), 1, String(status));
  }
});

test("a request to a person is sent once, as before", async () => {
  const s = server([503, 200]);
  assert.equal(await sendNotify({ kind: "request" }, s.fetcher, async () => {}), 1);
});
