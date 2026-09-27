import {
  createPublicClient,
  createTransport,
  HttpRequestError,
  http,
  LimitExceededRpcError,
  TimeoutError,
  type EIP1193RequestFn,
  type Transport,
} from "viem";
import { CHAIN, RPC_URL } from "./config.ts";
import { withRetry, type RetryOptions } from "./retry.ts";

/** Methods that send transactions. They never go through the read client. */
const WRITE_METHODS = new Set(["eth_sendRawTransaction", "eth_sendTransaction"]);

/**
 * Worth another attempt: the request never got an answer, or the server said
 * "later". Not worth it: anything the chain answered deterministically, such
 * as a revert, or the eth_getLogs range limit (HTTP 413), which will fail the
 * same way every time.
 */
export function isRetryableReadError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (error instanceof LimitExceededRpcError) return true;
  if (error instanceof HttpRequestError) {
    const status = error.status;
    return status === undefined || status === 408 || status === 429 || status >= 500;
  }
  return false;
}

export const READ_RETRY: Omit<RetryOptions, "isRetryable"> = {
  attempts: 5,
  baseMs: 300,
  capMs: 4_000,
};

/** HTTP transport with a timeout per call and jittered retries, for reads only. */
export function retryingReadTransport(url: string = RPC_URL): Transport {
  const inner = http(url, { retryCount: 0, timeout: 10_000 });
  return (params) => {
    const base = inner({ ...params, retryCount: 0 });
    return createTransport(
      {
        key: "read",
        name: "Read HTTP with jittered retry",
        type: "http",
        retryCount: 0,
        request: (async (args) => {
          if (WRITE_METHODS.has(args.method)) {
            throw new Error(`${args.method} must not go through the read client`);
          }
          return withRetry(() => base.request(args), { ...READ_RETRY, isRetryable: isRetryableReadError });
        }) as EIP1193RequestFn,
      },
      base.value,
    );
  };
}

// ccipRead off: no contract here uses CCIP-Read, and it would let a revert make
// the app fetch an arbitrary URL.
export const readClient = createPublicClient({ chain: CHAIN, transport: retryingReadTransport(), ccipRead: false });
