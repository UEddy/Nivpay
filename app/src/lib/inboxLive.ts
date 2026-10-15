import { getAddress, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { AppError } from "./errors.ts";
import { idbInboxKeys } from "./idb.ts";
import { keyId, newInboxKey, openRequest, requestDigest, requestProof, sealRequest, type PersonRequest } from "./inbox.ts";
import { fromBase64, proofMessage, sha256Hex, toBase64 } from "./proof.ts";

/**
 * Requests to a person, on this phone, through /api/inbox (lib/inbox.ts has
 * the rules). Every signature here is one fingerprint and moves no money.
 */

export type Sign = (message: string) => Promise<Hex>;

/** Whether requests to a person are set up on this site, asked once per page. */
let enabledOnce: Promise<boolean> | null = null;
export function inboxEnabled(probe: Address): Promise<boolean> {
  enabledOnce ??= fetch(`/api/inbox?account=${getAddress(probe)}&what=keys`)
    .then(async (r) => r.ok && ((await r.json()) as { enabled?: boolean }).enabled === true)
    .catch(() => false);
  return enabledOnce;
}

async function post(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`inbox refused: ${res.status}`);
}

/** Whether this phone can open requests sent to this account. */
export async function requestsOnHere(account: Address): Promise<boolean> {
  return Boolean(await idbInboxKeys.get(account).catch(() => undefined));
}

/** Makes this phone's key and publishes it, proved by the account's passkey. */
export async function turnOnRequests(account: Address, sign: Sign, now = Date.now()): Promise<void> {
  const k = await newInboxKey();
  const time = Math.floor(now / 1000);
  const message = proofMessage({ subject: "inbox", action: "key", account, data: `sha256:${await sha256Hex(k.raw)}`, time, site: location.host });
  // A cancelled fingerprint says so itself (errors.ts); only what follows is "couldn't turn on".
  const signature = await sign(message);
  try {
    await post({ action: "key", account: getAddress(account), time, signature, key: toBase64(k.raw) });
    await idbInboxKeys.put({ account, id: await keyId(k.raw), raw: k.raw, privateKey: k.privateKey });
  } catch {
    throw new AppError(copy.errRequestsTurnOn, ERROR_CODES.REQUESTS_TURN_ON_FAILED);
  }
}

/** Takes this phone's key back, and forgets it here. */
export async function turnOffRequests(account: Address, sign: Sign, now = Date.now()): Promise<void> {
  const mine = await idbInboxKeys.get(account);
  if (!mine) return;
  const time = Math.floor(now / 1000);
  const signature = await sign(proofMessage({ subject: "inbox", action: "unkey", account, data: `key:${mine.id}`, time, site: location.host }));
  try {
    await post({ action: "unkey", account: getAddress(account), time, signature, keyId: mine.id });
  } catch {
    throw new AppError(copy.errRequestsTurnOn, ERROR_CODES.REQUESTS_TURN_ON_FAILED);
  }
  await idbInboxKeys.delete(account);
}

/** What /api/notify needs to tell the person asked, without the amount or the name. */
export type SentRequest = { from: Address; to: Address; time: number; signature: Hex; digest: string };

/** Signs a request with the requester's passkey and leaves it, sealed, for the person asked. */
export async function sendPersonRequest(
  r: Omit<PersonRequest, "v" | "at" | "nonce">,
  sign: Sign,
  now = Date.now(),
): Promise<SentRequest> {
  const res = await fetch(`/api/inbox?account=${getAddress(r.to)}&what=keys`).catch(() => null);
  const keys = res?.ok ? (((await res.json()) as { keys?: { id: string; key: string }[] }).keys ?? []) : null;
  if (keys === null) throw new AppError(copy.errRequestSend, ERROR_CODES.REQUEST_SEND_FAILED);
  if (!keys.length) throw new AppError(copy.errRequestsNotOn, ERROR_CODES.REQUESTS_NOT_ON);
  const request: PersonRequest = { v: 1, ...r, from: getAddress(r.from), to: getAddress(r.to), at: now, nonce: toBase64(crypto.getRandomValues(new Uint8Array(12))) };
  const digest = await requestDigest(request);
  const signature = await sign(requestProof(request, digest, location.host));
  try {
    const sealed = await sealRequest(request, signature, keys.map((k) => ({ id: k.id, raw: fromBase64(k.key) })));
    const time = Math.floor(now / 1000);
    await post({ action: "send", from: request.from, to: request.to, time, signature, digest, data: toBase64(sealed) });
    return { from: request.from, to: request.to, time, signature, digest };
  } catch {
    throw new AppError(copy.errRequestSend, ERROR_CODES.REQUEST_SEND_FAILED);
  }
}

/** Requests waiting for this account that this phone can open, each checked (inbox.ts openRequest). */
export async function readInbox(account: Address, deployment: string, now = Date.now()): Promise<{ request: PersonRequest; digest: string }[]> {
  const mine = await idbInboxKeys.get(account).catch(() => undefined);
  if (!mine) return [];
  const res = await fetch(`/api/inbox?account=${getAddress(account)}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { entries?: { data?: string }[] };
  const out: { request: PersonRequest; digest: string }[] = [];
  for (const e of body.entries ?? []) {
    if (typeof e.data !== "string") continue;
    const got = await openRequest(fromBase64(e.data), { id: mine.id, privateKey: mine.privateKey }, account, deployment, location.host, now);
    if (got) out.push(got);
  }
  return out;
}

/** This phone's request key for an account is forgotten with it (lib/forget.ts). */
export const forgetInboxKey = (account: Address) => idbInboxKeys.delete(account).catch(() => {});
