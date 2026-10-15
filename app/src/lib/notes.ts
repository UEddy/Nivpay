import { getAddress, isAddress, type Address } from "viem";
import type { FoundPot } from "./discover.ts";
import type { Spend } from "./limits.ts";
import type { EndedRequest, OpenRequest } from "./waiting.ts";

/**
 * In-app notifications, built only from what Home already reads at the
 * finalized block: the pots found for this account (discover.ts), the
 * requests waiting for its yes (waiting.ts), its own pours and the daily
 * limit (limits.ts), and payments coming in. No server and no push messages:
 * they appear while the app is open, and the list starts from when this phone
 * first ran the feature.
 *
 * Each note has an id that says what it is about, so the same thing is never
 * said twice. Read and unread are kept per account on this phone.
 */

export type NoteKind = "received" | "chippedIn" | "askYes" | "askClose" | "paidOut" | "closingSoon" | "closedShare" | "limitRaised";

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
  notes: Note[];
};

export const EMPTY_NOTES: NotesState = { startedAt: null, startBlock: null, totals: {}, asked: [], poursSeen: [], notes: [] };

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
};

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
  const totals: Record<string, string> = {};
  const poursSeen = new Set(s.poursSeen);
  for (const p of i.found) {
    totals[p.potId] = p.totalAssets;
    const before = s.totals[p.potId];
    if (before !== undefined) {
      const rise = BigInt(p.totalAssets) - BigInt(before);
      if (rise > 0n) {
        // Take this account's own pours off the rise: chipping in yourself is not news.
        const mine = i.pours.filter((x) => x.final && x.potId === p.potId && !poursSeen.has(x.id));
        const own = mine.reduce((sum, x) => sum + BigInt(x.amount), 0n);
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
  if (i.raised && i.raised.at >= s.startedAt) fresh.push({ id: `limit:${i.raised.at}`, kind: "limitRaised", at: i.raised.at, read: false, amount: i.raised.limit, decimals: DOLLAR_DECIMALS });
  const named = fresh.map((n) => (n.potId !== undefined && names[n.potId] ? { ...n, name: names[n.potId] } : n));
  return add({ ...s, totals, asked: [...asked], poursSeen: [...poursSeen] }, named);
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

export const unread = (s: NotesState) => s.notes.filter((n) => !n.read).length;
export const markRead = (s: NotesState, id: string): NotesState => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, read: true } : n)) });
export const markAllRead = (s: NotesState): NotesState => ({ ...s, notes: s.notes.map((n) => ({ ...n, read: true })) });

type KeyValue = Pick<Storage, "getItem" | "setItem">;
const KINDS: NoteKind[] = ["received", "chippedIn", "askYes", "askClose", "paidOut", "closingSoon", "closedShare", "limitRaised"];

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
