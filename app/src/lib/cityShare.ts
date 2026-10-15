import { getAddress, isAddressEqual, type Address } from "viem";
import { fromBase64, proofMessage, sha256Hex, toBase64 } from "./proof.ts";

/**
 * Where people in a pot are chipping in from: a city, opt in, for the people
 * in that pot only.
 *
 * The city is encrypted on the phone with a key made from the pot link's
 * fragment, the part after #, which never reaches any server. So /api/city
 * holds only ciphertext it can't read, and only people with the pot's link
 * can read the cities. Someone who sees the pot on Home with no link has no
 * key, and sees no cities.
 *
 * Never a position: only a city name and a country code, chosen on the phone
 * (lib/cities.ts). Never written to the chain. Each share and removal is
 * proved by the account's passkey, one fingerprint (lib/proof.ts); inside the
 * ciphertext the account is named again, so a server can't move one person's
 * city to another.
 */

export type SharedCity = { account: Address; city: string; country: string; at: number };

const SALT = new TextEncoder().encode("nivpay-city-v1");

/** The pot's city key, from its link's fragment. Null for a pot opened with no link. */
export async function keyFromFragment(fragment: string): Promise<CryptoKey | null> {
  if (!fragment) return null;
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(fragment), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: new Uint8Array() }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** The city, encrypted: 12 bytes of IV, then the ciphertext. */
export async function seal(key: CryptoKey, c: SharedCity): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ a: getAddress(c.account), c: c.city, k: c.country, t: c.at }));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv);
  out.set(sealed, 12);
  return out;
}

/** The city inside, if it opens with this key and names `account`; else null. */
export async function open(key: CryptoKey, bytes: Uint8Array, account: Address): Promise<SharedCity | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    const v = JSON.parse(new TextDecoder().decode(plain)) as { a?: string; c?: unknown; k?: unknown; t?: unknown };
    if (typeof v.a !== "string" || !isAddressEqual(v.a as Address, account)) return null;
    if (typeof v.c !== "string" || !v.c || v.c.length > 80 || typeof v.k !== "string" || !/^[A-Z]{2}$/.test(v.k) || typeof v.t !== "number") return null;
    return { account: getAddress(account), city: v.c, country: v.k, at: v.t };
  } catch {
    return null;
  }
}

export type Sign = (message: string) => Promise<string>;
const potOf = (deployment: string, potId: string) => `${deployment}:${potId}`;

async function post(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/city", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`city refused: ${res.status}`);
}

/** Shares this account's city with one pot, proved with one fingerprint. */
export async function shareCity(account: Address, deployment: string, potId: string, sealed: Uint8Array, sign: Sign, now = Date.now()): Promise<void> {
  const time = Math.floor(now / 1000);
  const message = proofMessage({ subject: "city", action: "share", account, pot: potOf(deployment, potId), data: `sha256:${await sha256Hex(sealed)}`, time, site: location.host });
  await post({ action: "share", deployment, potId, account: getAddress(account), time, signature: await sign(message), data: toBase64(sealed) });
}

/** Removes this account's city from one pot. */
export async function removeCity(account: Address, deployment: string, potId: string, sign: Sign, now = Date.now()): Promise<void> {
  const time = Math.floor(now / 1000);
  const message = proofMessage({ subject: "city", action: "remove", account, pot: potOf(deployment, potId), data: "none", time, site: location.host });
  await post({ action: "remove", deployment, potId, account: getAddress(account), time, signature: await sign(message) });
}

/** Whether shared cities are set up, and the encrypted ones for this pot. */
export async function fetchCities(deployment: string, potId: string): Promise<{ enabled: boolean; entries: { account: Address; data: Uint8Array }[] }> {
  const res = await fetch(`/api/city?deployment=${encodeURIComponent(deployment)}&pot=${encodeURIComponent(potId)}`);
  if (!res.ok) return { enabled: false, entries: [] };
  const body = (await res.json()) as { enabled?: boolean; entries?: { account?: string; data?: string }[] };
  return {
    enabled: body.enabled === true,
    entries: (body.entries ?? []).flatMap((e) => (typeof e.account === "string" && /^0x[0-9a-fA-F]{40}$/.test(e.account) && typeof e.data === "string" ? [{ account: getAddress(e.account), data: fromBase64(e.data) }] : [])),
  };
}

/** Every city this pot's link can read: each opened, checked against its account, and the rest dropped. */
export async function readCities(key: CryptoKey, entries: { account: Address; data: Uint8Array }[]): Promise<Record<string, SharedCity>> {
  const out: Record<string, SharedCity> = {};
  for (const e of entries) {
    const c = await open(key, e.data, e.account);
    if (c) out[e.account.toLowerCase()] = c;
  }
  return out;
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;

/** Per account on this phone: pots it was offered a city for, and the city it shared in each. */
export class CityChoices {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string, account: Address) {
    this.kv = kv;
    this.key = `nivpay.citychoice.v1.${deployment}.${getAddress(account)}`;
  }

  private read(): Record<string, { asked: boolean; shared: { city: string; country: string } | null }> {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "{}") as unknown;
      return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, { asked: boolean; shared: { city: string; country: string } | null }>) : {};
    } catch {
      return {};
    }
  }

  get(potId: string) {
    return this.read()[potId] ?? { asked: false, shared: null };
  }

  set(potId: string, v: { asked: boolean; shared: { city: string; country: string } | null }): void {
    this.kv.setItem(this.key, JSON.stringify({ ...this.read(), [potId]: v }));
  }
}
