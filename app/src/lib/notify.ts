import type { Hex } from "viem";
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

/** A payment, chip-in or pot this phone made, once final: by its transaction alone. */
export const notifyTx = (deployment: string, tx: Hex) => post({ kind: "tx", deployment, tx });

/** A request this phone sent to a person: the proof the requester signed, with no amount or name. */
export const notifyRequest = (sent: SentRequest) => post({ kind: "request", ...sent });
