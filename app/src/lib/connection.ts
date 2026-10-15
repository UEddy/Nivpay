import { copy } from "../copy.ts";
import { dateLocale } from "./locale.ts";

/**
 * A balance is shown as live only while reads are coming back. When the
 * phone is offline or the last read failed, the last amount read stays on
 * screen, marked as not up to date with when it was read. When a read is
 * only slow (`slow`, lib/balanceRead.ts), it says so instead.
 */
export function balanceNote(down: boolean, readAtMs: number | null, timeZone?: string, slow = false): string | null {
  if ((!down && !slow) || readAtMs === null) return null;
  const time = new Intl.DateTimeFormat(dateLocale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(readAtMs));
  return down ? copy.balanceNotLive(time) : copy.balanceSlow(time);
}
