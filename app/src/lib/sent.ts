import type { Address } from "viem";
import { DEPLOYMENT } from "./deployment.ts";
import { fromSent, NotesStore } from "./notes.ts";
import { SEND_LABEL } from "./transfer.ts";
import { VoiceStore } from "./voice.ts";

/**
 * A payment to a person, from Send or from "Hey NivPay" (screens/VoicePay.tsx):
 * the label its write carries, and what is remembered once it is final.
 */

/** The write's label carries who and how much, so a payment resumed after a reload (on Send) can still say so. */
export const labelFor = (to: Address, amount: bigint) => `${SEND_LABEL} ${to} ${amount}`;

/**
 * This account's own payment, once final, in its notifications (lib/notes.ts),
 * and counted towards turning voice on (lib/voice.ts). Amounts are in dollars.
 */
export function noteSent(me: Address, tx: string, to: { account: Address; name: string }, amount: bigint): void {
  new VoiceStore(localStorage, DEPLOYMENT, me).sawWith(to.account, tx);
  try {
    new NotesStore(localStorage, DEPLOYMENT, me).update((s) => fromSent(s, { tx, to: to.account, toName: to.name, amount, decimals: 6, symbol: "$" }, Date.now()));
  } catch {
    // Storage refused: the payment itself is unaffected.
  }
}
