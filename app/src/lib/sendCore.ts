import { keccak256, type Address, type Hex, type LocalAccount } from "viem";
import { CHAIN_ID } from "./config.ts";
import { copy, ERROR_CODES } from "../copy.ts";
import { CancelledError, throwIfCancelled } from "./cancel.ts";
import { NotEnoughGasError, SendFailure, type SendStage } from "./errors.ts";
import { nonceForNewWrite, nonceForReplacement, replace, submit, type PendingWrite, type SequenceCall, type SignedNext, type WriteChain, type WriteStore } from "./writes.ts";

/**
 * The send flow, with everything it reads from or writes to passed in, so
 * tests can hold reads back and see what happens. send.ts gives it the live
 * RPC, IndexedDB and passkey.
 */

export type Step = "preparing" | "getting-ready" | "confirm" | "sending";

export type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

export type SendDeps = {
  store: WriteStore;
  chain: WriteChain;
  fees: () => Promise<Fees>;
  estimate: (from: Address, to: Address, data: Hex) => Promise<bigint>;
  ensureGas: (address: Address, needed: bigint) => Promise<void>;
  withSigner: <T>(expected: Address, sign: (account: LocalAccount) => Promise<T>) => Promise<T>;
  estimateGas: (args: { account: Address; to: Address; data: Hex }) => Promise<bigint>;
  getBalance: (address: Address) => Promise<bigint>;
};

export type Call = {
  from: Address;
  to: Address;
  data: Hex;
  label: string;
  onStep?: (step: Step) => void;
  /** Aborted by X before the passkey (lib/cancel.ts): the flow stops and nothing is sent. */
  signal?: AbortSignal;
  /**
   * Signs something more in the same passkey step, over the transaction's
   * hash, before the session ends and before anything is broadcast. Making a
   * pot uses it to sign the pot's labels, so it takes one fingerprint.
   */
  cosign?: (account: LocalAccount, hash: Hex) => Promise<void>;
  /**
   * Builds the call data inside the passkey session, for calls that carry a
   * signature of their own: a pour-in signs its permit here, so the permit
   * and the transaction take one fingerprint. `data` is then unused. The
   * gas is estimated from the real data inside the session, so the account
   * is made ready first for `gasHint`, before the session opens.
   */
  presign?: { gasHint: bigint; build: (account: LocalAccount) => Promise<Hex> };
};

async function signAndSubmit(deps: SendDeps, call: Call, replacing: boolean): Promise<PendingWrite> {
  let stage: SendStage = "preparing";
  let broadcast = false;
  // A step starts only if X hasn't been tapped. "confirm" asks for the passkey.
  const step = (s: Step) => {
    throwIfCancelled(call.signal);
    call.onStep?.(s);
  };
  try {
    step("preparing");
    const nonce = replacing ? await nonceForReplacement(deps.store, deps.chain, call.from) : await nonceForNewWrite(deps.store, deps.chain, call.from);
    throwIfCancelled(call.signal);
    const f = await deps.fees();
    throwIfCancelled(call.signal);
    let gas = call.presign ? call.presign.gasHint : await deps.estimate(call.from, call.to, call.data);

    stage = "gas grant";
    step("getting-ready");
    await deps.ensureGas(call.from, gas * f.maxFeePerGas);

    stage = "passkey";
    step("confirm");
    const raw = await deps.withSigner(call.from, async (account) => {
      stage = "signing";
      let data = call.data;
      if (call.presign) {
        data = await call.presign.build(account);
        // One estimate on the real data. Monad charges the limit, so no padding.
        stage = "preparing";
        gas = await deps.estimateGas({ account: call.from, to: call.to, data });
        const balance = await deps.getBalance(call.from);
        if (balance < gas * f.maxFeePerGas) throw new NotEnoughGasError(copy.errSetupFailed, ERROR_CODES.SETUP_REFUSED);
        stage = "signing";
      }
      const signed = await account.signTransaction({ chainId: CHAIN_ID, type: "eip1559", to: call.to, data, value: 0n, nonce, gas, ...f });
      await call.cosign?.(account, keccak256(signed));
      return signed;
    });

    stage = "broadcast";
    call.onStep?.("sending");
    const write: PendingWrite = {
      address: call.from,
      nonce,
      raw,
      hash: keccak256(raw),
      label: call.label,
      submittedAt: Date.now(),
      replaceable: false,
    };
    // submit and replace save the record, then broadcast, and swallow
    // broadcast errors. So if they throw, it was before any broadcast, and
    // once they return the bytes have been handed to the network.
    if (replacing) await replace(deps.store, deps.chain, write);
    else await submit(deps.store, deps.chain, write);
    broadcast = true;
    return write;
  } catch (error) {
    if (error instanceof CancelledError) throw error;
    throw new SendFailure(stage, broadcast, error);
  }
}

/** A brand new write. Refused while this account has one in flight. */
export function sendWrite(deps: SendDeps, call: Call): Promise<PendingWrite> {
  return signAndSubmit(deps, call, false);
}

/** Replaces a stuck write, on the same nonce, after re-checking it is safe. */
export function retryStuckWrite(deps: SendDeps, call: Call): Promise<PendingWrite> {
  return signAndSubmit(deps, call, true);
}

/**
 * Several requests behind one confirm and one fingerprint. The gas for all of
 * them is made ready first, then one passkey session signs each on the next
 * nonce, and only the first is broadcast. lib/writes.ts followSequence sends
 * each next one once the one before it is final. With `replacing`, the first
 * takes the nonce of a stuck request, as a retry of a single write does.
 */
export async function sendSequence(
  deps: SendDeps,
  from: Address,
  calls: SequenceCall[],
  onStep?: (step: Step) => void,
  replacing = false,
  signal?: AbortSignal,
): Promise<PendingWrite> {
  if (calls.length === 0) throw new Error("nothing to send");
  let stage: SendStage = "preparing";
  let broadcast = false;
  const step = (s: Step) => {
    throwIfCancelled(signal);
    onStep?.(s);
  };
  try {
    step("preparing");
    const nonce = replacing ? await nonceForReplacement(deps.store, deps.chain, from) : await nonceForNewWrite(deps.store, deps.chain, from);
    throwIfCancelled(signal);
    const f = await deps.fees();
    throwIfCancelled(signal);
    const gas = await Promise.all(calls.map((c) => c.gas ?? deps.estimate(from, c.to, c.data)));

    stage = "gas grant";
    step("getting-ready");
    await deps.ensureGas(from, gas.reduce((a, b) => a + b, 0n) * f.maxFeePerGas);

    stage = "passkey";
    step("confirm");
    const signed = await deps.withSigner(from, async (account) => {
      stage = "signing";
      const out: SignedNext[] = [];
      for (const [i, c] of calls.entries()) {
        const raw = await account.signTransaction({ chainId: CHAIN_ID, type: "eip1559", to: c.to, data: c.data, value: 0n, nonce: nonce + i, gas: gas[i]!, ...f });
        out.push({ nonce: nonce + i, raw, hash: keccak256(raw), label: c.label });
      }
      return out;
    });

    stage = "broadcast";
    onStep?.("sending");
    const [first, ...rest] = signed;
    const write: PendingWrite = {
      address: from,
      nonce: first!.nonce,
      raw: first!.raw,
      hash: first!.hash,
      label: first!.label,
      submittedAt: Date.now(),
      replaceable: false,
      then: rest.length ? rest : undefined,
    };
    if (replacing) await replace(deps.store, deps.chain, write);
    else await submit(deps.store, deps.chain, write);
    broadcast = true;
    return write;
  } catch (error) {
    if (error instanceof CancelledError) throw error;
    throw new SendFailure(stage, broadcast, error);
  }
}
