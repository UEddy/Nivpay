import { createPasskeyWithPrfOutput, getPasskeyPrfOutput } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { Address, LocalAccount } from "viem";
import { ERROR_CODES } from "../copy.ts";
import { AppError, WrongPasskeyError } from "./errors.ts";
import { checkPasskeyHost } from "./hosts.ts";
import { PRODUCTION_HOSTNAME } from "./passkeyHost.ts";
import { sessionAddress, sessionFromPrfOutput } from "./keys.ts";

export class HostNotAllowedError extends AppError {}

function rpId(): string {
  const check = checkPasskeyHost(location.hostname, PRODUCTION_HOSTNAME);
  if (!check.ok) throw new HostNotAllowedError(check.message, ERROR_CODES.HOST_NOT_ALLOWED);
  return check.rpId;
}

export { hostCheck } from "./passkeyHost.ts";

/** Makes a new passkey and returns the account's address. Nothing but the address leaves this function. */
export async function signUp(name: string): Promise<Address> {
  const id = rpId();
  const created = await createPasskeyWithPrfOutput({
    rp: { id, name: "NivPay" },
    user: { name, displayName: name },
  });
  const session = sessionFromPrfOutput(created.prfOutput);
  try {
    return sessionAddress(session);
  } finally {
    session.end();
  }
}

/** Asks for an existing passkey and returns its account's address. */
export async function signIn(): Promise<Address> {
  const { prfOutput } = await getPasskeyPrfOutput({ rpId: rpId() });
  const session = sessionFromPrfOutput(prfOutput);
  try {
    return sessionAddress(session);
  } finally {
    session.end();
  }
}

/**
 * Opens a signing session for `expected`, runs `sign` with it, and ends the
 * session straight after, whatever happens. `sign` should only sign: do the
 * broadcasting and waiting outside, after the session has ended.
 */
export async function withSigner<T>(expected: Address, sign: (account: LocalAccount) => Promise<T>): Promise<T> {
  const { prfOutput } = await getPasskeyPrfOutput({ rpId: rpId() });
  const session = sessionFromPrfOutput(prfOutput);
  try {
    if (sessionAddress(session) !== expected) throw new WrongPasskeyError();
    return await sign(toViemAccount(session));
  } finally {
    session.end();
  }
}
