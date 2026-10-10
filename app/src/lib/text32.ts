import { bytesToHex, hexToBytes, type Hex } from "viem";
import { stripInvisible } from "./text.ts";

/**
 * The pot's name and each payee's name are stored on chain as bytes32: UTF-8,
 * at most 32 bytes, padded with zeros on the right. "Mama's 60th" with a
 * curly apostrophe is 13 bytes, so the limit is in bytes, not characters.
 */
export const TEXT32_BYTES = 32;

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Fits when it is not blank and its UTF-8 form is 32 bytes or fewer. */
export function fitsText32(text: string): boolean {
  return text.trim().length > 0 && utf8Length(text) <= TEXT32_BYTES;
}

export function toText32(text: string): Hex {
  if (!fitsText32(text)) throw new Error("name must be 1 to 32 bytes");
  const out = new Uint8Array(TEXT32_BYTES);
  out.set(new TextEncoder().encode(text));
  return bytesToHex(out);
}

/**
 * A bytes32 name as it is shown. Anyone can make a pot straight through the
 * contract, so the name may carry invisible characters; they are taken out.
 */
export function shownText32(value: Hex): string {
  return stripInvisible(fromText32(value));
}

/** Reads a bytes32 name back. Trailing zeros are padding; anything that isn't UTF-8 throws. */
export function fromText32(value: Hex): string {
  const bytes = hexToBytes(value);
  if (bytes.length !== TEXT32_BYTES) throw new Error("not a bytes32 value");
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
}
