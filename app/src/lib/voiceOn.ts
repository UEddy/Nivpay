import type { Address } from "viem";
import { DEPLOYMENT } from "./deployment.ts";
import { language } from "./locale.ts";
import { speechAvailable } from "./speech.ts";
import { VoiceStore } from "./voice.ts";
import { wakeSupported } from "./wake/support.ts";

/** Where voice, and "Hey NivPay" on top of it, are offered and on (README, "Voice commands" and "Hey NivPay"). */

/** Voice is offered only in English (its parser is tested in English only), where the browser can do speech. */
export const voiceOffered = () => language() === "en" && speechAvailable();

/** On for this account, and offered here. */
export const voiceReady = (account: Address) => voiceOffered() && new VoiceStore(localStorage, DEPLOYMENT, account).active();

/** "Hey NivPay" can be offered: voice is, and the browser can hear the wake word on the phone. */
export const wakeOffered = () => voiceOffered() && wakeSupported();

/** Listening for "Hey NivPay" is on for this account: voice on, the switch on, and offered here. */
export const wakeReady = (account: Address) => {
  if (!wakeOffered()) return false;
  const s = new VoiceStore(localStorage, DEPLOYMENT, account).get();
  return s.on && s.wake;
};
