import { getAddress, type Address } from "viem";
import { proofMessage, sha256Hex, toBase64 } from "./proof.ts";

/**
 * Profile photos (api/photo). Made on the phone: the picture is read with
 * createImageBitmap, cropped to a square, drawn at 256 by 256 on a canvas and
 * saved as a JPEG of about 100 KB or less. Redrawing it also drops everything
 * hidden in the original file, such as where it was taken. Nothing but the
 * new JPEG leaves the phone, and only after the account's passkey proves it
 * (lib/proof.ts). The whole feature stays hidden until the server says photos
 * are set up.
 */

export const PHOTO_SIZE = 256;
export const MAX_PHOTO_BYTES = 100 * 1024;
/** JPEG qualities tried in turn until the photo is small enough. */
export const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25];

/** The largest centred square in a w by h picture. */
export function squareCrop(w: number, h: number): { sx: number; sy: number; size: number } {
  const size = Math.min(w, h);
  return { sx: Math.floor((w - size) / 2), sy: Math.floor((h - size) / 2), size };
}

/**
 * Up to two letters for someone with no photo: their name's first letters,
 * or for "account ending 7bC1" the end of the account.
 */
export function initialsFor(name: string, account: string): string {
  const words = name
    .normalize("NFC")
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  const looksLikeEnding = /\d/.test(name) && name.toLowerCase().includes(account.slice(-4).toLowerCase());
  if (!words.length || looksLikeEnding) return account.slice(-2).toUpperCase();
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : [words[0]!];
  return letters.map((w) => Array.from(w.replace(/^[^\p{L}]+/u, ""))[0] ?? "").join("").toUpperCase();
}

export const photoUrl = (account: Address, version = 0) => `/api/photo/${getAddress(account)}${version ? `?v=${version}` : ""}`;

let enabled: Promise<boolean> | null = null;
/** Whether photos are set up on this site. Asked once; false if the answer doesn't come. */
export function photosEnabled(): Promise<boolean> {
  enabled ??= fetch("/api/photo", { headers: { accept: "application/json" } })
    .then(async (r) => (r.ok ? ((await r.json()) as { enabled?: boolean }).enabled === true : false))
    .catch(() => false);
  return enabled;
}

/** Draws the picture as a 256 by 256 square on `canvas` and returns it as a small JPEG. Throws if it can't be read. */
export async function makePhoto(file: Blob, canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { sx, sy, size } = squareCrop(bitmap.width, bitmap.height);
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  } finally {
    bitmap.close();
  }
  for (const q of QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
    if (blob && blob.size <= MAX_PHOTO_BYTES) return new Uint8Array(await blob.arrayBuffer());
  }
  throw new Error("couldn't make it small enough");
}

type Sign = (message: string) => Promise<string>;

async function post(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/photo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`photo refused: ${res.status}`);
}

/** Saves `bytes` as this account's photo, proved by `sign` (one fingerprint). */
export async function uploadPhoto(account: Address, bytes: Uint8Array, sign: Sign, now = Date.now()): Promise<void> {
  const time = Math.floor(now / 1000);
  const message = proofMessage({ subject: "photo", action: "upload", account, data: `sha256:${await sha256Hex(bytes)}`, time, site: location.host });
  await post({ action: "upload", account: getAddress(account), time, signature: await sign(message), image: toBase64(bytes) });
}

/** Removes this account's photo, proved the same way. */
export async function removePhoto(account: Address, sign: Sign, now = Date.now()): Promise<void> {
  const time = Math.floor(now / 1000);
  const message = proofMessage({ subject: "photo", action: "remove", account, data: "none", time, site: location.host });
  await post({ action: "remove", account: getAddress(account), time, signature: await sign(message) });
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;
const REPORTED = "nivpay.reportedphotos.v1";

/** Photos this phone reported: shown as initials from then on. */
export class ReportedPhotos {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  all(): string[] {
    try {
      const raw = JSON.parse(this.kv.getItem(REPORTED) ?? "[]") as unknown;
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  has(account: string): boolean {
    return this.all().includes(account.toLowerCase());
  }

  add(account: string): void {
    this.kv.setItem(REPORTED, JSON.stringify([...new Set([...this.all(), account.toLowerCase()])]));
  }
}
