import { getAddress, type Address } from "viem";

/**
 * The short message an account's passkey signs to prove a photo, a shared
 * city, a request to a person, a request key or a phone's notifications are
 * its own (api/photo, api/city, api/inbox, api/push), or a display name its
 * own (api/name). It names the account, what is being
 * done, a SHA-256 of the data ("none" for a removal), the time in seconds,
 * and the site, so a proof made here is no good anywhere else and goes stale
 * after 5 minutes. One fingerprint, nothing moves, nothing is written to the
 * chain.
 *
 * The servers keep copies of proofMessage (api/photo/index.ts,
 * api/city/index.ts); api-tests fail if any of them differs from this one.
 */
export type ProofFields = { subject: "photo" | "city" | "request" | "inbox" | "push" | "name" | "autocash"; action: string; account: Address; pot?: string; data: string; time: number; site: string };

export function proofMessage(f: ProofFields): string {
  return [
    `NivPay ${f.subject}`,
    `Action: ${f.action}`,
    `Account: ${getAddress(f.account)}`,
    ...(f.pot !== undefined ? [`Pot: ${f.pot}`] : []),
    `Data: ${f.data}`,
    `Time: ${f.time}`,
    `Site: ${f.site}`,
  ].join("\n");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
