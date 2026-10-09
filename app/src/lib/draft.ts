import { bytesToHex, getAddress, isAddress, isAddressEqual, zeroAddress, type Address, type Hex } from "viem";
import { fitsText32, toText32 } from "./text32.ts";

/**
 * A pot being put together on the creator's phone (invite case B in
 * docs/APP-CONTRACT-MAP.md). Every decider's and every payee's account must be
 * known before createPot, and none of it can change afterwards, so the draft
 * collects them first: deciders and payees open a join link and send back a
 * signed reply, or a payee's Account ID is pasted and confirmed.
 *
 * Only display data and public accounts live here. Nothing secret.
 */

/** A person in the pot. Name, city and time zone are labels, never on chain. */
export type Person = {
  account: Address;
  name: string;
  city: string;
  /** IANA zone, such as "Europe/London". Times are shown in it with Intl. */
  timeZone: string;
};

/** Somewhere the pot may pay. Its name and limit go on chain. */
export type Payee = {
  /** Random id that ties a join reply to this slot. */
  slot: Hex;
  name: string;
  /** Limit in base units, as a decimal string so the draft survives JSON. */
  cap: string;
  account?: Address;
  /** How the account was learned: a signed reply, or pasted and confirmed. */
  via?: "reply" | "pasted";
  /** Suggested share in base units, optional. "0" or missing means none. */
  share?: string;
};

/**
 * A suggested share: where a person's stepper starts when they chip in. It
 * is a suggestion, signed with the names; the contract takes any amount.
 */
export type Share = { account: Address; amount: bigint };

/** The signed transaction that makes the pot, kept until it is final. */
/**
 * The pot's transaction while it is in flight. The labels are signed over a
 * transaction's hash, so each signed attempt (the first send, and each retry
 * of a stuck one, on the same nonce) keeps its own signature. Whichever
 * attempt lands, its names are here, even if a later retry was signed but
 * never sent.
 */
export type Sending = {
  /** The labels exactly as signed. The same for every attempt. */
  people: Person[];
  /** The suggested shares exactly as signed, amounts as decimal strings. */
  shares: { account: Address; amount: string }[];
  attempts: Attempt[];
};

export type Attempt = { hash: Hex; labelsSignature: Hex };

/** What older versions of the app stored: one attempt, inline. */
type LegacySending = { hash: Hex; labelsSignature: Hex; people: Person[]; shares?: Sending["shares"] };

/** Reads a stored Sending in either shape. */
export function normalizeSending(stored: Sending | LegacySending): Sending {
  if ("attempts" in stored) return stored;
  return {
    people: stored.people,
    shares: stored.shares ?? [],
    attempts: [{ hash: stored.hash, labelsSignature: stored.labelsSignature }],
  };
}

/** Records one more signed attempt. Called before it is broadcast. */
export function withAttempt(
  current: Sending | LegacySending | undefined,
  people: Person[],
  shares: Sending["shares"],
  attempt: Attempt,
): Sending {
  const before = current ? normalizeSending(current).attempts.filter((a) => a.hash !== attempt.hash) : [];
  return { people, shares, attempts: [...before, attempt] };
}

/** The signature over the labels for the transaction that actually made the pot, if this phone signed one. */
export function labelsFor(sending: Sending | LegacySending, hash: Hex): Hex | undefined {
  return normalizeSending(sending).attempts.find((a) => a.hash.toLowerCase() === hash.toLowerCase())?.labelsSignature;
}

export type Made = {
  potId: string;
  /** The block the pot was made in, so its story starts there. */
  block: string;
  /** The `#` fragment of the pot's link, to share again any time. Empty while the names still need signing. */
  fragment: string;
  /**
   * Set only if the transaction that landed has no signed names on this
   * phone. The creator signs them again, over this hash, before sharing.
   */
  unsigned?: { createdIn: Hex; people: Person[]; shares: Sending["shares"] };
};

export type Draft = {
  id: Hex;
  owner: Address;
  name: string;
  me: { city: string; timeZone: string };
  /** The other deciders. The creator always decides too, and comes first. */
  deciders: Person[];
  threshold: number;
  /** Suggested shares for the deciders, the creator included, by lowercase account. */
  shares?: Record<string, string>;
  payees: Payee[];
  /** The closing day as yyyy-mm-dd, in the creator's own time zone. */
  closes: string;
  sending?: Sending | LegacySending;
  made?: Made;
  createdAt: number;
};

export function newDraft(owner: Address, timeZone: string, now: number, random: (n: number) => Uint8Array): Draft {
  return {
    id: bytesToHex(random(16)),
    owner,
    name: "",
    me: { city: "", timeZone },
    deciders: [],
    threshold: 1,
    payees: [],
    closes: "",
    createdAt: now,
  };
}

export function newSlot(random: (n: number) => Uint8Array): Hex {
  return bytesToHex(random(8));
}

/** The default rule: a majority of the deciders. 2 of 3, 3 of 4, 1 of 1. */
export function majority(deciders: number): number {
  return Math.floor(deciders / 2) + 1;
}

/** Everyone who decides, the creator first. */
export function allDeciders(draft: Draft, myName: string): Person[] {
  return [{ account: draft.owner, name: myName, city: draft.me.city, timeZone: draft.me.timeZone }, ...draft.deciders];
}

/**
 * Adds or updates a decider from a verified reply. The creator can't be added
 * twice, and the threshold follows a majority until someone changes it.
 */
export function withDecider(draft: Draft, person: Person): Draft {
  if (isAddressEqual(person.account, draft.owner)) return draft;
  const others = draft.deciders.filter((d) => !isAddressEqual(d.account, person.account));
  const before = draft.deciders.length + 1;
  const deciders = [...others, person];
  const threshold = draft.threshold === majority(before) ? majority(deciders.length + 1) : draft.threshold;
  return { ...draft, deciders, threshold: Math.min(threshold, deciders.length + 1) };
}

export function withoutDecider(draft: Draft, account: Address): Draft {
  const deciders = draft.deciders.filter((d) => !isAddressEqual(d.account, account));
  const { [account.toLowerCase()]: _dropped, ...shares } = draft.shares ?? {};
  const wasMajority = draft.threshold === majority(draft.deciders.length + 1);
  const threshold = wasMajority ? majority(deciders.length + 1) : Math.min(draft.threshold, deciders.length + 1);
  return { ...draft, deciders, threshold, shares };
}

/** Sets or clears a decider's suggested share. Zero clears it. */
export function withDeciderShare(draft: Draft, account: Address, amount: bigint): Draft {
  const { [account.toLowerCase()]: _old, ...rest } = draft.shares ?? {};
  return { ...draft, shares: amount > 0n ? { ...rest, [account.toLowerCase()]: amount.toString() } : rest };
}

/** Sets or clears a payee's suggested share. Zero clears it. */
export function withPayeeShare(draft: Draft, slot: Hex, amount: bigint): Draft {
  return {
    ...draft,
    payees: draft.payees.map((p) => (p.slot === slot ? { ...p, share: amount > 0n ? amount.toString() : undefined } : p)),
  };
}

export function deciderShare(draft: Draft, account: Address): bigint {
  return BigInt(draft.shares?.[account.toLowerCase()] ?? "0");
}

/**
 * The suggested shares that get signed with the names: every decider and
 * every payee with an account and a share above zero, deciders first, each
 * account once. A decider who is also a payee keeps the decider's share.
 */
export function signedShares(draft: Draft): Share[] {
  const out: Share[] = [];
  const seen = new Set<string>();
  const add = (account: Address, amount: bigint) => {
    if (amount <= 0n || seen.has(account.toLowerCase())) return;
    seen.add(account.toLowerCase());
    out.push({ account: getAddress(account), amount });
  };
  for (const a of [draft.owner, ...draft.deciders.map((d) => d.account)]) add(a, deciderShare(draft, a));
  for (const p of draft.payees) if (p.account) add(p.account, BigInt(p.share ?? "0"));
  return out;
}

/** Fills a payee slot with an account, from a verified reply or a confirmed paste. */
export function withPayeeAccount(draft: Draft, slot: Hex, account: Address, via: "reply" | "pasted"): Draft {
  return {
    ...draft,
    payees: draft.payees.map((p) => (p.slot === slot ? { ...p, account: getAddress(account), via } : p)),
  };
}

/**
 * A pasted Account ID must be a valid account. If it is written in mixed
 * case, its checksum must be right: viem's isAddress checks that.
 */
export function parseAccountId(text: string): Address | null {
  const t = text.trim();
  if (!isAddress(t, { strict: true })) return null;
  return getAddress(t);
}

/** Payees are fixed forever, so a pasted Account ID is confirmed by typing its last 4 characters. */
export function confirmsAccount(account: Address, typed: string): boolean {
  return typed.trim().length === 4 && account.slice(-4).toLowerCase() === typed.trim().toLowerCase();
}

/**
 * When the pot closes: the end of the chosen day in the creator's time zone,
 * which is the first second of the next day there.
 */
export function endTimeFor(closes: string, timeZone: string): bigint | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(closes);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null;
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  // Midnight starting the next day, in timeZone: guess UTC, then correct by
  // the zone's offset at that moment (twice, for days that change offset).
  let guess = next.getTime();
  for (let i = 0; i < 2; i++) guess = next.getTime() - offsetMs(guess, timeZone);
  return BigInt(Math.floor(guess / 1000));
}

function offsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at / 1000) * 1000;
}

export type Limits = { maxDeciders: number; maxPayees: number };

/** What is still missing before the pot can be made, in the order the screen shows them. */
export type Missing = "name" | "city" | "deciders" | "payees" | "payee-account" | "closes" | "closes-past";

export type CreateArgs = readonly [Hex, readonly Address[], number, readonly Address[], readonly Hex[], readonly bigint[], bigint];

/**
 * Checks the draft against the same rules createPot enforces, so a refusal is
 * caught on the phone and costs nothing. Returns the call's arguments when
 * nothing is missing.
 */
export function checkDraft(
  draft: Draft,
  limits: Limits,
  nowSeconds: bigint,
  pots: Address,
): { missing: Missing[]; args?: CreateArgs } {
  const missing: Missing[] = [];
  if (!fitsText32(draft.name)) missing.push("name");
  if (!draft.me.city.trim()) missing.push("city");

  const deciders = [draft.owner, ...draft.deciders.map((d) => d.account)];
  const unique = new Set(deciders.map((a) => a.toLowerCase())).size === deciders.length;
  if (deciders.length > limits.maxDeciders || !unique || draft.threshold < 1 || draft.threshold > deciders.length) {
    missing.push("deciders");
  }

  const payeesOk =
    draft.payees.length >= 1 &&
    draft.payees.length <= limits.maxPayees &&
    draft.payees.every((p) => fitsText32(p.name) && BigInt(p.cap || "0") > 0n);
  if (!payeesOk) missing.push("payees");
  else if (
    draft.payees.some((p) => !p.account || isAddressEqual(p.account, zeroAddress) || isAddressEqual(p.account, pots))
  ) {
    missing.push("payee-account");
  }

  const end = endTimeFor(draft.closes, draft.me.timeZone);
  // A margin, so a pot is never made to close before its own transaction lands.
  if (end === null) missing.push("closes");
  else if (end <= nowSeconds + 600n) missing.push("closes-past");

  if (missing.length > 0) return { missing };
  return {
    missing,
    args: [
      toText32(draft.name),
      deciders,
      draft.threshold,
      draft.payees.map((p) => p.account!),
      draft.payees.map((p) => toText32(p.name)),
      draft.payees.map((p) => BigInt(p.cap)),
      end!,
    ] as const,
  };
}

/**
 * Drafts live in localStorage, keyed by the creator's account. A reply link
 * can be opened under any account on the phone, so lookups by draft id search
 * them all.
 */
type KeyValue = Pick<Storage, "getItem" | "setItem">;
const DRAFTS = "nivpay.drafts.v1";

export class DraftStore {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  all(): Draft[] {
    try {
      const raw = JSON.parse(this.kv.getItem(DRAFTS) ?? "[]") as unknown;
      return Array.isArray(raw) ? (raw as Draft[]).filter((d) => typeof d?.id === "string" && isAddress(d.owner)) : [];
    } catch {
      return [];
    }
  }

  forOwner(owner: Address): Draft[] {
    return this.all()
      .filter((d) => isAddressEqual(d.owner, owner))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: Hex): Draft | undefined {
    return this.all().find((d) => d.id === id);
  }

  put(draft: Draft): void {
    const others = this.all().filter((d) => d.id !== draft.id);
    this.kv.setItem(DRAFTS, JSON.stringify([...others, draft]));
  }

  delete(id: Hex): void {
    this.kv.setItem(DRAFTS, JSON.stringify(this.all().filter((d) => d.id !== id)));
  }
}
