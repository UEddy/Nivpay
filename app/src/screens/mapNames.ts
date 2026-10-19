import type { Address } from "viem";
import { copy } from "../copy.ts";

/**
 * A person's two lines on the map. With signed names, the first is their city
 * and the second says who and what. Without them there is no city, and
 * "account ending 7bC1" is too long for a map label (about 90 px at the
 * edges), so the first line is a short form that fits, "Ending 7bC1" or
 * "You", and the second carries only the detail.
 */
export function mapLines(
  p: { account: Address; city: string; country?: string; me: boolean; name: string; timeZone?: string },
  named: boolean,
  withName: string,
  alone: string,
  phoneZone: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): { city: string; sub: string; where: { city?: string; country?: string; timeZone?: string } } {
  // Where they are on the world: the city, else their time zone (lib/worldmap.ts). For the person
  // looking, when the pot doesn't know theirs (no names, so "UTC" or none), this phone's own.
  const known = p.timeZone && p.timeZone !== "UTC" ? p.timeZone : undefined;
  const where = { city: p.city || undefined, ...(p.city && p.country ? { country: p.country } : {}), timeZone: known ?? (p.me ? phoneZone() || undefined : undefined) };
  if (p.city) return { city: p.city, sub: withName, where };
  return { city: p.me ? copy.youCap : named ? p.name : copy.mapEnding(p.account), sub: alone, where };
}

/**
 * The letters in a decider's circle: "You" for the person looking, as the map
 * says; else their initial when named, else the last two characters of their
 * account.
 */
export function initialsOf(account: Address, name: string, named: boolean, me = false): string {
  if (me) return copy.youCap;
  return named && name ? name.charAt(0).toUpperCase() : account.slice(-2).toUpperCase();
}
