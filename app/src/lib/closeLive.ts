import { BaseError, ContractFunctionRevertedError, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { POTS_ABI } from "./abi.ts";
import { closeRefusalFor } from "./close.ts";
import type { AppError } from "./errors.ts";

/** The chain side of closing and taking a share out. Each is run as a call before it is signed. */

type Client = Pick<PublicClient, "simulateContract">;

export type CloseCall =
  | { functionName: "exit"; args: readonly [bigint, bigint] }
  | { functionName: "claim"; args: readonly [bigint] }
  | { functionName: "proposeClose"; args: readonly [bigint] }
  | { functionName: "closePot"; args: readonly [bigint] };

/** Take every share out: exit before close (any state), claim after. */
export function takeCall(potId: bigint, action: "exit" | "claim", shares: bigint): CloseCall {
  return action === "exit" ? { functionName: "exit", args: [potId, shares] } : { functionName: "claim", args: [potId] };
}

export const askCloseCall = (potId: bigint): CloseCall => ({ functionName: "proposeClose", args: [potId] });

export function dataOf(call: CloseCall): Hex {
  return encodeFunctionData({ abi: POTS_ABI, ...call } as Parameters<typeof encodeFunctionData<typeof POTS_ABI>>[0]);
}

/** Null when the contract would take it now; its refusal, with a code, when it wouldn't. Unreachable throws. */
export async function closeRefusalOf(client: Client, pots: Address, from: Address, call: CloseCall): Promise<AppError | null> {
  try {
    await client.simulateContract({ account: from, address: pots, abi: POTS_ABI, ...call } as Parameters<Client["simulateContract"]>[0]);
    return null;
  } catch (e) {
    if (e instanceof BaseError) {
      const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
      if (r instanceof ContractFunctionRevertedError) return closeRefusalFor(r.data?.errorName);
    }
    throw e;
  }
}
