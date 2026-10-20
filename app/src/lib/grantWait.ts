import type { Address, Hex } from "viem";

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
/** For tests. */
export const forgetGrants = () => grants.clear();

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

/** Waits until the balance covers `needed`, or GRANT_WAIT_MAX_MS has passed. */
export async function waitForBalance(deps: { balance: () => Promise<bigint>; needed: bigint; wait?: Wait; nowMs?: () => number }): Promise<boolean> {
  const wait = deps.wait ?? sleep;
  const now = deps.nowMs ?? Date.now;
  const start = now();
  for (;;) {
    const b = await deps.balance().catch(() => 0n);
    if (b >= deps.needed) return true;
    if (now() - start >= GRANT_WAIT_MAX_MS) return false;
    await wait(POLL_MS);
  }
}

/**
 * Asks for the gas grant early, without waiting for it, when a screen knows a
 * write is coming: only if the account holds under the grant threshold. The
 * grant's hash is remembered, so the write waits for its age if it is still
 * young. Never throws: a grant that isn't given now is asked for again by the
 * write itself, as before.
 */
export async function askGrantEarly(address: Address, deps: { balance: () => Promise<bigint>; fetch: (url: string, init: RequestInit) => Promise<Response> }): Promise<Hex | null> {
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
