import { getAddress, isAddress, isAddressEqual, recoverMessageAddress, type Address, type Hex } from "viem";
import { cleanName } from "./accounts.ts";
import { fromBase64, proofMessage, sha256Hex, toBase64 } from "./proof.ts";

/**
 * Payment requests sent straight to a person (README, "Requests to a
 * person"), sealed so only that person's phones can read them.
 *
 * Each phone that turns requests on makes its own key pair for the account
 * (ECDH P-256, in the browser's WebCrypto; the private half is made so it can
 * never leave the phone) and publishes the public half through /api/inbox,
 * proved by the account's passkey. A request is a small record, signed by
 * the requester's passkey (one fingerprint), then sealed to every published
 * key of the person asked: a fresh key pair for each request, ECDH with each
 * of theirs, HKDF, AES-GCM.
 *
 * The signature covers a short proof (proof.ts) naming the requester, the
 * person asked and a SHA-256 of the record. /api/inbox checks that proof and
 * keeps only the sealed bytes: it never sees the amount or the name, and
 * doesn't store who asked. The phone that opens a request checks the same
 * proof itself, and drops anything not addressed to it or not signed by who
 * it says.
 */

export type PersonRequest = {
  v: 1;
  deployment: string;
  from: Address;
  to: Address;
  /** The requester's name, as they go by. Cleaned again when read. */
  name: string;
  /** Base units of the dollar, as a decimal string. "0" lets the payer choose. */
  amount: string;
  /** When it was made, in milliseconds. */
  at: number;
  /** Random, so two requests for the same amount differ. */
  nonce: string;
};

/** Requests older than this are not shown. */
export const REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SALT = new TextEncoder().encode("nivpay-request-v1");

/** The record as signed and sealed: fixed key order, so its SHA-256 is the same everywhere. */
export function canonical(r: PersonRequest): string {
  return JSON.stringify({ v: r.v, deployment: r.deployment, from: getAddress(r.from), to: getAddress(r.to), name: r.name, amount: r.amount, at: r.at, nonce: r.nonce });
}

export const requestDigest = async (r: PersonRequest) => sha256Hex(new TextEncoder().encode(canonical(r)));

/** What the requester's passkey signs, and /api/inbox and the person asked both check. */
export function requestProof(r: PersonRequest, digest: string, site: string): string {
  return proofMessage({ subject: "request", action: "send", account: r.from, data: `to:${getAddress(r.to)};sha256:${digest}`, time: Math.floor(r.at / 1000), site });
}

/** A key's id: the start of the SHA-256 of its raw bytes. */
export const keyId = async (raw: Uint8Array) => (await sha256Hex(raw)).slice(0, 16);

/** A new key pair for this phone. The private half can't be exported. */
export async function newInboxKey(): Promise<{ privateKey: CryptoKey; raw: Uint8Array }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, raw };
}

async function aesKey(mine: CryptoKey, theirs: Uint8Array, id: string, use: KeyUsage): Promise<CryptoKey> {
  const pub = await crypto.subtle.importKey("raw", theirs as Uint8Array<ArrayBuffer>, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await crypto.subtle.deriveKey({ name: "ECDH", public: pub }, mine, { name: "HKDF" }, false, ["deriveKey"]).catch(async () => {
    // Some engines won't derive HKDF straight from ECDH: take the raw bits instead.
    const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, mine, 256);
    return crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  });
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: new TextEncoder().encode(id) }, shared, { name: "AES-GCM", length: 256 }, false, [use]);
}

type Sealed = { v: 1; eph: string; items: { k: string; iv: string; ct: string }[] };

/** The record and its signature, sealed to each of the person's keys. */
export async function sealRequest(r: PersonRequest, signature: Hex, keys: { id: string; raw: Uint8Array }[]): Promise<Uint8Array> {
  const eph = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"])) as CryptoKeyPair;
  const ephRaw = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const plain = new TextEncoder().encode(JSON.stringify({ r: canonical(r), s: signature }));
  const items = [];
  for (const k of keys) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await aesKey(eph.privateKey, k.raw, k.id, "encrypt");
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
    items.push({ k: k.id, iv: toBase64(iv), ct: toBase64(ct) });
  }
  const sealed: Sealed = { v: 1, eph: toBase64(ephRaw), items };
  return new TextEncoder().encode(JSON.stringify(sealed));
}

/**
 * Opens a sealed request with this phone's key, and checks it: signed by its
 * requester, for `me`, on this deployment, not too old, for an amount that
 * reads. Null for anything else.
 */
export async function openRequest(
  bytes: Uint8Array,
  mine: { id: string; privateKey: CryptoKey },
  me: Address,
  deployment: string,
  site: string,
  now: number,
): Promise<{ request: PersonRequest; digest: string } | null> {
  try {
    const sealed = JSON.parse(new TextDecoder().decode(bytes)) as Sealed;
    const item = sealed.items?.find((i) => i.k === mine.id);
    if (!item || typeof sealed.eph !== "string") return null;
    const key = await aesKey(mine.privateKey, fromBase64(sealed.eph), mine.id, "decrypt");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(item.iv) as Uint8Array<ArrayBuffer> }, key, fromBase64(item.ct) as Uint8Array<ArrayBuffer>);
    const { r, s } = JSON.parse(new TextDecoder().decode(plain)) as { r: string; s: Hex };
    const raw = JSON.parse(r) as PersonRequest;
    if (raw.v !== 1 || raw.deployment !== deployment || !isAddress(raw.from) || !isAddress(raw.to) || !isAddressEqual(raw.to, me) || isAddressEqual(raw.from, me)) return null;
    if (typeof raw.amount !== "string" || !/^\d{1,30}$/.test(raw.amount) || typeof raw.at !== "number" || typeof raw.nonce !== "string" || typeof raw.name !== "string") return null;
    if (raw.at > now + 5 * 60_000 || now - raw.at > REQUEST_TTL_MS) return null;
    const request: PersonRequest = { ...raw, from: getAddress(raw.from), to: getAddress(raw.to), name: cleanName(raw.name) };
    // The record must be exactly what was signed.
    if (canonical(raw) !== r) return null;
    const digest = await requestDigest(raw);
    const signer = await recoverMessageAddress({ message: requestProof(raw, digest, site), signature: s });
    return isAddressEqual(signer, request.from) ? { request, digest } : null;
  } catch {
    return null;
  }
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;

/** Accounts whose requests this account has muted, on this phone. */
export class MutedStore {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string, account: Address) {
    this.kv = kv;
    this.key = `nivpay.muted.v1.${deployment}.${getAddress(account)}`;
  }

  list(): Address[] {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "[]") as unknown;
      return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string" && isAddress(a)).map((a) => getAddress(a)) : [];
    } catch {
      return [];
    }
  }

  has(who: Address): boolean {
    return this.list().some((a) => isAddressEqual(a, who));
  }

  mute(who: Address): void {
    if (!this.has(who)) this.kv.setItem(this.key, JSON.stringify([...this.list(), getAddress(who)]));
  }

  unmute(who: Address): void {
    this.kv.setItem(this.key, JSON.stringify(this.list().filter((a) => !isAddressEqual(a, who))));
  }
}
