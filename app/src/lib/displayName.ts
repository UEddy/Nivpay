import { getAddress, type Address } from "viem";
import { cleanName } from "./accounts.ts";
import { proofMessage, sha256Hex } from "./proof.ts";

/**
 * The display name, kept for every phone the account signs in on
 * (api/name). Saved with one fingerprint, like the photo: the account's
 * passkey signs a short message naming the account, a SHA-256 of the name and
 * the time (lib/proof.ts). Read back when the account signs in, so a passkey
 * brings back its name as well as its account. The name stays on the phone
 * too, and the phone keeps working with it when the server can't be reached
 * or names aren't set up there.
 */

type Sign = (message: string) => Promise<string>;
type Fetch = typeof fetch;

let enabled: Promise<boolean> | null = null;
/** Whether names are kept on this site. Asked once; false if the answer doesn't come. */
export function namesSyncOn(get: Fetch = fetch): Promise<boolean> {
  enabled ??= get("/api/name", { headers: { accept: "application/json" } })
    .then(async (r) => (r.ok ? ((await r.json()) as { enabled?: boolean }).enabled === true : false))
    .catch(() => false);
  return enabled;
}

/** The name kept for this account: a string, null for none, or undefined if it couldn't be read. */
export async function readSavedName(account: Address, get: Fetch = fetch): Promise<string | null | undefined> {
  try {
    const r = await get(`/api/name/${getAddress(account)}`, { headers: { accept: "application/json" } });
    if (!r.ok) return undefined;
    const name = ((await r.json()) as { name?: unknown }).name;
    if (name === null) return null;
    return typeof name === "string" && cleanName(name) ? cleanName(name) : undefined;
  } catch {
    return undefined;
  }
}

/** Saves `name` (cleaned first) for this account, proved by `sign` (one fingerprint). Throws "name refused" if the server says no. */
export async function saveName(account: Address, name: string, sign: Sign, now = Date.now(), host = location.host, post: Fetch = fetch): Promise<void> {
  const clean = cleanName(name);
  if (!clean) throw new Error("name refused: empty");
  const time = Math.floor(now / 1000);
  const data = `sha256:${await sha256Hex(new TextEncoder().encode(clean))}`;
  const message = proofMessage({ subject: "name", action: "set", account, data, time, site: host });
  const res = await post("/api/name", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "set", account: getAddress(account), time, signature: await sign(message), name: clean }),
  });
  if (!res.ok) throw new Error(`name refused: ${res.status}`);
}

/**
 * Earlier versions showed the username, "@eddy", in place of a name when an
 * account came back on a new phone, and kept it as the name. It is not one:
 * the header shows a name, never the username.
 */
export function isUsernameStandIn(name: string): boolean {
  return /^@[a-z][a-z0-9_]{2,19}$/.test(name);
}

/**
 * What to do with the name when an account signs in, from the name on this
 * phone and the one kept for it (undefined when that couldn't be read):
 * the kept one wins; a username stand-in is dropped; with no name anywhere,
 * ask once (unless the person chose Skip on this phone).
 */
export function nameAtStart(local: string, saved: string | null | undefined, skipped: boolean): { name: string; ask: boolean } {
  const here = isUsernameStandIn(local) ? "" : local;
  if (saved) return { name: saved, ask: false };
  if (here) return { name: here, ask: false };
  return { name: "", ask: !skipped || local !== here };
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;
const PENDING = "nivpay.namepending.v1";

/**
 * Accounts whose name was changed on this phone but not yet kept for the
 * others (Code 88). Until it is, the name here is the newer one, and an
 * older kept one doesn't replace it at sign-in.
 */
export class PendingNames {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  private all(): string[] {
    try {
      const raw = JSON.parse(this.kv.getItem(PENDING) ?? "[]") as unknown;
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  has(account: string): boolean {
    return this.all().includes(account.toLowerCase());
  }

  set(account: string, pending: boolean): void {
    const rest = this.all().filter((a) => a !== account.toLowerCase());
    this.kv.setItem(PENDING, JSON.stringify(pending ? [...rest, account.toLowerCase()] : rest));
  }
}
