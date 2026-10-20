// /api/autocash: Auto cash out, run by the TEST desk behind Cash out
// (api/ramp). A simulation, like it: no bank is involved and no real
// currency moves. When dollars arrive in an account that turned it on, the
// desk moves them to itself with transferFrom, up to the allowance the person
// signed, and the cash out statement is the one Cash out gives for that
// transaction. On mainnet a licensed partner holds the bank details, runs ID
// checks and pays the bank; NivPay would only send the dollars (README,
// "Auto cash out").
//
// GET ?account=0x… returns whether it is on, the cap, what is kept, a change
//   waiting, and the moves (with their currency) and holds of the last 7
//   days: nothing about the bank, which stays in the private store.
// POST { kind: "set", account, settings, time, signature } turns it on or
//   changes it, with a proof the account's passkey signed (as api/push).
//   settings are { currency, bank: { name, last4 }, keep, cap }: the bank's
//   name and the last 4 digits, never an account number. A new bank or a
//   higher cap waits 24 hours (app/src/lib/autocash.ts).
// POST { kind: "cancel", account, time, signature } drops a waiting change.
// POST { kind: "off", account } turns it off at once. No proof: off only ever
//   leaves money where it is.
// POST { kind: "arrived", tx, accounts } from /api/notify, and
// POST { kind: "check", account, txs } from the person's own app when it
//   opens: for each, reads the receipt at the finalized block, works out what
//   really arrived for that account, and moves what the rules allow.
//
// What is moved, for one transaction and one account:
//  * only dollars (AUSD) that arrived in it for the account, from someone
//    else: never the account's own transaction, never from the desk, the
//    faucet or nothing (minted), and only in a block after it was turned on;
//  * never more than arrived, never below the balance to keep, never past
//    the day's cap or the allowance, and nothing under $1;
//  * each transaction once for each account, across every server instance,
//    by a claim written to the store before anything moves. Claims live in
//    one file per account, autocash/<account>/claims.json, changed only by a
//    conditional write: read uncached with its ETag, then written back with
//    ifMatch, which Vercel Blob refuses (412) if anyone wrote in between, so
//    two instances can never both claim one arrival. The loser reads again
//    and finds it claimed. A missing file is created with allowOverwrite
//    false, and "already exists" is answered by reading again. The file
//    keeps the last MAX_CLAIMS arrivals and two floors: the block auto cash
//    out was last turned on at, and the highest block ever pruned from the
//    list. An arrival at or below either is refused before any claim, so a
//    pruned arrival can never be cashed out again;
//  * only from the account itself: never from a pot, whose money stays there.
//
// Abuse limits, in the style of /api/ramp:
//  * RAMP_ENABLED must be exactly "true", or nothing moves: an arrival is
//    read and the person told the money stays, and nothing else runs.
//  * Same origin only, by the Origin header. Bodies over MAX_BODY_BYTES are
//    refused unread.
//  * Per account: MAX_MOVES_PER_HOUR moves, one request at a time on an
//    instance, MAX_REQUESTS_PER_MINUTE requests a minute on an instance.
//  * In total: the desk's DESK_TXS_PER_HOUR, counted from its own nonce now
//    and about an hour of blocks ago, shared with api/ramp.
//  * The desk's key is read only after every check has passed and a move is
//    due, and never logged. Logs carry the account, the amount and the
//    transactions; never the bank.
//
// The rules, the currency table, the quotes and proofMessage are copies of
// app/src/lib (autocash.ts, ramp.ts, proof.ts): this folder builds alone.
// app/src/api-tests/autocash.test.ts fails if they ever differ.

import { createHash } from "node:crypto";
import { BlobPreconditionFailedError, get, list, put, del } from "@vercel/blob";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  parseEther,
  parseEventLogs,
  recoverMessageAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

export const CHAIN_ID = 10143;
export const RPC_URL = "https://testnet-rpc.monad.xyz";
export const AUSD: Address = getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
export const AUSD_FAUCET: Address = getAddress("0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C");
const DOLLAR = 1_000_000n;
export const DESK_GAS_FLOOR = parseEther("0.2");
export const DESK_TXS_PER_HOUR = 30;
export const BLOCKS_PER_HOUR = 11_600n;
export const MAX_BODY_BYTES = 1_024;
export const PROOF_WINDOW_S = 300;
export const MAX_MOVES_PER_HOUR = 6;
export const MAX_REQUESTS_PER_MINUTE = 10;
/** A check from the app looks at this many of its latest arrivals at most; /api/notify passes this many accounts. */
export const MAX_TXS = 10;
export const MAX_ACCOUNTS = 5;
/** How far back GET lists moves and holds. */
export const SHOWN_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The rules: a copy of app/src/lib/autocash.ts
// ---------------------------------------------------------------------------

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WAIT_MS = DAY_MS;
export const DEFAULT_CAP = 500n * DOLLAR;
export const MIN_MOVE = 1n * DOLLAR;
export const MAX_CAP = 1_000n * DOLLAR;
export const BANK_NAME_MAX = 40;

export type Bank = { name: string; last4: string };
export type AutoCashSettings = {
  on: boolean;
  currency: string;
  bank: Bank;
  keep: string | null;
  cap: string;
  since: number;
  pending: { bank?: Bank; cap?: string; startsAt: number } | null;
};
export type AutoCashRequest = { currency: string; bank: Bank; keep: string | null; cap: string };

const isAmount = (v: unknown): v is string => typeof v === "string" && /^\d{1,30}$/.test(v);

export function cleanBankName(text: string): string | null {
  const name = text.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (name.length < 2 || name.length > BANK_NAME_MAX) return null;
  if (/\d{5}/u.test(name.replace(/[\s-]/gu, ""))) return null;
  if (/[<>{}\\]/u.test(name)) return null;
  return name;
}

export const isBank = (b: unknown): b is Bank =>
  !!b && typeof b === "object" && typeof (b as Bank).name === "string" && cleanBankName((b as Bank).name) === (b as Bank).name && typeof (b as Bank).last4 === "string" && /^\d{4}$/u.test((b as Bank).last4) && Object.keys(b).length === 2;

const sameBank = (a: Bank, b: Bank) => a.name === b.name && a.last4 === b.last4;

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

export function settle(s: AutoCashSettings, now: number): AutoCashSettings {
  if (!s.pending || now < s.pending.startsAt) return s;
  return { ...s, bank: s.pending.bank ?? s.bank, cap: s.pending.cap ?? s.cap, pending: null };
}

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

export const turnOff = (s: AutoCashSettings): AutoCashSettings => ({ ...s, on: false, pending: null });
export const cancelPending = (s: AutoCashSettings): AutoCashSettings => ({ ...s, pending: null });

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

export function movedToday(moves: readonly { dollars: string; at: number }[], now: number): bigint {
  return moves.filter((m) => now - m.at < DAY_MS && now >= m.at).reduce((sum, m) => sum + BigInt(m.dollars), 0n);
}

export type Held = "kept" | "cap" | "allowance" | "small";

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

// ---------------------------------------------------------------------------
// The quotes: a copy of app/src/lib/ramp.ts
// ---------------------------------------------------------------------------

export type Currency = { code: string; symbol: string; digits: number; testMinorPerDollar: bigint };
const CENT = DOLLAR / 100n;

export const CURRENCIES: readonly Currency[] = [
  { code: "NGN", symbol: "₦", digits: 2, testMinorPerDollar: 155_000n },
  { code: "GBP", symbol: "£", digits: 2, testMinorPerDollar: 79n },
  { code: "USD", symbol: "$", digits: 2, testMinorPerDollar: 100n },
  { code: "EUR", symbol: "€", digits: 2, testMinorPerDollar: 92n },
  { code: "GHS", symbol: "GH₵", digits: 2, testMinorPerDollar: 1_550n },
  { code: "KES", symbol: "KSh", digits: 2, testMinorPerDollar: 12_900n },
  { code: "ZAR", symbol: "R", digits: 2, testMinorPerDollar: 1_820n },
  { code: "XOF", symbol: "CFA", digits: 0, testMinorPerDollar: 605n },
  { code: "EGP", symbol: "E£", digits: 2, testMinorPerDollar: 4_850n },
  { code: "CAD", symbol: "CA$", digits: 2, testMinorPerDollar: 137n },
  { code: "AUD", symbol: "A$", digits: 2, testMinorPerDollar: 152n },
  { code: "INR", symbol: "₹", digits: 2, testMinorPerDollar: 8_350n },
  { code: "CNY", symbol: "CN¥", digits: 2, testMinorPerDollar: 725n },
  { code: "AED", symbol: "AED", digits: 2, testMinorPerDollar: 367n },
  { code: "BRL", symbol: "R$", digits: 2, testMinorPerDollar: 540n },
  { code: "MXN", symbol: "MX$", digits: 2, testMinorPerDollar: 1_800n },
  { code: "PHP", symbol: "₱", digits: 2, testMinorPerDollar: 5_700n },
  { code: "JPY", symbol: "¥", digits: 0, testMinorPerDollar: 150n },
];
const CODES = CURRENCIES.map((c) => c.code);
export const FEE_BPS = 100n;

function feeOn(dollars: bigint): bigint {
  const raw = (dollars * FEE_BPS + 9_999n) / 10_000n;
  return ((raw + CENT - 1n) / CENT) * CENT;
}

export function quoteCashOut(currency: Currency, dollars: bigint) {
  const safe = dollars > 0n ? dollars : 0n;
  const fee = safe > 0n ? feeOn(safe) : 0n;
  const net = safe > fee ? safe - fee : 0n;
  const bankGets = (net * currency.testMinorPerDollar) / DOLLAR;
  return { dollars: safe, fee, bankGets };
}

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const REF_LENGTH = 6;

export function referenceForTx(tx: string): string {
  const hex = tx.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("not a transaction id");
  let out = "";
  for (let i = 0; i < REF_LENGTH; i++) {
    const start = 64 - 2 * (REF_LENGTH - i);
    out += REF_ALPHABET[parseInt(hex.slice(start, start + 2), 16) & 31];
  }
  return `NVP-${out}`;
}

// ---------------------------------------------------------------------------
// The proof: a copy of app/src/lib/proof.ts
// ---------------------------------------------------------------------------

export type ProofFields = { subject: "autocash"; action: string; account: Address; data: string; time: number; site: string };

export function proofMessage(f: ProofFields): string {
  return [`NivPay ${f.subject}`, `Action: ${f.action}`, `Account: ${getAddress(f.account)}`, `Data: ${f.data}`, `Time: ${f.time}`, `Site: ${f.site}`].join("\n");
}

/** What a "set" proof signs: the request, its keys in this order, as JSON. The phone builds the same (lib/autocashLive.ts). */
export const requestText = (r: AutoCashRequest) => JSON.stringify({ currency: r.currency, bank: { name: r.bank.name, last4: r.bank.last4 }, keep: r.keep, cap: r.cap });

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

export type AutoCashEnv = {
  RAMP_ENABLED?: string;
  RAMP_DESK_ADDRESS?: string;
  RAMP_DESK_PRIVATE_KEY?: string;
  BLOB_STORE_ID?: string;
  BLOB_READ_WRITE_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
};

export type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
export type Moved = { from: Address; to: Address; value: bigint };

/** A transaction, once in a finalized block: who sent it, when, whether it went through, and its AUSD transfers. */
export type Arrival = { sender: Address; block: bigint; time: bigint; ok: boolean; transfers: Moved[] };

/** Everything the handler needs from the chain, so tests can script it. */
export interface AutoCashChain {
  chainId(): Promise<number>;
  /** The transaction if it is in a finalized block, "pending" if it isn't final yet, null if it isn't found. */
  arrival(tx: Hex): Promise<Arrival | "pending" | null>;
  dollars(account: Address): Promise<bigint>;
  allowance(owner: Address, desk: Address): Promise<bigint>;
  gasBalance(address: Address): Promise<bigint>;
  deskNonce(desk: Address): Promise<number>;
  latestBlock(): Promise<bigint>;
  deskNonceAt(desk: Address, block: bigint): Promise<number>;
  fees(): Promise<Fees>;
  /** Moves `amount` from `owner` to the desk with transferFrom, and waits for it to go through. Throws on a nonce conflict. */
  pull(owner: Address, amount: bigint, nonce: number, fees: Fees): Promise<Hex>;
}

/** The private store: one file per account's settings, per arrival handled, per move and per hold. */
export interface AutoCashStore {
  read(path: string): Promise<Uint8Array | null>;
  /** Writes; with `create`, only if nothing is there yet, and false if something was. */
  write(path: string, bytes: Uint8Array, create: boolean): Promise<boolean>;
  /** Reads past any cache, with the blob's ETag; null if there is nothing there. */
  readTagged(path: string): Promise<{ bytes: Uint8Array; etag: string } | null>;
  /** Writes only if the blob's ETag is still `etag`: "ok", or "changed" if someone wrote in between (412). */
  writeIfMatch(path: string, bytes: Uint8Array, etag: string): Promise<"ok" | "changed">;
  list(prefix: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

export type Logger = (entry: Record<string, string>) => void;

/** One move to the bank, as GET lists it and a "moved" outcome carries it. */
export type Move = { tx: Hex; arrivedTx: Hex; dollars: string; fee: string; bankGets: string; currency: string; reference: string; at: number };
/** Why money that arrived stayed in the account: the cap, the allowance used up, the desk switched off, busy or short of what it runs on. */
export type HeldWhy = "cap" | "allowance" | "paused" | "busy" | "desk";
export type Hold = { arrivedTx: Hex; dollars: string; why: HeldWhy; at: number };

export type Outcome =
  | { account: Address; result: "moved"; move: Move; bank: Bank }
  | { account: Address; result: "held"; hold: Hold }
  | { account: Address; result: "kept" | "off" | "none" | "already" | "pending" | "unknown" };

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function originAllowed(request: Request, env: AutoCashEnv): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const own = new URL(request.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return origin === own || extra.includes(origin);
}

function deskAddress(env: AutoCashEnv): Address | undefined {
  return env.RAMP_DESK_ADDRESS && isAddress(env.RAMP_DESK_ADDRESS) ? getAddress(env.RAMP_DESK_ADDRESS) : undefined;
}

const storeOn = (env: AutoCashEnv) => Boolean(env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN);
const deskOn = (env: AutoCashEnv) => env.RAMP_ENABLED === "true" && deskAddress(env) !== undefined;

const settingsPath = (a: Address) => `autocash/${a}/settings.json`;
const arrivalPath = (a: Address, tx: string) => `autocash/${a}/arrivals/${tx.toLowerCase()}.json`;
// Moves and holds carry what the cap and GET need in their names, so a list is enough to count them.
const movesPrefix = (a: Address) => `autocash/${a}/moves/`;
const holdsPrefix = (a: Address) => `autocash/${a}/held/`;
const movePath = (a: Address, m: Move) => `${movesPrefix(a)}${m.at}-${m.dollars}-${m.currency}-${m.tx.toLowerCase()}.json`;
const holdPath = (a: Address, h: Hold) => `${holdsPrefix(a)}${h.at}-${h.dollars}-${h.why}-${h.arrivedTx.toLowerCase()}.json`;
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

async function readJson(store: AutoCashStore, path: string): Promise<unknown> {
  const bytes = await store.read(path);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function readSettings(store: AutoCashStore, a: Address, now: number): Promise<AutoCashSettings | null> {
  const s = cleanSettings(await readJson(store, settingsPath(a)), CODES);
  return s ? settle(s, now) : null;
}

/** The moves (or holds) named under a prefix, newest first: [at, dollars, rest of the name]. */
async function named(store: AutoCashStore, prefix: string): Promise<{ at: number; dollars: string; rest: string[] }[]> {
  const out: { at: number; dollars: string; rest: string[] }[] = [];
  for (const path of await store.list(prefix)) {
    const parts = path.slice(prefix.length).replace(/\.json$/, "").split("-");
    const at = Number(parts[0]);
    if (Number.isFinite(at) && isAmount(parts[1])) out.push({ at, dollars: parts[1]!, rest: parts.slice(2) });
  }
  return out.sort((x, y) => y.at - x.at);
}

// ---------------------------------------------------------------------------
// Claims: one file per account, changed only by a conditional write
// ---------------------------------------------------------------------------

/** How many arrivals claims.json keeps; older ones are pruned and raise the floor. */
export const MAX_CLAIMS = 500;
/** How many times a claim is tried when another instance wrote first (412), before answering "try again". */
export const CLAIM_TRIES = 5;

export type Claims = {
  /** The block auto cash out was last turned on at: nothing at or below it is ever moved. */
  onBlock: string;
  /** The highest block ever pruned from `txs`: nothing at or below it is ever claimed again. */
  floor: string;
  txs: { tx: string; block: string }[];
};
const EMPTY_CLAIMS: Claims = { onBlock: "0", floor: "0", txs: [] };
const claimsPath = (a: Address) => `autocash/${a}/claims.json`;

function parseClaims(bytes: Uint8Array): Claims {
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Claims>;
    const num = (v: unknown) => (typeof v === "string" && /^\d{1,30}$/.test(v) ? v : "0");
    const txs = Array.isArray(raw.txs) ? raw.txs.filter((x) => x && typeof x.tx === "string" && /^0x[0-9a-f]{64}$/.test(x.tx) && typeof x.block === "string" && /^\d{1,30}$/.test(x.block)) : [];
    return { onBlock: num(raw.onBlock), floor: num(raw.floor), txs };
  } catch {
    // Unreadable: refuse everything rather than risk moving an arrival twice.
    return { onBlock: (2n ** 64n).toString(), floor: (2n ** 64n).toString(), txs: [] };
  }
}

/** Keeps the newest MAX_CLAIMS by block, and raises the floor to the highest block pruned. */
export function pruneClaims(c: Claims): Claims {
  if (c.txs.length <= MAX_CLAIMS) return c;
  const sorted = [...c.txs].sort((x, y) => (BigInt(x.block) < BigInt(y.block) ? -1 : BigInt(x.block) > BigInt(y.block) ? 1 : 0));
  const pruned = sorted.slice(0, sorted.length - MAX_CLAIMS);
  const top = pruned.reduce((m, x) => (BigInt(x.block) > m ? BigInt(x.block) : m), BigInt(c.floor));
  return { ...c, floor: top.toString(), txs: sorted.slice(sorted.length - MAX_CLAIMS) };
}

/**
 * Changes claims.json by a conditional write. `change` gets what is there now
 * (EMPTY_CLAIMS if nothing) and returns the new claims, or a verdict to stop
 * with. A 412, or a create beaten by another, reads again, CLAIM_TRIES times.
 */
async function changeClaims<V extends string>(store: AutoCashStore, a: Address, change: (c: Claims) => Claims | V): Promise<"ok" | "busy" | V> {
  const path = claimsPath(a);
  for (let i = 0; i < CLAIM_TRIES; i++) {
    const now = await store.readTagged(path);
    const next = change(now ? parseClaims(now.bytes) : EMPTY_CLAIMS);
    if (typeof next === "string") return next;
    const bytes = enc(pruneClaims(next));
    if (!now) {
      if (await store.write(path, bytes, true)) return "ok";
      continue; // Created by someone else first: read it.
    }
    if ((await store.writeIfMatch(path, bytes, now.etag)) === "ok") return "ok";
  }
  return "busy";
}

/** Claims one arrival for one account, or says why not: before it was turned on, already claimed (or pruned), or busy. */
export function claimArrival(store: AutoCashStore, a: Address, tx: Hex, block: bigint) {
  const key = tx.toLowerCase();
  return changeClaims(store, a, (c): Claims | "before" | "already" => {
    if (block <= BigInt(c.onBlock)) return "before";
    if (block <= BigInt(c.floor)) return "already";
    if (c.txs.some((x) => x.tx === key)) return "already";
    return { ...c, txs: [...c.txs, { tx: key, block: block.toString() }] };
  });
}

/** Turned on: nothing at or below this block is ever moved. Only ever raised. */
function markOn(store: AutoCashStore, a: Address, block: bigint) {
  return changeClaims(store, a, (c): Claims => ({ ...c, onBlock: (block > BigInt(c.onBlock) ? block : BigInt(c.onBlock)).toString() }));
}

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}
const inFlight = new Set<Address>();
let recent: { at: number; account: Address }[] = [];
/** Clears this instance's memory. For tests. */
export function forgetRecent(): void {
  recent = [];
  inFlight.clear();
}

function isNonceConflict(error: unknown): boolean {
  const text = String((error as { details?: string; message?: string })?.details ?? (error as Error)?.message ?? error);
  return /nonce too low|nonce.*(already|used)|already known|replacement transaction underpriced/i.test(text);
}

/** Dollars that arrived for `account` in one transaction, from someone else; 0 for anything else. */
export function arrivedFor(a: Arrival, account: Address, desk: Address): bigint {
  if (!a.ok || isAddressEqual(a.sender, account)) return 0n;
  const excluded = (from: Address) => isAddressEqual(from, account) || isAddressEqual(from, desk) || isAddressEqual(from, AUSD_FAUCET) || /^0x0{40}$/i.test(from);
  return a.transfers.filter((t) => isAddressEqual(t.to, account) && !excluded(t.from)).reduce((sum, t) => sum + t.value, 0n);
}

/**
 * One arrival for one account: everything in the header, in order. Claims the
 * transaction for the account before anything moves, and never lets the claim
 * go: a move that failed after it was sent may still have gone through, so it
 * is never tried again. A failure before anything was sent is a hold.
 */
async function handleArrival(store: AutoCashStore, chain: AutoCashChain, env: AutoCashEnv, account: Address, tx: Hex, arrival: Arrival | "pending" | null, now: number, log: Logger): Promise<Outcome> {
  const settings = await readSettings(store, account, now);
  if (!settings?.on) return { account, result: "off" };
  if (arrival === null) return { account, result: "unknown" };
  if (arrival === "pending") return { account, result: "pending" };
  const desk = deskAddress(env);
  const arrived = desk ? arrivedFor(arrival, account, desk) : 0n;
  if (arrived === 0n || Number(arrival.time) * 1000 < settings.since) return { account, result: "none" };

  const hold = async (why: HeldWhy, dollars: bigint): Promise<Outcome> => {
    const h: Hold = { arrivedTx: tx, dollars: dollars.toString(), why, at: now };
    await store.write(holdPath(account, h), enc(h), false).catch(() => {});
    log({ event: "held", account, why, amount: h.dollars, tx });
    return { account, result: "held", hold: h };
  };
  // Switched off: told, nothing claimed, so nothing moves later either.
  if (!deskOn(env) || !desk) return hold("paused", arrived);
  const claim = await claimArrival(store, account, tx, arrival.block);
  if (claim === "before") return { account, result: "none" };
  if (claim === "already") return { account, result: "already" };
  // Another instance kept writing first: nothing claimed, nothing moved; the next check tries again.
  if (claim === "busy") return { account, result: "pending" };
  await store.write(arrivalPath(account, tx), enc({ state: "claimed", at: now }), false).catch(() => {});

  let sending = false;
  try {
    const moves = await named(store, movesPrefix(account));
    const capLeft = BigInt(settings.cap) - movedToday(moves, now);
    const [balance, allowance] = await Promise.all([chain.dollars(account), chain.allowance(account, desk)]);
    const { amount, held } = amountToMove({ arrived, balance, keep: settings.keep === null ? null : BigInt(settings.keep), capLeft: capLeft > 0n ? capLeft : 0n, allowance });
    if (amount === 0n) {
      await store.write(arrivalPath(account, tx), enc({ state: held, at: now }), false);
      return held === "kept" || held === "small" ? { account, result: "kept" } : hold(held!, arrived);
    }
    if (moves.filter((m) => now - m.at < 60 * 60 * 1000).length >= MAX_MOVES_PER_HOUR) return hold("busy", arrived);
    const [latest, nowNonce] = await Promise.all([chain.latestBlock(), chain.deskNonce(desk)]);
    const hourAgo = latest > BLOCKS_PER_HOUR ? latest - BLOCKS_PER_HOUR : 0n;
    if (nowNonce - (await chain.deskNonceAt(desk, hourAgo)) >= DESK_TXS_PER_HOUR) return hold("busy", arrived);
    if ((await chain.gasBalance(desk)) < DESK_GAS_FLOOR) return hold("desk", arrived);
    const fees = await chain.fees();

    // Every check has passed: only now is the key read (liveChain), inside pull.
    sending = true;
    const hash = await serialized(async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await chain.pull(account, amount, await chain.deskNonce(desk), fees);
        } catch (error) {
          lastError = error;
          if (!isNonceConflict(error)) break;
        }
      }
      throw lastError;
    });
    const currency = CURRENCIES.find((c) => c.code === settings.currency)!;
    const q = quoteCashOut(currency, amount);
    const move: Move = { tx: hash, arrivedTx: tx, dollars: amount.toString(), fee: q.fee.toString(), bankGets: q.bankGets.toString(), currency: currency.code, reference: referenceForTx(hash), at: now };
    await store.write(movePath(account, move), enc(move), false);
    await store.write(arrivalPath(account, tx), enc({ state: "moved", move: hash, at: now }), false);
    log({ event: "moved", account, amount: move.dollars, currency: move.currency, arrived: tx, tx: hash });
    return { account, result: "moved", move, bank: settings.bank };
  } catch (error) {
    const code = error instanceof AutoCashConfigError ? error.code : sending ? "SEND_FAILED" : "RPC_FAILED";
    log({ event: "failed", account, tx, code, detail: error instanceof AutoCashConfigError ? "" : safeDetail(error) });
    await store.write(arrivalPath(account, tx), enc({ state: sending ? "unknown" : "failed", at: now }), false).catch(() => {});
    // Sent, then lost: it may have gone through, so nothing is said that could be wrong; History shows it if it did.
    return sending && !(error instanceof AutoCashConfigError) ? { account, result: "unknown" } : hold("desk", arrived);
  }
}

export async function handleAutoCash(
  request: Request,
  env: AutoCashEnv,
  makeChain: (env: AutoCashEnv) => AutoCashChain,
  makeStore: (env: AutoCashEnv) => AutoCashStore,
  log: Logger = (e) => console.log(JSON.stringify(e)),
  now: () => number = Date.now,
): Promise<Response> {
  const t = now();
  if (request.method === "GET") {
    if (!storeOn(env)) return json(200, { enabled: false, desk: null, on: false });
    const raw = new URL(request.url).searchParams.get("account") ?? "";
    if (!isAddress(raw)) return json(400, { error: "not an account" });
    const account = getAddress(raw);
    const store = makeStore(env);
    const s = await readSettings(store, account, t);
    const since = (x: { at: number }) => t - x.at < SHOWN_MS;
    const moves = (await named(store, movesPrefix(account))).filter(since);
    const holds = (await named(store, holdsPrefix(account))).filter(since);
    return json(200, {
      enabled: deskOn(env),
      desk: deskAddress(env) ?? null,
      on: s?.on ?? false,
      ...(s ? { currency: s.currency, cap: s.cap, keep: s.keep, since: s.since, pending: s.pending ? { startsAt: s.pending.startsAt, bank: s.pending.bank !== undefined, ...(s.pending.cap ? { cap: s.pending.cap } : {}) } : null } : {}),
      movedToday: movedToday(moves, t).toString(),
      moves: moves.slice(0, 20).map((m) => ({ at: m.at, dollars: m.dollars, currency: m.rest[0], tx: m.rest[1] })),
      held: holds.slice(0, 20).map((h) => ({ at: h.at, dollars: h.dollars, why: h.rest[0], tx: h.rest[1] })),
    });
  }
  if (request.method !== "POST") return json(405, { error: "use GET or POST" });
  if (!storeOn(env)) return json(503, { error: "auto cash out is not set up" });
  if (!originAllowed(request, env)) return json(403, { error: "same origin only" });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(413, { error: "request too large" });
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: "request too large" });
    body = JSON.parse(text) as Record<string, unknown>;
    if (!body || typeof body !== "object") throw new Error("not an object");
  } catch {
    return json(400, { error: "send JSON" });
  }
  const kind = body.kind;
  if (!["set", "cancel", "off", "arrived", "check"].includes(String(kind))) return json(400, { error: "kind is set, cancel, off, arrived or check" });
  const store = makeStore(env);

  recent = recent.filter((r) => t - r.at < 60_000);
  const limited = (a: Address) => {
    if (recent.filter((r) => r.account === a).length >= MAX_REQUESTS_PER_MINUTE) return true;
    recent.push({ at: t, account: a });
    return false;
  };

  if (kind === "arrived") {
    const tx = body.tx;
    if (typeof tx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx)) return json(400, { error: "not a valid transaction" });
    const accounts = Array.isArray(body.accounts) ? [...new Set(body.accounts.filter((a): a is string => typeof a === "string" && isAddress(a)).map((a) => getAddress(a)))].slice(0, MAX_ACCOUNTS) : [];
    if (!accounts.length) return json(400, { error: "no accounts" });
    return json(200, { outcomes: await arrivals(store, makeChain, env, accounts.map((a) => [a, tx as Hex]), t, log, limited) });
  }

  const raw = body.account;
  if (typeof raw !== "string" || !isAddress(raw)) return json(400, { error: "not an account" });
  const account = getAddress(raw);
  if (limited(account)) return json(429, { error: "too many, try again in a minute" });

  if (kind === "check") {
    const txs = Array.isArray(body.txs) ? [...new Set(body.txs.filter((x): x is string => typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x)).map((x) => x.toLowerCase()))].slice(0, MAX_TXS) : [];
    if (!txs.length) return json(400, { error: "no transactions" });
    recent.pop();
    return json(200, { outcomes: await arrivals(store, makeChain, env, txs.map((x) => [account, x as Hex]), t, log, () => false) });
  }

  if (kind === "off") {
    const s = await readSettings(store, account, t);
    if (s?.on) await store.write(settingsPath(account), enc(turnOff(s)), false);
    log({ event: "off", account });
    return json(200, { on: false });
  }

  // set and cancel: a proof the account's passkey signed, as api/push.
  const { time, signature } = body;
  if (typeof time !== "number" || !Number.isInteger(time) || Math.abs(t / 1000 - time) > PROOF_WINDOW_S) return json(401, { error: "the proof is too old or from the future" });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return json(400, { error: "no proof" });
  let req: AutoCashRequest | null = null;
  if (kind === "set") {
    req = cleanRequest(body.settings, CODES);
    if (!req) {
      log({ event: "refused", account, reason: "bad settings" });
      return json(400, { error: "the settings aren't right: a known currency, the bank's name and the last 4 digits only, a cap of $1 to $1,000" });
    }
  }
  const data = req ? `sha256:${createHash("sha256").update(requestText(req)).digest("hex")}` : "none";
  const message = proofMessage({ subject: "autocash", action: kind === "set" ? "on" : "cancel", account, data, time, site: new URL(request.url).host });
  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message, signature: signature as Hex });
  } catch {
    return json(401, { error: "the proof doesn't check out" });
  }
  if (!isAddressEqual(signer, account)) return json(401, { error: "the proof doesn't check out" });
  const current = await readSettings(store, account, t);
  const next = req ? change(current, req, t) : current ? cancelPending(current) : null;
  // Turned on: the block now becomes the floor below which nothing is ever moved (claims.json), before the settings say on.
  if (next?.on && !current?.on) {
    let block: bigint;
    try {
      block = await makeChain(env).latestBlock();
    } catch {
      return json(502, { error: "could not read the chain, try again in a minute" });
    }
    if ((await markOn(store, account, block)) !== "ok") return json(503, { error: "busy, try again in a minute" });
  }
  if (next) await store.write(settingsPath(account), enc(next), false);
  log({ event: String(kind), account, waiting: next?.pending ? "yes" : "no" });
  return json(200, { on: next?.on ?? false, currency: next?.currency, cap: next?.cap, keep: next?.keep, since: next?.since, pending: next?.pending ? { startsAt: next.pending.startsAt, bank: next.pending.bank !== undefined, ...(next.pending.cap ? { cap: next.pending.cap } : {}) } : null });
}

/** Each (account, transaction) in turn, one request per account at a time, each transaction's receipt read once. */
async function arrivals(store: AutoCashStore, makeChain: (env: AutoCashEnv) => AutoCashChain, env: AutoCashEnv, work: [Address, Hex][], t: number, log: Logger, limited: (a: Address) => boolean): Promise<Outcome[]> {
  const chain = makeChain(env);
  if ((await chain.chainId().catch(() => 0)) !== CHAIN_ID) return work.map(([account]) => ({ account, result: "unknown" as const }));
  const receipts = new Map<string, Promise<Arrival | "pending" | null>>();
  const out: Outcome[] = [];
  for (const [account, tx] of work) {
    if (inFlight.has(account) || limited(account)) {
      out.push({ account, result: "pending" });
      continue;
    }
    inFlight.add(account);
    try {
      if (!receipts.has(tx)) receipts.set(tx, chain.arrival(tx).catch(() => null));
      out.push(await handleArrival(store, chain, env, account, tx, await receipts.get(tx)!, t, log));
    } finally {
      inFlight.delete(account);
    }
  }
  return out;
}

/** A configuration problem, with a code that is safe to log. */
export class AutoCashConfigError extends Error {
  readonly code: "DESK_KEY_MALFORMED" | "DESK_KEY_MISMATCH";
  constructor(code: "DESK_KEY_MALFORMED" | "DESK_KEY_MISMATCH") {
    super(code);
    this.name = "AutoCashConfigError";
    this.code = code;
  }
}

export function normalizeDeskKey(raw: string | undefined): Hex {
  const key = (raw ?? "").trim();
  const withPrefix = /^[0-9a-fA-F]{64}$/.test(key) ? `0x${key}` : key;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) throw new AutoCashConfigError("DESK_KEY_MALFORMED");
  return withPrefix as Hex;
}

export function safeDetail(error: unknown): string {
  const e = error as { shortMessage?: unknown; message?: unknown; name?: unknown };
  const text = String(e?.shortMessage ?? e?.message ?? e?.name ?? "unknown").split("\n")[0] ?? "";
  return text.replace(/0x[0-9a-fA-F]{40,}/g, "0x…").replace(/[0-9a-fA-F]{40,}/g, "…").slice(0, 120);
}

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "transferFrom", stateMutability: "nonpayable", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "event", name: "Transfer", inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false }] },
] as const;

/** The real chain, on the public testnet RPC; reads of a receipt at the finalized block. The key is read only in pull. */
export function liveChain(env: AutoCashEnv): AutoCashChain {
  const transport = http(RPC_URL, { timeout: 10_000, retryCount: 1 });
  const client = createPublicClient({ chain: monadTestnet, transport });
  const desk = getAddress(env.RAMP_DESK_ADDRESS ?? "");
  let wallet: ReturnType<typeof createWalletClient> | undefined;
  const walletClient = () => {
    if (wallet) return wallet;
    const account = privateKeyToAccount(normalizeDeskKey(env.RAMP_DESK_PRIVATE_KEY));
    if (account.address !== desk) throw new AutoCashConfigError("DESK_KEY_MISMATCH");
    wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL, { timeout: 10_000, retryCount: 0 }) });
    return wallet;
  };
  return {
    chainId: () => client.getChainId(),
    arrival: async (tx) => {
      const receipt = await client.getTransactionReceipt({ hash: tx }).catch(() => null);
      if (!receipt) return null;
      const finalized = await client.getBlock({ blockTag: "finalized" });
      if (receipt.blockNumber > finalized.number) return "pending";
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      const transfers = parseEventLogs({ abi: ERC20_ABI, eventName: "Transfer", logs: receipt.logs })
        .filter((l) => isAddressEqual(l.address, AUSD))
        .map((l) => ({ from: getAddress(l.args.from), to: getAddress(l.args.to), value: l.args.value }));
      return { sender: getAddress(receipt.from), block: receipt.blockNumber, time: block.timestamp, ok: receipt.status === "success", transfers };
    },
    dollars: (a) => client.readContract({ address: AUSD, abi: ERC20_ABI, functionName: "balanceOf", args: [a] }),
    allowance: (owner, spender) => client.readContract({ address: AUSD, abi: ERC20_ABI, functionName: "allowance", args: [owner, spender] }),
    gasBalance: (a) => client.getBalance({ address: a }),
    deskNonce: (d) => client.getTransactionCount({ address: d, blockTag: "pending" }),
    latestBlock: () => client.getBlockNumber(),
    deskNonceAt: (d, block) => client.getTransactionCount({ address: d, blockNumber: block }),
    fees: async () => {
      const [price, tip] = await Promise.all([client.getGasPrice(), client.estimateMaxPriorityFeePerGas()]);
      const maxFeePerGas = (price * 105n) / 100n;
      return { maxFeePerGas, maxPriorityFeePerGas: tip < maxFeePerGas ? tip : maxFeePerGas };
    },
    pull: async (owner, amount, nonce, fees) => {
      const w = walletClient();
      const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transferFrom", args: [owner, desk, amount] });
      const gas = await client.estimateGas({ account: desk, to: AUSD, data }).catch(() => 120_000n);
      const hash = await w.sendTransaction({ account: w.account!, chain: monadTestnet, to: AUSD, data, gas: (gas * 13n) / 10n, nonce, ...fees });
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 20_000 });
      if (receipt.status !== "success") throw new Error("the move didn't go through");
      return hash;
    },
  };
}

/** Vercel Blob, private. */
export function blobStore(env: AutoCashEnv): AutoCashStore {
  const token = env.BLOB_READ_WRITE_TOKEN;
  return {
    read: async (path) => {
      const found = await get(path, { access: "private", token, useCache: false }).catch(() => null);
      if (!found || found.statusCode !== 200) return null;
      return new Uint8Array(await new Response(found.stream).arrayBuffer());
    },
    write: async (path, bytes, create) => {
      try {
        await put(path, Buffer.from(bytes), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: !create, token });
        return true;
      } catch (error) {
        if (create && /already exists/i.test(String((error as Error)?.message))) return false;
        throw error;
      }
    },
    list: async (prefix) => (await list({ prefix, limit: 200, token })).blobs.map((b) => b.pathname),
    remove: async (path) => {
      await del(path, { token });
    },
    // Past the CDN cache, straight from origin storage, with the ETag a conditional write needs.
    readTagged: async (path) => {
      const found = await get(path, { access: "private", token, useCache: false }).catch(() => null);
      if (!found || found.statusCode !== 200) return null;
      return { bytes: new Uint8Array(await new Response(found.stream).arrayBuffer()), etag: found.blob.etag };
    },
    writeIfMatch: async (path, bytes, etag) => {
      try {
        await put(path, Buffer.from(bytes), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, ifMatch: etag, token });
        return "ok";
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return "changed";
        throw error;
      }
    },
  };
}

export function POST(request: Request): Promise<Response> {
  const env = process.env as AutoCashEnv;
  return handleAutoCash(request, env, liveChain, blobStore);
}

export function GET(request: Request): Promise<Response> {
  const env = process.env as AutoCashEnv;
  return handleAutoCash(request, env, liveChain, blobStore);
}
