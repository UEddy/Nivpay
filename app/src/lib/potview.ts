import { getAddress, numberToHex, pad, parseEventLogs, type Address, type Hex, type Log } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { ERC20_READ_ABI, POTS_ABI, POTS_READ_ABI, POTS_V2_ABI } from "./abi.ts";
import { LOG_PAGE_BLOCKS } from "./config.ts";
import { DEPLOYMENT, POTS_V2_HERE, potsAt } from "./deployment.ts";
import type { Person, Share } from "./draft.ts";
import { AppError } from "./errors.ts";
import { PotFeed, refillCutShort, type FeedSource, type PotEvent } from "./feed.ts";
import { idbFeedStore } from "./idb.ts";
import { verifyLabels, type PotLink } from "./invites.ts";
import { readClient } from "./rpc.ts";
import { shownText32 } from "./text32.ts";
import type { PotChange } from "./changes.ts";
import { readChanges } from "./changesLive.ts";
import { lastOf, PotLastStore } from "./potLast.ts";
import { potKey } from "./potstore.ts";

/** A pot as opened from its link, checked against its PotCreated event. */
export type PotInfo = {
  potId: bigint;
  /** On NivPayPotsV2: its changes can be proposed and shown. */
  onV2: boolean;
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
  if (link.deployment !== DEPLOYMENT || (link.onV2 && !POTS_V2_HERE)) throw new AppError(copy.errPotOtherVersion, ERROR_CODES.POT_OTHER_VERSION);
  const pots = potsAt(link.onV2);
  const raw = (await readClient.request({
    method: "eth_getLogs",
    params: [
      {
        address: pots,
        fromBlock: numberToHex(link.block),
        toBlock: numberToHex(link.block),
        topics: [null, pad(numberToHex(link.potId), { size: 32 })],
      },
    ],
  })) as Log[];
  const [created] = parseEventLogs({ abi: POTS_ABI, eventName: "PotCreated", logs: raw }).filter((l) => l.args.potId === link.potId);
  if (!created) throw new AppError(copy.errPotNotFound, ERROR_CODES.POT_NOT_FOUND);
  const labelsOk = await verifyLabels(pots, link, created.transactionHash, created.args.creator);
  return {
    potId: link.potId,
    onV2: link.onV2,
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
  /** On NivPayPotsV2: its changes can be proposed, and are read below. */
  onV2: boolean;
  /** Payees taken off the pot by a change, by index. All false on NivPayPots, where none can be. */
  removed: boolean[];
  /** The changes open on the pot (lib/changes.ts). Always empty on NivPayPots. */
  changes: PotChange[];
  /** How long a widening change waits, in seconds (NivPayPotsV2.EXIT_WINDOW). 0 on NivPayPots. */
  exitWindow: bigint;
};

export async function readPotState(onV2: boolean, potId: bigint, accounts: Address[], me: Address): Promise<PotState> {
  const POTS = potsAt(onV2);
  const block = await readClient.getBlock({ blockTag: "finalized" });
  const at = { blockNumber: block.number } as const;
  const [pot, deciders, destinations, asset] = await Promise.all([
    readClient.readContract({ address: POTS, abi: POTS_ABI, functionName: "getPot", args: [potId], ...at }),
    readClient.readContract({ address: POTS, abi: POTS_ABI, functionName: "getApprovers", args: [potId], ...at }),
    readClient.readContract({ address: POTS, abi: POTS_ABI, functionName: "getDestinations", args: [potId], ...at }),
    readClient.readContract({ address: POTS, abi: POTS_READ_ABI, functionName: "token", ...at }),
  ]);
  const unique = [...new Map(accounts.map((a) => [a.toLowerCase(), a])).values()];
  // A V2 pot's changes and removed payees, at the same block as everything else.
  const v2 = onV2 ? await readChanges(readClient, POTS, potId, destinations.length, block.number) : { changes: [], removed: destinations.map(() => false), exitWindow: 0n };
  const [decimals, myBalance, ...infos] = await Promise.all([
    readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "decimals", ...at }),
    readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [me], ...at }),
    ...unique.map((a) => readClient.readContract({ address: POTS, abi: POTS_ABI, functionName: "funderInfo", args: [potId, a], ...at })),
  ]);
  return {
    at: block.number,
    now: block.timestamp,
    name: shownText32(pot.purpose),
    endTime: pot.endTime,
    threshold: pot.threshold,
    closed: pot.closed,
    frozen: pot.frozen,
    totalAssets: pot.totalAssets,
    deciders: deciders.map((d) => getAddress(d)),
    payees: destinations.map((d) => ({ to: getAddress(d.to), name: shownText32(d.label), cap: d.cap, spent: d.spent })),
    asset: getAddress(asset),
    decimals,
    myBalance,
    held: Object.fromEntries(unique.map((a, i) => [a.toLowerCase(), (infos[i] as readonly [bigint, bigint])[1]])),
    shares: Object.fromEntries(unique.map((a, i) => [a.toLowerCase(), (infos[i] as readonly [bigint, bigint])[0]])),
    totalShares: pot.totalShares,
    onV2,
    ...v2,
  };
}

/** The pot's events from the RPC. potId is the first indexed topic of some events and the second of others. */
function rpcSource(pots: Address, potId: bigint): FeedSource {
  const topic = pad(numberToHex(potId), { size: 32 });
  const query = (from: bigint, to: bigint, topics: (Hex | null)[]) =>
    readClient.request({
      method: "eth_getLogs",
      params: [{ address: pots, fromBlock: numberToHex(from), toBlock: numberToHex(to), topics }],
    }) as Promise<Log[]>;
  return {
    finalized: async () => (await readClient.getBlock({ blockTag: "finalized" })).number,
    async logs(from, to) {
      const [first, second] = await Promise.all([query(from, to, [null, topic]), query(from, to, [null, null, topic])]);
      const decoded = parseEventLogs({ abi: POTS_V2_ABI, logs: [...first, ...second] });
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

export function potFeed(onV2: boolean, potId: bigint, fromBlock: bigint): PotFeed {
  const pots = potsAt(onV2);
  const feed = new PotFeed(rpcSource(pots, potId), refillCutShort(idbFeedStore(`${pots}:${potId}`), fromBlock), fromBlock, {
    pageSize: LOG_PAGE_BLOCKS,
    parallel: 4,
    everyMs: 1_000,
  });
  // Whoever follows the pot, the Pots tab learns its last event too (lib/potLast.ts).
  const start = feed.start.bind(feed);
  feed.start = (onEvents, onError) =>
    start((all, fresh, progress) => {
      rememberLast(potKey({ potId, onV2 }), all);
      onEvents(all, fresh, progress);
    }, onError);
  return feed;
}

/** Keeps a pot's last event for its row, from events already read. Never throws. */
export function rememberLast(key: string, events: PotEvent[]): void {
  try {
    const last = lastOf(events);
    if (last) new PotLastStore(localStorage, DEPLOYMENT).put(key, last);
  } catch {
    // Storage refused: the row shows what the pot holds.
  }
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
