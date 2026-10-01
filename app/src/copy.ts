/**
 * Every word NivPay shows people lives here.
 *
 * Product rule (docs/BUILD-APP.md): NivPay reads like a fintech app. People
 * never need to know it runs on crypto. No crypto, blockchain, block, chain,
 * onchain, wallet, token, gas, Monad, testnet, network, address, hash,
 * contract, stablecoin, seed, mnemonic, private key, 0x or MON, in any form.
 * copy.test.ts enforces this on this file and on the text in the screens.
 *
 * The only exception is data, not wording: the Account ID in the account
 * details sheet shows the account's identifier so support can find it.
 */

export const copy = {
  appName: "NivPay",
  tagline: "A group purse for one purpose that no single person can pocket.",
  testMode: "Test mode",

  // Welcome, sign up, sign in, switch account
  switchAccount: "Switch account",
  accountsOnThisPhone: "Accounts on this phone",
  useOneOfThese: "Use one of these",
  pickAccountHint: "Your phone asks which passkey. Pick the account you want.",
  addAnotherAccount: "Add another account",
  makeYourAccount: "Make your account",
  yourName: "Your name",
  namePlaceholder: "Idara",
  createAccount: "Create your account",
  createAccountHint: "Your account is a passkey on this phone. There is no password and nothing to write down.",
  alreadyHaveAccount: "I already have an account",
  waitingForPasskey: "Waiting for your passkey…",
  back: "Back",

  // Account home
  accountDetails: "Account details",
  accountId: "Account ID",
  accountIdHint: "Only needed if NivPay support asks for it.",
  copyAction: "Copy",
  copied: "Copied",
  close: "Close",
  yourBalance: "Your balance",
  readingBalance: "Reading your balance…",
  dollars: "Dollars",
  dollarsLine: "Held as AUSD, a digital dollar issued by Agora.",
  testDollars: "Test dollars",
  testDollarsLine: "Test dollars, not real money.",

  // Add test dollars
  addTestDollars: "Add test dollars",
  addTestDollarsHint: "For trying NivPay out. These are test dollars, not real money, and they only work in test mode.",
  howMany: "How many",
  upToAtATime: (max: string) => `Up to ${max} at a time.`,
  stepPreparing: "Getting ready…",
  stepGettingReady: "Getting your account ready…",
  stepConfirm: "Confirm with your fingerprint",
  stepSending: "Adding test dollars…",
  added: (amount: string, seconds: string) => `Added ${amount} test dollars. Settled in ${seconds}s.`,
  tryAgain: "Try again",

  // Connection. "Nothing has moved" only when no request of ours is in flight.
  offlineNothingInFlight: "Can't connect right now. Nothing has moved. Trying again.",
  offlineRequestInFlight:
    "Can't connect right now. Your request was sent and is still being confirmed. Don't send it again. Trying again.",

  // Hosts
  onlyAtHome: (home: string) => `Accounts can only be made and used at ${home}. This copy of NivPay is for testing and can't hold an account.`,
  homeNotChosen: "Accounts can't be made here yet. NivPay's home hasn't been chosen, and an account made here could never move.",

  // Outcomes and failures. Each failure ends with its code from ERROR_CODES.
  nothingWasSent: "Nothing was sent.",
  sentNotConfirmed: "Your request was sent but isn't confirmed yet. Don't send it again: NivPay keeps checking and will show the result here.",
  stuck: "This is taking longer than it should. It hasn't gone through, and nothing has moved yet.",
  earlierStuck: "An earlier attempt is taking longer than it should. It hasn't gone through, and nothing has moved yet.",
  didNotGoThrough: "That didn't go through. No test dollars moved.",
  code: (n: number) => `Code ${n}`,

  errPreparing: "Couldn't get this ready.",
  errInFlight: "Another payment from this account is still going through. Wait for it to finish.",
  errSetupUnreachable: "Couldn't reach NivPay to get your account ready. Check your connection and try again.",
  errSetupPaused: "NivPay can't set up payments right now. Try again later.",
  errSetupFailed: "Your account couldn't be made ready for this. Try again in a minute.",
  errSetupSlow: "Getting your account ready is taking too long. Try again in a minute.",
  errSetupReverted: "Getting your account ready didn't go through. Try again.",
  errPasskeyCancelled: "The passkey step was cancelled or didn't finish.",
  errPasskeyUnsupported:
    "This passkey can't hold a NivPay account. On Android, save it to Google Password Manager. " +
    "On iPhone, use iCloud Keychain on iOS 18 or later. Chrome's desktop profile, Bitwarden and Dashlane don't work. " +
    "If you use Samsung Pass, choose Google Password Manager instead.",
  errBrowserMissingFeature: "This browser is missing a security feature NivPay needs. Update Chrome and try again.",
  errWrongPasskey: "That passkey belongs to a different NivPay account. Choose the passkey for this account and try again.",
  errPasskeyTimedOut: "The signing step timed out.",
  errPasskeyOther: "Something went wrong with the passkey.",
  errSigning: "Couldn't sign this request.",
  errSaving: "Couldn't save this request on your phone.",
  errConfirming: "Your request was sent but checking on it failed.",
  errMayStillGoThrough: "The earlier attempt may still go through. Wait a little longer.",
  errNothingStuck: "There's nothing waiting to try again.",
  errUnknown: "Something went wrong.",

  /** How a vendor or person is shown when a name alone isn't enough. */
  accountEnding: (id: string) => `account ending ${id.slice(-4)}`,
} as const;

/**
 * The connection banner. "Nothing has moved" is only true when no request of
 * ours is in flight; when that is unknown, it is not claimed.
 */
export function offlineMessage(requestsInFlight: number | undefined): string {
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
  PASSKEY_CANCELLED: 30,
  PASSKEY_UNSUPPORTED: 31,
  BROWSER_MISSING_FEATURE: 32,
  WRONG_PASSKEY: 33,
  PASSKEY_TIMED_OUT: 34,
  PASSKEY_OTHER: 35,
  HOST_NOT_ALLOWED: 36,
  SIGNING: 41,
  SAVING: 42,
  CONFIRMING: 50,
  STUCK: 51,
  REVERTED: 52,
  SUPERSEDED: 53,
  MAY_STILL_GO_THROUGH: 54,
  NOTHING_STUCK: 55,
  UNKNOWN: 99,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
