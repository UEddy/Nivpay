import { getAddress, zeroAddress, type Address, type PublicClient } from "viem";
import { NAMES_ABI } from "./abi.ts";

/**
 * Reads from NivPayNames, always at one finalized block, batched through
 * Multicall3 as discovery reads pots (discoverLive.ts). Nothing here writes.
 */
export type NameLookup = { holder: Address | null; availableAt: bigint; releasedBy: Address | null };

export interface NamesReader {
  finalized(): Promise<bigint>;
  /** Each account's username, "" for none, in the same order. */
  namesOf(accounts: Address[], at: bigint): Promise<string[]>;
  /** Who holds a name, when anyone may claim it, and who released it if it is held. */
  lookup(name: string, at: bigint): Promise<NameLookup>;
}

const CHUNK = 100;
const orNull = (a: Address) => (a === zeroAddress ? null : getAddress(a));

export function namesReader(client: Pick<PublicClient, "getBlock" | "multicall">, names: Address): NamesReader {
  return {
    finalized: async () => (await client.getBlock({ blockTag: "finalized" })).number,
    async namesOf(accounts, at) {
      const out: string[] = [];
      for (let i = 0; i < accounts.length; i += CHUNK) {
        const rows = await client.multicall({
          allowFailure: false,
          blockNumber: at,
          contracts: accounts.slice(i, i + CHUNK).map((a) => ({ address: names, abi: NAMES_ABI, functionName: "nameOf", args: [a] }) as const),
        });
        out.push(...rows);
      }
      return out;
    },
    async lookup(name, at) {
      const [holder, availableAt, releasedBy] = await client.multicall({
        allowFailure: false,
        blockNumber: at,
        contracts: [
          { address: names, abi: NAMES_ABI, functionName: "accountOf", args: [name] },
          { address: names, abi: NAMES_ABI, functionName: "availableAt", args: [name] },
          { address: names, abi: NAMES_ABI, functionName: "releasedBy", args: [name] },
        ],
      });
      return { holder: orNull(holder), availableAt, releasedBy: orNull(releasedBy) };
    },
  };
}
