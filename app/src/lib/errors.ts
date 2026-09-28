import { isMeraError } from "@category-labs/mera";

/** Thrown when the passkey someone chose belongs to a different account. */
export class WrongPasskeyError extends Error {
  constructor() {
    super("That passkey belongs to a different NivPay account. Choose the passkey for this account and try again.");
  }
}

/**
 * Plain words for everything that can go wrong around a passkey. Support
 * facts from https://mera.category.xyz/authenticator-support/ (27 Sep 2026).
 */
export function passkeyErrorMessage(error: unknown): string {
  if (error instanceof WrongPasskeyError) return error.message;
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return (
          "This passkey can't hold a NivPay account. On Android, save it to Google Password Manager. " +
          "On iPhone, use iCloud Keychain on iOS 18 or later. Chrome's desktop profile, Bitwarden and Dashlane don't work. " +
          "If you use Samsung Pass, choose Google Password Manager instead."
        );
      case "PASSKEY_OPERATION_FAILED":
        return "The passkey step was cancelled or didn't finish. Nothing was saved and nothing was sent. You can try again.";
      case "CRYPTO_UNAVAILABLE":
        return "This browser is missing a security feature NivPay needs. Update Chrome and try again.";
      case "SESSION_ENDED":
        return "The signing step timed out. Nothing was sent. Try again.";
      default:
        return "Something went wrong with the passkey. Nothing was sent. Try again.";
    }
  }
  return "Something went wrong. Nothing was sent. Try again.";
}
