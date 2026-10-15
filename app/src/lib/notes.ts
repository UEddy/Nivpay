import { getAddress, isAddress, type Address } from "viem";
import type { FoundPot } from "./discover.ts";
import type { Spend } from "./limits.ts";
import type { EndedRequest, OpenRequest } from "./waiting.ts";

/**
 * In-app notifications, built only from what Home already reads at the
 * finalized block: the pots found for this account (discover.ts), the
 * requests waiting for its yes (waiting.ts), its own pours and the daily
 * limit (limits.ts), payments coming in, money put into its own pots by the
 * people in them (fundings.ts), and its own payments once final (Send). They
 * appear while the app is open, and the list starts from when this phone
 * first ran the feature.
 *
 * Each note has an id that says what it is about, so the same thing is never
 * said twice. Read and unread are kept per account on this phone.
 */

export type NoteKind =
  | "received"
  | "chippedIn"
  | "askYes"
  | "askClose"
  | "paidOut"
  | "closingSoon"
  | "closedShare"
  | "limitRaised"
  | "sent"
  | "potNamesYou"
  | "memberChippedIn"
  | "request";

export type Note = {
  id: string;
  kind: NoteKind;
  at: number;
  read: boolean;
  potId?: string;
  /** The pot's name as the chain has it, when the note was made. */
  name?: string;
  proposalId?: string;
  /** Base units, as a decimal string, with the decimals and symbol to show it by. */
  amount?: string;
  decimals?: number;
  symbol?: string;
  from?: Address;
  /** Who a payment went to (sent). */
  to?: Address;
  /** The name they were paid under, cleaned, when the payment was made (sent). */
  toName?: string;
  /** The name a requester signed their request with, cleaned (request). */
  fromName?: string;
};

export type NotesState = {
  /** When this phone first ran notifications for this account. Null until then. */
  startedAt: number | null;
  /** The finalized block then, where reading payments in starts. */
  startBlock: string | null;
  /** Each pot's total when last seen, by pot number. */
  totals: Record<string, string>;
  /** Requests already noted as waiting for a yes. */
  asked: string[];
  /** This account's own pours already taken off a pot's rise. */
  poursSeen: string[];
  /** Pots already looked at for "a pot names you". Null until the first poll, which looks at all and says nothing. */
  potsSeen: string[] | null;
  /** Money put in by people in this account's own pots, already noted (fundings.ts ids). */
  fundsSeen: string[];
  /** Requests ignored, by note id, so they don't come back from the inbox. */
  dismissed: string[];
  notes: Note[];
};

export const EMPTY_NOTES: NotesState = { startedAt: null, startBlock: null, totals: {}, asked: [], poursSeen: [], potsSeen: null, fundsSeen: [], dismissed: [], notes: [] };

/** Money put into one of this account's own pots by someone in it, from its Funded event (fundings.ts). */
export type Funding = { id: string; potId: string; from: Address; amount: string };

/** The most notes kept, newest first. */
export const MAX_NOTES = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const DOLLAR_DECIMALS = 6;

export type PollInputs = {
  now: number;
  found: FoundPot[];
  /** Requests waiting for this account's yes, on pots that are its own (not new to it, not hidden). */
  waiting: OpenRequest[];
  /** Requests that ended since the poll before. */
  ended: EndedRequest[];
  /** This account's pours (lib/limits.ts spends of kind "pour"). */
  pours: Spend[];
  /** The last raise of the daily limit that took effect. */
  raised: { limit: string; at: number } | null;
  /** This account. */
  me?: Address;
  /** Who made each pot, by pot number, once known (potSort.ts). */
  makers?: Record<string, Address>;
  /** Contacts and the accounts on this phone: only a pot one of them made is announced. */
  trusted?: readonly Address[];
  /** Money put into this account's own pots by the people in them, read up to the same block as `found`. */
  fundings?: Funding[];
};

/** The most pot numbers and funding ids remembered. */
const MAX_SEEN = 500;
const sameAccount = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();

function add(s: NotesState, fresh: Note[]): NotesState {
  if (!fresh.length) return s;
  const known = new Set(s.notes.map((n) => n.id));
  const notes = [...fresh.filter((n) => !known.has(n.id)), ...s.notes].sort((a, b) => b.at - a.at).slice(0, MAX_NOTES);
  return { ...s, notes };
}

/** The first run on this phone: remember where things stand, say nothing. */
export function start(s: NotesState, now: number, block: bigint): NotesState {
  return s.startedAt === null ? { ...s, startedAt: now, startBlock: block.toString() } : s;
}

/** One poll of Home's reads, turned into notes. */
export function fromPoll(s: NotesState, i: PollInputs): NotesState {
  if (s.startedAt === null) return s;
  const fresh: Note[] = [];
  const names = Object.fromEntries(i.found.map((p) => [p.potId, p.name]));
  // Pots missing from one poll (still loading, or hidden for now) keep the total last seen.
  const totals: Record<string, string> = { ...s.totals };
  const poursSeen = new Set(s.poursSeen);
  // Money put in by the people in this account's own pots: named, and taken off the anonymous rise.
  const fundsSeen = new Set(s.fundsSeen);
  const named: Record<string, bigint> = {};
  for (const f of i.fundings ?? []) {
    if (fundsSeen.has(f.id)) continue;
    fundsSeen.add(f.id);
    named[f.potId] = (named[f.potId] ?? 0n) + BigInt(f.amount);
    fresh.push({ id: `fund:${f.id}`, kind: "memberChippedIn", at: i.now, read: false, potId: f.potId, from: f.from, amount: f.amount, decimals: DOLLAR_DECIMALS });
  }
  for (const p of i.found) {
    totals[p.potId] = p.totalAssets;
    const before = s.totals[p.potId];
    if (before !== undefined) {
      const rise = BigInt(p.totalAssets) - BigInt(before);
      if (rise > 0n) {
        // Take this account's own pours off the rise: chipping in yourself is not news.
        const mine = i.pours.filter((x) => x.final && x.potId === p.potId && !poursSeen.has(x.id));
        const own = mine.reduce((sum, x) => sum + BigInt(x.amount), 0n) + (named[p.potId] ?? 0n);
        mine.forEach((x) => poursSeen.add(x.id));
        if (rise > own) fresh.push({ id: `in:${p.potId}:${p.totalAssets}`, kind: "chippedIn", at: i.now, read: false, potId: p.potId, amount: (rise - own).toString(), decimals: DOLLAR_DECIMALS });
      }
    }
    const ends = Number(p.endTime) * 1000;
    const closed = p.closed || ends <= i.now;
    if (!closed && ends - i.now <= DAY_MS) fresh.push({ id: `closing:${p.potId}`, kind: "closingSoon", at: i.now, read: false, potId: p.potId });
    if (closed && p.roles.includes("putIn")) fresh.push({ id: `closed:${p.potId}`, kind: "closedShare", at: i.now, read: false, potId: p.potId });
  }
  const asked = new Set(s.asked);
  for (const r of i.waiting) {
    if (asked.has(r.proposalId)) continue;
    asked.add(r.proposalId);
    fresh.push({ id: `ask:${r.proposalId}`, kind: r.kind === 1 ? "askClose" : "askYes", at: i.now, read: false, potId: r.potId, proposalId: r.proposalId, amount: r.amount, decimals: DOLLAR_DECIMALS });
  }
  for (const e of i.ended) {
    if (e.kind === 0 && e.status === 1) fresh.push({ id: `paid:${e.proposalId}`, kind: "paidOut", at: i.now, read: false, potId: e.potId, proposalId: e.proposalId, amount: e.amount, decimals: DOLLAR_DECIMALS });
  }
  // A pot that names this account, made by a contact or one of the accounts on this phone. Strangers' pots are never announced.
  let potsSeen = s.potsSeen;
  if (potsSeen === null) potsSeen = i.found.map((p) => p.potId);
  else {
    const seen = new Set(potsSeen);
    for (const p of i.found) {
      if (seen.has(p.potId)) continue;
      const namesMe = p.roles.includes("decides") || p.roles.includes("paid");
      const maker = i.makers?.[p.potId];
      // Its maker isn't known yet: look again next poll.
      if (namesMe && !maker) continue;
      seen.add(p.potId);
      if (!namesMe || !maker || (i.me && sameAccount(maker, i.me))) continue;
      if ((i.trusted ?? []).some((t) => sameAccount(t, maker))) fresh.push({ id: `named:${p.potId}`, kind: "potNamesYou", at: i.now, read: false, potId: p.potId, from: maker });
    }
    potsSeen = [...seen];
  }
  if (i.raised && i.raised.at >= s.startedAt) fresh.push({ id: `limit:${i.raised.at}`, kind: "limitRaised", at: i.raised.at, read: false, amount: i.raised.limit, decimals: DOLLAR_DECIMALS });
  const withNames = fresh.map((n) => (n.potId !== undefined && names[n.potId] ? { ...n, name: names[n.potId] } : n));
  return add({ ...s, totals, asked: [...asked], poursSeen: [...poursSeen], potsSeen: potsSeen.slice(-MAX_SEEN), fundsSeen: [...fundsSeen].slice(-MAX_SEEN) }, withNames);
}

export type Sent = { tx: string; to: Address; toName: string; amount: bigint; decimals: number; symbol: string };

/** This account's own payment, once final (Send). */
export function fromSent(s: NotesState, sent: Sent, now: number): NotesState {
  if (s.startedAt === null) return s;
  return add(s, [{ id: `tx:${sent.tx}`, kind: "sent", at: now, read: true, to: sent.to, toName: sent.toName, amount: sent.amount.toString(), decimals: sent.decimals, symbol: sent.symbol }]);
}

export type Arrival = { tx: string; logIndex: number; from: Address; amount: bigint; decimals: number; symbol: string };

/** Payments that came in, from the same reads as Receive. */
export function fromArrivals(s: NotesState, arrivals: Arrival[], now: number): NotesState {
  if (s.startedAt === null) return s;
  return add(
    s,
    arrivals.map((a) => ({ id: `rx:${a.tx}:${a.logIndex}`, kind: "received" as const, at: now, read: false, from: a.from, amount: a.amount.toString(), decimals: a.decimals, symbol: a.symbol })),
  );
}

/** A request sent straight to this account (inbox.ts), already opened and checked. */
export type Asked = { digest: string; from: Address; name: string; amount: string; at: number };

/** Requests from people: one note each, never from a muted account, never again once ignored. */
export function fromRequests(s: NotesState, asked: Asked[], muted: readonly Address[]): NotesState {
  if (s.startedAt === null) return s;
  const gone = new Set(s.dismissed);
  return add(
    s,
    asked
      .filter((a) => !gone.has(`req:${a.digest}`) && !muted.some((m) => sameAccount(m, a.from)))
      .map((a) => ({ id: `req:${a.digest}`, kind: "request" as const, at: a.at, read: false, from: a.from, fromName: a.name, amount: a.amount, decimals: DOLLAR_DECIMALS })),
  );
}

/** Ignore: the note goes, and stays gone. */
export const dismiss = (s: NotesState, id: string): NotesState => ({ ...s, notes: s.notes.filter((n) => n.id !== id), dismissed: [...s.dismissed.filter((d) => d !== id), id].slice(-MAX_SEEN) });

/** Mute: every request note from that account goes. */
export const withoutRequestsFrom = (s: NotesState, who: Address): NotesState => ({ ...s, notes: s.notes.filter((n) => !(n.kind === "request" && n.from && sameAccount(n.from, who))) });

export const unread = (s: NotesState) => s.notes.filter((n) => !n.read).length;
export const markRead = (s: NotesState, id: string): NotesState => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, read: true } : n)) });
export const markAllRead = (s: NotesState): NotesState => ({ ...s, notes: s.notes.map((n) => ({ ...n, read: true })) });

type KeyValue = Pick<Storage, "getItem" | "setItem">;
const KINDS: NoteKind[] = ["received", "chippedIn", "askYes", "askClose", "paidOut", "closingSoon", "closedShare", "limitRaised", "sent", "potNamesYou", "memberChippedIn", "request"];

export class NotesStore {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string, account: Address) {
    if (!isAddress(account)) throw new Error("not an account");
    this.kv = kv;
    this.key = `nivpay.notes.v1.${deployment}.${getAddress(account)}`;
  }

  get(): NotesState {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "null") as Partial<NotesState> | null;
      if (!raw || typeof raw.startedAt !== "number") return EMPTY_NOTES;
      const notes = Array.isArray(raw.notes) ? raw.notes.filter((n): n is Note => !!n && typeof n.id === "string" && KINDS.includes(n.kind) && typeof n.at === "number") : [];
      return {
        startedAt: raw.startedAt,
        startBlock: typeof raw.startBlock === "string" && /^\d+$/.test(raw.startBlock) ? raw.startBlock : null,
        totals: raw.totals && typeof raw.totals === "object" ? raw.totals : {},
        asked: Array.isArray(raw.asked) ? raw.asked.filter((x) => typeof x === "string") : [],
        poursSeen: Array.isArray(raw.poursSeen) ? raw.poursSeen.filter((x) => typeof x === "string") : [],
        potsSeen: Array.isArray(raw.potsSeen) ? raw.potsSeen.filter((x) => typeof x === "string") : null,
        fundsSeen: Array.isArray(raw.fundsSeen) ? raw.fundsSeen.filter((x) => typeof x === "string") : [],
        dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.filter((x) => typeof x === "string") : [],
        notes,
      };
    } catch {
      return EMPTY_NOTES;
    }
  }

  set(s: NotesState): void {
    this.kv.setItem(this.key, JSON.stringify(s));
  }

  update(f: (s: NotesState) => NotesState): NotesState {
    const next = f(this.get());
    this.set(next);
    return next;
  }
}
