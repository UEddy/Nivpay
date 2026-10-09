/**
 * Invite, reply and request links get pasted into WhatsApp and other chats,
 * so no raw 0x string may ever appear in one. Everything a link carries is
 * packed as binary and written in the `#` fragment as lowercase RFC 4648
 * base32 without padding. That alphabet (a to z, 2 to 7) has no digit 0, so
 * "0x" cannot appear even by chance, and lowercase can't spell MON.
 */
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

/** Lowercase RFC 4648 base32, no padding. */
export function toBase32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** Reverses toBase32. Throws on any character outside the alphabet or on stray bits. */
export function fromBase32(text: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of text) {
    const v = LOOKUP.get(c);
    if (v === undefined) throw new Error("link is damaged");
    buffer = (buffer << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  }
  // Leftover bits must be padding zeros and fewer than a whole character.
  if (bits >= 5 || buffer !== 0) throw new Error("link is damaged");
  return Uint8Array.from(out);
}

/** Builds a link payload field by field. Accounts and signatures go in as bytes, never as hex text. */
export class LinkWriter {
  private parts: number[] = [];

  /** Unsigned integer as a LEB128 varint (versions, roles, block numbers). */
  uint(value: bigint | number): this {
    let v = BigInt(value);
    if (v < 0n) throw new Error("negative value in link");
    do {
      let byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v > 0n) byte |= 0x80;
      this.parts.push(byte);
    } while (v > 0n);
    return this;
  }

  /** Length-prefixed raw bytes. */
  bytes(value: Uint8Array): this {
    this.uint(value.length);
    this.parts.push(...value);
    return this;
  }

  /** A 20-byte account, stored without a length prefix. */
  account(value: Address): this {
    const b = hexToBytes(value);
    if (b.length !== 20) throw new Error("account must be 20 bytes");
    this.parts.push(...b);
    return this;
  }

  /** Hex data such as a signature or draft id, stored as length-prefixed bytes. */
  hex(value: Hex): this {
    return this.bytes(hexToBytes(value));
  }

  /** UTF-8 text such as a name or label. */
  text(value: string): this {
    return this.bytes(new TextEncoder().encode(value));
  }

  /** The finished payload, ready for the `#` fragment. */
  toFragment(): string {
    return toBase32(Uint8Array.from(this.parts));
  }
}

/** Reads a payload back in the same order it was written. */
export class LinkReader {
  private at = 0;
  private readonly data: Uint8Array;

  constructor(fragment: string) {
    this.data = fromBase32(fragment.replace(/^#/, ""));
  }

  private take(n: number): Uint8Array {
    if (this.at + n > this.data.length) throw new Error("link is damaged");
    const out = this.data.slice(this.at, this.at + n);
    this.at += n;
    return out;
  }

  uint(): bigint {
    let value = 0n;
    let shift = 0n;
    for (;;) {
      const [byte] = this.take(1);
      value |= BigInt(byte! & 0x7f) << shift;
      if ((byte! & 0x80) === 0) return value;
      shift += 7n;
      if (shift > 256n) throw new Error("link is damaged");
    }
  }

  bytes(): Uint8Array {
    const n = this.uint();
    if (n > BigInt(this.data.length)) throw new Error("link is damaged");
    return this.take(Number(n));
  }

  account(): Address {
    return bytesToHex(this.take(20)) as Address;
  }

  hex(): Hex {
    return bytesToHex(this.bytes());
  }

  text(): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes());
  }

  /** Throws if anything is left over, so a truncated or padded link is never half read. */
  end(): void {
    if (this.at !== this.data.length) throw new Error("link is damaged");
  }
}
