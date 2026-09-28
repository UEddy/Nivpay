import { keccak256, type Address, type Hex } from "viem";
import { CHAIN_ID } from "./config.ts";
import { waitForFinalized, liveWriteChain } from "./chain.ts";
import { idbWriteStore } from "./idb.ts";
import { withSigner } from "./passkey.ts";
import { readClient } from "./rpc.ts";
import { nonceForNewWrite, nonceForReplacement, replace, submit, type PendingWrite } from "./writes.ts";

export type Step = "preparing" | "getting-ready" | "confirm" | "sending";

export class NotEnoughGasError extends Error {}

type Call = { from: Address; to: Address; data: Hex; label: string; onStep?: (step: Step) => void };

async function fees() {
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
  const res = await fetch("/api/fund", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  }).catch(() => null);
  if (!res) throw new NotEnoughGasError("Couldn't reach NivPay to get your account ready. Check your connection and try again.");
  const body = (await res.json().catch(() => ({}))) as { hash?: Hex; error?: string };
  if (res.ok && body.hash) {
    const status = await waitForFinalized(body.hash);
    if (status !== "success") throw new NotEnoughGasError("Getting your account ready didn't go through. Try again.");
    return;
  }
  if (res.status === 409 && balance >= needed && needed > 0n) return;
  throw new NotEnoughGasError(
    body.error === "funding is paused" || res.status === 503
      ? "NivPay can't cover network costs right now. Try again later."
      : "Your account couldn't be made ready for this. Try again in a minute.",
  );
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

async function signAndSubmit(call: Call, nonce: number, replacing: boolean): Promise<PendingWrite> {
  call.onStep?.("preparing");
  const gas = await estimate(call.from, call.to, call.data);
  const f = await fees();
  call.onStep?.("getting-ready");
  await ensureGas(call.from, gas * f.maxFeePerGas);

  call.onStep?.("confirm");
  const raw = await withSigner(call.from, (account) =>
    account.signTransaction({ chainId: CHAIN_ID, type: "eip1559", to: call.to, data: call.data, value: 0n, nonce, gas, ...f }),
  );

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
  if (replacing) await replace(idbWriteStore, liveWriteChain, write);
  else await submit(idbWriteStore, liveWriteChain, write);
  return write;
}

/** A brand new write. Refused while this account has one in flight. */
export async function sendWrite(call: Call): Promise<PendingWrite> {
  const nonce = await nonceForNewWrite(idbWriteStore, liveWriteChain, call.from);
  return signAndSubmit(call, nonce, false);
}

/** Replaces a stuck write, on the same nonce, after re-checking it is safe. */
export async function retryStuckWrite(call: Call): Promise<PendingWrite> {
  const nonce = await nonceForReplacement(idbWriteStore, liveWriteChain, call.from);
  return signAndSubmit(call, nonce, true);
}
