import { getAddress, isAddressEqual, parseEventLogs, type Address, type Hex, type Log } from "viem";
import { ERC20_TRANSFER_ABI, POTS_ABI } from "./abi.ts";
import type { PotEvent } from "./feed.ts";

/**
 * History on Home (README, "History"): every finalized movement of this
 * account's money that this phone has followed, newest first. Built from the
 * dollar's (and CTK's) Transfer events in and out of the account, the same
 * finalized reads the bell uses; nothing here reads the chain. Each entry says
 * what it was by who was on the other side: a pot, the Add money and Cash out
 * desk (by hand, or by Auto cash out), Agora's settlement pair, the faucet,
 * or a person.
 */

export type HistoryKind = "sent" | "received" | "sentOther" | "receivedOther" | "addMoney" | "cashOut" | "autoCashOut" | "testDollars" | "potIn" | "potOut";

export type HistoryEntry = {
  id: string;
  tx: Hex;
  block: bigint;
  logIndex: number;
  kind: HistoryKind;
  /** Money in (+) or out (-) of this account. */
  direction: "in" | "out";
  amount: bigint;
  decimals: number;
  symbol: string;
  /** The account on the other side of the transfer. */
  other: Address;
};

export type Parties = {
  me: Address;
  pots: Address[];
  pair: Address;
  /** Where test dollars come from: Agora's faucet, or nobody (minted). */
  faucets: Address[];
  /** The Add money and Cash out desk, if there is one. */
  desk: Address | null;
  /** Cash outs Auto cash out made, by transaction in lower case (lib/autocashLive.ts). */
  autoCash?: ReadonlySet<string>;
};

export type TransferFeed = { events: PotEvent[]; decimals: number; symbol: string };

const ZERO = "0x0000000000000000000000000000000000000000";
const is = (a: Address, list: (Address | null)[]) => list.some((b) => b !== null && isAddressEqual(a, b));

function classify(direction: "in" | "out", other: Address, p: Parties, otherCurrency: boolean, tx: string): HistoryKind {
  if (is(other, p.pots)) return direction === "in" ? "potOut" : "potIn";
  if (p.desk && isAddressEqual(other, p.desk)) return direction === "in" ? "addMoney" : p.autoCash?.has(tx.toLowerCase()) ? "autoCashOut" : "cashOut";
  if (isAddressEqual(other, p.pair)) return direction === "in" ? "receivedOther" : "sentOther";
  if (direction === "in" && (is(other, p.faucets) || isAddressEqual(other, ZERO))) return "testDollars";
  if (otherCurrency) return direction === "in" ? "receivedOther" : "sentOther";
  return direction === "in" ? "received" : "sent";
}

/** Entries from the transfers in and out, newest first, each once. */
export function historyFrom(incoming: TransferFeed[], outgoing: TransferFeed[], p: Parties, dollarSymbol = "$"): HistoryEntry[] {
  const out = new Map<string, HistoryEntry>();
  const add = (feed: TransferFeed, direction: "in" | "out") => {
    for (const e of feed.events) {
      if (e.name !== "Transfer") continue;
      const from = getAddress(String(e.args.from));
      const to = getAddress(String(e.args.to));
      if (direction === "in" ? !isAddressEqual(to, p.me) : !isAddressEqual(from, p.me)) continue;
      if (isAddressEqual(from, to)) continue;
      const other = direction === "in" ? from : to;
      const id = `${e.tx}:${e.logIndex}`;
      out.set(id, {
        id,
        tx: e.tx,
        block: e.block,
        logIndex: e.logIndex,
        kind: classify(direction, other, p, feed.symbol !== dollarSymbol, e.tx),
        direction,
        amount: e.args.value as bigint,
        decimals: feed.decimals,
        symbol: feed.symbol,
        other,
      });
    }
  };
  for (const f of incoming) add(f, "in");
  for (const f of outgoing) add(f, "out");
  return [...out.values()].sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1));
}

export type HistoryDetail = {
  /** The pot money went into or came out of. */
  potId?: string;
  /** For a payment in another currency: who got it, and how much of the other currency. */
  recipient?: Address;
  received?: bigint;
};

/** What a transaction's receipt adds to an entry: its pot, or who got a payment in another currency. */
export function detailFrom(entry: HistoryEntry, logs: Log[], pots: Address[], otherCurrency: Address | null): HistoryDetail {
  if (entry.kind === "potIn" || entry.kind === "potOut") {
    const mine = logs.filter((l) => is(getAddress(l.address), pots));
    const events = parseEventLogs({ abi: POTS_ABI, logs: mine });
    const hit = events.find((ev) => "potId" in ev.args && (ev.eventName === "Funded" || ev.eventName === "PayoutExecuted" || ev.eventName === "Claimed" || ev.eventName === "Exited"));
    return hit && "potId" in hit.args ? { potId: (hit.args.potId as bigint).toString() } : {};
  }
  if (entry.kind === "sentOther" && otherCurrency) {
    const transfers = parseEventLogs({ abi: ERC20_TRANSFER_ABI, eventName: "Transfer", logs: logs.filter((l) => isAddressEqual(getAddress(l.address), otherCurrency)) });
    const paid = transfers.find((t) => !isAddressEqual(t.args.to, entry.other));
    return paid ? { recipient: getAddress(paid.args.to), received: paid.args.value } : {};
  }
  return {};
}
