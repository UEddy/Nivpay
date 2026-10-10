import { checkPasskeyHost } from "./hosts.ts";

/**
 * The hostname passkeys are bound to, set at build time (README,
 * VITE_PRODUCTION_HOSTNAME). Kept apart from passkey.ts so a screen can check
 * the hostname without loading the passkey and signing code.
 */
export const PRODUCTION_HOSTNAME: string = import.meta.env.VITE_PRODUCTION_HOSTNAME ?? "";

export function hostCheck() {
  return checkPasskeyHost(location.hostname, PRODUCTION_HOSTNAME);
}
