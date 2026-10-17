import { BaseError, ContractFunctionRevertedError, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { POTS_V2_ABI } from "./abi.ts";
import { fromChain, type ChangeInfo, type PotChange } from "./changes.ts";
import { AppError } from "./errors.ts";
import { shownText32 } from "./text32.ts";

/** The chain side of a pot's changes on NivPayPotsV2. Each write is run as a call before it is signed. */

type Reader = Pick<PublicClient, "readContract">;
type Client = Pick<PublicClient, "simulateContract">;

export type ChangeCall =
  | { functionName: "proposeAddPayee"; args: readonly [bigint, Address, Hex, bigint] }
  | { functionName: "proposeRaiseLimit"; args: readonly [bigint, number, bigint] }
  | { functionName: "proposeLowerLimit"; args: readonly [bigint, number, bigint] }
  | { functionName: "proposeRemovePayee"; args: readonly [bigint, number] }
  | { functionName: "proposeLaterClose"; args: readonly [bigint, bigint] }
  | { functionName: "approveChange"; args: readonly [bigint] }
  | { functionName: "withdrawChange"; args: readonly [bigint] }
  | { functionName: "applyChange"; args: readonly [bigint] };

export function changeData(call: ChangeCall): Hex {
  return encodeFunctionData({ abi: POTS_V2_ABI, ...call } as Parameters<typeof encodeFunctionData<typeof POTS_V2_ABI>>[0]);
}

/** Every change open on a pot, and whether each payee has been removed, at one block. */
export async function readChanges(client: Reader, pots: Address, potId: bigint, payees: number, at: bigint): Promise<{ changes: PotChange[]; removed: boolean[] }> {
  const block = { blockNumber: at } as const;
  const [ids, removed] = await Promise.all([
    client.readContract({ address: pots, abi: POTS_V2_ABI, functionName: "openChanges", args: [potId], ...block }),
    Promise.all(Array.from({ length: payees }, (_, i) => client.readContract({ address: pots, abi: POTS_V2_ABI, functionName: "isRemoved", args: [potId, BigInt(i)], ...block }))),
  ]);
  const infos = await Promise.all(ids.map((id) => client.readContract({ address: pots, abi: POTS_V2_ABI, functionName: "changeInfo", args: [id], ...block })));
  const named = (v: unknown): ChangeInfo => {
    const info = v as Omit<ChangeInfo, "label"> & { label: Hex };
    let label = "";
    try {
      label = shownText32(info.label);
    } catch {
      // Not UTF-8: no name, shown as "someone it can pay".
    }
    return { ...info, label };
  };
  return { changes: infos.map((v, i) => fromChain(ids[i]!, named(v))), removed };
}

/** The code for a change the contract refused as a call. */
export function changeRefusalFor(errorName: string | undefined): AppError {
  switch (errorName) {
    case "NotApprover":
      return new AppError(copy.errNotDeciderChange, ERROR_CODES.NOT_DECIDER);
    case "PotClosed":
      return new AppError(copy.errAlreadyClosed, ERROR_CODES.POT_ALREADY_CLOSED);
    case "TooManyOpenChanges":
      return new AppError(copy.errTooManyChanges, ERROR_CODES.CHANGE_REFUSED);
    case "ChangeNotReady":
      return new AppError(copy.errChangeNotReady, ERROR_CODES.CHANGE_NOT_READY);
    case "ChangeNotPending":
    case "ChangeNotOpen":
    case "ProposalExpired":
      return new AppError(copy.errChangeNotOpen, ERROR_CODES.CHANGE_REFUSED);
    case "PotFrozen":
      return new AppError(copy.errChangePaused, ERROR_CODES.CHANGE_REFUSED);
    case "LimitBelowSpent":
      return new AppError(copy.errLimitBelowPaid, ERROR_CODES.CHANGE_REFUSED);
    case "NotWider":
    case "NotNarrower":
      return new AppError(copy.errChangeNoLongerFits, ERROR_CODES.CHANGE_REFUSED);
    default:
      return new AppError(copy.errChangeRefused, ERROR_CODES.CHANGE_REFUSED);
  }
}

/** Null when the contract would take it now; its refusal, with a code, when it wouldn't. Unreachable throws. */
export async function changeRefusalOf(client: Client, pots: Address, from: Address, call: ChangeCall): Promise<AppError | null> {
  try {
    await client.simulateContract({ account: from, address: pots, abi: POTS_V2_ABI, ...call } as Parameters<Client["simulateContract"]>[0]);
    return null;
  } catch (e) {
    if (e instanceof BaseError) {
      const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
      if (r instanceof ContractFunctionRevertedError) return changeRefusalFor(r.data?.errorName);
    }
    throw e;
  }
}

/**
 * Agreed changes on their way (waiting out their 72 hours, or ready), on the
 * V2 pots given: what Home tells everyone with money in (lib/notes.ts
 * "changeAgreed"). Each pot's payee names come from the pot itself.
 */
export async function readComing(client: Reader, pots: Address, potIds: bigint[], at: bigint): Promise<{ potId: bigint; change: PotChange; payee: string }[]> {
  const block = { blockNumber: at } as const;
  const out: { potId: bigint; change: PotChange; payee: string }[] = [];
  for (const potId of potIds) {
    const ids = await client.readContract({ address: pots, abi: POTS_V2_ABI, functionName: "openChanges", args: [potId], ...block });
    if (!ids.length) continue;
    const [infos, dests] = await Promise.all([
      Promise.all(ids.map((id) => client.readContract({ address: pots, abi: POTS_V2_ABI, functionName: "changeInfo", args: [id], ...block }))),
      client.readContract({ address: pots, abi: POTS_V2_ABI, functionName: "getDestinations", args: [potId], ...block }),
    ]);
    infos.forEach((v, i) => {
      const info = v as unknown as Omit<ChangeInfo, "label"> & { label: Hex };
      let label = "";
      try {
        label = shownText32(info.label);
      } catch {
        // Not UTF-8: no name.
      }
      const change = fromChain(ids[i]!, { ...info, label });
      if (change.status !== "waiting" && change.status !== "ready") return;
      let payee = "";
      try {
        const d = dests[change.destIndex];
        payee = d ? shownText32(d.label) : "";
      } catch {
        // Not UTF-8: no name.
      }
      out.push({ potId, change, payee });
    });
  }
  return out;
}
