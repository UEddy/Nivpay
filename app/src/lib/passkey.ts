import type { Address, LocalAccount } from "viem";
import { ERROR_CODES } from "../copy.ts";
import { CredentialStore } from "./credentials.ts";
import { AppError } from "./errors.ts";
import { checkPasskeyHost } from "./hosts.ts";
import { PRODUCTION_HOSTNAME } from "./passkeyHost.ts";
import { createAccount, openAccount, signAs, type Opened } from "./passkeyCore.ts";

export class HostNotAllowedError extends AppError {}

function rpId(): string {
  const check = checkPasskeyHost(location.hostname, PRODUCTION_HOSTNAME);
  if (!check.ok) throw new HostNotAllowedError(check.message, ERROR_CODES.HOST_NOT_ALLOWED);
  return check.rpId;
}

/** Each account's credential ID, kept in localStorage next to the accounts (lib/credentials.ts). */
const book = new CredentialStore(localStorage);

export { hostCheck } from "./passkeyHost.ts";

/** Makes a new passkey and returns the account's address and the passkey's ID. Nothing secret leaves this function. */
export async function signUp(name: string): Promise<Opened> {
  return createAccount(rpId(), name);
}

/**
 * Asks for a passkey and returns its account. With `expected`, an account on
 * this phone, only that account's passkey is asked for (passkeyCore.ts).
 * Without, the phone shows its list, so a passkey from another phone works.
 */
export async function signIn(expected?: Address): Promise<Opened> {
  return openAccount(rpId(), book, expected);
}

/**
 * Opens a signing session for `expected`, runs `sign` with it, and ends the
 * session straight after, whatever happens. `sign` should only sign: do the
 * broadcasting and waiting outside, after the session has ended.
 */
export async function withSigner<T>(expected: Address, sign: (account: LocalAccount) => Promise<T>): Promise<T> {
  return signAs(rpId(), book, expected, sign);
}
