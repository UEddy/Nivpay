import type { Address, Hex } from "viem";
import type { SentRequest } from "./inboxLive.ts";

/**
 * Tells /api/notify that something this phone did is done, so the people it
 * affects get a notification on their phones (README, "Notifications on the
 * phone"). The server works out who from the finalized receipt's events, or
 * from the request's own proof, never from what is sent here. Best effort:
 * if this phone closes first, or the call fails, that push is missed, and
 * the bell in the app still shows it. A payment's own call is tried up to
 * three times (now, then after 5 and 15 seconds) while the server answers 503
 * "try again" or can't be reached: the server handles each transaction once,
 * and Auto cash out claims each arrival once, so a retry never pushes or
 * moves twice. If this phone closes before its tries, an Auto cash out waits
 * until the person paid opens their app.
 */

/** Whether notifications are set up on this site, asked once per page: if not, nothing is sent. */
let enabledOnce: Promise<boolean> | null = null;
const enabled = () =>
  (enabledOnce ??= fetch("/api/push")
    .then(async (r) => r.ok && ((await r.json()) as { enabled?: boolean }).enabled === true)
    .catch(() => false));

/** The waits before each retry of a transaction's call. */
export const RETRY_AFTER_MS = [5_000, 15_000];

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Sends one call, and for a transaction tries again while the server says 503
 * or can't be reached. Anything else (done, ignored, refused) is final.
 * Returns how many calls were made.
 */
export async function sendNotify(body: Record<string, unknown>, fetcher: Fetch = fetch, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<number> {
  const tries = body.kind === "tx" ? 1 + RETRY_AFTER_MS.length : 1;
  for (let i = 0; ; i++) {
    let again = false;
    try {
      const res = await fetcher("/api/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true });
      again = res.status === 503;
    } catch {
      again = true;
    }
    if (!again || i + 1 >= tries) return i + 1;
    await wait(RETRY_AFTER_MS[i]!);
  }
}

async function post(body: Record<string, unknown>): Promise<void> {
  try {
    if (!(await enabled())) return;
    await sendNotify(body);
  } catch {
    // Missed: the bell still shows it.
  }
}

/**
 * A payment, chip-in or pot this phone made, once final: by its transaction
 * alone. For a change agreed on a NivPayPotsV2 pot, `people` are those this
 * phone saw put money in; the server tells only those who still hold some in
 * the pot at that block, read from the chain, so a wrong list can only
 * leave someone out, never tell a stranger.
 */
export const notifyTx = (deployment: string, tx: Hex, people?: Address[]) => post({ kind: "tx", deployment, tx, ...(people?.length ? { people } : {}) });

/** A request this phone sent to a person: the proof the requester signed, with no amount or name. */
export const notifyRequest = (sent: SentRequest) => post({ kind: "request", ...sent });
