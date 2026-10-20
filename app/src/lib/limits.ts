import { getAddress, isAddress, type Address } from "viem";

/**
 * A daily limit on money leaving the account: $1,000 in any 24 hours unless
 * the person sets another. It counts Send, Send in another currency, chipping
 * in, Cash out and Auto cash out, from the moment each is sent, so requests still in flight
 * count too. Taking your share out of a pot and money coming in never count.
 *
 * The public RPC can't read a day of history cheaply, so the limit counts the
 * payments this phone made: a payment made from another phone counts only
 * there. Lowering the limit takes effect at once; raising it takes effect 24
 * hours later, so nobody can pressure someone into raising it on the spot.
 *
 * The limit lives in the app. It protects against mistakes and pressure, not
 * against someone who has the passkey and uses other software. Clearing the
 * site's data resets it to the default (README, "Daily limit").
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** $1,000, in base units of a six decimal dollar (AUSD and TESTUSD both). */
export const DEFAULT_LIMIT = 1_000_000_000n;
export const LIMIT_DECIMALS = 6;

export type SpendKind = "send" | "currency" | "pour" | "cashout";

/** One payment out. `id` is its nonce, so a retry on the same nonce replaces it rather than counting twice. */
export type Spend = { id: string; kind: SpendKind; amount: string; at: number; final: boolean; potId?: string };

export type LimitState = {
  limit: string;
  /** A higher limit waiting for its 24 hours. */
  raise: { limit: string; startsAt: number } | null;
  /** The last raise that took effect, so the app can say so once. */
  raised: { limit: string; at: number } | null;
  spends: Spend[];
};

export const FRESH: LimitState = { limit: DEFAULT_LIMIT.toString(), raise: null, raised: null, spends: [] };

/** A due raise applied, and spends older than a day dropped. */
export function settle(s: LimitState, now: number): LimitState {
  let next = s;
  if (s.raise && now >= s.raise.startsAt) next = { ...s, limit: s.raise.limit, raise: null, raised: { limit: s.raise.limit, at: s.raise.startsAt } };
  const spends = next.spends.filter((x) => now - x.at < DAY_MS);
  return spends.length === next.spends.length ? next : { ...next, spends };
}

export const limitNow = (s: LimitState, now: number) => BigInt(settle(s, now).limit);

/** Everything sent in the last 24 hours, final or still in flight. */
export function usedToday(s: LimitState, now: number): bigint {
  return settle(s, now).spends.reduce((sum, x) => sum + BigInt(x.amount), 0n);
}

export function leftToday(s: LimitState, now: number): bigint {
  const left = limitNow(s, now) - usedToday(s, now);
  return left > 0n ? left : 0n;
}

export type LimitCheck = { ok: true; left: bigint } | { ok: false; left: bigint };

/** The one rule every way money leaves calls before anything is signed. */
export function checkSpend(s: LimitState, amount: bigint, now: number): LimitCheck {
  const left = leftToday(s, now);
  return amount <= left ? { ok: true, left } : { ok: false, left };
}

/** Lower: at once, and any raise waiting is dropped. Higher: in 24 hours. The same: drops a raise waiting. */
export function changeLimit(s: LimitState, next: bigint, now: number): LimitState {
  const settled = settle(s, now);
  const current = BigInt(settled.limit);
  if (next < 0n) throw new Error("a limit can't be negative");
  if (next <= current) return { ...settled, limit: next.toString(), raise: null };
  return { ...settled, raise: { limit: next.toString(), startsAt: now + DAY_MS } };
}

/** Counts a payment from the moment it is sent; the same id again replaces it. */
export function recordSpend(s: LimitState, spend: Spend): LimitState {
  return { ...s, spends: [...s.spends.filter((x) => x.id !== spend.id), spend] };
}

/** Auto cash out's moves (api/autocash), each once by its transaction, final and counted from when the desk made them. */
export function recordAutoCash(s: LimitState, moves: readonly { tx: string; dollars: bigint; at: number }[]): LimitState {
  return moves.reduce((acc, m) => recordSpend(acc, { id: `auto:${m.tx.toLowerCase()}`, kind: "cashout", amount: m.dollars.toString(), at: m.at, final: true }), s);
}

/** Final: it keeps counting. Failed (reverted or replaced): it never left, so it stops counting. */
export function finishSpend(s: LimitState, id: string, outcome: "final" | "failed"): LimitState {
  if (outcome === "failed") return { ...s, spends: s.spends.filter((x) => x.id !== id) };
  return { ...s, spends: s.spends.map((x) => (x.id === id ? { ...x, final: true } : x)) };
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;
const isAmount = (v: unknown): v is string => typeof v === "string" && /^\d{1,30}$/.test(v);

export class LimitStore {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string, account: Address) {
    if (!isAddress(account)) throw new Error("not an account");
    this.kv = kv;
    this.key = `nivpay.limit.v1.${deployment}.${getAddress(account)}`;
  }

  get(): LimitState {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "null") as Partial<LimitState> | null;
      if (!raw || !isAmount(raw.limit)) return FRESH;
      const raise = raw.raise && isAmount(raw.raise.limit) && typeof raw.raise.startsAt === "number" ? raw.raise : null;
      const raised = raw.raised && isAmount(raw.raised.limit) && typeof raw.raised.at === "number" ? raw.raised : null;
      const spends = Array.isArray(raw.spends)
        ? raw.spends.filter((x): x is Spend => !!x && typeof x.id === "string" && isAmount(x.amount) && typeof x.at === "number" && ["send", "currency", "pour", "cashout"].includes(x.kind))
        : [];
      return { limit: raw.limit, raise, raised, spends };
    } catch {
      return FRESH;
    }
  }

  set(s: LimitState): void {
    this.kv.setItem(this.key, JSON.stringify(s));
  }

  update(f: (s: LimitState) => LimitState): LimitState {
    const next = f(this.get());
    this.set(next);
    return next;
  }
}
