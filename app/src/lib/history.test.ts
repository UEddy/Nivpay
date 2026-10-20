import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Address, type Hex, type Log } from "viem";
import { ERC20_TRANSFER_ABI, POTS_ABI } from "./abi.ts";
import type { PotEvent } from "./feed.ts";
import { detailFrom, historyFrom, type Parties } from "./history.ts";

const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const [ME, MUM, POTS, PAIR, FAUCET, DESK, CTK] = [A(1), A(2), A(3), A(4), A(5), A(6), A(7)];
const P: Parties = { me: ME, pots: [POTS], pair: PAIR, faucets: [FAUCET], desk: DESK };
const t = (block: number, from: Address, to: Address, value: bigint, logIndex = 0): PotEvent => ({ name: "Transfer", block: BigInt(block), logIndex, tx: `0x${block.toString(16).padStart(64, "0")}` as Hex, args: { from, to, value } });

test("every movement says what it was, by who was on the other side, newest first", () => {
  const incoming = [t(1, FAUCET, ME, 10n), t(2, MUM, ME, 20n), t(3, DESK, ME, 30n), t(4, POTS, ME, 40n), t(9, A(0), ME, 5n)];
  const outgoing = [t(5, ME, MUM, 1n), t(6, ME, POTS, 2n), t(7, ME, DESK, 3n), t(8, ME, PAIR, 4n)];
  const h = historyFrom([{ events: incoming, decimals: 6, symbol: "$" }, { events: [t(10, PAIR, ME, 99n)], decimals: 18, symbol: "CTK" }], [{ events: outgoing, decimals: 6, symbol: "$" }], P);
  assert.deepEqual(
    h.map((e) => [e.kind, e.direction, e.amount]),
    [
      ["receivedOther", "in", 99n],
      ["testDollars", "in", 5n],
      ["sentOther", "out", 4n],
      ["cashOut", "out", 3n],
      ["potIn", "out", 2n],
      ["sent", "out", 1n],
      ["potOut", "in", 40n],
      ["addMoney", "in", 30n],
      ["received", "in", 20n],
      ["testDollars", "in", 10n],
    ],
  );
  assert.equal(h[0]!.symbol, "CTK");
});

test("each once, and not someone else's transfer; with no desk, its transfers are plain payments", () => {
  const e = t(2, MUM, ME, 20n);
  assert.equal(historyFrom([{ events: [e, e], decimals: 6, symbol: "$" }], [], P).length, 1);
  assert.equal(historyFrom([{ events: [t(3, MUM, A(9), 5n)], decimals: 6, symbol: "$" }], [], P).length, 0);
  assert.equal(historyFrom([{ events: [t(3, DESK, ME, 5n)], decimals: 6, symbol: "$" }], [], { ...P, desk: null })[0]!.kind, "received");
});

const log = (address: Address, topics: Hex[], data: Hex): Log => ({ address, topics: topics as [Hex, ...Hex[]], data, blockNumber: 1n, blockHash: `0x${"0".repeat(64)}`, logIndex: 0, transactionHash: `0x${"1".repeat(64)}`, transactionIndex: 0, removed: false });

test("the receipt names the pot, or who got a payment in another currency", () => {
  const [potIn] = historyFrom([], [{ events: [t(6, ME, POTS, 2n)], decimals: 6, symbol: "$" }], P);
  const funded = log(POTS, encodeEventTopics({ abi: POTS_ABI, eventName: "Funded", args: { potId: 7n, funder: ME } }) as Hex[], encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [2n, 2n]));
  assert.deepEqual(detailFrom(potIn!, [funded], [POTS], CTK), { potId: "7" });
  const [other] = historyFrom([], [{ events: [t(8, ME, PAIR, 4n)], decimals: 6, symbol: "$" }], P);
  const toMum = log(CTK, encodeEventTopics({ abi: ERC20_TRANSFER_ABI, eventName: "Transfer", args: { from: PAIR, to: MUM } }) as Hex[], encodeAbiParameters([{ type: "uint256" }], [4_000_000_000_000_000_000n]));
  assert.deepEqual(detailFrom(other!, [toMum], [POTS], CTK), { recipient: MUM, received: 4_000_000_000_000_000_000n });
  assert.deepEqual(detailFrom(other!, [], [POTS], CTK), {});
});

test("a cash out Auto cash out made says so; one made by hand stays Cash out", () => {
  const auto = t(7, ME, DESK, 3n);
  const byHand = t(8, ME, DESK, 4n);
  const h = historyFrom([], [{ events: [auto, byHand], decimals: 6, symbol: "$" }], { ...P, autoCash: new Set([auto.tx.toLowerCase()]) });
  assert.deepEqual(h.map((e) => e.kind), ["cashOut", "autoCashOut"]);
  // Money in from the desk is still Add money, whatever the list says.
  assert.equal(historyFrom([{ events: [t(9, DESK, ME, 5n)], decimals: 6, symbol: "$" }], [], { ...P, autoCash: new Set([t(9, DESK, ME, 5n).tx]) })[0]!.kind, "addMoney");
});
