import { BaseError, ContractFunctionRevertedError, encodeFunctionData, getAddress, isAddressEqual, numberToHex, pad, parseEventLogs, toEventSelector, type Address, type Hex, type Log, type PublicClient } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { ERC20_TRANSFER_ABI } from "./abi.ts";
import { AppError } from "./errors.ts";
import type { FeedSource, FeedState, FeedStore, PotEvent } from "./feed.ts";
import { formatAmount } from "./money.ts";

/**
 * Sending dollars from one account to another: a plain transfer of the
 * deployment's dollar (AUSD by default), signed with the person's passkey and
 * followed to Finalized like every other request (lib/send.ts, lib/writes.ts).
 */

/** Label for the pending write record, so a reload resumes the right screen. */
export const SEND_LABEL = "send";

export function transferData(to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [to, amount] });
}

export type SendCheck = {
  me: Address;
  to: Address;
  amount: bigint;
  balance: bigint;
  decimals: number;
  /** True when the recipient has code: a service, not a person's account. */
  recipientHasCode: boolean;
};

/** Everything that can be refused on the phone, before a gas grant or a passkey prompt. */
export function checkSend(c: SendCheck): AppError | null {
  if (isAddressEqual(c.me, c.to)) return new AppError(copy.errSendToSelf, ERROR_CODES.SEND_TO_SELF);
  if (c.recipientHasCode) return new AppError(copy.errSendNotPerson, ERROR_CODES.SEND_NOT_PERSON);
  if (c.amount <= 0n) return new AppError(copy.errSendNoAmount, ERROR_CODES.SEND_NO_AMOUNT);
  if (c.amount > c.balance) return new AppError(copy.errSendMoreThanBalance(formatAmount(c.balance, c.decimals, "cents")), ERROR_CODES.SEND_MORE_THAN_BALANCE);
  return null;
}

/**
 * Runs the transfer as a call before anything is signed. A revert here is the
 * dollar itself refusing, such as the issuer's freeze on either account, so
 * it costs no gas grant and no passkey prompt. Failing to reach the network
 * is not a refusal: that throws, as any read does.
 */
export async function transferRefused(client: Pick<PublicClient, "simulateContract">, dollar: Address, from: Address, to: Address, amount: bigint): Promise<boolean> {
  try {
    await client.simulateContract({ account: from, address: dollar, abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [to, amount] });
    return false;
  } catch (e) {
    if (e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError) !== null) return true;
    throw e;
  }
}

/** A payment that reached this account, as the Receive view lists it. */
export type Incoming = { tx: Hex; block: bigint; logIndex: number; from: Address; amount: bigint };

export function incomingFrom(events: PotEvent[], me: Address): Incoming[] {
  return events
    .filter((e) => e.name === "Transfer" && isAddressEqual(e.args.to as Address, me))
    .map((e) => ({ tx: e.tx, block: e.block, logIndex: e.logIndex, from: getAddress(e.args.from as Address), amount: e.args.value as bigint }))
    .sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1));
}

const TRANSFER_TOPIC = toEventSelector("Transfer(address,address,uint256)");

type GetLogs = (params: { address: Address; fromBlock: Hex; toBlock: Hex; topics: (Hex | null)[] }) => Promise<Log[]>;

/** Transfers of `asset` into `me`, from finalized blocks only, in the feed's shape. */
export function incomingSource(asset: Address, me: Address, finalized: () => Promise<bigint>, getLogs: GetLogs): FeedSource {
  const toTopic = pad(me, { size: 32 });
  return {
    finalized,
    async logs(from, to) {
      const raw = await getLogs({ address: asset, fromBlock: numberToHex(from), toBlock: numberToHex(to), topics: [TRANSFER_TOPIC, null, toTopic] });
      return parseEventLogs({ abi: ERC20_TRANSFER_ABI, eventName: "Transfer", logs: raw })
        .filter((l) => isAddressEqual(l.args.to, me))
        .map((l) => ({ name: "Transfer", block: l.blockNumber, logIndex: l.logIndex, tx: l.transactionHash, args: l.args as Record<string, unknown> }));
    },
  };
}

/** About ten minutes of blocks. Payments older than this when the view opens aren't read back from history. */
export const RECEIVE_BACKLOG_BLOCKS = 2_000n;

/**
 * Keeps what was received before but never reads further back than `floor`,
 * so opening Receive after a long time away doesn't page through hours of
 * blocks 100 at a time. The balance is always right; only the list is short.
 */
export function withFloor(store: FeedStore, floor: bigint): FeedStore {
  return {
    load: async () => {
      const saved = await store.load();
      if (!saved) return undefined;
      return { cursor: saved.cursor > floor ? saved.cursor : floor, events: saved.events } satisfies FeedState;
    },
    save: (s) => store.save(s),
  };
}
