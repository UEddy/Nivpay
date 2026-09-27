/**
 * Retries for READS only. A read is idempotent, so trying it again can never
 * move money. Writes never come through here: a write is signed once and the
 * same signed bytes are re-broadcast (see docs/APP-CONTRACT-MAP.md section 9).
 */

export type RetryOptions = {
  /** Total attempts, including the first. */
  attempts: number;
  /** Backoff base in ms. The delay before retry n is random in [0, min(cap, base * 2^n)). */
  baseMs: number;
  /** Ceiling on any single delay, in ms. */
  capMs: number;
  /** Decides whether an error is worth another attempt. */
  isRetryable: (error: unknown) => boolean;
  /** Injected for tests. Defaults to Math.random and setTimeout. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter. */
export function backoffDelay(retry: number, baseMs: number, capMs: number, random: () => number): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** retry);
  return Math.floor(random() * ceiling);
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const last = attempt === options.attempts - 1;
      if (last || !options.isRetryable(error)) throw error;
      await sleep(backoffDelay(attempt, options.baseMs, options.capMs, random));
    }
  }
  throw lastError;
}
