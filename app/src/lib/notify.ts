import type { Address, Hex } from "viem";
import type { SentRequest } from "./inboxLive.ts";

/**
 * Tells /api/notify that something this phone did is done, so the people it
 * affects get a notification on their phones (README, "Notifications on the
 * phone"). The server works out who from the finalized receipt's events, or
 * from the request's own proof, never from what is sent here. Best effort:
 * if this phone closes first, or the call fails, that push is missed, and
 * the bell in the app still shows it.
 */

/** Whether notifications are set up on this site, asked once per page: if not, nothing is sent. */
let enabledOnce: Promise<boolean> | null = null;
const enabled = () =>
  (enabledOnce ??= fetch("/api/push")
    .then(async (r) => r.ok && ((await r.json()) as { enabled?: boolean }).enabled === true)
    .catch(() => false));

async function post(body: Record<string, unknown>): Promise<void> {
  try {
    if (!(await enabled())) return;
    await fetch("/api/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true });
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
