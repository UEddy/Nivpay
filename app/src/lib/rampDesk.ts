import { getAddress, isAddress, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { AppError } from "./errors.ts";

/**
 * The phone's side of the test desk (api/ramp/index.ts). The desk recomputes
 * every quote itself; the phone sends only the currency, the local amount
 * and, for a cash out, the transaction that paid the desk. Bank details are
 * never sent.
 */

/** Label for a cash out's pending write: "cashout <desk> <amount> <currency>", so a reload can resume it. */
export const CASHOUT_LABEL = "cashout";

export function cashOutLabel(desk: Address, amount: bigint, currency: string): string {
  return `${CASHOUT_LABEL} ${desk} ${amount} ${currency}`;
}

export function fromCashOutLabel(label: string): { desk: Address; amount: bigint; currency: string } | null {
  const [kind, desk, amount, currency, ...rest] = label.split(" ");
  if (kind !== CASHOUT_LABEL || rest.length || !desk || !isAddress(desk) || !amount || !/^\d+$/.test(amount) || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  return { desk: getAddress(desk), amount: BigInt(amount), currency };
}

export type DeskInfo = { enabled: boolean; desk: Address | null };
export type Bought = { hash: Hex; received: bigint };
export type Statement = { currency: string; dollars: bigint; fee: bigint; bankGets: bigint; reference: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type Body = { error?: string; code?: string };

/** The desk's answer as an error people can read, with its code. */
export function deskFailure(status: number, body: Body, kind: "buy" | "cashout"): AppError {
  if (kind === "cashout" && status !== 503) return new AppError(copy.errCashOutStatement, ERROR_CODES.CASHOUT_STATEMENT);
  if (status === 503) return new AppError(copy.errRampPaused, ERROR_CODES.RAMP_PAUSED);
  if (status === 502 || body.code) return new AppError(copy.errRampFailed, ERROR_CODES.RAMP_FAILED);
  return new AppError(copy.errRampRefused, ERROR_CODES.RAMP_REFUSED);
}

async function call(fetcher: Fetch, init?: RequestInit): Promise<Response> {
  try {
    return await fetcher("/api/ramp", init);
  } catch {
    throw new AppError(copy.errRampUnreachable, ERROR_CODES.RAMP_UNREACHABLE);
  }
}

const post = (body: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export async function readDesk(fetcher: Fetch = fetch): Promise<DeskInfo> {
  const res = await call(fetcher);
  const body = (await res.json().catch(() => ({}))) as { enabled?: unknown; desk?: unknown };
  const desk = typeof body.desk === "string" && isAddress(body.desk) ? getAddress(body.desk) : null;
  return { enabled: res.ok && body.enabled === true && desk !== null, desk };
}

/** Asks the desk for test dollars for `localMinor` of `currency`. Resolves once it has sent them, not once they are final. */
export async function askToBuy(account: Address, currency: string, localMinor: bigint, fetcher: Fetch = fetch): Promise<Bought> {
  const res = await call(fetcher, post({ kind: "buy", address: account, currency, amount: localMinor.toString() }));
  const body = (await res.json().catch(() => ({}))) as Body & { hash?: string; received?: string };
  if (res.ok && typeof body.hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(body.hash) && /^\d+$/.test(body.received ?? "")) {
    return { hash: body.hash as Hex, received: BigInt(body.received!) };
  }
  throw deskFailure(res.status, body, "buy");
}

/**
 * The desk's statement for a cash out that is already final on this phone.
 * The desk's own read can lag a moment behind, so "not final yet" is asked
 * again a few times. Asking again is always safe: it moves nothing.
 */
export async function askStatement(account: Address, currency: string, tx: Hex, fetcher: Fetch = fetch, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<Statement> {
  for (let attempt = 0; ; attempt++) {
    const res = await call(fetcher, post({ kind: "cashout", address: account, currency, tx }));
    const body = (await res.json().catch(() => ({}))) as Body & Record<string, unknown>;
    if (res.ok && [body.dollars, body.fee, body.bankGets].every((v) => typeof v === "string" && /^\d+$/.test(v)) && typeof body.reference === "string") {
      return { currency: String(body.currency), dollars: BigInt(body.dollars as string), fee: BigInt(body.fee as string), bankGets: BigInt(body.bankGets as string), reference: body.reference };
    }
    if (res.status === 409 && body.error === "that transaction isn't final yet" && attempt < 5) {
      await wait(1_000);
      continue;
    }
    throw deskFailure(res.status, body, "cashout");
  }
}
