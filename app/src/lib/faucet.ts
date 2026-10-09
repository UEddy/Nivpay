import { BaseError, encodeFunctionData, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { AUSD_FAUCET } from "./config.ts";
import { AppError, SendFailure } from "./errors.ts";
import { formatAmount } from "./money.ts";
import { readClient } from "./rpc.ts";

/**
 * Agora's AUSD faucet, recovered from its bytecode (the source isn't
 * published). The cooldown is one timestamp for the whole faucet, not one
 * per account: anyone's claim blocks everyone else's for maxDripFrequency.
 */
export const FAUCET_ABI = [
  {
    type: "function",
    name: "requestFunds",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
  { type: "function", name: "faucetDripAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxDripFrequency", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxAmountToOwn", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lastDripTimestamp", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/**
 * The faucet's custom errors, by selector. Confirmed on a fork of the live
 * contract: a second claim inside the cooldown, a claim for an account over
 * the ceiling, and the stock check the Foundry fork test already knows.
 */
export const FAUCET_ERRORS = {
  cooldown: "0x20e5bc67",
  ceiling: "0x0949dab9",
  outOfStock: "0x356680b7",
} as const;

export type FaucetTerms = { drip: bigint; ceiling: bigint };

export function claimData(to: Address): Hex {
  return encodeFunctionData({ abi: FAUCET_ABI, functionName: "requestFunds", args: [to] });
}

/** The revert data of a failed call, wherever viem put it. */
export function revertData(error: unknown): Hex | undefined {
  if (!(error instanceof BaseError)) return undefined;
  let found: Hex | undefined;
  error.walk((e) => {
    const data = (e as { data?: unknown }).data;
    if (typeof data === "string" && data.startsWith("0x")) found = data as Hex;
    else if (data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string") {
      found = (data as { data: Hex }).data;
    }
    return found !== undefined;
  });
  return found;
}

/** What a refusal means, from its selector. Anything unrecognised is a plain refusal. */
export function refusalKind(data: Hex | undefined): "cooldown" | "ceiling" | "refused" {
  const selector = data?.slice(0, 10).toLowerCase();
  if (selector === FAUCET_ERRORS.cooldown) return "cooldown";
  if (selector === FAUCET_ERRORS.ceiling) return "ceiling";
  return "refused";
}

/** Seconds until the next claim is allowed, never less than 1. */
export function secondsLeft(lastDrip: bigint, frequency: bigint, now: bigint): number {
  const left = lastDrip + frequency - now;
  return left < 1n ? 1 : Number(left);
}

/**
 * The shared cooldown refused the claim. `until` is when, on this phone's
 * clock, the next claim is allowed, so the screen can count down to it.
 */
export class ClaimCooldownError extends AppError {
  readonly until: number;
  constructor(seconds: number, now: number = Date.now()) {
    super(copy.errClaimCooldown(seconds), ERROR_CODES.CLAIM_COOLDOWN);
    this.until = now + seconds * 1000;
  }
}

/** The cooldown behind a failure, if that is what it was. */
export function cooldownIn(error: unknown): ClaimCooldownError | undefined {
  const cause = error instanceof SendFailure ? error.cause : error;
  return cause instanceof ClaimCooldownError ? cause : undefined;
}

/** Whole seconds left until `until`, counting down to 0. */
export function secondsUntil(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** A refusal found before anything was sent, worded for people, with "Nothing was sent". */
function notSent(error: AppError): SendFailure {
  return new SendFailure("preparing", false, error);
}

/**
 * Runs the claim as a call against the latest block, from the account itself,
 * before any gas grant or passkey prompt. Throws a SendFailure that says
 * nothing was sent if the faucet would refuse; returns quietly if it would pay.
 * If the faucet can't be reached the failure is "couldn't get this ready".
 */
export async function checkClaim(account: Address, terms: FaucetTerms, decimals: number): Promise<void> {
  try {
    await readClient.call({ account, to: AUSD_FAUCET, data: claimData(account), blockTag: "latest" });
    return;
  } catch (error) {
    const data = revertData(error);
    if (data === undefined) throw new SendFailure("preparing", false, error);
    switch (refusalKind(data)) {
      case "cooldown": {
        const [last, frequency, block] = await Promise.all([
          readClient.readContract({ address: AUSD_FAUCET, abi: FAUCET_ABI, functionName: "lastDripTimestamp" }),
          readClient.readContract({ address: AUSD_FAUCET, abi: FAUCET_ABI, functionName: "maxDripFrequency" }),
          readClient.getBlock({ blockTag: "latest" }),
        ]).catch(() => [0n, 60n, { timestamp: 0n }] as const);
        const seconds = block.timestamp === 0n ? 60 : secondsLeft(last, frequency, block.timestamp);
        throw notSent(new ClaimCooldownError(seconds));
      }
      case "ceiling":
        throw notSent(
          new AppError(copy.errClaimCeiling(formatAmount(terms.ceiling, decimals, "auto")), ERROR_CODES.CLAIM_CEILING),
        );
      default:
        throw notSent(new AppError(copy.errClaimRefused, ERROR_CODES.CLAIM_REVERTED));
    }
  }
}

/** The faucet's terms, read at the finalized block like every balance. */
export async function readFaucetTerms(blockNumber: bigint): Promise<FaucetTerms> {
  const at = { blockNumber } as const;
  const [drip, ceiling] = await Promise.all([
    readClient.readContract({ address: AUSD_FAUCET, abi: FAUCET_ABI, functionName: "faucetDripAmount", ...at }),
    readClient.readContract({ address: AUSD_FAUCET, abi: FAUCET_ABI, functionName: "maxAmountToOwn", ...at }),
  ]);
  return { drip, ceiling };
}
