/**
 * Auto cash out (README, "Auto cash out"), the rules with no browser or
 * server in them: what is kept, what a change does and when, and how much of
 * a payment that arrived the desk may move. Shared by the phone
 * (screens/AutoCash.tsx) and the desk (api/autocash/index.ts, which keeps
 * its own copy of these rules; app/src/api-tests/autocash.test.ts fails if
 * the two ever differ).
 *
 * Kept: the currency, the bank's name and the last 4 digits of its account
 * number, never the full number; what to cash out (everything that arrives,
 * or everything above a balance to keep); a daily cap. Lowering the cap or
 * raising the balance to keep applies at once. A new bank, or a higher cap,
 * waits 24 hours, so nobody can be pressured into sending their money
 * somewhere new on the spot.
 *
 * Pure, with no imports. Dollars are bigint base units (6 decimals) and kept
 * as decimal strings.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** A new bank or a higher cap waits this long. */
export const WAIT_MS = DAY_MS;
const DOLLAR = 1_000_000n;
/** $500 a day, unless the person chooses another. */
export const DEFAULT_CAP = 500n * DOLLAR;
/** The desk moves at least $1 at a time, as Cash out does. */
export const MIN_MOVE = 1n * DOLLAR;
/** The most a cap can be: the default daily limit, $1,000. */
export const MAX_CAP = 1_000n * DOLLAR;
export const BANK_NAME_MAX = 40;

export type Bank = { name: string; last4: string };

export type AutoCashSettings = {
  on: boolean;
  currency: string;
  bank: Bank;
  /** Null: everything that arrives. Else a balance to keep, in base units. */
  keep: string | null;
  /** The most moved in any 24 hours, in base units. */
  cap: string;
  /** When it was last turned on (ms). Money that arrived before then is never moved. */
  since: number;
  /** A new bank or a higher cap, waiting for its 24 hours. */
  pending: { bank?: Bank; cap?: string; startsAt: number } | null;
};

/** What the person asks for, on turning it on or changing it. */
export type AutoCashRequest = { currency: string; bank: Bank; keep: string | null; cap: string };

const isAmount = (v: unknown): v is string => typeof v === "string" && /^\d{1,30}$/.test(v);

/** A bank's name as kept: trimmed, single spaced, 2 to 40 characters, with no run of 5 digits (an account number typed into it). */
export function cleanBankName(text: string): string | null {
  const name = text.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (name.length < 2 || name.length > BANK_NAME_MAX) return null;
  if (/\d{5}/u.test(name.replace(/[\s-]/gu, ""))) return null;
  if (/[<>{}\\]/u.test(name)) return null;
  return name;
}

/**
 * The last 4 digits of an account number typed in, or null. Spaces and
 * dashes are dropped; letters are allowed (an IBAN), but it must end in 4
 * digits and be 6 to 34 characters. The number itself is never kept.
 */
export function lastFour(accountNumber: string): string | null {
  const t = accountNumber.replace(/[\s-]/gu, "").toUpperCase();
  if (!/^[A-Z0-9]{6,34}$/u.test(t)) return null;
  const last = t.slice(-4);
  return /^\d{4}$/u.test(last) ? last : null;
}

export const isBank = (b: unknown): b is Bank =>
  !!b && typeof b === "object" && typeof (b as Bank).name === "string" && cleanBankName((b as Bank).name) === (b as Bank).name && typeof (b as Bank).last4 === "string" && /^\d{4}$/u.test((b as Bank).last4) && Object.keys(b).length === 2;

const sameBank = (a: Bank, b: Bank) => a.name === b.name && a.last4 === b.last4;

/** A request, checked: a known currency, a kept bank, a cap of $1 to $1,000, a balance to keep or none. Null if anything is wrong. */
export function cleanRequest(raw: unknown, currencies: readonly string[]): AutoCashRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !["currency", "bank", "keep", "cap"].includes(k))) return null;
  if (typeof r.currency !== "string" || !currencies.includes(r.currency)) return null;
  if (!isBank(r.bank)) return null;
  if (!isAmount(r.cap) || BigInt(r.cap) < MIN_MOVE || BigInt(r.cap) > MAX_CAP) return null;
  if (r.keep !== null && !isAmount(r.keep)) return null;
  return { currency: r.currency, bank: { name: r.bank.name, last4: r.bank.last4 }, keep: r.keep as string | null, cap: r.cap };
}

/** A waiting change applied once its 24 hours are up. */
export function settle(s: AutoCashSettings, now: number): AutoCashSettings {
  if (!s.pending || now < s.pending.startsAt) return s;
  return { ...s, bank: s.pending.bank ?? s.bank, cap: s.pending.cap ?? s.cap, pending: null };
}

/**
 * Turning it on, or changing it. The first time, everything applies at once.
 * After that: a lower cap, a currency, and what to keep apply at once; a new
 * bank or a higher cap waits 24 hours, and until then the old one is used.
 * Asking for what is in force now drops anything waiting.
 */
export function change(current: AutoCashSettings | null, req: AutoCashRequest, now: number): AutoCashSettings {
  if (!current) return { on: true, currency: req.currency, bank: req.bank, keep: req.keep, cap: req.cap, since: now, pending: null };
  const s = settle(current, now);
  const newBank = !sameBank(s.bank, req.bank);
  const higherCap = BigInt(req.cap) > BigInt(s.cap);
  const pending = newBank || higherCap ? { ...(newBank ? { bank: req.bank } : {}), ...(higherCap ? { cap: req.cap } : {}), startsAt: now + WAIT_MS } : null;
  return {
    on: true,
    currency: req.currency,
    bank: s.bank,
    keep: req.keep,
    cap: higherCap ? s.cap : req.cap,
    since: s.on ? s.since : now,
    pending,
  };
}

/** Off: at once. What was chosen is kept for next time; anything waiting is dropped. */
export const turnOff = (s: AutoCashSettings): AutoCashSettings => ({ ...s, on: false, pending: null });

/** Cancel: the waiting change is dropped, and the bank and cap in force stay. */
export const cancelPending = (s: AutoCashSettings): AutoCashSettings => ({ ...s, pending: null });

/** Settings as stored, or null if anything is wrong with them. */
export function cleanSettings(raw: unknown, currencies: readonly string[]): AutoCashSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const req = cleanRequest({ currency: r.currency, bank: r.bank, keep: r.keep, cap: r.cap }, currencies);
  if (!req || typeof r.on !== "boolean" || typeof r.since !== "number") return null;
  let pending: AutoCashSettings["pending"] = null;
  if (r.pending && typeof r.pending === "object") {
    const p = r.pending as Record<string, unknown>;
    if (typeof p.startsAt !== "number" || (p.bank !== undefined && !isBank(p.bank)) || (p.cap !== undefined && !isAmount(p.cap))) return null;
    pending = { ...(p.bank ? { bank: p.bank as Bank } : {}), ...(p.cap ? { cap: p.cap as string } : {}), startsAt: p.startsAt };
  }
  return { on: r.on, ...req, since: r.since, pending };
}

/** Dollars moved in the last 24 hours. */
export function movedToday(moves: readonly { dollars: string; at: number }[], now: number): bigint {
  return moves.filter((m) => now - m.at < DAY_MS && now >= m.at).reduce((sum, m) => sum + BigInt(m.dollars), 0n);
}

/** Why less than what arrived is moved: all of it kept, the cap reached, the allowance used up, or under $1. */
export type Held = "kept" | "cap" | "allowance" | "small";

/**
 * How much of a payment that arrived to move: never more than arrived, never
 * below the balance to keep, never past the day's cap or the allowance the
 * person signed. Under $1, nothing. `held` says what stopped it from moving
 * all that arrived.
 */
export function amountToMove(x: { arrived: bigint; balance: bigint; keep: bigint | null; capLeft: bigint; allowance: bigint }): { amount: bigint; held: Held | null } {
  let amount = x.arrived;
  let held: Held | null = null;
  const room = x.keep === null ? x.balance : x.balance > x.keep ? x.balance - x.keep : 0n;
  if (room < amount) [amount, held] = [room, "kept"];
  if (x.capLeft < amount) [amount, held] = [x.capLeft > 0n ? x.capLeft : 0n, "cap"];
  if (x.allowance < amount) [amount, held] = [x.allowance, "allowance"];
  if (amount < MIN_MOVE) return { amount: 0n, held: held ?? "small" };
  return { amount, held };
}
