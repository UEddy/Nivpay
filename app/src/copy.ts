import { en, type Dictionary } from "./i18n/en.ts";

/**
 * Every word NivPay shows people lives in a dictionary under src/i18n: one
 * per language, all with the same keys. English is the source.
 *
 * Product rule (docs/BUILD-APP.md): NivPay reads like a fintech app. People
 * never need to know it runs on crypto. No crypto, blockchain, block, chain,
 * onchain, wallet, token, gas, Monad, testnet, network, address, hash,
 * contract, stablecoin, seed, mnemonic, private key, 0x or MON, in any form,
 * in any language. copy.test.ts and i18n.test.ts enforce this.
 *
 * The only exception is data, not wording: the Account ID in the account
 * details sheet shows the account's identifier so support can find it.
 *
 * `copy` is the language in use. It is chosen once, before any screen loads
 * (i18n/start.ts), so every module that reads it reads the same language.
 * Until then, and in tests, it is English.
 */

/** "account ending" in the language in use, as accountEnding writes it. */
let ending = endingOf(en);
function endingOf(d: Dictionary): string {
  return d.accountEnding("0x0000").replace(/\s*0000$/, "");
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A person without a signed name is "account ending 7bC1". Where that starts
 * a sentence, it starts with a capital: "Account ending 7bC1 added $100".
 */
export function sentenceStarts(text: string): string {
  const upper = ending.charAt(0).toUpperCase() + ending.slice(1);
  return text.replace(new RegExp(`(^|[.!?]\\s+)${escape(ending)}`, "g"), `$1${upper}`);
}

/** These make the name itself, which goes in the middle of sentences too. */
const NAME_MAKERS = new Set(["accountEnding", "mapEnding", "withUsername"]);

function withSentenceStarts(words: Dictionary): Dictionary {
  return Object.fromEntries(
    Object.entries(words).map(([k, v]) => [k, typeof v === "function" && !NAME_MAKERS.has(k) ? (...a: unknown[]) => sentenceStarts((v as (...x: unknown[]) => string)(...a)) : v]),
  ) as Dictionary;
}

/** The words of the language in use. One object, filled in place, so every import sees a change made before the screens load. */
export const copy: Dictionary = withSentenceStarts(en);

/** Puts a language's words in place. Called once at startup, before any screen is imported. */
export function useDictionary(words: Dictionary): void {
  ending = endingOf(words);
  Object.assign(copy, withSentenceStarts(words));
}

/**
 * The connection banner. "Nothing has moved" is only true when no request of
 * ours is in flight; when that is unknown, it is not claimed.
 */
export function offlineMessage(requestsInFlight: number | undefined, offline = false): string {
  if (offline) return requestsInFlight === 0 ? copy.youreOffline : copy.youreOfflineRequestInFlight;
  return requestsInFlight === 0 ? copy.offlineNothingInFlight : copy.offlineRequestInFlight;
}

/**
 * The code table, mirrored in docs/ERROR-CODES.md. People read a code off the
 * phone; the table says what happened. Codes are stable: never reuse one.
 */
export const ERROR_CODES = {
  PREPARING: 10,
  IN_FLIGHT: 11,
  SETUP_UNREACHABLE: 12,
  SETUP_PAUSED: 13,
  SETUP_KEY_MALFORMED: 14,
  SETUP_KEY_MISMATCH: 15,
  SETUP_SEND_FAILED: 16,
  SETUP_READ_FAILED: 17,
  SETUP_LIMIT_REACHED: 18,
  SETUP_REFUSED: 19,
  SETUP_SLOW: 20,
  SETUP_REVERTED: 21,
  NOT_DECIDER: 22,
  PAY_NO_AMOUNT: 23,
  PAY_OVER_LIMIT: 24,
  PAY_POT_SHORT: 25,
  PAY_POT_STOPPED: 26,
  REQUEST_EXPIRED: 27,
  REQUEST_DECIDED: 28,
  REQUEST_REFUSED: 29,
  NOTHING_TO_TAKE: 94,
  POT_ALREADY_CLOSED: 95,
  NOT_CLOSED_YET: 96,
  TAKE_REFUSED: 97,
  PASSKEY_CANCELLED: 30,
  PASSKEY_UNSUPPORTED: 31,
  BROWSER_MISSING_FEATURE: 32,
  WRONG_PASSKEY: 33,
  PASSKEY_TIMED_OUT: 34,
  PASSKEY_OTHER: 35,
  HOST_NOT_ALLOWED: 36,
  NAME_TAKEN: 37,
  NAME_NOT_ALLOWED: 38,
  NAME_HELD: 39,
  NAME_NOT_FOUND: 40,
  SIGNING: 41,
  SAVING: 42,
  NAME_CHANGED: 43,
  DAILY_LIMIT: 44,
  PHOTO_SAVE_FAILED: 45,
  NAME_SAVE_FAILED: 88,
  PHOTO_UNREADABLE: 46,
  CITY_SAVE_FAILED: 47,
  REQUEST_SEND_FAILED: 48,
  REQUESTS_NOT_ON: 49,
  REQUESTS_TURN_ON_FAILED: 57,
  PUSH_TURN_ON_FAILED: 58,
  PUSH_BLOCKED: 59,
  VOICE_OVER_CAP: 68,
  VOICE_FAILED: 69,
  CONFIRMING: 50,
  STUCK: 51,
  REVERTED: 52,
  SUPERSEDED: 53,
  MAY_STILL_GO_THROUGH: 54,
  NOTHING_STUCK: 55,
  REFUSED: 56,
  CLAIM_COOLDOWN: 60,
  CLAIM_CEILING: 61,
  CLAIM_REVERTED: 62,
  RAMP_UNREACHABLE: 63,
  RAMP_PAUSED: 64,
  RAMP_REFUSED: 65,
  RAMP_FAILED: 66,
  CASHOUT_STATEMENT: 67,
  LINK_DAMAGED: 70,
  REPLY_NOT_HERE: 71,
  REPLY_UNVERIFIED: 72,
  CREATE_REFUSED: 73,
  REPLY_TOO_LATE: 74,
  POT_OTHER_VERSION: 75,
  POT_NOT_FOUND: 76,
  FIND_POTS_FAILED: 77,
  STORY_READ_FAILED: 78,
  SEND_TO_SELF: 80,
  SEND_NOT_PERSON: 81,
  SEND_NO_AMOUNT: 82,
  SEND_MORE_THAN_BALANCE: 83,
  SEND_REFUSED: 84,
  PAY_LINK_OTHER_VERSION: 85,
  RECEIVE_READ_FAILED: 86,
  REPORT_FAILED: 87,
  PAIR_PAUSED: 90,
  QUOTE_CHANGED: 91,
  LOW_LIQUIDITY: 92,
  NOT_ENOUGH_FOR_FEES: 93,
  SCREEN_FAILED: 98,
  UNKNOWN: 99,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
