import { getAddress, isAddress, isAddressEqual, type Address } from "viem";

/**
 * "Remove from this phone", in Account details. This phone forgets what it
 * keeps for one account: its name, its drafts, and its settings (contacts,
 * hidden and kept pots, the daily limit, usernames paid, what Home found,
 * notifications). The account and its money stay where they are, and its
 * passkey brings it back on this phone or any other.
 *
 * Kept on purpose: the passkey's credential ID (public, it only tells the
 * phone which passkey to offer, and credentials.ts never removes one), and
 * what is public and shared by every account (pot blocks and makers, block
 * times, the install banner, the language).
 */

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** Keys of shared stores that hold rows for many accounts, and how to drop one account's rows. */
const SHARED: Record<string, (raw: unknown, a: Address) => unknown> = {
  "nivpay.accounts.v1": (raw, a) => (Array.isArray(raw) ? raw.filter((r) => !sameAs(r?.address, a)) : raw),
  "nivpay.drafts.v1": (raw, a) => (Array.isArray(raw) ? raw.filter((r) => !sameAs(r?.owner, a)) : raw),
  "nivpay.invited.v1": (raw, a) => (Array.isArray(raw) ? raw.filter((r) => !sameAs(r?.account, a)) : raw),
  "nivpay.nameSkipped.v1": (raw, a) => (Array.isArray(raw) ? raw.filter((r) => !sameAs(r, a)) : raw),
  "nivpay.lastBalance.v1": (raw, a) => withoutKey(raw, a),
  "nivpay.lastused.v1": (raw, a) => withoutKey(raw, a),
};

const KEPT = ["nivpay.credentials.v1"];

function sameAs(v: unknown, a: Address): boolean {
  return typeof v === "string" && isAddress(v) && isAddressEqual(v, a);
}

function withoutKey(raw: unknown, a: Address): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k]) => !sameAs(k, a)));
}

/** Forgets one account on this phone. Returns the keys removed or changed, for the record. */
export function forgetAccount(store: Store, account: Address): string[] {
  const a = getAddress(account);
  const touched: string[] = [];
  const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => k !== null && k.startsWith("nivpay."));
  for (const key of keys) {
    if (KEPT.includes(key)) continue;
    const shared = SHARED[key];
    if (shared) {
      try {
        const before = store.getItem(key);
        const after = JSON.stringify(shared(JSON.parse(before ?? "null"), a));
        if (after !== before) {
          store.setItem(key, after);
          touched.push(key);
        }
      } catch {
        // A damaged shared store is left for its own reader, which already ignores damage.
      }
      continue;
    }
    if (key.toLowerCase().includes(a.toLowerCase())) {
      store.removeItem(key);
      touched.push(key);
    }
  }
  if (sameAs(store.getItem("nivpay.active.v1"), a)) {
    store.removeItem("nivpay.active.v1");
    touched.push("nivpay.active.v1");
  }
  return touched.sort();
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;
const LAST_USED = "nivpay.lastused.v1";

/** When each account was last used on this phone, for "This phone" in Account details. */
export class LastUsedStore {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  all(): Record<string, number> {
    try {
      const raw = JSON.parse(this.kv.getItem(LAST_USED) ?? "{}") as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k, v]) => isAddress(k) && typeof v === "number")) as Record<string, number>;
    } catch {
      return {};
    }
  }

  get(account: Address): number | undefined {
    return this.all()[getAddress(account)];
  }

  touch(account: Address, now: number): void {
    this.kv.setItem(LAST_USED, JSON.stringify({ ...this.all(), [getAddress(account)]: now }));
  }
}
