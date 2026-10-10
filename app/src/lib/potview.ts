import { getAddress, numberToHex, pad, parseEventLogs, type Address, type Hex, type Log } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { ERC20_READ_ABI, POTS_ABI, POTS_READ_ABI } from "./abi.ts";
import { LOG_PAGE_BLOCKS } from "./config.ts";
import { DEPLOYMENT, POTS } from "./deployment.ts";
import type { Person, Share } from "./draft.ts";
import { AppError } from "./errors.ts";
import { PotFeed, type FeedSource, type PotEvent } from "./feed.ts";
import { idbFeedStore } from "./idb.ts";
import { verifyLabels, type PotLink } from "./invites.ts";
import { readClient } from "./rpc.ts";
import { fromText32 } from "./text32.ts";

/** A pot as opened from its link, checked against its PotCreated event. */
export type PotInfo = {
  potId: bigint;
  block: bigint;
  creator: Address;
  /** True only when the names and shares were signed by the pot's creator over its transaction. */
  labelsOk: boolean;
  people: Person[];
  shares: Share[];
};

/**
 * Opens a pot link. Destinations, limits and deciders always come from the
 * chain; the names and suggested shares in the link are used only if the
 * pot's creator signed them over the transaction that made the pot.
 */
export async function openPot(link: PotLink): Promise<PotInfo> {
  if (link.deployment !== DEPLOYMENT) throw new AppError(copy.errPotOtherVersion, ERROR_CODES.POT_OTHER_VERSION);
  const raw = (await readClient.request({
    method: "eth_getLogs",
    params: [
      {
        address: POTS,
        fromBlock: numberToHex(link.block),
        toBlock: numberToHex(link.block),
        topics: [null, pad(numberToHex(link.potId), { size: 32 })],
      },
    ],
  })) as Log[];
  const [created] = parseEventLogs({ abi: POTS_ABI, eventName: "PotCreated", logs: raw }).filter((l) => l.args.potId === link.potId);
  if (!created) throw new AppError(copy.errPotNotFound, ERROR_CODES.POT_NOT_FOUND);
  const labelsOk = await verifyLabels(POTS, link, created.transactionHash, created.args.creator);
  return {
    potId: link.potId,
    block: link.block,
    creator: getAddress(created.args.creator),
    labelsOk,
    people: labelsOk ? link.people : [],
    shares: labelsOk ? link.shares : [],
  };
}

export type Payee = { to: Address; name: string; cap: bigint; spent: bigint };

/** Current numbers, all read at one finalized block. */
export type PotState = {
  at: bigint;
  /** The finalized block's time, in seconds: what expiry is judged against. */
  now: bigint;
  name: string;
  endTime: bigint;
  threshold: number;
  closed: boolean;
  frozen: boolean;
  totalAssets: bigint;
  deciders: Address[];
  payees: Payee[];
  asset: Address;
  decimals: number;
  myBalance: bigint;
  /** What each listed account could take out now (funderInfo.redeemable), by lowercase account. */
  held: Record<string, bigint>;
  /** Each listed account's shares (funderInfo.shares), by lowercase account, and the pot's total. */
  shares: Record<string, bigint>;
  totalShares: bigint;
};

export async function readPotState(potId: bigint, accounts: Address[], me: Address): Promise<PotState> {
  const block = await readClient.getBlock({ blockTag: "finalized" });
  const at = { blockNumber: block.number } as const;
  const [pot, deciders, destinations, asset] = await Promise.all([
    readClient.readContract({ address: POTS, abi: POTS_ABI, functionName: "getPot", args: [potId], ...at }),
    readClient.readContract({ address: POTS, abi: POTS_ABI, functionName: "getApprovers", args: [potId], ...at }),
    readClient.readContract({ address: POTS, abi: POTS_ABI, functionName: "getDestinations", args: [potId], ...at }),
    readClient.readContract({ address: POTS, abi: POTS_READ_ABI, functionName: "token", ...at }),
  ]);
  const unique = [...new Map(accounts.map((a) => [a.toLowerCase(), a])).values()];
  const [decimals, myBalance, ...infos] = await Promise.all([
    readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "decimals", ...at }),
    readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [me], ...at }),
    ...unique.map((a) => readClient.readContract({ address: POTS, abi: POTS_ABI, functionName: "funderInfo", args: [potId, a], ...at })),
  ]);
  return {
    at: block.number,
    now: block.timestamp,
    name: fromText32(pot.purpose),
    endTime: pot.endTime,
    threshold: pot.threshold,
    closed: pot.closed,
    frozen: pot.frozen,
    totalAssets: pot.totalAssets,
    deciders: deciders.map((d) => getAddress(d)),
    payees: destinations.map((d) => ({ to: getAddress(d.to), name: fromText32(d.label), cap: d.cap, spent: d.spent })),
    asset: getAddress(asset),
    decimals,
    myBalance,
    held: Object.fromEntries(unique.map((a, i) => [a.toLowerCase(), (infos[i] as readonly [bigint, bigint])[1]])),
    shares: Object.fromEntries(unique.map((a, i) => [a.toLowerCase(), (infos[i] as readonly [bigint, bigint])[0]])),
    totalShares: pot.totalShares,
  };
}

/** The pot's events from the RPC. potId is the first indexed topic of some events and the second of others. */
function rpcSource(potId: bigint): FeedSource {
  const topic = pad(numberToHex(potId), { size: 32 });
  const query = (from: bigint, to: bigint, topics: (Hex | null)[]) =>
    readClient.request({
      method: "eth_getLogs",
      params: [{ address: POTS, fromBlock: numberToHex(from), toBlock: numberToHex(to), topics }],
    }) as Promise<Log[]>;
  return {
    finalized: async () => (await readClient.getBlock({ blockTag: "finalized" })).number,
    async logs(from, to) {
      const [first, second] = await Promise.all([query(from, to, [null, topic]), query(from, to, [null, null, topic])]);
      const decoded = parseEventLogs({ abi: POTS_ABI, logs: [...first, ...second] });
      const out = new Map<string, PotEvent>();
      for (const l of decoded) {
        // A topic match alone isn't enough: a proposal id or an account can share the number.
        if (!("potId" in l.args) || l.args.potId !== potId) continue;
        out.set(`${l.transactionHash}:${l.logIndex}`, {
          name: l.eventName,
          block: l.blockNumber,
          logIndex: l.logIndex,
          tx: l.transactionHash,
          args: l.args as Record<string, unknown>,
        });
      }
      return [...out.values()];
    },
  };
}

export function potFeed(potId: bigint, fromBlock: bigint): PotFeed {
  return new PotFeed(rpcSource(potId), idbFeedStore(`${POTS}:${potId}`), fromBlock, {
    pageSize: LOG_PAGE_BLOCKS,
    parallel: 4,
    everyMs: 1_000,
  });
}

/** Total each account has put in, from Funded events. */
export function putIn(events: PotEvent[]): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const e of events) {
    if (e.name !== "Funded") continue;
    const who = String(e.args.funder).toLowerCase();
    out[who] = (out[who] ?? 0n) + (e.args.assets as bigint);
  }
  return out;
}
