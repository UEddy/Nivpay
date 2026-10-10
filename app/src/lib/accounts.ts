import { getAddress, isAddress, type Address } from "viem";

/**
 * The accounts this phone knows about. Only an address and a display name are
 * ever stored. No key, PRF output, mnemonic, seed or session is stored or
 * logged anywhere.
 *
 * The name is what the person asked to be called on this phone. It is a
 * label, not an identity: nobody checks it, it is never written on chain and
 * never sent to /api. "" means no name yet; the screens then show
 * defaultAccountName. A passkey brings back its account on another phone,
 * but not its name.
 */
export type StoredAccount = { address: Address; name: string };

type KeyValue = Pick<Storage, "getItem" | "setItem">;

const ACCOUNTS = "nivpay.accounts.v1";
const ACTIVE = "nivpay.active.v1";
/** Accounts whose person chose Skip when asked for a name, so they are not asked again on this phone. */
const NAME_SKIPPED = "nivpay.nameSkipped.v1";

/** The most characters a name may have, counting each emoji or accented letter as one or more. */
export const NAME_MAX = 40;

/**
 * A name as typed, made safe to keep and show as plain text: Unicode
 * normalised, control and invisible formatting characters removed (including
 * right-to-left overrides and zero-width characters, which can make one name
 * look like another), runs of spaces made one, trimmed, and cut to NAME_MAX.
 */
export function cleanName(raw: string): string {
  const visible = raw
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(visible).slice(0, NAME_MAX).join("").trim();
}

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
        if (typeof r.address !== "string" || !isAddress(r.address) || typeof r.name !== "string") return [];
        const address = getAddress(r.address);
        const name = cleanName(r.name);
        // Earlier versions saved the fallback as if it were a name. It isn't one.
        return [{ address, name: name === defaultAccountName(address) ? "" : name }];
      });
    } catch {
      return [];
    }
  }

  /** Adds the account, or updates its name if one is given. An empty name keeps the one already kept. */
  upsert(account: StoredAccount): void {
    const address = getAddress(account.address);
    const existing = this.list().find((a) => a.address === address);
    const name = cleanName(account.name) || existing?.name || "";
    this.save([...this.list().filter((a) => a.address !== address), { address, name }]);
  }

  /** Changes the name this phone shows for an account it knows. An empty name, after cleaning, changes nothing. */
  rename(address: Address, name: string): boolean {
    const clean = cleanName(name);
    const at = getAddress(address);
    if (!clean || !this.list().some((a) => a.address === at)) return false;
    this.save(this.list().map((a) => (a.address === at ? { ...a, name: clean } : a)));
    return true;
  }

  /** True when the person should be asked for a name: none kept, and they haven't chosen Skip on this phone. */
  needsName(address: Address): boolean {
    const at = getAddress(address);
    const account = this.list().find((a) => a.address === at);
    return Boolean(account && !account.name && !this.skipped().includes(at));
  }

  skipName(address: Address): void {
    const at = getAddress(address);
    this.kv.setItem(NAME_SKIPPED, JSON.stringify([...new Set([...this.skipped(), at])]));
  }

  active(): StoredAccount | undefined {
    const address = this.kv.getItem(ACTIVE);
    return this.list().find((a) => a.address === address);
  }

  setActive(address: Address): void {
    this.kv.setItem(ACTIVE, getAddress(address));
  }

  private skipped(): string[] {
    try {
      const raw = JSON.parse(this.kv.getItem(NAME_SKIPPED) ?? "[]") as unknown;
      return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : [];
    } catch {
      return [];
    }
  }

  private save(accounts: StoredAccount[]): void {
    this.kv.setItem(ACCOUNTS, JSON.stringify(accounts));
  }
}

/** The name shown for an account with none: its last four characters. */
export function defaultAccountName(address: string): string {
  return `Account ${address.slice(-4)}`;
}

/** What to call an account on screen and in the links it makes: its name, else its default. */
export function shownName(account: StoredAccount): string {
  return account.name || defaultAccountName(account.address);
}
