import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import type { AutoCashRequest, Bank } from "./autocash.ts";
import { AppError } from "./errors.ts";
import { proofMessage, sha256Hex } from "./proof.ts";

/**
 * The phone's side of Auto cash out (api/autocash/index.ts): reading it,
 * turning it on or changing it with a proof the passkey signs, turning it
 * off, and asking the desk to look at money that arrived while the app was
 * closed. Only the bank's name and the last 4 digits ever leave the phone.
 *
 * The allowance the desk moves under is the dollar's own, set by a write
 * through sendWrite (screens/AutoCash.tsx): allowanceData builds it.
 */

/** What a "set" proof signs: the request, its keys in this order, as JSON. The server builds the same. */
export const requestText = (r: AutoCashRequest) => JSON.stringify({ currency: r.currency, bank: { name: r.bank.name, last4: r.bank.last4 }, keep: r.keep, cap: r.cap });

export type Sign = (message: string) => Promise<Hex>;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** As the server says it is: nothing about the bank, which stays in the private store and on this phone. */
export type AutoCashInfo = {
  /** The desk is on and set up. */
  enabled: boolean;
  desk: Address | null;
  on: boolean;
  currency?: string;
  cap?: string;
  keep?: string | null;
  since?: number;
  pending?: { startsAt: number; bank: boolean; cap?: string } | null;
  movedToday: bigint;
  moves: { at: number; dollars: bigint; currency: string; tx: Hex }[];
  held: { at: number; dollars: bigint; why: string; tx: Hex }[];
};

/** What one arrival came to (api/autocash Outcome), as the phone shows it. */
export type Outcome = { result: string; move?: { tx: Hex; arrivedTx: Hex; dollars: string; bankGets: string; currency: string; reference: string; at: number }; hold?: { why: string; dollars: string } };

const isTx = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
const isAmount = (v: unknown): v is string => typeof v === "string" && /^\d{1,30}$/.test(v);

async function call(fetcher: Fetch, init?: RequestInit, query = ""): Promise<Response> {
  try {
    return await fetcher(`/api/autocash${query}`, init);
  } catch {
    throw new AppError(copy.errRampUnreachable, ERROR_CODES.RAMP_UNREACHABLE);
  }
}

const post = (body: Record<string, unknown>): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function refused(status: number): AppError {
  if (status === 503) return new AppError(copy.errRampPaused, ERROR_CODES.RAMP_PAUSED);
  if (status >= 500) return new AppError(copy.errRampFailed, ERROR_CODES.RAMP_FAILED);
  return new AppError(copy.errRampRefused, ERROR_CODES.RAMP_REFUSED);
}

export async function readAutoCash(account: Address, fetcher: Fetch = fetch): Promise<AutoCashInfo> {
  const res = await call(fetcher, undefined, `?account=${getAddress(account)}`);
  if (!res.ok) throw refused(res.status);
  const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const p = b.pending as AutoCashInfo["pending"] | undefined;
  return {
    enabled: b.enabled === true,
    desk: typeof b.desk === "string" && isAddress(b.desk) ? getAddress(b.desk) : null,
    on: b.on === true,
    currency: typeof b.currency === "string" ? b.currency : undefined,
    cap: isAmount(b.cap) ? b.cap : undefined,
    keep: isAmount(b.keep) ? b.keep : null,
    since: typeof b.since === "number" ? b.since : undefined,
    pending: p && typeof p.startsAt === "number" ? { startsAt: p.startsAt, bank: p.bank === true, ...(isAmount(p.cap) ? { cap: p.cap } : {}) } : null,
    movedToday: isAmount(b.movedToday) ? BigInt(b.movedToday) : 0n,
    moves: list(b.moves)
      .filter((m) => typeof m.at === "number" && isAmount(m.dollars) && typeof m.currency === "string" && /^[A-Z]{3}$/.test(m.currency) && isTx(m.tx))
      .map((m) => ({ at: m.at as number, dollars: BigInt(m.dollars as string), currency: m.currency as string, tx: m.tx as Hex })),
    held: list(b.held).filter((h) => typeof h.at === "number" && isAmount(h.dollars) && isTx(h.tx) && typeof h.why === "string").map((h) => ({ at: h.at as number, dollars: BigInt(h.dollars as string), why: h.why as string, tx: h.tx as Hex })),
  };
}

/** Turns it on, or changes it: one fingerprint signs the settings, and the server applies its rules (lib/autocash.ts). */
export async function saveAutoCash(account: Address, req: AutoCashRequest, sign: Sign, fetcher: Fetch = fetch, now = Date.now()): Promise<AutoCashInfo["pending"]> {
  const time = Math.floor(now / 1000);
  const data = `sha256:${await sha256Hex(new TextEncoder().encode(requestText(req)))}`;
  const signature = await sign(proofMessage({ subject: "autocash", action: "on", account, data, time, site: location.host }));
  const res = await call(fetcher, post({ kind: "set", account: getAddress(account), settings: JSON.parse(requestText(req)), time, signature }));
  if (!res.ok) throw refused(res.status);
  const b = (await res.json().catch(() => ({}))) as { pending?: AutoCashInfo["pending"] };
  return b.pending ?? null;
}

/** Drops a change still waiting for its 24 hours. One fingerprint. */
export async function cancelAutoCashChange(account: Address, sign: Sign, fetcher: Fetch = fetch, now = Date.now()): Promise<void> {
  const time = Math.floor(now / 1000);
  const signature = await sign(proofMessage({ subject: "autocash", action: "cancel", account, data: "none", time, site: location.host }));
  const res = await call(fetcher, post({ kind: "cancel", account: getAddress(account), time, signature }));
  if (!res.ok) throw refused(res.status);
}

/** Off on the server, at once, with no fingerprint: off only ever leaves money where it is. */
export async function autoCashOff(account: Address, fetcher: Fetch = fetch): Promise<void> {
  const res = await call(fetcher, post({ kind: "off", account: getAddress(account) }));
  if (!res.ok) throw refused(res.status);
}

/** Money that arrived while the app was closed, or before the sender's app told the server: the desk looks at each. */
export async function checkArrivals(account: Address, txs: Hex[], fetcher: Fetch = fetch): Promise<Outcome[]> {
  if (!txs.length) return [];
  const res = await call(fetcher, post({ kind: "check", account: getAddress(account), txs: txs.slice(0, 10) }));
  if (!res.ok) return [];
  const b = (await res.json().catch(() => ({}))) as { outcomes?: Outcome[] };
  return Array.isArray(b.outcomes) ? b.outcomes : [];
}

const ALLOWANCE_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
export { ALLOWANCE_ABI };

/** The dollar's own call that lets the desk move up to `amount` from this account; 0 takes it back. */
export const allowanceData = (desk: Address, amount: bigint) => encodeFunctionData({ abi: ALLOWANCE_ABI, functionName: "approve", args: [desk, amount] });

/** Label for the allowance's pending write: "autocash <desk> <amount>". */
export const allowanceLabel = (desk: Address, amount: bigint) => `autocash ${desk} ${amount}`;

/**
 * This phone's own copy of what was chosen, for showing it: the bank's name
 * and last 4 digits, never more, and a new bank waiting its 24 hours.
 * Another phone shows "your bank" instead.
 */
export type AutoCashLocal = { bank: Bank; currency: string; next?: Bank };

export class AutoCashLocalStore {
  private readonly kv: Pick<Storage, "getItem" | "setItem">;
  private readonly key: string;
  constructor(kv: Pick<Storage, "getItem" | "setItem">, deployment: string, account: Address) {
    this.kv = kv;
    this.key = `nivpay.autocash.v1.${deployment}.${getAddress(account)}`;
  }

  get(): AutoCashLocal | null {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "null") as AutoCashLocal | null;
      const bank = (b: unknown): b is Bank => !!b && typeof (b as Bank).name === "string" && /^\d{4}$/.test((b as Bank).last4);
      if (!raw || typeof raw.currency !== "string" || !bank(raw.bank)) return null;
      return { bank: { name: raw.bank.name, last4: raw.bank.last4 }, currency: raw.currency, ...(bank(raw.next) ? { next: { name: raw.next.name, last4: raw.next.last4 } } : {}) };
    } catch {
      return null;
    }
  }

  set(v: AutoCashLocal): void {
    try {
      const only = (b: Bank) => ({ name: b.name, last4: b.last4 });
      this.kv.setItem(this.key, JSON.stringify({ bank: only(v.bank), currency: v.currency, ...(v.next ? { next: only(v.next) } : {}) }));
    } catch {
      // Storage refused: the server keeps it; this phone shows "your bank".
    }
  }
}

/** The cash outs Auto cash out made, by transaction, kept on this phone so History says so after GET's 7 days. At most 500. */
export class AutoCashSeenStore {
  private readonly kv: Pick<Storage, "getItem" | "setItem">;
  private readonly key: string;
  constructor(kv: Pick<Storage, "getItem" | "setItem">, deployment: string, account: Address) {
    this.kv = kv;
    this.key = `nivpay.autocash.moves.v1.${deployment}.${getAddress(account)}`;
  }

  all(): Set<string> {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "[]") as unknown;
      return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && /^0x[0-9a-f]{64}$/.test(x)) : []);
    } catch {
      return new Set();
    }
  }

  add(txs: readonly string[]): Set<string> {
    const all = this.all();
    for (const tx of txs) all.add(tx.toLowerCase());
    try {
      this.kv.setItem(this.key, JSON.stringify([...all].slice(-500)));
    } catch {
      // Storage refused: History says Cash out for these.
    }
    return all;
  }
}
