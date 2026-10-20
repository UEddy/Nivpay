import type { Address } from "viem";
import { matchName, payableByVoice, withinVoiceCap, type VoiceCommand, type VoiceState } from "./voice.ts";

/**
 * "Hey NivPay", hands free (README, "Hey NivPay"): after the wake word, one
 * sentence is heard, read back aloud, and paid only after a spoken yes and a
 * fingerprint. These are the parts with no browser in them: who a heard
 * "send" pays, and what counts as a yes. The rules are voice's own
 * (lib/voice.ts): trusted contacts only, at most $200.
 */

export type VoicePlan<T> =
  | { kind: "pay"; to: T; amount: bigint }
  | { kind: "pick"; options: T[]; amount: bigint }
  | { kind: "over-cap" }
  | { kind: "no-contact"; name: string }
  | { kind: "not-send" };

/** Who a heard command pays, among the contacts voice may pay; never anyone else. */
export function planVoiceSend<T extends { account: Address; name: string }>(cmd: VoiceCommand, contacts: readonly T[], s: VoiceState, paid: readonly Address[]): VoicePlan<T> {
  if (cmd.kind !== "send") return { kind: "not-send" };
  if (!withinVoiceCap(cmd.amount)) return { kind: "over-cap" };
  const found = matchName(cmd.name, payableByVoice(contacts, s, paid));
  if (found.length === 0) return { kind: "no-contact", name: cmd.name };
  if (found.length > 1) return { kind: "pick", options: found, amount: cmd.amount };
  return { kind: "pay", to: found[0]!, amount: cmd.amount };
}

const YES = new Set(["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "confirm", "confirmed", "correct", "right", "send it", "pay it", "do it", "go ahead", "that's right", "thats right", "yes please", "yes send it"]);
const NO = new Set(["no", "nope", "nah", "cancel", "stop", "don't", "dont", "wrong", "wait", "not"]);

/**
 * A spoken answer to "Send $20 to Ana?": "yes" only when the whole answer is
 * a yes ("yes", "yeah, send it", "okay please"); "no" when any word of it
 * says no or stop; null for anything else, which is never taken as a yes.
 */
export function heardYesNo(heard: string): "yes" | "no" | null {
  const words = heard
    .toLowerCase()
    .replace(/[’]/gu, "'")
    .replace(/[^\p{L}\s']/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
  if (words.length === 0) return null;
  if (words.some((w) => NO.has(w))) return "no";
  const rest = words.filter((w) => w !== "please");
  if (rest.length === 0) return null;
  const phrase = rest.join(" ");
  if (YES.has(phrase)) return "yes";
  // "yeah send it", "okay go ahead": a yes word, then a yes phrase.
  if (rest.length > 1 && YES.has(rest[0]!) && YES.has(rest.slice(1).join(" "))) return "yes";
  return null;
}
