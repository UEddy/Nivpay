import { copy } from "../copy.ts";

/**
 * The small line under a recipient's name: "account ending 0B61", so people
 * can check it. Left out when the name already is that line (a pasted Account
 * ID has no name), so it isn't said twice.
 */
export function recipientDetail(to: { account: string; name: string }): string | null {
  const ending = copy.accountEnding(to.account);
  return to.name.toLowerCase() === ending.toLowerCase() ? null : ending;
}
