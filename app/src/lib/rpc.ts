import {
  BaseError,
  createPublicClient,
  createTransport,
  HttpRequestError,
  http,
  LimitExceededRpcError,
  RpcError,
  RpcRequestError,
  TimeoutError,
  type EIP1193RequestFn,
  type Transport,
} from "viem";
import { CHAIN, RPC_URL } from "./config.ts";
import { withRetry, type RetryOptions } from "./retry.ts";

/**
 * The public testnet RPC's rate limit: a JSON-RPC answer with this code and
 * "requests limited to 15/sec" (seen 10 Oct 2026). It means "later", like
 * HTTP 429, not a refusal of the request itself.
 */
export const RATE_LIMITED_CODE = -32011;

function rateLimited(error: unknown): boolean {
  const answered = (e: unknown) => e instanceof RpcError || e instanceof RpcRequestError;
  const found = error instanceof BaseError ? error.walk(answered) : answered(error) ? error : null;
  if (!found) return false;
  const code = (found as RpcError | RpcRequestError).code;
  const text = error instanceof Error ? error.message : "";
  return code === RATE_LIMITED_CODE || /requests limited|rate limit/i.test(text);
}

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
  if (rateLimited(error)) return true;
  if (error instanceof LimitExceededRpcError) return true;
  if (error instanceof HttpRequestError) {
    const status = error.status;
    return status === undefined || status === 408 || status === 429 || status >= 500;
  }
  return false;
}

/**
 * The node answered a broadcast and turned it down, with a JSON-RPC error
 * such as too little to cover the fee or a bad signature. Not a refusal: no
 * answer at all, "later" (rate limits and internal errors), and answers that
 * say the request is already known or its nonce already used, which tell
 * nothing about whether it lands.
 */
export function isBroadcastRefusal(error: unknown): boolean {
  const answered = (e: unknown) => e instanceof RpcError || e instanceof RpcRequestError;
  const found = error instanceof BaseError ? error.walk(answered) : answered(error) ? error : null;
  if (!found) return false;
  const code = (found as RpcError | RpcRequestError).code;
  if (code === LimitExceededRpcError.code || code === -32603 || rateLimited(error)) return false;
  const text = error instanceof Error ? error.message : "";
  return !/already known|known transaction|already imported|nonce too low/i.test(text);
}

export const READ_RETRY: Omit<RetryOptions, "isRetryable"> = {
  attempts: 5,
  baseMs: 300,
  capMs: 4_000,
};

/**
 * How long one try of a read may wait for an answer. A healthy read answers
 * in 0.2 to 0.8 s, with spikes to 4.5 s (measured 11 Oct 2026). Log scans
 * cover thousands of blocks and keep the longer limit.
 */
export const READ_TIMEOUT_MS = 5_000;
export const LOGS_TIMEOUT_MS = 10_000;

export function readTimeoutFor(method: string): number {
  return method === "eth_getLogs" ? LOGS_TIMEOUT_MS : READ_TIMEOUT_MS;
}

/** The longest one read can take before it fails: every try timing out, with the longest backoff between. */
export function worstCaseReadMs(method: string): number {
  let sleeps = 0;
  for (let retry = 0; retry < READ_RETRY.attempts - 1; retry++) sleeps += Math.min(READ_RETRY.capMs, READ_RETRY.baseMs * 2 ** retry);
  return READ_RETRY.attempts * readTimeoutFor(method) + sleeps;
}

/** Injected by tests and scripts: a stand-in fetch, and a sleep that needn't wait. */
export type ReadTransportOptions = {
  fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
};

/** HTTP transport with a timeout per call and jittered retries, for reads only. */
export function retryingReadTransport(url: string = RPC_URL, options: ReadTransportOptions = {}): Transport {
  const inner = http(url, { retryCount: 0, timeout: READ_TIMEOUT_MS, fetchFn: options.fetchFn });
  const logs = http(url, { retryCount: 0, timeout: LOGS_TIMEOUT_MS, fetchFn: options.fetchFn });
  return (params) => {
    const base = inner({ ...params, retryCount: 0 });
    const logsBase = logs({ ...params, retryCount: 0 });
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
          const to = readTimeoutFor(args.method) === LOGS_TIMEOUT_MS ? logsBase : base;
          return withRetry(() => to.request(args), { ...READ_RETRY, isRetryable: isRetryableReadError, sleep: options.sleep });
        }) as EIP1193RequestFn,
      },
      base.value,
    );
  };
}

// ccipRead off: no contract here uses CCIP-Read, and it would let a revert make
// the app fetch an arbitrary URL.
export const readClient = createPublicClient({ chain: CHAIN, transport: retryingReadTransport(), ccipRead: false });
