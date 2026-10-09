import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpRequestError, InternalRpcError, InvalidInputRpcError, LimitExceededRpcError, RpcRequestError, TimeoutError, TransactionRejectedRpcError } from "viem";
import { backoffDelay, withRetry } from "./retry.ts";
import { isBroadcastRefusal, isRetryableReadError } from "./rpc.ts";

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

test("which broadcast errors are refusals", () => {
  const url = "https://testnet-rpc.monad.xyz";
  const answer = (code: number, message: string) => new RpcRequestError({ body: {}, url, error: { code, message } });
  assert.equal(isBroadcastRefusal(new InvalidInputRpcError(answer(-32000, "insufficient balance for fee"))), true);
  assert.equal(isBroadcastRefusal(new TransactionRejectedRpcError(answer(-32003, "rejected"))), true);
  assert.equal(isBroadcastRefusal(answer(-32000, "invalid sender")), true);
  assert.equal(isBroadcastRefusal(new InvalidInputRpcError(answer(-32000, "already known"))), false, "already known says nothing");
  assert.equal(isBroadcastRefusal(new InvalidInputRpcError(answer(-32000, "nonce too low"))), false, "its nonce may be our own");
  assert.equal(isBroadcastRefusal(new LimitExceededRpcError(answer(-32005, "rate limited"))), false, "later");
  assert.equal(isBroadcastRefusal(new InternalRpcError(answer(-32603, "internal"))), false, "later");
  assert.equal(isBroadcastRefusal(new TimeoutError({ body: {}, url })), false, "no answer");
  assert.equal(isBroadcastRefusal(new HttpRequestError({ url, status: 502 })), false, "no answer");
  assert.equal(isBroadcastRefusal(new Error("anything else")), false);
});
