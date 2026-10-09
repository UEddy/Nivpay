import { getAddress, type Address, type PublicClient } from "viem";
import { ERC20_READ_ABI, POTS_ABI, POTS_READ_ABI } from "./abi.ts";
import type { PotsReader } from "./discover.ts";
import { fromText32 } from "./text32.ts";

/** Calls per Multicall3 batch, so one slow or oversized request never holds up the rest. */
const CHUNK = 100;

async function inChunks<T, R>(items: T[], run: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(...(await run(items.slice(i, i + CHUNK))));
  return out;
}

/** Discovery's reads against a pots contract, batched through Multicall3 at one finalized block. */
export function potsReader(readClient: Pick<PublicClient, "getBlock" | "readContract" | "multicall">, pots: Address): PotsReader {
  return {
    finalized: async () => (await readClient.getBlock({ blockTag: "finalized" })).number,

    potCount: async (at) => Number(await readClient.readContract({ address: pots, abi: POTS_ABI, functionName: "potCount", blockNumber: at })),

    async decimals(at) {
      const asset = await readClient.readContract({ address: pots, abi: POTS_READ_ABI, functionName: "token", blockNumber: at });
      return readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "decimals", blockNumber: at });
    },

    members: (ids, at) =>
      inChunks(ids, async (chunk) => {
        const results = await readClient.multicall({
          allowFailure: false,
          blockNumber: at,
          contracts: chunk.flatMap((id) => [
            { address: pots, abi: POTS_ABI, functionName: "getApprovers", args: [BigInt(id)] } as const,
            { address: pots, abi: POTS_ABI, functionName: "getDestinations", args: [BigInt(id)] } as const,
          ]),
        });
        return chunk.map((_, i) => ({
          deciders: (results[i * 2] as readonly Address[]).map((a) => getAddress(a)),
          payees: (results[i * 2 + 1] as readonly { to: Address }[]).map((d) => getAddress(d.to)),
        }));
      }),

    shares: (ids, account, at) =>
      inChunks(ids, (chunk) =>
        readClient.multicall({
          allowFailure: false,
          blockNumber: at,
          contracts: chunk.map((id) => ({ address: pots, abi: POTS_ABI, functionName: "sharesOf", args: [BigInt(id), account] }) as const),
        }),
      ),

    views: (ids, at) =>
      inChunks(ids, async (chunk) => {
        const rows = await readClient.multicall({
          allowFailure: false,
          blockNumber: at,
          contracts: chunk.map((id) => ({ address: pots, abi: POTS_ABI, functionName: "getPot", args: [BigInt(id)] }) as const),
        });
        return rows.map((p) => ({ name: fromText32(p.purpose), totalAssets: p.totalAssets, endTime: p.endTime, closed: p.closed }));
      }),
  };
}
