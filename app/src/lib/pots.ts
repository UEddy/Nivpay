import { BaseError, ContractFunctionRevertedError, parseEventLogs, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { ERC20_READ_ABI, POTS_ABI, POTS_READ_ABI } from "./abi.ts";
import { DEPLOYMENT, NEW_POTS_ON_V2, POTS, POTS_V2_HERE, potsAt } from "./deployment.ts";
import type { CreateArgs, Person, Share } from "./draft.ts";
import { AppError } from "./errors.ts";
import { encodeLink } from "./invites.ts";
import { readClient } from "./rpc.ts";

/** Where new pots are made: NivPayPotsV2 once config.ts sets it, NivPayPots until then. */
export const NEW_POTS: Address = potsAt(NEW_POTS_ON_V2);

/** What a new pot is allowed to be, read from the pots contract at the finalized block. */
export type CreateTerms = {
  maxDeciders: number;
  maxPayees: number;
  /** The pot's money: whatever its pots contract is bound to. */
  asset: Address;
  decimals: number;
  /** The finalized block's time, in seconds, to check the closing date against. */
  now: bigint;
};

export async function readCreateTerms(): Promise<CreateTerms> {
  const block = await readClient.getBlock({ blockTag: "finalized" });
  const at = { blockNumber: block.number } as const;
  const [maxDeciders, maxPayees, asset] = await Promise.all([
    readClient.readContract({ address: NEW_POTS, abi: POTS_ABI, functionName: "MAX_APPROVERS", ...at }),
    readClient.readContract({ address: NEW_POTS, abi: POTS_ABI, functionName: "MAX_DESTINATIONS", ...at }),
    readClient.readContract({ address: NEW_POTS, abi: POTS_READ_ABI, functionName: "token", ...at }),
  ]);
  const decimals = await readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "decimals", ...at });
  return { maxDeciders: Number(maxDeciders), maxPayees: Number(maxPayees), asset, decimals, now: block.timestamp };
}

export class CreateRefusedError extends AppError {
  readonly reason: string;
  constructor(reason: string) {
    super(copy.createRefused, ERROR_CODES.CREATE_REFUSED);
    this.reason = reason;
  }
}

/**
 * Runs createPot as a call first, so a pot the contract would refuse costs no
 * grant and no passkey prompt. Only a revert is a refusal; a read that fails
 * for any other reason is thrown as it is and retried by the caller.
 */
export async function checkCreate(from: Address, args: CreateArgs): Promise<void> {
  try {
    await readClient.simulateContract({ account: from, address: NEW_POTS, abi: POTS_ABI, functionName: "createPot", args });
  } catch (error) {
    const revert = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    if (revert instanceof ContractFunctionRevertedError) {
      throw new CreateRefusedError(revert.data?.errorName ?? "unknown");
    }
    throw error;
  }
}

/**
 * The pot a finalized createPot transaction made, from its PotCreated event,
 * and which contract made it: a pot sent off just before this build moved new
 * pots to V2 is still found on NivPayPots.
 */
export async function potMadeBy(hash: Hex): Promise<{ potId: bigint; block: bigint; creator: Address; onV2: boolean }> {
  const receipt = await readClient.getTransactionReceipt({ hash });
  const ours = (log: { address: Address }) =>
    log.address.toLowerCase() === POTS.toLowerCase() || (POTS_V2_HERE !== null && log.address.toLowerCase() === POTS_V2_HERE.toLowerCase());
  const [made] = parseEventLogs({ abi: POTS_ABI, eventName: "PotCreated", logs: receipt.logs }).filter(ours);
  if (!made) throw new Error("no PotCreated in that transaction");
  const onV2 = POTS_V2_HERE !== null && made.address.toLowerCase() === POTS_V2_HERE.toLowerCase();
  return { potId: made.args.potId, block: receipt.blockNumber, creator: made.args.creator, onV2 };
}

/** The `#` fragment of the link that opens a made pot. */
export function potFragment(potId: bigint, block: bigint, people: Person[], shares: Share[], signature: Hex, onV2: boolean): string {
  return encodeLink({ kind: "pot", version: 2, deployment: DEPLOYMENT, onV2, potId, block, people, shares, signature });
}

/** Label for the pending write record, told apart from dollar claims on the home screen. */
export const CREATE_LABEL = "create pot";
