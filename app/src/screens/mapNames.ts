import type { Address } from "viem";
import { copy } from "../copy.ts";

/**
 * A person's two lines on the map. With signed names, the first is their city
 * and the second says who and what. Without them there is no city, and
 * "account ending 7bC1" is too long for a map label (about 90 px at the
 * edges), so the first line is a short form that fits, "Ending 7bC1" or
 * "You", and the second carries only the detail.
 */
export function mapLines(p: { account: Address; city: string; me: boolean; name: string }, named: boolean, withName: string, alone: string): { city: string; sub: string } {
  if (p.city) return { city: p.city, sub: withName };
  return { city: p.me ? copy.youCap : named ? p.name : copy.mapEnding(p.account), sub: alone };
}

/** The letters in a decider's circle: their initial when named, else the last two characters of their account. */
export function initialsOf(account: Address, name: string, named: boolean): string {
  return named && name ? name.charAt(0).toUpperCase() : account.slice(-2).toUpperCase();
}
