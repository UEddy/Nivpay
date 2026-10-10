import {
  BaseError,
  ContractFunctionRevertedError,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  parseEventLogs,
  parseTransaction,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { POTS_ABI, POTS_READ_ABI } from "./abi.ts";
import { AppError } from "./errors.ts";
import { refusalFor, statusFrom, type PotFacts, type RequestFacts } from "./payout.ts";

/**
 * The chain side of paying from a pot. Reads are made at the finalized block,
 * so nothing shown can be taken back; a request is run as a call before it is
 * signed, so a refusal costs no gas grant and no passkey prompt.
 */

type Client = Pick<PublicClient, "getBlock" | "readContract" | "simulateContract" | "getTransactionReceipt">;

export const askData = (potId: bigint, payee: number, amount: bigint): Hex =>
  encodeFunctionData({ abi: POTS_ABI, functionName: "proposePayout", args: [potId, payee, amount] });
export const yesData = (proposalId: bigint): Hex => encodeFunctionData({ abi: POTS_ABI, functionName: "approve", args: [proposalId] });
export const takeBackData = (proposalId: bigint): Hex => encodeFunctionData({ abi: POTS_ABI, functionName: "revokeApproval", args: [proposalId] });

export type FeeTerms = { feeBps: bigint; feeCap: bigint; ttl: bigint };

/** The fee rate, its cap and how long a request lasts, read from the contract, never written down here. */
export async function readFeeTerms(client: Client, pots: Address, blockNumber?: bigint): Promise<FeeTerms> {
  const at = blockNumber === undefined ? {} : { blockNumber };
  const [feeBps, feeCap, ttl] = await Promise.all([
    client.readContract({ address: pots, abi: POTS_READ_ABI, functionName: "feeBps", ...at }),
    client.readContract({ address: pots, abi: POTS_READ_ABI, functionName: "feeCap", ...at }),
    client.readContract({ address: pots, abi: POTS_ABI, functionName: "PROPOSAL_TTL", ...at }),
  ]);
  return { feeBps, feeCap, ttl };
}

const reverted = (e: unknown): ContractFunctionRevertedError | null => {
  if (!(e instanceof BaseError)) return null;
  const found = e.walk((x) => x instanceof ContractFunctionRevertedError);
  return found instanceof ContractFunctionRevertedError ? found : null;
};

export type ReadRequest = { request: RequestFacts; iSaid: boolean; now: bigint; at: bigint };

/**
 * A payment request and whether `me` said yes, at the finalized block. A
 * request that doesn't exist, or belongs to another pot, means the link that
 * named it is wrong: code 70. Not reaching the network throws as any read does.
 */
export async function readRequest(client: Client, pots: Address, potId: bigint, proposalId: bigint, me: Address): Promise<ReadRequest> {
  const block = await client.getBlock({ blockTag: "finalized" });
  const at = { blockNumber: block.number } as const;
  let info;
  let iSaid;
  try {
    [info, iSaid] = await Promise.all([
      client.readContract({ address: pots, abi: POTS_ABI, functionName: "proposalInfo", args: [proposalId], ...at }),
      client.readContract({ address: pots, abi: POTS_ABI, functionName: "hasApproved", args: [proposalId, me], ...at }),
    ]);
  } catch (e) {
    if (reverted(e)) throw new AppError(copy.errRequestNotFound, ERROR_CODES.LINK_DAMAGED);
    throw e;
  }
  if (info.potId !== potId || info.kind !== 0) throw new AppError(copy.errRequestNotFound, ERROR_CODES.LINK_DAMAGED);
  return {
    request: {
      proposalId,
      potId: info.potId,
      kind: info.kind,
      payee: info.destIndex,
      amount: info.amount,
      fee: info.fee,
      asker: getAddress(info.proposer),
      createdAt: info.createdAt,
      expiresAt: info.expiresAt,
      yes: info.approvedBy.map((a) => getAddress(a)),
      threshold: info.threshold,
      status: statusFrom(info.status),
    },
    iSaid,
    now: block.timestamp,
    at: block.number,
  };
}

export type PotCall =
  | { functionName: "proposePayout"; args: readonly [bigint, number, bigint] }
  | { functionName: "approve"; args: readonly [bigint] }
  | { functionName: "revokeApproval"; args: readonly [bigint] };

export const askCall = (potId: bigint, payee: number, amount: bigint): PotCall => ({ functionName: "proposePayout", args: [potId, payee, amount] });
export const yesCall = (proposalId: bigint): PotCall => ({ functionName: "approve", args: [proposalId] });
export const takeBackCall = (proposalId: bigint): PotCall => ({ functionName: "revokeApproval", args: [proposalId] });

/**
 * Runs a request from `from` as a call against the latest state. Null when the
 * contract would take it; the refusal, with its code, when it wouldn't.
 */
export async function refusalOf(client: Client, pots: Address, from: Address, call: PotCall, pot?: PotFacts, request?: Pick<RequestFacts, "payee">): Promise<AppError | null> {
  try {
    await client.simulateContract({ account: from, address: pots, abi: POTS_ABI, ...call } as Parameters<Client["simulateContract"]>[0]);
    return null;
  } catch (e) {
    const r = reverted(e);
    if (r) return refusalFor(r.data?.errorName, pot, request);
    throw e;
  }
}

/** The request number a finalized ask made, from its own receipt. */
export async function proposalIdIn(client: Client, pots: Address, hash: Hex): Promise<bigint | null> {
  const receipt = await client.getTransactionReceipt({ hash });
  const [proposed] = parseEventLogs({ abi: POTS_ABI, eventName: "Proposed", logs: receipt.logs.filter((l) => l.address.toLowerCase() === pots.toLowerCase()) });
  return proposed ? proposed.args.proposalId : null;
}

/**
 * What a signed ask asks for, read back from its own bytes, so an ask that
 * was in flight when the app was closed can say what it is and be retried
 * with exactly the same payee and amount. Null for anything else.
 */
export function askIn(raw: Hex, pots: Address, potId: bigint): { payee: number; amount: bigint } | null {
  try {
    const tx = parseTransaction(raw);
    if (!tx.to || tx.to.toLowerCase() !== pots.toLowerCase() || !tx.data) return null;
    const call = decodeFunctionData({ abi: POTS_ABI, data: tx.data });
    if (call.functionName !== "proposePayout") return null;
    const [id, payee, amount] = call.args;
    return id === potId ? { payee, amount } : null;
  } catch {
    return null;
  }
}
