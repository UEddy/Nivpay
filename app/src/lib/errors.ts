import { isMeraError } from "@category-labs/mera";

/** An error with a short reason that is safe to show on the phone and report. */
export class AppError extends Error {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = new.target.name;
    this.reason = reason;
  }
}

/** Thrown when the passkey someone chose belongs to a different account. */
export class WrongPasskeyError extends AppError {
  constructor() {
    super(
      "That passkey belongs to a different NivPay account. Choose the passkey for this account and try again.",
      "passkey for a different account",
    );
  }
}

/** The account could not be given gas. `reason` says which step and what the server answered. */
export class NotEnoughGasError extends AppError {}

export type SendStage = "preparing" | "gas grant" | "passkey" | "signing" | "broadcast" | "confirming";

/**
 * Wraps any failure in the send flow with where it happened and whether the
 * person's own transaction had been broadcast by then. "Nothing was sent" is
 * only ever said when `broadcast` is false.
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

/** One short line: long hex removed, first line only, capped. */
export function shortDetail(error: unknown): string {
  if (error instanceof AppError) return error.reason;
  if (isMeraError(error)) return `passkey ${error.code}`;
  const e = error as { shortMessage?: unknown; message?: unknown; name?: unknown } | null;
  const text = String(e?.shortMessage ?? e?.message ?? e?.name ?? error ?? "unknown").split("\n")[0] ?? "";
  return text.replace(/0x[0-9a-fA-F]{40,}/g, "0x…").slice(0, 100);
}

/**
 * Plain words for everything that can go wrong around a passkey, without any
 * claim about whether something was sent. Support facts from
 * https://mera.category.xyz/authenticator-support/ (27 Sep 2026).
 */
export function passkeyErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return (
          "This passkey can't hold a NivPay account. On Android, save it to Google Password Manager. " +
          "On iPhone, use iCloud Keychain on iOS 18 or later. Chrome's desktop profile, Bitwarden and Dashlane don't work. " +
          "If you use Samsung Pass, choose Google Password Manager instead."
        );
      case "PASSKEY_OPERATION_FAILED":
        return "The passkey step was cancelled or didn't finish.";
      case "CRYPTO_UNAVAILABLE":
        return "This browser is missing a security feature NivPay needs. Update Chrome and try again.";
      case "SESSION_ENDED":
        return "The signing step timed out.";
      default:
        return "Something went wrong with the passkey.";
    }
  }
  return "Something went wrong.";
}

/** What the person sees when something fails, and the short reason to report. */
export function describeFailure(error: unknown): { text: string; reason: string } {
  if (error instanceof SendFailure) {
    const reason = `${error.stage}: ${shortDetail(error.cause)}`;
    if (error.broadcast) {
      return {
        text: "Your request was sent but isn't confirmed yet. Don't send it again: NivPay keeps checking and will show the result here.",
        reason,
      };
    }
    return { text: `${passkeyErrorMessage(error.cause)} Nothing was sent.`, reason };
  }
  return { text: passkeyErrorMessage(error), reason: shortDetail(error) };
}
