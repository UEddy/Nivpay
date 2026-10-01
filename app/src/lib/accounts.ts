import { getAddress, isAddress, type Address } from "viem";

/**
 * The accounts this phone knows about. Only an address and a display name are
 * ever stored. No key, PRF output, mnemonic, seed or session is stored or
 * logged anywhere.
 */
export type StoredAccount = { address: Address; name: string };

type KeyValue = Pick<Storage, "getItem" | "setItem">;

const ACCOUNTS = "nivpay.accounts.v1";
const ACTIVE = "nivpay.active.v1";

export class AccountStore {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  list(): StoredAccount[] {
    try {
      const raw = JSON.parse(this.kv.getItem(ACCOUNTS) ?? "[]") as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.flatMap((a: unknown) => {
        const r = a as Partial<StoredAccount>;
        return typeof r.address === "string" && isAddress(r.address) && typeof r.name === "string"
          ? [{ address: getAddress(r.address), name: r.name }]
          : [];
      });
    } catch {
      return [];
    }
  }

  /** Adds the account, or updates its name if it is already known. */
  upsert(account: StoredAccount): void {
    const address = getAddress(account.address);
    const others = this.list().filter((a) => a.address !== address);
    const existing = this.list().find((a) => a.address === address);
    const name = account.name.trim() || existing?.name || defaultAccountName(address);
    this.kv.setItem(ACCOUNTS, JSON.stringify([...others, { address, name }]));
  }

  active(): StoredAccount | undefined {
    const address = this.kv.getItem(ACTIVE);
    return this.list().find((a) => a.address === address);
  }

  setActive(address: Address): void {
    this.kv.setItem(ACTIVE, getAddress(address));
  }
}

/** The name shown when someone signs in with a passkey this phone hasn't seen. */
export function defaultAccountName(address: string): string {
  return `Account ${address.slice(-4)}`;
}
