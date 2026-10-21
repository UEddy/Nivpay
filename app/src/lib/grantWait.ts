import type { Address, Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { NotEnoughGasError, setupFailure } from "./errors.ts";

/**
 * The gas grant's timing (/api/fund), the parts with no browser in them.
 *
 * A grant can be final, and the account's balance read as covering a write,
 * while the node a write is sent to still refuses it for lack of balance
 * ("Signer had insufficient balance"), as seen for about ten seconds on the
 * public RPC. So a write that needed a grant waits until that grant is at
 * least GRANT_MIN_AGE_S old by block time before the fingerprint is asked
 * for, and screens that know a write is coming ask for the grant early, so
 * by then it is old enough already.
 */

/** A grant is used only once it is this old, by its block's time against the newest block's. */
export const GRANT_MIN_AGE_S = 15n;
/** /api/fund grants only to accounts holding under this (its THRESHOLD, 0.075 MON). */
export const GRANT_THRESHOLD = 75_000_000_000_000_000n;
/** The longest any of these waits goes on before letting the write try anyway, as it did before. */
export const GRANT_WAIT_MAX_MS = 30_000;
export const POLL_MS = 1_500;

type Wait = (ms: number) => Promise<void>;
const sleep: Wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The grant each account was last given on this phone, so a later write knows to wait for its age. */
const grants = new Map<string, Hex>();
export const rememberGrant = (address: Address, hash: Hex) => void grants.set(address.toLowerCase(), hash);
export const grantFor = (address: Address): Hex | undefined => grants.get(address.toLowerCase());
/** Once a grant is old enough there is nothing more to wait for. */
export const forgetGrant = (address: Address) => void grants.delete(address.toLowerCase());
/** Early asks still on their way, so a second ask (a double tap, or the write itself) waits for this one instead of asking again. */
const asking = new Map<string, Promise<Hex | null>>();
export const grantAsked = (address: Address): Promise<Hex | null> | undefined => asking.get(address.toLowerCase());
/** For tests. */
export const forgetGrants = () => (grants.clear(), asking.clear());

/**
 * Waits until the grant's block is GRANT_MIN_AGE_S older than the newest
 * block, or GRANT_WAIT_MAX_MS has passed (then the write tries anyway, as it
 * did before). A grant not found yet counts as young.
 */
export async function waitForGrantAge(deps: { grantTime: () => Promise<bigint | null>; latestTime: () => Promise<bigint>; wait?: Wait; nowMs?: () => number }): Promise<"old enough" | "gave up"> {
  const wait = deps.wait ?? sleep;
  const now = deps.nowMs ?? Date.now;
  const start = now();
  for (;;) {
    const [grant, latest] = await Promise.all([deps.grantTime().catch(() => null), deps.latestTime().catch(() => null)]);
    if (grant !== null && latest !== null && latest - grant >= GRANT_MIN_AGE_S) return "old enough";
    if (now() - start >= GRANT_WAIT_MAX_MS) return "gave up";
    await wait(POLL_MS);
  }
}

/** Waits until the balance covers `needed`, or `maxMs` (GRANT_WAIT_MAX_MS unless given) has passed. Reads at least once. */
export async function waitForBalance(deps: { balance: () => Promise<bigint>; needed: bigint; maxMs?: number; wait?: Wait; nowMs?: () => number }): Promise<boolean> {
  const wait = deps.wait ?? sleep;
  const now = deps.nowMs ?? Date.now;
  const start = now();
  for (;;) {
    const b = await deps.balance().catch(() => 0n);
    if (b >= deps.needed) return true;
    if (now() - start >= (deps.maxMs ?? GRANT_WAIT_MAX_MS)) return false;
    await wait(POLL_MS);
  }
}

/**
 * Asks for the gas grant early, without waiting for it, when a screen knows a
 * write is coming: only if the account holds under the grant threshold. The
 * grant's hash is remembered, so the write waits for its age if it is still
 * young. Never throws: a grant that isn't given now is asked for again by the
 * write itself, as before. Asks once: while an ask is on its way, a second one
 * (a double tap on Turn on) gets that same ask, and once a grant is
 * remembered it is not asked for again.
 */
export function askGrantEarly(address: Address, deps: { balance: () => Promise<bigint>; fetch: (url: string, init: RequestInit) => Promise<Response> }): Promise<Hex | null> {
  const key = address.toLowerCase();
  const known = grants.get(key);
  if (known) return Promise.resolve(known);
  const on = asking.get(key);
  if (on) return on;
  const ask = askOnce(address, deps).finally(() => asking.delete(key));
  asking.set(key, ask);
  return ask;
}

async function askOnce(address: Address, deps: { balance: () => Promise<bigint>; fetch: (url: string, init: RequestInit) => Promise<Response> }): Promise<Hex | null> {
  try {
    if ((await deps.balance()) >= GRANT_THRESHOLD) return null;
    const res = await deps.fetch("/api/fund", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
    const body = (await res.json().catch(() => ({}))) as { hash?: unknown };
    if (!res.ok || typeof body.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.hash)) return null;
    rememberGrant(address, body.hash as Hex);
    return body.hash as Hex;
  } catch {
    return null;
  }
}

/** /api/fund's refusals that mean a grant for this account is coming, from an ask before this one. */
const GRANT_COMING = new Set(["a grant for this address is already on its way", "a grant for this address was just sent"]);

export type GasDeps = {
  balance: () => Promise<bigint>;
  /** POST /api/fund for this account. */
  fund: () => Promise<Response>;
  finalized: (hash: Hex) => Promise<"success" | "reverted">;
  /** Waits until the grant is GRANT_MIN_AGE_S old (waitForGrantAge). */
  settled: (hash: Hex) => Promise<void>;
  wait?: Wait;
  nowMs?: () => number;
};

/**
 * ensureGas (lib/send.ts) with its chain and server passed in. Makes sure the
 * account can pay for `needed` wei of gas, asking /api/fund for a grant only
 * if no grant is already coming: an early ask still on its way is waited for,
 * never asked beside, and /api/fund's "already on its way" or "just sent" is
 * a grant coming, not a failure. Waiting for a grant that is coming takes
 * GRANT_WAIT_MAX_MS at most in all, from the start; if the balance still
 * doesn't cover the write by then, it is Code 19, as before.
 */
export async function ensureGasWith(address: Address, needed: bigint, deps: GasDeps): Promise<void> {
  const wait = deps.wait ?? sleep;
  const now = deps.nowMs ?? Date.now;
  const deadline = now() + GRANT_WAIT_MAX_MS;
  const left = () => Math.max(0, deadline - now());
  const enough = (b: bigint) => needed > 0n && b >= needed;
  let balance = await deps.balance();
  const asked = grantAsked(address);
  if (asked && !enough(balance)) {
    let answered = false;
    void asked.then(() => (answered = true), () => (answered = true));
    while (!answered && left() > 0) await wait(POLL_MS);
  }
  const early = grantFor(address);
  // A grant asked for early and still landing: wait for that one, never ask again (/api/fund would refuse a second so soon).
  if (early && !enough(balance)) {
    await deps.finalized(early).catch(() => undefined);
    if (needed > 0n) await waitForBalance({ balance: deps.balance, needed, maxMs: left(), wait, nowMs: now });
    balance = await deps.balance();
  }
  if (enough(balance)) {
    if (early) {
      await deps.settled(early);
      forgetGrant(address);
    }
    return;
  }
  let res: Response;
  try {
    res = await deps.fund();
  } catch {
    throw new NotEnoughGasError(copy.errSetupUnreachable, ERROR_CODES.SETUP_UNREACHABLE);
  }
  const body = (await res.json().catch(() => ({}))) as { hash?: Hex; error?: string; code?: string };
  if (res.ok && body.hash) {
    let status: "success" | "reverted";
    try {
      status = await deps.finalized(body.hash);
    } catch {
      throw new NotEnoughGasError(copy.errSetupSlow, ERROR_CODES.SETUP_SLOW);
    }
    if (status !== "success") throw new NotEnoughGasError(copy.errSetupReverted, ERROR_CODES.SETUP_REVERTED);
    rememberGrant(address, body.hash);
    if (needed > 0n) await waitForBalance({ balance: deps.balance, needed, wait, nowMs: now });
    await deps.settled(body.hash);
    forgetGrant(address);
    return;
  }
  if (res.status === 409 && enough(balance)) return;
  // A grant is coming (asked for early on this phone, or from another tab): wait for it, within what is left of the cap.
  if (res.status === 409 && body.error && GRANT_COMING.has(body.error)) {
    if (await waitForBalance({ balance: deps.balance, needed: needed > 0n ? needed : 1n, maxMs: left(), wait, nowMs: now })) {
      const hash = grantFor(address);
      if (hash) {
        await deps.settled(hash);
        forgetGrant(address);
      }
      return;
    }
    throw setupFailure(res.status, body);
  }
  // Grants go only to accounts holding under the grant threshold. One holding
  // more than that, but less than this request needs, can't be topped up yet.
  if (res.status === 409 && body.error === "this account already has enough") {
    throw new NotEnoughGasError(copy.errNotEnoughForFees, ERROR_CODES.NOT_ENOUGH_FOR_FEES);
  }
  throw setupFailure(res.status, body);
}
