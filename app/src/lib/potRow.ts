import { copy } from "../copy.ts";
import type { FoundPot, Role } from "./discover.ts";

export const ROLE_TEXT: Record<Role, string> = {
  decides: copy.foundRoleDecides,
  paid: copy.foundRolePaid,
  putIn: copy.foundRolePutIn,
};

/**
 * The line under a pot opened or made on this phone, on Home. Says what this
 * account does in it when the chain says so (a maker who decides reads "You
 * decide on payments"), and only otherwise the general "Open to chip in".
 */
export function openedPotMeta(found: FoundPot | undefined, holds: string): string {
  if (!found || found.roles.length === 0) return copy.potRowJoined;
  return copy.foundMeta(found.roles.map((r) => ROLE_TEXT[r]), holds);
}
