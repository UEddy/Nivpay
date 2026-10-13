// /api/ramp: the TEST desk behind Add money and Cash out. A simulation: no
// bank is involved, no real currency moves, and only test AUSD leaves or
// reaches the desk account. On mainnet a licensed partner does the bank side
// (README, "Mainnet plan: money in and out in any currency").
//
// GET returns { enabled, desk } and nothing secret.
// POST { kind: "buy", address, currency, amount } sends the desk's test AUSD
//   for `amount` local minor units, quoted here, never trusted from the phone.
// POST { kind: "cashout", address, currency, tx } checks, at the finalized
//   block, that `tx` succeeded and moved AUSD from `address` to the desk, and
//   returns what a bank would get, with a reference derived from `tx`, so
//   asking twice gives the same answer. It sends nothing.
//
// Abuse limits, in the style of /api/fund:
//  * RAMP_ENABLED must be exactly "true", or nothing else runs.
//  * Same origin only, by the Origin header. That stops other websites, not
//    scripts.
//  * Request bodies over MAX_BODY_BYTES are refused unread.
//  * A buy is $1 to $100, and only for a personal account (no code) holding
//    under HOLD_LIMIT of AUSD.
//  * One request per address at a time on an instance, and an address that
//    bought in the last RECENT_MS is refused on that instance.
//  * At most DESK_TXS_PER_HOUR desk transactions in all, counted from the
//    desk's own nonce now and about an hour of blocks ago, so the cap holds
//    across every instance with no storage.
//  * When the desk runs low it claims from Agora's AUSD faucet for itself
//    (requestFunds(desk)), only after a call shows the faucet would pay.
//
// The desk key is read only after every check has passed, never when
// RAMP_ENABLED is off, never on a cash out, and never logged. Logs carry the
// address, the currency, the amount and the transaction, nothing else.
//
// The currency table and the quotes are a copy of app/src/lib/ramp.ts: this
// folder builds with NodeNext and doesn't import from src.
// app/src/api-tests/ramp.test.ts fails if the two ever differ.

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
/** A buy is refused for an account holding this much test AUSD or more. */
export const HOLD_LIMIT = 1_000n * DOLLAR;
/** Below this, after a buy, the desk claims from the faucet for itself. */
export const DESK_LOW = 500n * DOLLAR;
/** The desk's own MON for gas, below which it stops. */
export const DESK_GAS_FLOOR = parseEther("0.2");
/** Buys and refills in about an hour, from every instance together. */
export const DESK_TXS_PER_HOUR = 30;
/** About an hour of Monad testnet blocks, as in /api/fund. */
export const BLOCKS_PER_HOUR = 11_600n;
export const RECENT_MS = 120_000;
export const MAX_BODY_BYTES = 1_024;

// ---------------------------------------------------------------------------
// The quotes: a copy of app/src/lib/ramp.ts
// ---------------------------------------------------------------------------

export type Route = "ramp" | "local" | "aggregator";
export type Currency = { code: string; symbol: string; digits: number; testMinorPerDollar: bigint; route: Route };
const CENT = DOLLAR / 100n;

export const CURRENCIES: readonly Currency[] = [
  { code: "NGN", symbol: "₦", digits: 2, testMinorPerDollar: 155_000n, route: "local" },
  { code: "GBP", symbol: "£", digits: 2, testMinorPerDollar: 79n, route: "ramp" },
  { code: "USD", symbol: "$", digits: 2, testMinorPerDollar: 100n, route: "ramp" },
  { code: "EUR", symbol: "€", digits: 2, testMinorPerDollar: 92n, route: "local" },
  { code: "GHS", symbol: "GH₵", digits: 2, testMinorPerDollar: 1_550n, route: "local" },
  { code: "KES", symbol: "KSh", digits: 2, testMinorPerDollar: 12_900n, route: "local" },
  { code: "ZAR", symbol: "R", digits: 2, testMinorPerDollar: 1_820n, route: "local" },
  { code: "XOF", symbol: "CFA", digits: 0, testMinorPerDollar: 605n, route: "aggregator" },
  { code: "EGP", symbol: "E£", digits: 2, testMinorPerDollar: 4_850n, route: "aggregator" },
  { code: "CAD", symbol: "CA$", digits: 2, testMinorPerDollar: 137n, route: "ramp" },
  { code: "AUD", symbol: "A$", digits: 2, testMinorPerDollar: 152n, route: "ramp" },
  { code: "INR", symbol: "₹", digits: 2, testMinorPerDollar: 8_350n, route: "local" },
  { code: "CNY", symbol: "CN¥", digits: 2, testMinorPerDollar: 725n, route: "local" },
  { code: "AED", symbol: "AED", digits: 2, testMinorPerDollar: 367n, route: "aggregator" },
  { code: "BRL", symbol: "R$", digits: 2, testMinorPerDollar: 540n, route: "aggregator" },
  { code: "MXN", symbol: "MX$", digits: 2, testMinorPerDollar: 1_800n, route: "aggregator" },
  { code: "PHP", symbol: "₱", digits: 2, testMinorPerDollar: 5_700n, route: "aggregator" },
  { code: "JPY", symbol: "¥", digits: 0, testMinorPerDollar: 150n, route: "aggregator" },
];

export const MIN_DOLLARS = 1n * DOLLAR;
export const MAX_DOLLARS = 100n * DOLLAR;
export const FEE_BPS = 100n;
export type Limit = "too-small" | "too-large" | null;

export function limitFor(dollars: bigint): Limit {
  if (dollars < MIN_DOLLARS) return "too-small";
  if (dollars > MAX_DOLLARS) return "too-large";
  return null;
}

function feeOn(dollars: bigint): bigint {
  const raw = (dollars * FEE_BPS + 9_999n) / 10_000n;
  return ((raw + CENT - 1n) / CENT) * CENT;
}

export function quoteAdd(currency: Currency, localMinor: bigint) {
  const safe = localMinor > 0n ? localMinor : 0n;
  const cents = (safe * 100n) / currency.testMinorPerDollar;
  const gross = cents * CENT;
  const fee = gross > 0n ? feeOn(gross) : 0n;
  const received = gross > fee ? gross - fee : 0n;
  return { currency: currency.code, localMinor: safe, gross, fee, received, limit: limitFor(gross) };
}

export function quoteCashOut(currency: Currency, dollars: bigint) {
  const safe = dollars > 0n ? dollars : 0n;
  const fee = safe > 0n ? feeOn(safe) : 0n;
  const net = safe > fee ? safe - fee : 0n;
  const bankGets = (net * currency.testMinorPerDollar) / DOLLAR;
  return { currency: currency.code, dollars: safe, fee, bankGets, limit: limitFor(safe) };
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
// The handler
// ---------------------------------------------------------------------------

export type RampEnv = {
  RAMP_ENABLED?: string;
  RAMP_DESK_ADDRESS?: string;
  RAMP_DESK_PRIVATE_KEY?: string;
  /** Optional, comma separated, as in /api/fund. */
  ALLOWED_ORIGINS?: string;
};

export type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

/** One AUSD transfer in a finalized transaction. */
export type Moved = { from: Address; to: Address; value: bigint };

/** Everything the handler needs from the chain, so tests can script it. */
export interface RampChain {
  chainId(): Promise<number>;
  hasCode(address: Address): Promise<boolean>;
  /** AUSD held, at the latest block. */
  dollars(address: Address): Promise<bigint>;
  /** MON held for gas. */
  gasBalance(address: Address): Promise<bigint>;
  fees(): Promise<Fees>;
  deskNonce(desk: Address): Promise<number>;
  latestBlock(): Promise<bigint>;
  deskNonceAt(desk: Address, block: bigint): Promise<number>;
  /** True when a call of requestFunds(desk) from the desk would pay. */
  faucetWouldPay(desk: Address): Promise<boolean>;
  /** Sends `amount` AUSD from the desk. Throws on a nonce conflict. */
  sendDollars(to: Address, amount: bigint, nonce: number, fees: Fees): Promise<Hex>;
  /** Claims from Agora's faucet for the desk. */
  refill(nonce: number, fees: Fees): Promise<Hex>;
  /**
   * The transaction's AUSD transfers, if it is in a finalized block: "pending"
   * if it isn't final yet or isn't found, "reverted" if it failed.
   */
  finalizedTransfers(tx: Hex): Promise<Moved[] | "pending" | "reverted">;
}

export type Logger = (entry: Record<string, string>) => void;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function originAllowed(request: Request, env: RampEnv): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const own = new URL(request.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return origin === own || extra.includes(origin);
}

function deskAddress(env: RampEnv): Address | undefined {
  return env.RAMP_DESK_ADDRESS && isAddress(env.RAMP_DESK_ADDRESS) ? getAddress(env.RAMP_DESK_ADDRESS) : undefined;
}

function isNonceConflict(error: unknown): boolean {
  const text = String((error as { details?: string; message?: string })?.details ?? (error as Error)?.message ?? error);
  return /nonce too low|nonce.*(already|used)|already known|replacement transaction underpriced/i.test(text);
}

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}
const inFlight = new Set<Address>();
const recent = new Map<Address, number>();
/** For tests, which reuse addresses. */
export function forgetRecentBuys(): void {
  recent.clear();
}

/** GET: whether the desk is on, and its account, so the phone knows where a cash out goes. */
export function handleInfo(env: RampEnv): Response {
  const desk = deskAddress(env);
  return json(200, { enabled: env.RAMP_ENABLED === "true" && desk !== undefined, desk: desk ?? null });
}

export async function handleRamp(
  request: Request,
  env: RampEnv,
  makeChain: (env: RampEnv) => RampChain,
  log: Logger = (e) => console.log(JSON.stringify(e)),
  now: () => number = Date.now,
): Promise<Response> {
  if (request.method === "GET") return handleInfo(env);
  if (request.method !== "POST") return json(405, { error: "use GET or POST" });
  if (env.RAMP_ENABLED !== "true") return json(503, { error: "the test desk is paused" });
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
  if (kind !== "buy" && kind !== "cashout") return json(400, { error: "kind is buy or cashout" });
  const raw = body.address;
  if (typeof raw !== "string" || !isAddress(raw) || /^0x0{40}$/i.test(raw)) {
    log({ event: "refused", reason: "bad address" });
    return json(400, { error: "not a valid address" });
  }
  const address = getAddress(raw);
  const refuse = (status: number, reason: string) => {
    log({ event: "refused", kind, address, reason });
    return json(status, { error: reason });
  };
  const currency = CURRENCIES.find((c) => c.code === body.currency);
  if (!currency) return refuse(400, "unknown currency");
  const desk = deskAddress(env);
  if (!desk) return refuse(503, "the test desk is not configured");

  if (inFlight.has(address)) return refuse(409, "a request for this account is already on its way");
  for (const [a, at] of recent) if (now() - at > RECENT_MS) recent.delete(a);

  if (kind === "cashout") {
    const tx = body.tx;
    if (typeof tx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx)) return refuse(400, "not a valid transaction");
    inFlight.add(address);
    try {
      const chain = makeChain(env);
      if ((await chain.chainId()) !== CHAIN_ID) return refuse(503, "wrong chain");
      const moved = await chain.finalizedTransfers(tx as Hex);
      if (moved === "pending") return refuse(409, "that transaction isn't final yet");
      if (moved === "reverted") return refuse(409, "that transaction didn't go through");
      const dollars = moved.filter((m) => isAddressEqual(m.from, address) && isAddressEqual(m.to, desk)).reduce((sum, m) => sum + m.value, 0n);
      if (dollars === 0n) return refuse(409, "no dollars reached the desk in that transaction");
      const q = quoteCashOut(currency, dollars);
      log({ event: "cashout", address, currency: currency.code, amount: dollars.toString(), tx });
      return json(200, {
        simulated: true,
        currency: currency.code,
        dollars: q.dollars.toString(),
        fee: q.fee.toString(),
        bankGets: q.bankGets.toString(),
        reference: referenceForTx(tx),
      });
    } catch (error) {
      log({ event: "failed", kind, address, code: "RPC_FAILED", detail: safeDetail(error) });
      return json(502, { error: "could not check the cash out, try again in a minute", code: "RPC_FAILED" });
    } finally {
      inFlight.delete(address);
    }
  }

  // A buy. The quote is made here, from the local amount alone.
  const amountText = body.amount;
  if (typeof amountText !== "string" || !/^\d{1,24}$/.test(amountText)) return refuse(400, "amount is a whole number of minor units, as text");
  const q = quoteAdd(currency, BigInt(amountText));
  if (q.limit === "too-small") return refuse(400, "under $1");
  if (q.limit === "too-large") return refuse(400, "over $100");
  if (recent.has(address)) return refuse(409, "this account just added money, try again in two minutes");

  inFlight.add(address);
  let stage: "checks" | "send" = "checks";
  try {
    const chain = makeChain(env);
    if ((await chain.chainId()) !== CHAIN_ID) return refuse(503, "wrong chain");
    if (await chain.hasCode(address)) return refuse(409, "only personal accounts can add money");
    if ((await chain.dollars(address)) >= HOLD_LIMIT) return refuse(409, "this account already holds $1,000 or more");
    const [latest, nowNonce] = await Promise.all([chain.latestBlock(), chain.deskNonce(desk)]);
    const hourAgo = latest > BLOCKS_PER_HOUR ? latest - BLOCKS_PER_HOUR : 0n;
    if (nowNonce - (await chain.deskNonceAt(desk, hourAgo)) >= DESK_TXS_PER_HOUR) return refuse(503, "the test desk is busy, try again later");
    if ((await chain.gasBalance(desk)) < DESK_GAS_FLOOR) return refuse(503, "the test desk is paused, it is out of processing funds");

    const held = await chain.dollars(desk);
    const short = held < q.received;
    const wouldPay = short || held - q.received < DESK_LOW ? await chain.faucetWouldPay(desk) : false;
    if (short && !wouldPay) return refuse(503, "the test desk is restocking, try again in a minute");
    const fees = await chain.fees();

    stage = "send";
    const { hash, refill } = await serialized(async () => {
      let lastError: unknown;
      let refillHash: Hex | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        let nonce = await chain.deskNonce(desk);
        try {
          // Short: the claim goes first, and the send after it on the next nonce.
          if (short && !refillHash) refillHash = await chain.refill(nonce++, fees);
          const sent = await chain.sendDollars(address, q.received, nonce++, fees);
          if (!short && wouldPay) {
            // Running low: restock after this send, best effort.
            refillHash = await chain.refill(nonce, fees).catch(() => undefined);
          }
          return { hash: sent, refill: refillHash };
        } catch (error) {
          lastError = error;
          if (!isNonceConflict(error)) break;
        }
      }
      throw lastError;
    });

    recent.set(address, now());
    log({ event: "buy", address, currency: currency.code, local: q.localMinor.toString(), amount: q.received.toString(), hash });
    if (refill) log({ event: "refill", hash: refill });
    return json(200, { simulated: true, hash, received: q.received.toString(), fee: q.fee.toString(), gross: q.gross.toString() });
  } catch (error) {
    const code = error instanceof RampConfigError ? error.code : stage === "checks" ? "RPC_FAILED" : "SEND_FAILED";
    const detail = error instanceof RampConfigError ? "" : safeDetail(error);
    log({ event: "failed", kind, address, code, detail });
    return json(502, { error: "could not send the dollars, try again in a minute", code });
  } finally {
    inFlight.delete(address);
  }
}

/** A configuration problem, with a code that is safe to log and return. */
export class RampConfigError extends Error {
  readonly code: "DESK_KEY_MALFORMED" | "DESK_KEY_MISMATCH";
  constructor(code: "DESK_KEY_MALFORMED" | "DESK_KEY_MISMATCH") {
    super(code);
    this.name = "RampConfigError";
    this.code = code;
  }
}

/** As pasted into Vercel: spaces or newlines around it, 0x or not. The key never appears in any error. */
export function normalizeDeskKey(raw: string | undefined): Hex {
  const key = (raw ?? "").trim();
  const withPrefix = /^[0-9a-fA-F]{64}$/.test(key) ? `0x${key}` : key;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) throw new RampConfigError("DESK_KEY_MALFORMED");
  return withPrefix as Hex;
}

export function safeDetail(error: unknown): string {
  const e = error as { shortMessage?: unknown; message?: unknown; name?: unknown };
  const text = String(e?.shortMessage ?? e?.message ?? e?.name ?? "unknown").split("\n")[0] ?? "";
  return text.replace(/0x[0-9a-fA-F]{40,}/g, "0x…").replace(/[0-9a-fA-F]{40,}/g, "…").slice(0, 120);
}

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

const FAUCET_ABI = [
  { type: "function", name: "requestFunds", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }], outputs: [] },
] as const;

/** The real chain, on the public testnet RPC. The key is read here, only when a send is made. */
export function liveChain(env: RampEnv): RampChain {
  const transport = http(RPC_URL, { timeout: 10_000, retryCount: 1 });
  const client = createPublicClient({ chain: monadTestnet, transport });
  const desk = getAddress(env.RAMP_DESK_ADDRESS ?? "");
  let wallet: ReturnType<typeof createWalletClient> | undefined;
  const walletClient = () => {
    if (wallet) return wallet;
    const account = privateKeyToAccount(normalizeDeskKey(env.RAMP_DESK_PRIVATE_KEY));
    if (account.address !== desk) throw new RampConfigError("DESK_KEY_MISMATCH");
    wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL, { timeout: 10_000, retryCount: 0 }) });
    return wallet;
  };
  const send = async (to: Address, data: Hex, nonce: number, fees: Fees) => {
    const w = walletClient();
    // Estimated as of the pending state, with a margin: a refill sent just
    // before on the previous nonce changes what the transfer costs.
    const gas = await client.estimateGas({ account: desk, to, data }).catch(() => 150_000n);
    return w.sendTransaction({ account: w.account!, chain: monadTestnet, to, data, gas: (gas * 13n) / 10n, nonce, ...fees });
  };
  return {
    chainId: () => client.getChainId(),
    hasCode: async (a) => ((await client.getCode({ address: a })) ?? "0x") !== "0x",
    dollars: (a) => client.readContract({ address: AUSD, abi: ERC20_ABI, functionName: "balanceOf", args: [a] }),
    gasBalance: (a) => client.getBalance({ address: a }),
    deskNonce: (d) => client.getTransactionCount({ address: d, blockTag: "pending" }),
    latestBlock: () => client.getBlockNumber(),
    deskNonceAt: (d, block) => client.getTransactionCount({ address: d, blockNumber: block }),
    faucetWouldPay: async (d) => {
      try {
        await client.call({ account: d, to: AUSD_FAUCET, data: encodeFunctionData({ abi: FAUCET_ABI, functionName: "requestFunds", args: [d] }) });
        return true;
      } catch {
        return false;
      }
    },
    fees: async () => {
      const [price, tip] = await Promise.all([client.getGasPrice(), client.estimateMaxPriorityFeePerGas()]);
      const maxFeePerGas = (price * 105n) / 100n;
      return { maxFeePerGas, maxPriorityFeePerGas: tip < maxFeePerGas ? tip : maxFeePerGas };
    },
    sendDollars: (to, amount, nonce, fees) => send(AUSD, encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [to, amount] }), nonce, fees),
    refill: (nonce, fees) => send(AUSD_FAUCET, encodeFunctionData({ abi: FAUCET_ABI, functionName: "requestFunds", args: [desk] }), nonce, fees),
    finalizedTransfers: async (tx) => {
      const receipt = await client.getTransactionReceipt({ hash: tx }).catch(() => null);
      if (!receipt) return "pending";
      const finalized = await client.getBlock({ blockTag: "finalized" });
      if (receipt.blockNumber > finalized.number) return "pending";
      if (receipt.status !== "success") return "reverted";
      return parseEventLogs({ abi: ERC20_ABI, eventName: "Transfer", logs: receipt.logs })
        .filter((l) => isAddressEqual(l.address, AUSD))
        .map((l) => ({ from: getAddress(l.args.from), to: getAddress(l.args.to), value: l.args.value }));
    },
  };
}

export function POST(request: Request): Promise<Response> {
  return handleRamp(request, process.env as RampEnv, liveChain);
}

export function GET(): Response {
  return handleInfo(process.env as RampEnv);
}
