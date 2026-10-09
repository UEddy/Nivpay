// POST /api/fund: tops up a NivPay account with a little testnet MON so that
// people never see gas. Vercel function, Web API signature.
//
// Abuse limits, stated honestly (also in the README):
//  * An address gets a grant only while it holds under THRESHOLD, has sent
//    fewer than MAX_SENT_TXS transactions, and has no contract code.
//  * The worst case per address is about MAX_SENT_TXS grants, 1 MON, if
//    someone deliberately spends each grant away.
//  * New addresses cost nothing to make, so a determined abuser with many
//    addresses can drain the funder down to FLOOR, where granting stops.
//  * Same-origin only, by the Origin header. That stops other websites from
//    using a visitor's browser; it does not stop scripts, which can send any
//    Origin they like.
//  * Two requests for the same address on different server instances at the
//    same moment can both pass the balance check, so one address can get two
//    grants in a race. Nonces never clash: sends are serialized per instance
//    and a nonce conflict is retried with a fresh nonce.
//
// The funder key is read only after every check has passed, never when
// FUNDING_ENABLED is off, and never logged. Logs carry the address, the
// amount and the transaction hash, and nothing else from the request.

import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

export const CHAIN_ID = 10143;
export const RPC_URL = "https://testnet-rpc.monad.xyz";
export const GRANT = parseEther("0.1");
export const THRESHOLD = parseEther("0.075");
export const MAX_SENT_TXS = 10;
export const FLOOR = parseEther("1");
export const GRANT_GAS = 21_000n;

export type FundEnv = {
  FUNDING_ENABLED?: string;
  FUNDER_PRIVATE_KEY?: string;
  FUNDER_ADDRESS?: string;
  /** Optional, comma separated. For local testing, for example http://localhost:5173. */
  ALLOWED_ORIGINS?: string;
};

export type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

/** Everything the handler needs from the chain, so tests can script it. */
export interface FundChain {
  chainId(): Promise<number>;
  hasCode(address: Address): Promise<boolean>;
  balance(address: Address): Promise<bigint>;
  /** Transactions this address has sent, counting pending ones. */
  sentCount(address: Address): Promise<number>;
  fees(): Promise<Fees>;
  /** Sends GRANT from the funder with this nonce. Throws on a nonce conflict. */
  sendGrant(to: Address, nonce: number, fees: Fees): Promise<Hex>;
  funderNonce(): Promise<number>;
}

export type Logger = (entry: Record<string, string>) => void;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function originAllowed(request: Request, env: FundEnv): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const own = new URL(request.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return origin === own || extra.includes(origin);
}

function isNonceConflict(error: unknown): boolean {
  const text = String((error as { details?: string; message?: string })?.details ?? (error as Error)?.message ?? error);
  return /nonce too low|nonce.*(already|used)|already known|replacement transaction underpriced/i.test(text);
}

// Serializes sends within one server instance, so two requests handled by the
// same instance never pick the same nonce.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}
const inFlight = new Set<Address>();

export async function handleFund(
  request: Request,
  env: FundEnv,
  makeChain: (env: FundEnv) => FundChain,
  log: Logger = (e) => console.log(JSON.stringify(e)),
): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "use POST" });

  // Kill switch first: the key is never touched while funding is off.
  if (env.FUNDING_ENABLED !== "true") return json(503, { error: "funding is paused" });

  if (!originAllowed(request, env)) return json(403, { error: "same origin only" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "send JSON with an address" });
  }
  const raw = (body as { address?: unknown })?.address;
  if (typeof raw !== "string" || !isAddress(raw)) {
    log({ event: "refused", reason: "bad address" });
    return json(400, { error: "not a valid address" });
  }
  const address = getAddress(raw);
  const refuse = (status: number, reason: string) => {
    log({ event: "refused", address, reason });
    return json(status, { error: reason });
  };
  if (address === "0x0000000000000000000000000000000000000000") return refuse(400, "not a valid address");

  if (inFlight.has(address)) return refuse(409, "a grant for this address is already on its way");
  inFlight.add(address);
  let stage: "checks" | "send" = "checks";
  try {
    const chain = makeChain(env);
    if ((await chain.chainId()) !== CHAIN_ID) return refuse(503, "wrong chain, refusing to fund");
    if (await chain.hasCode(address)) return refuse(409, "only personal accounts can be funded");
    if ((await chain.balance(address)) >= THRESHOLD) return refuse(409, "this account already has enough");
    if ((await chain.sentCount(address)) >= MAX_SENT_TXS) return refuse(409, "this account has reached its limit");

    const funder = env.FUNDER_ADDRESS && isAddress(env.FUNDER_ADDRESS) ? getAddress(env.FUNDER_ADDRESS) : undefined;
    if (!funder) return refuse(503, "funding is not configured");
    const fees = await chain.fees();
    const cost = GRANT + GRANT_GAS * fees.maxFeePerGas;
    if ((await chain.balance(funder)) - cost < FLOOR) return refuse(503, "funding is paused, the funder is at its floor");

    stage = "send";
    const hash = await serialized(async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        const nonce = await chain.funderNonce();
        try {
          return await chain.sendGrant(address, nonce, fees);
        } catch (error) {
          lastError = error;
          if (!isNonceConflict(error)) break;
        }
      }
      throw lastError;
    });

    log({ event: "grant", address, amountWei: GRANT.toString(), hash });
    return json(200, { hash });
  } catch (error) {
    // Only a short category and a sanitized one line detail are logged and
    // returned, never the raw error: it could carry configuration details.
    const code =
      error instanceof FundConfigError ? error.code : stage === "checks" ? "RPC_FAILED" : "SEND_FAILED";
    const detail = error instanceof FundConfigError ? "" : safeDetail(error);
    log({ event: "failed", address, code, detail });
    return json(502, { error: "could not send the grant, try again in a minute", code });
  } finally {
    inFlight.delete(address);
  }
}

/** A configuration problem, with a code that is safe to log and return. */
export class FundConfigError extends Error {
  readonly code: "FUNDER_KEY_MALFORMED" | "FUNDER_KEY_MISMATCH";
  constructor(code: "FUNDER_KEY_MALFORMED" | "FUNDER_KEY_MISMATCH") {
    super(code);
    this.name = "FundConfigError";
    this.code = code;
  }
}

/**
 * Accepts the key as pasted into Vercel: surrounding spaces or newlines, with
 * or without 0x. Anything else is malformed. The key itself never appears in
 * any error.
 */
export function normalizeFunderKey(raw: string | undefined): Hex {
  const key = (raw ?? "").trim();
  const withPrefix = /^[0-9a-fA-F]{64}$/.test(key) ? `0x${key}` : key;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) throw new FundConfigError("FUNDER_KEY_MALFORMED");
  return withPrefix as Hex;
}

/** One short line about a failure, with anything long and hex removed. */
export function safeDetail(error: unknown): string {
  const e = error as { shortMessage?: unknown; message?: unknown; name?: unknown };
  const text = String(e?.shortMessage ?? e?.message ?? e?.name ?? "unknown").split("\n")[0] ?? "";
  return text.replace(/0x[0-9a-fA-F]{40,}/g, "0x…").replace(/[0-9a-fA-F]{40,}/g, "…").slice(0, 120);
}

/** The real chain, on the public testnet RPC. The key is read here, and only here. */
export function liveChain(env: FundEnv): FundChain {
  const transport = http(RPC_URL, { timeout: 10_000, retryCount: 1 });
  const client = createPublicClient({ chain: monadTestnet, transport });
  const funderAddress = getAddress(env.FUNDER_ADDRESS ?? "");
  let wallet: ReturnType<typeof createWalletClient> | undefined;
  const walletClient = () => {
    if (wallet) return wallet;
    const account = privateKeyToAccount(normalizeFunderKey(env.FUNDER_PRIVATE_KEY));
    if (account.address !== funderAddress) throw new FundConfigError("FUNDER_KEY_MISMATCH");
    wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL, { timeout: 10_000, retryCount: 0 }) });
    return wallet;
  };
  return {
    chainId: () => client.getChainId(),
    hasCode: async (a) => ((await client.getCode({ address: a })) ?? "0x") !== "0x",
    balance: (a) => client.getBalance({ address: a }),
    sentCount: (a) => client.getTransactionCount({ address: a, blockTag: "pending" }),
    funderNonce: () => client.getTransactionCount({ address: funderAddress, blockTag: "pending" }),
    fees: async () => {
      const [price, tip] = await Promise.all([client.getGasPrice(), client.estimateMaxPriorityFeePerGas()]);
      const maxFeePerGas = (price * 105n) / 100n;
      return { maxFeePerGas, maxPriorityFeePerGas: tip < maxFeePerGas ? tip : maxFeePerGas };
    },
    sendGrant: (to, nonce, fees) => {
      const w = walletClient();
      return w.sendTransaction({
        account: w.account!,
        chain: monadTestnet,
        to,
        value: GRANT,
        gas: GRANT_GAS,
        nonce,
        ...fees,
      });
    },
  };
}

export function POST(request: Request): Promise<Response> {
  return handleFund(request, process.env as FundEnv, liveChain);
}

export function GET(): Response {
  return json(405, { error: "use POST" });
}
