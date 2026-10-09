import type { Address, Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { AppError } from "./errors.ts";

/**
 * The write path's rules, from docs/APP-CONTRACT-MAP.md section 9. The one bug
 * this exists to prevent is a retry that pours money in twice.
 *
 *  1. One write in flight per account. The pending record is the lock.
 *  2. A transaction is signed once. The record (raw bytes and hash) is saved
 *     BEFORE the first broadcast, and every retry re-broadcasts those same
 *     bytes. Two copies of one signed transaction can only ever be included
 *     once.
 *  3. Success is reported only when the receipt's block is finalized.
 *  4. A new transaction replaces the old one only when the old nonce is
 *     confirmed unused at the finalized block and the old hash is not in any
 *     block, and it must reuse that same nonce, so at most one of the two can
 *     ever be included. On Monad eth_getTransactionByHash is null until a
 *     transaction is in a block, so the nonce, not mempool visibility, is what
 *     makes this safe.
 *
 *  5. Several requests signed with one fingerprint (a sequence) sit on
 *     consecutive nonces. Only the first is broadcast; each next one is
 *     broadcast only once the one before it is final and succeeded. If any
 *     step reverts, is superseded or sticks, the rest are dropped unsent.
 *
 * Nothing in this module signs anything.
 */

export type PendingWrite = {
  address: Address;
  nonce: number;
  raw: Hex;
  hash: Hex;
  label: string;
  submittedAt: number;
  replaceable: boolean;
  /** The rest of a sequence signed with the same fingerprint, each on the next nonce, not yet broadcast. */
  then?: SignedNext[];
};

export type SignedNext = { nonce: number; raw: Hex; hash: Hex; label: string };

/** One request in a sequence. `gas` is required when it can't be estimated before the steps before it have run. */
export type SequenceCall = { to: Address; data: Hex; label: string; gas?: bigint };

export interface WriteStore {
  get(address: Address): Promise<PendingWrite | undefined>;
  put(write: PendingWrite): Promise<void>;
  delete(address: Address): Promise<void>;
}

export interface WriteChain {
  /** Broadcasts raw bytes. May throw; the caller tracks by hash regardless. */
  sendRawTransaction(raw: Hex): Promise<unknown>;
  getReceipt(hash: Hex): Promise<{ blockNumber: bigint; status: "success" | "reverted" } | null>;
  getFinalizedBlockNumber(): Promise<bigint>;
  getNonce(address: Address, blockTag: "pending" | "finalized"): Promise<number>;
  /** True when the transaction is in some block. On Monad, null until then. */
  isInBlock(hash: Hex): Promise<boolean>;
}

export type Outcome =
  | { kind: "final"; blockNumber: bigint; settledMs: number }
  | { kind: "reverted"; blockNumber: bigint }
  /** The nonce was used at finalized by a different transaction. Nothing of ours moved. */
  | { kind: "superseded" }
  /** Not included and the nonce is unused at finalized. May be replaced, same nonce only. */
  | { kind: "stuck" };

export class WriteInFlightError extends AppError {
  constructor() {
    super(copy.errInFlight, ERROR_CODES.IN_FLIGHT);
  }
}

export type Timing = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
  rebroadcastEveryMs: number;
  stuckAfterMs: number;
};

export const DEFAULT_TIMING: Timing = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  pollMs: 400,
  rebroadcastEveryMs: 4_000,
  stuckAfterMs: 45_000,
};

/** Refuses to start a write while this account has one pending. */
export async function assertNoWriteInFlight(store: WriteStore, address: Address): Promise<void> {
  if (await store.get(address)) throw new WriteInFlightError();
}

/** Saves the record, then broadcasts. A failed broadcast is not an error: the record is tracked by hash. */
export async function submit(store: WriteStore, chain: WriteChain, write: PendingWrite): Promise<void> {
  await assertNoWriteInFlight(store, write.address);
  await store.put(write);
  await chain.sendRawTransaction(write.raw).catch(() => undefined);
}

/**
 * Follows a pending write until it is final, reverted, superseded or stuck.
 * While it waits it re-broadcasts the SAME raw bytes, never anything new.
 * The lock is released on final, reverted and superseded; it is kept, marked
 * replaceable, on stuck.
 */
export async function followToFinality(
  store: WriteStore,
  chain: WriteChain,
  write: PendingWrite,
  timing: Timing = DEFAULT_TIMING,
): Promise<Outcome> {
  const started = timing.now();
  let lastBroadcast = started;
  for (;;) {
    const receipt = await chain.getReceipt(write.hash).catch(() => null);
    if (receipt) {
      const finalized = await chain.getFinalizedBlockNumber().catch(() => -1n);
      if (finalized >= receipt.blockNumber) {
        await store.delete(write.address);
        return receipt.status === "success"
          ? { kind: "final", blockNumber: receipt.blockNumber, settledMs: timing.now() - write.submittedAt }
          : { kind: "reverted", blockNumber: receipt.blockNumber };
      }
    } else {
      const now = timing.now();
      if (now - lastBroadcast >= timing.rebroadcastEveryMs) {
        lastBroadcast = now;
        await chain.sendRawTransaction(write.raw).catch(() => undefined);
      }
      if (now - started >= timing.stuckAfterMs) {
        const verdict = await nonceVerdict(chain, write);
        if (verdict === "superseded") {
          await store.delete(write.address);
          return { kind: "superseded" };
        }
        if (verdict === "unused") {
          await store.put({ ...write, replaceable: true });
          return { kind: "stuck" };
        }
      }
    }
    await timing.sleep(timing.pollMs);
  }
}

/**
 * "unused": the old nonce is still free at finalized and the old hash is in no
 * block, so a replacement on the same nonce is safe. "superseded": the nonce
 * was used at finalized and not by us. "wait": anything else, including our
 * transaction sitting in a block that is not final yet.
 */
async function nonceVerdict(chain: WriteChain, write: PendingWrite): Promise<"unused" | "superseded" | "wait"> {
  try {
    const [finalizedNonce, inBlock, receipt] = await Promise.all([
      chain.getNonce(write.address, "finalized"),
      chain.isInBlock(write.hash),
      chain.getReceipt(write.hash),
    ]);
    if (inBlock || receipt) return "wait";
    if (finalizedNonce > write.nonce) return "superseded";
    if (finalizedNonce === write.nonce) return "unused";
    return "wait";
  } catch {
    return "wait";
  }
}

/**
 * Checks, again, that a stuck write may be replaced, and returns the nonce the
 * replacement MUST use. Call it right before signing the replacement.
 */
export async function nonceForReplacement(store: WriteStore, chain: WriteChain, address: Address): Promise<number> {
  const old = await store.get(address);
  if (!old || !old.replaceable) throw new AppError(copy.errNothingStuck, ERROR_CODES.NOTHING_STUCK);
  if ((await nonceVerdict(chain, old)) !== "unused") {
    throw new AppError(copy.errMayStillGoThrough, ERROR_CODES.MAY_STILL_GO_THROUGH);
  }
  return old.nonce;
}

/** Swaps a stuck write for its replacement. Refuses anything but the same nonce. */
export async function replace(store: WriteStore, chain: WriteChain, replacement: PendingWrite): Promise<void> {
  const old = await store.get(replacement.address);
  if (!old || !old.replaceable) throw new AppError(copy.errNothingStuck, ERROR_CODES.NOTHING_STUCK);
  if (replacement.nonce !== old.nonce) {
    throw new Error(`a replacement must reuse nonce ${old.nonce}, got ${replacement.nonce}`);
  }
  await store.put({ ...replacement, replaceable: false });
  await chain.sendRawTransaction(replacement.raw).catch(() => undefined);
}

/** Nonce for a brand new write. Only valid when no write is pending for the account. */
export async function nonceForNewWrite(store: WriteStore, chain: WriteChain, address: Address): Promise<number> {
  await assertNoWriteInFlight(store, address);
  return chain.getNonce(address, "pending");
}

/** How a sequence ended: the outcome of the step it stopped at, counting from 0. */
export type SequenceOutcome = { outcome: Outcome; step: number; steps: number; write: PendingWrite };

/**
 * Follows a sequence to its end. Each step is followed to finality exactly
 * as a single write is; only after it is final and succeeded is the next,
 * already signed, saved and broadcast. `onStep` hears each step as it starts.
 */
export async function followSequence(
  store: WriteStore,
  chain: WriteChain,
  write: PendingWrite,
  onStep: (step: number, steps: number) => void = () => {},
  timing: Timing = DEFAULT_TIMING,
  firstStep = 0,
): Promise<SequenceOutcome> {
  const steps = firstStep + 1 + (write.then?.length ?? 0);
  let current = write;
  let step = firstStep;
  for (;;) {
    onStep(step, steps);
    const outcome = await followToFinality(store, chain, current, timing);
    const [next, ...rest] = current.then ?? [];
    if (outcome.kind !== "final" || !next) {
      // A stuck step keeps its record, for a replacement on its nonce. The
      // steps after it were never broadcast; they are dropped, not replaced.
      if (outcome.kind === "stuck" && current.then?.length) await store.put({ ...current, replaceable: true, then: undefined });
      return { outcome, step, steps, write: current };
    }
    const following: PendingWrite = {
      address: current.address,
      nonce: next.nonce,
      raw: next.raw,
      hash: next.hash,
      label: next.label,
      submittedAt: timing.now(),
      replaceable: false,
      then: rest.length ? rest : undefined,
    };
    if (next.nonce !== current.nonce + 1) throw new Error(`a sequence must use consecutive nonces, got ${current.nonce} then ${next.nonce}`);
    await submit(store, chain, following);
    current = following;
    step += 1;
  }
}
