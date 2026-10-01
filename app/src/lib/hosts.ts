import { copy } from "../copy.ts";

/**
 * A passkey is bound to the hostname it was made on (the WebAuthn rpId) and
 * can never be used on another. So passkeys are only made or used on the
 * production hostname and on localhost; anywhere else, such as a preview
 * deploy, an account made there would be stranded for good.
 *
 * `production` is empty until the final hostname is confirmed (Phase 4), which
 * leaves localhost as the only place accounts can be made.
 */
export type HostCheck = { ok: true; rpId: string } | { ok: false; message: string };

export function checkPasskeyHost(hostname: string, production: string | undefined): HostCheck {
  const host = hostname.toLowerCase();
  if (host === "localhost") return { ok: true, rpId: host };
  if (production && host === production.toLowerCase()) return { ok: true, rpId: host };
  return { ok: false, message: production ? copy.onlyAtHome(production) : copy.homeNotChosen };
}
