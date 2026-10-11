import type { Address, Hex } from "viem";
import { waitForFinalized, liveWriteChain } from "./chain.ts";
import { copy, ERROR_CODES } from "../copy.ts";
import { NotEnoughGasError, setupFailure } from "./errors.ts";
import { idbWriteStore } from "./idb.ts";
import { withSigner } from "./passkey.ts";
import { readClient } from "./rpc.ts";
import * as core from "./sendCore.ts";
import type { Call, Fees, SendDeps, Step } from "./sendCore.ts";
import type { PendingWrite, SequenceCall } from "./writes.ts";

export type { Call, Step };

async function fees(): Promise<Fees> {
  const [price, tip] = await Promise.all([readClient.getGasPrice(), readClient.estimateMaxPriorityFeePerGas()]);
  // Monad charges the gas limit at the effective price, and checks the
  // sender's balance against limit x max fee. A 5% margin over the current
  // price keeps that check close to what is actually charged.
  const maxFeePerGas = (price * 105n) / 100n;
  return { maxFeePerGas, maxPriorityFeePerGas: tip < maxFeePerGas ? tip : maxFeePerGas };
}

/**
 * Makes sure the account can pay for `needed` wei of gas. If not, asks
 * /api/fund for a grant and waits until that grant is FINALIZED before
 * returning, so the person's own transaction never races it.
 */
export async function ensureGas(address: Address, needed: bigint): Promise<void> {
  const balance = await readClient.getBalance({ address });
  if (balance >= needed && needed > 0n) return;
  let res: Response;
  try {
    res = await fetch("/api/fund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
  } catch {
    throw new NotEnoughGasError(copy.errSetupUnreachable, ERROR_CODES.SETUP_UNREACHABLE);
  }
  const body = (await res.json().catch(() => ({}))) as { hash?: Hex; error?: string; code?: string };
  if (res.ok && body.hash) {
    let status: "success" | "reverted";
    try {
      status = await waitForFinalized(body.hash);
    } catch {
      throw new NotEnoughGasError(copy.errSetupSlow, ERROR_CODES.SETUP_SLOW);
    }
    if (status !== "success") throw new NotEnoughGasError(copy.errSetupReverted, ERROR_CODES.SETUP_REVERTED);
    return;
  }
  if (res.status === 409 && balance >= needed && needed > 0n) return;
  // Grants go only to accounts holding under the grant threshold. One holding
  // more than that, but less than this request needs, can't be topped up yet.
  if (res.status === 409 && body.error === "this account already has enough") {
    throw new NotEnoughGasError(copy.errNotEnoughForFees, ERROR_CODES.NOT_ENOUGH_FOR_FEES);
  }
  throw setupFailure(res.status, body);
}

async function estimate(from: Address, to: Address, data: Hex): Promise<bigint> {
  try {
    return await readClient.estimateGas({ account: from, to, data });
  } catch {
    // A brand new account may be refused an estimate for holding nothing.
    // Get it ready, then estimate again. A second failure is real.
    await ensureGas(from, 0n);
    return readClient.estimateGas({ account: from, to, data });
  }
}

/** The live send flow: the RPC, this phone's IndexedDB and its passkeys (sendCore.ts). */
const live: SendDeps = {
  store: idbWriteStore,
  chain: liveWriteChain,
  fees,
  estimate,
  ensureGas,
  withSigner,
  estimateGas: (args) => readClient.estimateGas(args),
  getBalance: (address) => readClient.getBalance({ address }),
};

/** A brand new write. Refused while this account has one in flight. */
export function sendWrite(call: Call): Promise<PendingWrite> {
  return core.sendWrite(live, call);
}

/** Replaces a stuck write, on the same nonce, after re-checking it is safe. */
export function retryStuckWrite(call: Call): Promise<PendingWrite> {
  return core.retryStuckWrite(live, call);
}

/** Several requests behind one confirm and one fingerprint (sendCore.ts). */
export function sendSequence(from: Address, calls: SequenceCall[], onStep?: (step: Step) => void, replacing = false, signal?: AbortSignal): Promise<PendingWrite> {
  return core.sendSequence(live, from, calls, onStep, replacing, signal);
}
