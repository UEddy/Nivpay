import { getAddress, isAddress, type Address } from "viem";
import type { CredentialBook } from "./passkeyCore.ts";

type KeyValue = Pick<Storage, "getItem" | "setItem">;

/** Next to nivpay.accounts.v1, kept apart so the signing code never reads names (nameSafety.test.ts). */
const CREDENTIALS = "nivpay.credentials.v1";

/** A WebAuthn credential ID as Mera gives it: canonical unpadded base64url. */
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{1,1366}$/;

/**
 * Each account's passkey credential ID on this phone, by address. The ID is
 * public: it only tells the phone which passkey to offer (passkeyCore.ts).
 * One kept is never replaced or removed.
 */
export class CredentialStore implements CredentialBook {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  credentialFor(address: Address): string | undefined {
    return this.all()[getAddress(address)];
  }

  rememberCredential(address: Address, credentialId: string): void {
    const all = this.all();
    const at = getAddress(address);
    if (all[at] || !CREDENTIAL_ID.test(credentialId)) return;
    this.kv.setItem(CREDENTIALS, JSON.stringify({ ...all, [at]: credentialId }));
  }

  private all(): Record<string, string> {
    try {
      const raw = JSON.parse(this.kv.getItem(CREDENTIALS) ?? "{}") as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(
        Object.entries(raw).flatMap(([a, id]) =>
          isAddress(a) && typeof id === "string" && CREDENTIAL_ID.test(id) ? [[getAddress(a), id]] : [],
        ),
      );
    } catch {
      return {};
    }
  }
}
