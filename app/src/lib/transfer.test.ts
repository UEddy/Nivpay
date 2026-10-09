import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeAbiParameters, getAddress, pad, toEventSelector, type Hex, type Log } from "viem";
import { ERROR_CODES } from "../copy.ts";
import { ERC20_TRANSFER_ABI } from "./abi.ts";
import type { FeedStore } from "./feed.ts";
import { checkSend, incomingFrom, incomingSource, transferData, withFloor } from "./transfer.ts";

const IDARA = getAddress("0x725c9a4bb4c3de2f11ac0e7c9b1e8f0d3a2b7bc1");
const UBONG = getAddress("0x1111111111111111111111111111111111111111");
const AUSD = getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
const ok = { me: IDARA, to: UBONG, amount: 25_000_000n, balance: 100_000_000n, decimals: 6, recipientHasCode: false };

test("a send is exactly a transfer of that amount to that account", () => {
  const { functionName, args } = decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: transferData(UBONG, 25_000_000n) });
  assert.equal(functionName, "transfer");
  assert.deepEqual(args, [UBONG, 25_000_000n]);
});

test("a good send passes; everything refusable is refused on the phone with its own code", () => {
  assert.equal(checkSend(ok), null);
  assert.equal(checkSend({ ...ok, amount: ok.balance }), null, "the whole balance can be sent");
  const code = (c: Partial<typeof ok>) => checkSend({ ...ok, ...c })?.code;
  assert.equal(code({ to: IDARA.toLowerCase() as Hex }), ERROR_CODES.SEND_TO_SELF);
  assert.equal(code({ recipientHasCode: true }), ERROR_CODES.SEND_NOT_PERSON);
  assert.equal(code({ amount: 0n }), ERROR_CODES.SEND_NO_AMOUNT);
  assert.equal(code({ amount: ok.balance + 1n }), ERROR_CODES.SEND_MORE_THAN_BALANCE);
  assert.match(checkSend({ ...ok, amount: ok.balance + 1n })!.message, /\$100\.00/);
});

const TOPIC = toEventSelector("Transfer(address,address,uint256)");
function transferLog(from: Hex, to: Hex, value: bigint, block: bigint, logIndex: number): Log {
  return {
    address: AUSD,
    topics: [TOPIC, pad(from, { size: 32 }), pad(to, { size: 32 })],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    blockNumber: block,
    logIndex,
    transactionHash: `0x${block.toString(16).padStart(64, "0")}`,
    transactionIndex: 0,
    blockHash: `0x${"11".repeat(32)}`,
    removed: false,
  } as Log;
}

test("incoming payments are read from finalized logs filtered to this account, newest first", async () => {
  const asked: unknown[] = [];
  const source = incomingSource(AUSD, UBONG, async () => 120n, async (p) => {
    asked.push(p);
    return [transferLog(IDARA, UBONG, 25_000_000n, 101n, 0), transferLog(IDARA, IDARA, 9n, 102n, 0), transferLog(IDARA, UBONG, 5_000_000n, 110n, 3)];
  });
  const events = await source.logs(100n, 120n);
  assert.deepEqual(asked, [{ address: AUSD, fromBlock: "0x64", toBlock: "0x78", topics: [TOPIC, null, pad(UBONG, { size: 32 }).toLowerCase()] }]);
  assert.deepEqual(
    incomingFrom(events, UBONG).map((i) => [i.block, i.from, i.amount]),
    [
      [110n, IDARA, 5_000_000n],
      [101n, IDARA, 25_000_000n],
    ],
  );
});

test("Receive never reads further back than its floor, and keeps what it had", async () => {
  const saved = { cursor: 50n, events: [{ name: "Transfer", block: 40n, logIndex: 0, tx: "0x01" as Hex, args: {} }] };
  const inner: FeedStore = { load: async () => saved, save: async () => {} };
  assert.deepEqual(await withFloor(inner, 1_000n).load(), { cursor: 1_000n, events: saved.events });
  assert.deepEqual(await withFloor(inner, 10n).load(), saved);
  assert.equal(await withFloor({ load: async () => undefined, save: async () => {} }, 5n).load(), undefined);
});
