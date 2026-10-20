import type { Address, Hex } from "viem";
import { waitForFinalized, liveWriteChain } from "./chain.ts";
import { copy, ERROR_CODES } from "../copy.ts";
import { NotEnoughGasError, setupFailure } from "./errors.ts";
import { askGrantEarly, forgetGrant, grantFor, rememberGrant, waitForBalance, waitForGrantAge } from "./grantWait.ts";
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
 * Waits, while "Getting your account ready" shows, until this account's grant
 * is GRANT_MIN_AGE_S old by block time (lib/grantWait.ts): a node can refuse
 * a write for lack of balance for a few seconds after the grant is final.
 */
async function grantSettled(hash: Hex): Promise<void> {
  await waitForGrantAge({
    grantTime: async () => {
      const r = await readClient.getTransactionReceipt({ hash }).catch(() => null);
      return r ? (await readClient.getBlock({ blockNumber: r.blockNumber })).timestamp : null;
    },
    latestTime: async () => (await readClient.getBlock({ blockTag: "latest" })).timestamp,
  });
}

/**
 * Asks for the gas grant early, when a screen knows a write is coming (Auto
 * cash out, as it opens and at Turn on), so the grant is old enough by the
 * time the write needs it. Only under the grant threshold; never throws.
 */
export const askForGasEarly = (address: Address) => askGrantEarly(address, { balance: () => readClient.getBalance({ address }), fetch: (url, init) => fetch(url, init) });

/**
 * Makes sure the account can pay for `needed` wei of gas. If not, asks
 * /api/fund for a grant and waits until that grant is FINALIZED, the balance
 * covers the write, and the grant is GRANT_MIN_AGE_S old, before returning,
 * so the person's own transaction never races it. A grant asked for early
 * (askForGasEarly) is waited for by its age too. Every write goes through
 * here: Send, a payment in another currency, chipping in, a pot's payments
 * and changes, making and closing a pot, a username, test dollars, Cash out,
 * Auto cash out and the hands free voice payment.
 */
export async function ensureGas(address: Address, needed: bigint): Promise<void> {
  let balance = await readClient.getBalance({ address });
  const early = grantFor(address);
  // A grant asked for early and still landing: wait for that one, never ask again (/api/fund would refuse a second so soon).
  if (early && !(balance >= needed && needed > 0n)) {
    await waitForFinalized(early).catch(() => undefined);
    if (needed > 0n) await waitForBalance({ balance: () => readClient.getBalance({ address }), needed });
    balance = await readClient.getBalance({ address });
  }
  if (balance >= needed && needed > 0n) {
    if (early) {
      await grantSettled(early);
      forgetGrant(address);
    }
    return;
  }
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
    rememberGrant(address, body.hash);
    if (needed > 0n) await waitForBalance({ balance: () => readClient.getBalance({ address }), needed });
    await grantSettled(body.hash);
    forgetGrant(address);
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
