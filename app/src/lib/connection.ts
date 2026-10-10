import { copy } from "../copy.ts";

/**
 * A balance is shown as live only while reads are coming back. When the
 * phone is offline or the last read failed, the last amount read stays on
 * screen, marked as not up to date with when it was read.
 */
export function balanceNote(down: boolean, readAtMs: number | null, timeZone?: string): string | null {
  if (!down || readAtMs === null) return null;
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(readAtMs));
  return copy.balanceNotLive(time);
}
