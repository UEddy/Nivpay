import { getAddress, numberToHex, pad, parseEventLogs, toEventSelector, type Address, type Log, type PublicClient } from "viem";
import { ERC20_READ_ABI, POTS_ABI, POTS_READ_ABI } from "./abi.ts";
import type { PotsReader } from "./discover.ts";
import type { FundingsReader } from "./fundings.ts";
import type { CreatorReader } from "./invited.ts";
import type { MakerReader } from "./potSort.ts";
import type { AskReader } from "./waiting.ts";
import { shownText32 } from "./text32.ts";

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
        return rows.map((p) => ({ name: shownText32(p.purpose), totalAssets: p.totalAssets, endTime: p.endTime, closed: p.closed }));
      }),
  };
}

/**
 * Where things stand as an invite is answered: the finalized block and how
 * many pots exist there. The pot the invite is for is made later, so it is
 * made after this block and numbered at least this count.
 */
export async function readSince(readClient: Pick<PublicClient, "getBlock" | "readContract">, pots: Address): Promise<{ block: bigint; potCount: number }> {
  const block = (await readClient.getBlock({ blockTag: "finalized" })).number;
  const potCount = Number(await readClient.readContract({ address: pots, abi: POTS_ABI, functionName: "potCount", blockNumber: block }));
  return { block, potCount };
}

const POT_CREATED = toEventSelector(POTS_ABI.find((e) => e.type === "event" && e.name === "PotCreated")!);

/** Matching's reads against a pots contract (invited.ts). */
export function creatorReader(readClient: Pick<PublicClient, "getBlock" | "readContract" | "multicall" | "request">, pots: Address): CreatorReader {
  const members = potsReader(readClient, pots).members;
  return {
    finalized: async () => (await readClient.getBlock({ blockTag: "finalized" })).number,

    potCountAt: async (at) => Number(await readClient.readContract({ address: pots, abi: POTS_ABI, functionName: "potCount", blockNumber: at })),

    async created(from, to, creator, potId) {
      const raw = (await readClient.request({
        method: "eth_getLogs",
        params: [
          {
            address: pots,
            fromBlock: numberToHex(from),
            toBlock: numberToHex(to),
            topics: [POT_CREATED, potId === undefined ? null : pad(numberToHex(potId), { size: 32 }), pad(creator.toLowerCase() as Address, { size: 32 })],
          },
        ],
      })) as Log[];
      return parseEventLogs({ abi: POTS_ABI, eventName: "PotCreated", logs: raw })
        .filter((l) => getAddress(l.args.creator) === getAddress(creator) && (potId === undefined || l.args.potId === potId))
        .map((l) => ({ potId: l.args.potId, block: l.blockNumber }));
    },

    members: async (potId, at) => (await members([Number(potId)], at))[0]!,
  };
}

const FUNDED = toEventSelector(POTS_ABI.find((x) => x.type === "event" && x.name === "Funded")!);

/** Money put into some pots (fundings.ts): their Funded events, one page of blocks, and the pots' members. */
export function fundingsReader(readClient: Pick<PublicClient, "getBlock" | "readContract" | "multicall" | "request">, pots: Address): FundingsReader {
  const members = potsReader(readClient, pots).members;
  return {
    async funded(potIds, from, to) {
      const raw = (await readClient.request({
        method: "eth_getLogs",
        params: [{ address: pots, fromBlock: numberToHex(from), toBlock: numberToHex(to), topics: [FUNDED, potIds.map((id) => pad(numberToHex(id), { size: 32 }))] }],
      })) as Log[];
      return parseEventLogs({ abi: POTS_ABI, eventName: "Funded", logs: raw }).map((l) => ({
        tx: l.transactionHash,
        logIndex: l.logIndex,
        potId: l.args.potId,
        funder: getAddress(l.args.funder),
        assets: l.args.assets,
      }));
    },
    members: async (potId, at) => (await members([Number(potId)], at))[0]!,
  };
}

/** A pot's maker, from its PotCreated event in the block it was made in (potSort.ts). */
export function makerReader(readClient: Pick<PublicClient, "request">, pots: Address): MakerReader {
  return {
    async makerAt(potId, block) {
      const raw = (await readClient.request({
        method: "eth_getLogs",
        params: [{ address: pots, fromBlock: numberToHex(block), toBlock: numberToHex(block), topics: [POT_CREATED, pad(numberToHex(potId), { size: 32 })] }],
      })) as Log[];
      const [made] = parseEventLogs({ abi: POTS_ABI, eventName: "PotCreated", logs: raw }).filter((l) => l.args.potId === potId);
      return made ? getAddress(made.args.creator) : null;
    },
  };
}

/** Requests waiting for a yes (waiting.ts): proposalInfo for many numbers in one Multicall3 batch at a finalized block. */
export function askReader(readClient: Pick<PublicClient, "getBlock" | "readContract" | "multicall">, pots: Address): AskReader {
  return {
    async finalized() {
      const b = await readClient.getBlock({ blockTag: "finalized" });
      return { number: b.number, timestamp: b.timestamp };
    },
    proposalCount: async (at) => Number(await readClient.readContract({ address: pots, abi: POTS_ABI, functionName: "proposalCount", blockNumber: at })),
    infos: (ids, at) =>
      inChunks(ids, async (chunk) => {
        const rows = await readClient.multicall({
          allowFailure: false,
          blockNumber: at,
          contracts: chunk.map((id) => ({ address: pots, abi: POTS_ABI, functionName: "proposalInfo", args: [BigInt(id)] }) as const),
        });
        return rows.map((r) => ({
          potId: r.potId,
          kind: r.kind,
          status: r.status,
          payee: r.destIndex,
          amount: r.amount,
          asker: getAddress(r.proposer),
          expiresAt: r.expiresAt,
          yes: r.approvedBy.map((a) => getAddress(a)),
          threshold: r.threshold,
        }));
      }),
  };
}
