import { encodeFunctionData, isAddressEqual, parseEventLogs, type Address, type Hex, type Log } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { ERC20_ALLOWANCE_ABI, ERC20_TRANSFER_ABI, SETTLEMENT_PAIR_ABI, SETTLEMENT_WHITELISTER_ABI } from "./abi.ts";
import { AppError } from "./errors.ts";
import type { SequenceCall } from "./writes.ts";

/**
 * Sending in another currency through Agora's Instant Settlement pair: the
 * sender's AUSD goes in, the pair's other currency (CTK) comes out, straight
 * to the recipient's account. The pair sells at a fixed price, set by Agora.
 *
 * What it takes, in order, behind one confirm and one fingerprint:
 *  1. once per account: permission to send through the pair, which on testnet
 *     the account grants itself through Agora's whitelister contract,
 *  2. letting the pair take exactly this amount of AUSD, unless enough is
 *     already allowed,
 *  3. the exchange itself, with the recipient as its recipient and a minimum
 *     amount out, so a price change by the pair's admin between the quote and
 *     the exchange makes it fail, never pay out less.
 */

/** Gas for the exchange. It can't be estimated before steps 1 and 2 have run, so it is fixed: 207,981 measured on a fork, sending to an account that held none, plus 15 percent. */
export const EXCHANGE_GAS = 240_000n;

const PRICE_PRECISION = 10n ** 18n;
const FEE_PRECISION = 10n ** 18n;

/** The pair's own formula for buying token0 with token1 (getAmount0Out), fee rounded up as it rounds it. */
export function amountOut(amountIn: bigint, price: bigint, fee: bigint): { out: bigint; fee: bigint } {
  let feeAmount = (amountIn * price * fee) / (FEE_PRECISION * PRICE_PRECISION);
  if (feeAmount * FEE_PRECISION * PRICE_PRECISION < amountIn * price * fee) feeAmount += 1n;
  return { out: (amountIn * price) / PRICE_PRECISION - feeAmount, fee: feeAmount };
}

/** Everything a quote needs, read from the pair, AUSD and CTK at one block. */
export type SettlementState = {
  paused: boolean;
  /** Price now and at the deadline, token0 per token1 with 18 decimals of precision. */
  price: bigint;
  priceAtDeadline: bigint;
  /** Purchase fee on token0, 18 decimals of precision (1e16 is 1 percent). */
  fee: bigint;
  /** What the pair itself quotes now for this amount (getAmountsOut). */
  quotedOut: bigint;
  /** The pair's CTK. */
  reserveOut: bigint;
  /** True once this account may send through the pair. */
  isSetUp: boolean;
  /** AUSD this account already lets the pair take. */
  allowance: bigint;
  inDecimals: number;
  outDecimals: number;
  outSymbol: string;
};

export type Quote = {
  amountIn: bigint;
  /** What the recipient gets at today's price. */
  out: bigint;
  /** The least they can get: the lower of now and the deadline's price. The exchange fails below it. */
  minOut: bigint;
  /** The pair's fee, in the currency the recipient gets. */
  feeOut: bigint;
  /** What one dollar buys, in the other currency's base units, before any fee. */
  rate: bigint;
  deadline: bigint;
  needsSetup: boolean;
  needsAllowance: boolean;
  outDecimals: number;
  outSymbol: string;
};

/** Turns the pair's state into a quote, or refuses: paused, too small, or more than the pair holds. */
export function quote(state: SettlementState, amountIn: bigint, deadline: bigint): Quote {
  if (state.paused) throw new AppError(copy.errPairPaused, ERROR_CODES.PAIR_PAUSED);
  if (amountIn <= 0n) throw new AppError(copy.errSendNoAmount, ERROR_CODES.SEND_NO_AMOUNT);
  const now = amountOut(amountIn, state.price, state.fee);
  const later = amountOut(amountIn, state.priceAtDeadline, state.fee);
  // The pair's own quote wins over ours if they ever differ; the minimum is the lowest of all three.
  const out = state.quotedOut;
  const minOut = [out, now.out, later.out].reduce((a, b) => (b < a ? b : a));
  if (minOut <= 0n) throw new AppError(copy.errSendNoAmount, ERROR_CODES.SEND_NO_AMOUNT);
  if (out > state.reserveOut) throw new AppError(copy.errLowLiquidity, ERROR_CODES.LOW_LIQUIDITY);
  return {
    amountIn,
    out,
    minOut,
    feeOut: now.fee,
    rate: amountOut(10n ** BigInt(state.inDecimals), state.price, 0n).out,
    deadline,
    needsSetup: !state.isSetUp,
    needsAllowance: state.allowance < amountIn,
    outDecimals: state.outDecimals,
    outSymbol: state.outSymbol,
  };
}

/** A quote taken again right before signing must promise exactly what the person saw, or they see it again. */
export function assertSameQuote(shown: Quote, fresh: Quote): void {
  if (shown.out !== fresh.out || shown.minOut !== fresh.minOut || shown.feeOut !== fresh.feeOut) {
    throw new AppError(copy.errQuoteChanged, ERROR_CODES.QUOTE_CHANGED);
  }
}

export type Settlement = { pair: Address; whitelister: Address; dollar: Address; other: Address };

/** Label prefix for every step, so a reload resumes the Send screen's follow of it. */
export const CURRENCY_LABEL = "currency";

export function currencyLabel(to: Address, q: Pick<Quote, "amountIn" | "minOut">, step: "setup" | "allow" | "send"): string {
  return `${CURRENCY_LABEL} ${to} ${q.amountIn} ${q.minOut} ${step}`;
}

export function fromCurrencyLabel(label: string): { to: Address; amountIn: bigint; minOut: bigint } | null {
  const [kind, to, amountIn, minOut] = label.split(" ");
  if (kind !== CURRENCY_LABEL || !to || !/^0x[0-9a-fA-F]{40}$/.test(to) || !/^\d+$/.test(amountIn ?? "") || !/^\d+$/.test(minOut ?? "")) return null;
  return { to: to as Address, amountIn: BigInt(amountIn!), minOut: BigInt(minOut!) };
}

/** The requests to sign, in order: the one-time setup if needed, the allowance if needed, then the exchange to `to`. */
export function settlementCalls(s: Settlement, q: Quote, me: Address, to: Address): SequenceCall[] {
  const calls: SequenceCall[] = [];
  if (q.needsSetup) {
    calls.push({
      to: s.whitelister,
      data: encodeFunctionData({ abi: SETTLEMENT_WHITELISTER_ABI, functionName: "setApprovedSwapper", args: [me] }),
      label: currencyLabel(to, q, "setup"),
    });
  }
  if (q.needsAllowance) {
    calls.push({
      to: s.dollar,
      data: encodeFunctionData({ abi: ERC20_ALLOWANCE_ABI, functionName: "approve", args: [s.pair, q.amountIn] }),
      label: currencyLabel(to, q, "allow"),
    });
  }
  calls.push({
    to: s.pair,
    data: exchangeData(s, q, to),
    label: currencyLabel(to, q, "send"),
    gas: EXCHANGE_GAS,
  });
  return calls;
}

export function exchangeData(s: Settlement, q: Pick<Quote, "amountIn" | "minOut" | "deadline">, to: Address): Hex {
  return encodeFunctionData({
    abi: SETTLEMENT_PAIR_ABI,
    functionName: "swapExactTokensForTokens",
    args: [q.amountIn, q.minOut, [s.dollar, s.other], to, q.deadline],
  });
}

/** What the recipient actually received, from the exchange's own receipt: at least the minimum, usually exactly the quote. */
export function received(logs: Log[], currency: Address, to: Address): bigint {
  return parseEventLogs({ abi: ERC20_TRANSFER_ABI, eventName: "Transfer", logs })
    .filter((l) => isAddressEqual(l.address, currency) && isAddressEqual(l.args.to, to))
    .reduce((sum, l) => sum + l.args.value, 0n);
}

/** Which step a label belongs to, for the progress line. */
export function stepOf(label: string): "setup" | "allow" | "send" | null {
  const last = label.split(" ").pop();
  return last === "setup" || last === "allow" || last === "send" ? last : null;
}
