import { isMeraError } from "@category-labs/mera";
import { copy, ERROR_CODES, type ErrorCode } from "../copy.ts";

/** An error that already knows what to tell people and which code to show. */
export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(message: string, code: ErrorCode) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Thrown when the passkey someone chose belongs to a different account. */
export class WrongPasskeyError extends AppError {
  constructor() {
    super(copy.errWrongPasskey, ERROR_CODES.WRONG_PASSKEY);
  }
}

/** The account could not be made ready to send. */
export class NotEnoughGasError extends AppError {}

/**
 * Turns the setup service's answer into a code people can read off the phone.
 * The status and the service's code never reach the screen, only this.
 */
export function setupFailure(status: number, body: { error?: string; code?: string }): NotEnoughGasError {
  const failed = (code: ErrorCode) => new NotEnoughGasError(copy.errSetupFailed, code);
  switch (body.code) {
    case "FUNDER_KEY_MALFORMED":
      return failed(ERROR_CODES.SETUP_KEY_MALFORMED);
    case "FUNDER_KEY_MISMATCH":
      return failed(ERROR_CODES.SETUP_KEY_MISMATCH);
    case "SEND_FAILED":
      return failed(ERROR_CODES.SETUP_SEND_FAILED);
    case "RPC_FAILED":
      return failed(ERROR_CODES.SETUP_READ_FAILED);
  }
  if (status === 503) {
    if (body.error === "funding is not configured") return failed(ERROR_CODES.SETUP_KEY_MALFORMED);
    if (body.error === "wrong chain, refusing to fund") return failed(ERROR_CODES.SETUP_REFUSED);
    return new NotEnoughGasError(copy.errSetupPaused, ERROR_CODES.SETUP_PAUSED);
  }
  if (status === 409 && body.error === "this account has reached its limit") return failed(ERROR_CODES.SETUP_LIMIT_REACHED);
  return failed(ERROR_CODES.SETUP_REFUSED);
}

export type SendStage = "preparing" | "gas grant" | "passkey" | "signing" | "broadcast" | "confirming";

/**
 * Wraps any failure in the send flow with where it happened and whether the
 * person's own request had been broadcast by then. "Nothing was sent" is only
 * ever said when `broadcast` is false.
 */
export class SendFailure extends Error {
  readonly stage: SendStage;
  readonly broadcast: boolean;
  override readonly cause: unknown;
  constructor(stage: SendStage, broadcast: boolean, cause: unknown) {
    super(`${stage} failed`);
    this.name = "SendFailure";
    this.stage = stage;
    this.broadcast = broadcast;
    this.cause = cause;
  }
}

/** Message and code for anything that isn't already an AppError. */
function classify(error: unknown, stage?: SendStage): { text: string; code: ErrorCode } {
  if (error instanceof AppError) return { text: error.message, code: error.code };
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return { text: copy.errPasskeyUnsupported, code: ERROR_CODES.PASSKEY_UNSUPPORTED };
      case "PASSKEY_OPERATION_FAILED":
        return { text: copy.errPasskeyCancelled, code: ERROR_CODES.PASSKEY_CANCELLED };
      case "CRYPTO_UNAVAILABLE":
        return { text: copy.errBrowserMissingFeature, code: ERROR_CODES.BROWSER_MISSING_FEATURE };
      case "SESSION_ENDED":
        return { text: copy.errPasskeyTimedOut, code: ERROR_CODES.PASSKEY_TIMED_OUT };
      default:
        return { text: copy.errPasskeyOther, code: ERROR_CODES.PASSKEY_OTHER };
    }
  }
  switch (stage) {
    case "preparing":
    case "gas grant":
      return { text: copy.errPreparing, code: ERROR_CODES.PREPARING };
    case "passkey":
      return { text: copy.errPasskeyOther, code: ERROR_CODES.PASSKEY_OTHER };
    case "signing":
      return { text: copy.errSigning, code: ERROR_CODES.SIGNING };
    case "broadcast":
      return { text: copy.errSaving, code: ERROR_CODES.SAVING };
    case "confirming":
      return { text: copy.errConfirming, code: ERROR_CODES.CONFIRMING };
    default:
      return { text: copy.errUnknown, code: ERROR_CODES.UNKNOWN };
  }
}

/**
 * What people see when something fails: plain words and a neutral code that
 * maps to docs/ERROR-CODES.md. Never internal names, never server answers.
 */
export function describeFailure(error: unknown): { text: string; code: ErrorCode } {
  if (error instanceof SendFailure) {
    if (error.broadcast) {
      const code = error.cause instanceof AppError ? error.cause.code : ERROR_CODES.CONFIRMING;
      return { text: copy.sentNotConfirmed, code };
    }
    const { text, code } = classify(error.cause, error.stage);
    return { text: `${text} ${copy.nothingWasSent}`, code };
  }
  return classify(error);
}
