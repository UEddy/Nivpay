import type { Address } from "viem";
import { NAMES } from "./config.ts";
import { namesReader } from "./namesLive.ts";
import { readClient } from "./rpc.ts";

/**
 * The live username registry, or nothing while config.ts has no NAMES: then
 * every username feature is off and nothing is read.
 */
export const namesOn = NAMES !== null;
export const names = NAMES ? namesReader(readClient, NAMES) : null;

/** The write label for a claim, change or let go: "username claim idara", "username release idara". */
export const USERNAME_LABEL = "username";

/** The account's username, read at the finalized block. Null when it has none, or usernames are off. */
export async function usernameOf(account: Address): Promise<string | null> {
  if (!names) return null;
  const [name] = await names.namesOf([account], await names.finalized());
  return name || null;
}

/** Who holds a name now, at the finalized block. Null if nobody does, or usernames are off. */
export async function holderOf(name: string): Promise<Address | null> {
  if (!names) return null;
  return (await names.lookup(name, await names.finalized())).holder;
}
