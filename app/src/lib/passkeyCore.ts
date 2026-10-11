import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, type WebAuthnClient } from "@category-labs/mera";
import type { Address, LocalAccount } from "viem";
import { toViemAccount } from "@category-labs/mera/viem";
import { WrongPasskeyError } from "./errors.ts";
import { sessionAddress, sessionFromPrfOutput } from "./keys.ts";

/**
 * Which passkey to ask for, and what each one opens. Kept apart from
 * passkey.ts, which reads the hostname and localStorage, so tests can run it
 * with a stand-in WebAuthn client.
 *
 * The derivation (keys.ts), the rpId and the PRF salt are untouched: Mera's
 * default salt is used everywhere. A credential ID only narrows which passkey
 * the phone offers; the same passkey gives the same PRF output, and so the
 * same account, with or without it.
 */

/** Where each account's credential ID is kept: CredentialStore (credentials.ts). */
export type CredentialBook = {
  credentialFor(address: Address): string | undefined;
  /** Keeps the ID for an account. Never replaces one already kept. */
  rememberCredential(address: Address, credentialId: string): void;
};

export type Opened = { address: Address; credentialId: string };

function addressFrom(prfOutput: Uint8Array): Address {
  const session = sessionFromPrfOutput(prfOutput);
  try {
    return sessionAddress(session);
  } finally {
    session.end();
  }
}

/**
 * One assertion. With a credential ID the phone goes straight to that
 * passkey; without one it shows its own list of passkeys for this site.
 */
function askPasskey(rpId: string, credentialId: string | undefined, client: WebAuthnClient | undefined) {
  return getPasskeyPrfOutput({
    rpId,
    ...(credentialId ? { credential: { credentialId } } : {}),
    ...(client ? { webAuthnClient: client } : {}),
  });
}

/**
 * Makes a new passkey. If the phone does not give the PRF output while
 * making it, Mera asks the new passkey for it by its ID, so no list of
 * passkeys is shown.
 */
export async function createAccount(rpId: string, name: string, client?: WebAuthnClient): Promise<Opened> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: rpId, name: "NivPay" },
    user: { name, displayName: name },
    ...(client ? { webAuthnClient: client } : {}),
  });
  return { address: addressFrom(created.prfOutput), credentialId: created.credentialId };
}

/**
 * Signs in. For an account this phone knows (`expected`), only its own
 * passkey is asked for when its ID is kept. When it is not (an account kept
 * before IDs were), the phone's list is shown once, the passkey picked must
 * open that same account, and its ID is then kept. With no `expected` (a new
 * phone, or an account not on this phone yet) the phone's list is shown, so
 * any passkey can bring its account back.
 */
export async function openAccount(
  rpId: string,
  book: CredentialBook,
  expected?: Address,
  client?: WebAuthnClient,
): Promise<Opened> {
  const kept = expected ? book.credentialFor(expected) : undefined;
  const { prfOutput, credentialId } = await askPasskey(rpId, kept, client);
  const address = addressFrom(prfOutput);
  if (expected && address !== expected) throw new WrongPasskeyError();
  if (expected && !kept) book.rememberCredential(address, credentialId);
  return { address, credentialId };
}

/**
 * Opens a signing session for `expected`, runs `sign` with it, and ends the
 * session straight after, whatever happens. Asks for the account's own
 * passkey when its ID is kept, and keeps it when it was not.
 */
export async function signAs<T>(
  rpId: string,
  book: CredentialBook,
  expected: Address,
  sign: (account: LocalAccount) => Promise<T>,
  client?: WebAuthnClient,
): Promise<T> {
  const kept = book.credentialFor(expected);
  const { prfOutput, credentialId } = await askPasskey(rpId, kept, client);
  const session = sessionFromPrfOutput(prfOutput);
  try {
    if (sessionAddress(session) !== expected) throw new WrongPasskeyError();
    if (!kept) book.rememberCredential(expected, credentialId);
    return await sign(toViemAccount(session));
  } finally {
    session.end();
  }
}
