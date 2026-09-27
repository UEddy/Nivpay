import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpRequestError, LimitExceededRpcError, RpcRequestError, TimeoutError } from "viem";
import { backoffDelay, withRetry } from "./retry.ts";
import { isRetryableReadError } from "./rpc.ts";

test("backoff is full jitter under an exponential ceiling with a cap", () => {
  assert.equal(backoffDelay(0, 300, 4000, () => 0.999), 299);
  assert.equal(backoffDelay(3, 300, 4000, () => 0.999), 2397);
  assert.equal(backoffDelay(10, 300, 4000, () => 0.999), 3996);
  assert.equal(backoffDelay(5, 300, 4000, () => 0), 0);
});

test("a retryable failure is retried until it succeeds", async () => {
  let calls = 0;
  const slept: number[] = [];
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("flaky");
      return "ok";
    },
    {
      attempts: 5,
      baseMs: 100,
      capMs: 1000,
      isRetryable: () => true,
      random: () => 0.5,
      sleep: async (ms) => {
        slept.push(ms);
      },
    },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(slept, [50, 100]);
});

test("a non-retryable failure is thrown at once", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error("revert");
      },
      { attempts: 5, baseMs: 1, capMs: 1, isRetryable: () => false, sleep: async () => {} },
    ),
    /revert/,
  );
  assert.equal(calls, 1);
});

test("attempts are capped", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error("down");
      },
      { attempts: 4, baseMs: 1, capMs: 1, isRetryable: () => true, sleep: async () => {} },
    ),
  );
  assert.equal(calls, 4);
});

test("which read errors are retried", () => {
  const url = "https://testnet-rpc.monad.xyz";
  assert.equal(isRetryableReadError(new TimeoutError({ body: {}, url })), true);
  assert.equal(isRetryableReadError(new HttpRequestError({ url })), true, "no response at all");
  assert.equal(isRetryableReadError(new HttpRequestError({ url, status: 429 })), true);
  assert.equal(isRetryableReadError(new HttpRequestError({ url, status: 503 })), true);
  assert.equal(isRetryableReadError(new HttpRequestError({ url, status: 413 })), false, "the eth_getLogs range limit");
  assert.equal(isRetryableReadError(new HttpRequestError({ url, status: 400 })), false);
  assert.equal(isRetryableReadError(new LimitExceededRpcError(new Error("limit"))), true);
  const revert = new RpcRequestError({ body: {}, url, error: { code: 3, message: "execution reverted" } });
  assert.equal(isRetryableReadError(revert), false);
  assert.equal(isRetryableReadError(new Error("anything else")), false);
});
