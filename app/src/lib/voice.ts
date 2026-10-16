import { getAddress, isAddress, isAddressEqual, type Address } from "viem";
import { cleanName } from "./accounts.ts";

/**
 * Voice commands (README, "Voice commands"), the parts with no browser in
 * them: turning one heard sentence into a command, matching the name in it,
 * and when voice may be used at all.
 *
 * Voice only fills in a screen. It understands exactly two things, in
 * English: sending dollars to a person, and putting dollars into a pot. It
 * can never change a setting or a limit, add or trust a contact, or say yes
 * to a pot's payment: there is no command for any of that, and anything else
 * is "I didn't catch that". The confirm sheet and a fingerprint still follow.
 */

/** Dollars have 6 decimals on both deployments. */
export const VOICE_DECIMALS = 6;
const UNIT = 10n ** BigInt(VOICE_DECIMALS);
/** The most one voice payment can be: $200. */
export const VOICE_CAP = 200n * UNIT;
/**
 * Final payments this phone has seen between this account and one person,
 * sent to them or received from them, before voice can pay that person.
 */
export const PAYMENTS_WITH_PERSON = 10;

export type VoiceCommand = { kind: "send"; amount: bigint; name: string } | { kind: "put"; amount: bigint; pot: string };

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/**
 * A number said in words, under a million: "fifty", "a hundred and fifty",
 * "two thousand five hundred", "twenty five". Null for anything that isn't
 * one number, such as "fifteen fifty" (1550 or 15.50?) or "five five".
 */
export function wordsToNumber(words: string[]): number | null {
  const unit = (w: string | undefined) => (w !== undefined && w in SMALL && SMALL[w]! >= 1 && SMALL[w]! <= 9 ? SMALL[w]! : null);
  const teen = (w: string | undefined) => (w !== undefined && w in SMALL && SMALL[w]! >= 10 ? SMALL[w]! : null);
  const tens = (w: string | undefined) => (w !== undefined && w in TENS ? TENS[w]! : null);
  const isNumberWord = (w: string | undefined) => unit(w) !== null || teen(w) !== null || tens(w) !== null;
  /** 1 to 999 from position i: [unit or "a"] "hundred" ["and"] then a teen, a tens [unit], or a unit. */
  const under1000 = (i: number): { value: number; next: number } | null => {
    let v = 0;
    const start = i;
    const h = words[i] === "a" || words[i] === "an" ? 1 : unit(words[i]);
    if (h !== null && words[i + 1] === "hundred") {
      v = h * 100;
      i += 2;
      if (words[i] === "and") {
        if (!isNumberWord(words[i + 1])) return null;
        i += 1;
      }
    }
    if (teen(words[i]) !== null) {
      v += teen(words[i])!;
      i += 1;
    } else if (tens(words[i]) !== null) {
      v += tens(words[i])!;
      i += 1;
      if (unit(words[i]) !== null) {
        v += unit(words[i])!;
        i += 1;
      }
    } else if (unit(words[i]) !== null) {
      v += unit(words[i])!;
      i += 1;
    }
    return i === start || v === 0 ? null : { value: v, next: i };
  };
  let total = 0;
  let i = 0;
  if ((words[0] === "a" || words[0] === "an") && words[1] === "thousand") {
    total = 1000;
    i = 2;
  } else {
    const first = under1000(0);
    if (!first) return null;
    i = first.next;
    if (words[i] === "thousand") {
      total = first.value * 1000;
      i += 1;
    } else {
      total = first.value;
    }
  }
  if (total >= 1000 && i < words.length) {
    if (words[i] === "and") {
      if (!isNumberWord(words[i + 1])) return null;
      i += 1;
    }
    const rest = under1000(i);
    if (!rest) return null;
    total += rest.value;
    i = rest.next;
  }
  return i === words.length && total > 0 && total < 1_000_000 ? total : null;
}

/** "100", "1,000", "12.50", "$100": base units, or null. More than 2 decimals, or a misplaced comma, is refused. */
function digitsToUnits(text: string): bigint | null {
  const t = text.replace(/^\$/, "");
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.replace(/,/g, "").split(".");
  const units = BigInt(whole!) * UNIT + BigInt((frac + "00").slice(0, 2)) * (UNIT / 100n);
  return units > 0n ? units : null;
}

/** The amount at the start of `words`, and how many words it took. */
function readAmount(words: string[]): { units: bigint; used: number } | null {
  if (!words.length) return null;
  const first = digitsToUnits(words[0]!);
  if (first !== null) return { units: first, used: 1 };
  // The longest run of number words that reads as one number.
  for (let n = Math.min(words.length, 12); n > 0; n--) {
    const v = wordsToNumber(words.slice(0, n));
    if (v !== null) return { units: BigInt(v) * UNIT, used: n };
  }
  return null;
}

const DOLLARS = new Set(["dollar", "dollars", "usd", "bucks", "buck"]);
const OTHER_MONEY = new Set(["euro", "euros", "pound", "pounds", "naira", "cent", "cents", "reais", "real", "peso", "pesos", "yen", "percent"]);

/**
 * One heard sentence, as a command, or null for anything else. English only.
 * "send 100 dollars to mum", "send 100 USD to Mum", "pay a hundred and fifty
 * dollars to Idara", "put 50 into Mama's 60th".
 */
export function parseVoice(heard: string): VoiceCommand | null {
  const words = heard
    .trim()
    .replace(/[.!?]+$/u, "")
    .replace(/(\d)\s*(?=dollars?\b|usd\b)/giu, "$1 ")
    .split(/\s+/u)
    .filter(Boolean);
  if (words.length < 3) return null;
  const verb = words[0]!.toLowerCase();
  const kind = verb === "send" || verb === "pay" ? "send" : verb === "put" || verb === "add" ? "put" : null;
  if (!kind) return null;
  let rest = words.slice(1);
  const lower = (i: number) => rest[i]?.toLowerCase() ?? "";
  const got = readAmount(rest.map((w, i) => (i < 13 ? w.toLowerCase() : w)));
  if (!got) return null;
  rest = rest.slice(got.used);
  if (DOLLARS.has(lower(0))) rest = rest.slice(1);
  else if (OTHER_MONEY.has(lower(0))) return null;
  const join = kind === "send" ? ["to"] : ["into", "in", "to"];
  if (!join.includes(lower(0))) return null;
  const target = rest.slice(1).join(" ").trim();
  // A name or pot, and nothing more: no second amount or command. A person's name has no digits;
  // a pot's may ("Mama's 60th").
  if (!target) return null;
  if (/\b(send|pay|put|add)\b/iu.test(target) || /\b(and|then|also|plus)\s+(\$?\d|a\b|an\b)/iu.test(target)) return null;
  if (kind === "send" && /\d/u.test(target)) return null;
  if (target.length > 60) return null;
  return kind === "send" ? { kind, amount: got.units, name: target } : { kind, amount: got.units, pot: target };
}

/** For matching what was heard against names: lower case, no accents, no "my", no possessive, no punctuation. */
export function spokenKey(text: string): string {
  return cleanName(text)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/gu, "'")
    .replace(/^(my|our)\s+/u, "")
    .replace(/'s\b/gu, "s")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Edits between two strings. */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * What a heard name could mean among `options`: every option whose name is
 * the same, or close (a letter or two off, by length). One exact match with
 * nothing else close is the answer; anything close to two is shown as both,
 * for the person to pick. Never matches outside `options`.
 */
export function matchName<T extends { name: string }>(heard: string, options: readonly T[]): T[] {
  const h = spokenKey(heard);
  if (!h) return [];
  const scored = options
    .map((o) => {
      const k = spokenKey(o.name);
      return { o, d: k ? editDistance(h, k) : Infinity, k };
    })
    .filter((x) => x.k && x.d <= Math.max(1, Math.floor(Math.max(h.length, x.k.length) / 4)));
  scored.sort((a, b) => a.d - b.d);
  return scored.map((x) => x.o);
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;

export type VoiceState = {
  on: boolean;
  /** The speech service has been explained and the person said go ahead. */
  explained: boolean;
  /** Contacts marked Trusted for voice. */
  trusted: Address[];
  /**
   * Final payments seen on this phone with each person, sent or received, by
   * their account, as ids (transaction and log); only the count matters, up
   * to PAYMENTS_WITH_PERSON each.
   */
  withPerson: Record<string, string[]>;
};

const FRESH: VoiceState = { on: false, explained: false, trusted: [], withPerson: {} };

/** Voice, per deployment and account, on this phone. */
export class VoiceStore {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string, account: Address) {
    if (!isAddress(account)) throw new Error("not an account");
    this.kv = kv;
    this.key = `nivpay.voice.v2.${deployment}.${getAddress(account)}`;
  }

  get(): VoiceState {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "null") as Partial<VoiceState> | null;
      if (!raw || typeof raw !== "object") return FRESH;
      const withPerson: Record<string, string[]> = {};
      if (raw.withPerson && typeof raw.withPerson === "object") {
        for (const [who, ids] of Object.entries(raw.withPerson)) {
          if (isAddress(who) && Array.isArray(ids)) withPerson[getAddress(who)] = (ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, PAYMENTS_WITH_PERSON);
        }
      }
      return {
        on: raw.on === true,
        explained: raw.explained === true,
        trusted: Array.isArray(raw.trusted) ? (raw.trusted as unknown[]).filter((a): a is string => typeof a === "string" && isAddress(a)).map((a) => getAddress(a)) : [],
        withPerson,
      };
    } catch {
      return FRESH;
    }
  }

  private set(s: VoiceState): void {
    try {
      this.kv.setItem(this.key, JSON.stringify(s));
    } catch {
      // Storage refused: voice stays as it was.
    }
  }

  /** A final payment with this person, sent or received, seen on this phone. Each id counts once. */
  sawWith(who: Address, id: string): void {
    if (!isAddress(who)) return;
    const s = this.get();
    const key = getAddress(who);
    const ids = s.withPerson[key] ?? [];
    if (ids.includes(id) || ids.length >= PAYMENTS_WITH_PERSON) return;
    this.set({ ...s, withPerson: { ...s.withPerson, [key]: [...ids, id] } });
  }

  /** Payments seen with this person so far, at most PAYMENTS_WITH_PERSON. */
  countWith(who: Address): number {
    return this.get().withPerson[getAddress(who)]?.length ?? 0;
  }

  setOn(on: boolean): void {
    this.set({ ...this.get(), on });
  }

  active(): boolean {
    return this.get().on;
  }

  explained(): void {
    this.set({ ...this.get(), explained: true });
  }

  isTrusted(who: Address): boolean {
    return this.get().trusted.some((a) => isAddressEqual(a, who));
  }

  setTrusted(who: Address, trusted: boolean): void {
    const s = this.get();
    const rest = s.trusted.filter((a) => !isAddressEqual(a, who));
    this.set({ ...s, trusted: trusted ? [...rest, getAddress(who)] : rest });
  }
}

/** Whether voice may pay this person: enough payments together, paid at least once, and marked Trusted for voice. */
export function voiceCanPay(s: VoiceState, who: Address, paid: readonly Address[]): boolean {
  const seen = s.withPerson[getAddress(who)]?.length ?? 0;
  return seen >= PAYMENTS_WITH_PERSON && paid.some((p) => isAddressEqual(p, who)) && s.trusted.some((t) => isAddressEqual(t, who));
}

/**
 * Who voice can pay: contacts marked Trusted for voice, that this phone has
 * paid before (the remembered pair: this name, this account), and with whom
 * it has seen PAYMENTS_WITH_PERSON final payments, sent or received.
 */
export function payableByVoice<T extends { account: Address; name: string }>(contacts: readonly T[], s: VoiceState, paid: readonly Address[]): T[] {
  return contacts.filter((c) => voiceCanPay(s, c.account, paid));
}

/** Whether an amount filled in by voice can be paid by voice. */
export const withinVoiceCap = (amount: bigint) => amount > 0n && amount <= VOICE_CAP;
