import { getAddress, isAddress, isAddressEqual, type Address } from "viem";
import { cleanName } from "./accounts.ts";

/**
 * Contacts: names this person saved for accounts they pay, on this phone.
 *
 * A contact is a convenience, not an identity. Nobody checks it, it is never
 * sent anywhere or written on chain, and clearing the site's data removes it.
 * What it buys is a second opinion at the moment of paying: a link's name is
 * whatever its maker typed, so "Idara" on a link with an account this phone
 * has saved under another name is worth a warning, and so is paying an
 * account for the first time. Warnings only: nothing here stops a payment.
 *
 * Kept per deployment and per account, so two people sharing a phone keep
 * separate lists.
 */

export type Contact = { account: Address; name: string; addedAt: number };

type KeyValue = Pick<Storage, "getItem" | "setItem">;

/** Two names are the same if they match ignoring case and spacing, after cleanName. */
export function nameKey(name: string): string {
  return cleanName(name).toLocaleLowerCase("en-GB").replace(/\s+/gu, "");
}

function readList<T>(kv: KeyValue, key: string, keep: (row: unknown) => T | null): T[] {
  try {
    const raw = JSON.parse(kv.getItem(key) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((r) => {
      const v = keep(r);
      return v === null ? [] : [v];
    });
  } catch {
    return [];
  }
}

export class ContactStore {
  private readonly kv: KeyValue;
  private readonly key: string;
  private readonly owner: Address;

  constructor(kv: KeyValue, deployment: string, owner: Address) {
    if (!isAddress(owner)) throw new Error("not an account");
    this.kv = kv;
    this.owner = getAddress(owner);
    this.key = `nivpay.contacts.v1.${deployment}.${this.owner}`;
  }

  /** Newest first. Rows that don't read as a contact are dropped, and every name is cleaned again. */
  list(): Contact[] {
    return readList(this.kv, this.key, (r) => {
      const c = r as Partial<Contact>;
      if (typeof c?.account !== "string" || !isAddress(c.account) || typeof c.name !== "string" || typeof c.addedAt !== "number") return null;
      const name = cleanName(c.name);
      return name ? { account: getAddress(c.account), name, addedAt: c.addedAt } : null;
    }).sort((a, b) => b.addedAt - a.addedAt);
  }

  get(account: Address): Contact | undefined {
    return this.list().find((c) => isAddressEqual(c.account, account));
  }

  /** Saves or renames. False, and nothing saved, for an empty name or the owner's own account. */
  save(account: Address, name: string, now: number): boolean {
    const clean = cleanName(name);
    if (!clean || !isAddress(account) || isAddressEqual(account, this.owner)) return false;
    const at = getAddress(account);
    const old = this.get(at);
    const rest = this.list().filter((c) => c.account !== at);
    this.kv.setItem(this.key, JSON.stringify([...rest, { account: at, name: clean, addedAt: old?.addedAt ?? now }]));
    return true;
  }

  remove(account: Address): void {
    this.kv.setItem(this.key, JSON.stringify(this.list().filter((c) => !isAddressEqual(c.account, account))));
  }
}

/** Accounts this account has paid with a payment that reached final, on this phone. */
export class PaidStore {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string, owner: Address) {
    if (!isAddress(owner)) throw new Error("not an account");
    this.kv = kv;
    this.key = `nivpay.paid.v1.${deployment}.${getAddress(owner)}`;
  }

  all(): Address[] {
    return readList(this.kv, this.key, (r) => (typeof r === "string" && isAddress(r) ? getAddress(r) : null));
  }

  has(account: Address): boolean {
    return this.all().some((a) => isAddressEqual(a, account));
  }

  add(account: Address): void {
    if (this.has(account)) return;
    this.kv.setItem(this.key, JSON.stringify([...this.all(), getAddress(account)]));
  }
}

export type SendWarnings = {
  /** Never paid with a final payment from this account on this phone. */
  firstTime: boolean;
  /** A contact with the link's name, on a different account: maybe not them. */
  clash: Contact | null;
  /** The account is a contact saved under another name than the link's. Shown contact first, link second. */
  savedAs: Contact | null;
};

/**
 * What the confirm sheet warns about before a payment. `linkName` is the name
 * on a request link, or null when the account was pasted or picked.
 */
export function sendWarnings(to: Address, linkName: string | null, contacts: Contact[], paidBefore: boolean): SendWarnings {
  const saved = contacts.find((c) => isAddressEqual(c.account, to)) ?? null;
  const key = linkName === null ? "" : nameKey(linkName);
  const clash = key ? (contacts.find((c) => !isAddressEqual(c.account, to) && nameKey(c.name) === key) ?? null) : null;
  return {
    firstTime: !paidBefore,
    clash,
    savedAs: saved && key && nameKey(saved.name) !== key ? saved : null,
  };
}

/**
 * Usernames this account has paid, and the account each pointed at then, on
 * this phone. Kept beside contacts but apart from them: a username is the
 * other person's choice, not a name this person gave them.
 *
 * The first payment to a username asks for the last 4 characters of the
 * Account ID, like a pasted one; once a payment to it is final, the pair is
 * remembered and not asked again. If the name later points somewhere else,
 * the payment stops before anything is signed (namePairCheck).
 */
export class NamePairStore {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string, owner: Address) {
    if (!isAddress(owner)) throw new Error("not an account");
    this.kv = kv;
    this.key = `nivpay.namepairs.v1.${deployment}.${getAddress(owner)}`;
  }

  private read(): Record<string, Address> {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "{}") as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).flatMap(([n, a]) => (/^[a-z0-9_]{1,20}$/.test(n) && typeof a === "string" && isAddress(a) ? [[n, getAddress(a)]] : [])),
      );
    } catch {
      return {};
    }
  }

  get(name: string): Address | undefined {
    return this.read()[name];
  }

  /** Remembers the account a username pointed at when a payment to it was final. A later payment replaces it only through remember again. */
  remember(name: string, account: Address): void {
    this.kv.setItem(this.key, JSON.stringify({ ...this.read(), [name]: getAddress(account) }));
  }
}

export type NamePairCheck = "first" | "same" | "changed";

/** A username's account now, against the one remembered from paying it before. */
export function namePairCheck(now: Address, remembered: Address | undefined): NamePairCheck {
  if (!remembered) return "first";
  return isAddressEqual(now, remembered) ? "same" : "changed";
}
