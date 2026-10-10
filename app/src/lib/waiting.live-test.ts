// Live checks against the real pot on the AUSD pots contract: npm run test:live.
// Read only. Nothing is signed or broadcast and no key is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, numberToHex, pad, parseEventLogs, type Log } from "viem";
import { POTS_ABI } from "./abi.ts";
import { DEPLOY_BLOCK, POTS_AUSD } from "./config.ts";
import { askReader, creatorReader } from "./discoverLive.ts";
import { readClient } from "./rpc.ts";
import { EMPTY_ASK_SCAN, findOpenRequests, learnPotBlocks, PotBlocks } from "./waiting.ts";

class Memory {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
}

const MAKER = getAddress("0x725C9cd75b2C8C29AEbf6a14eE84a3b54C787bC1");

test("live: pot 0 opens with no link: its creation block is found from past state and holds its PotCreated", async () => {
  const blocks = new PotBlocks(new Memory(), "ausd");
  await learnPotBlocks(blocks, ["0"], creatorReader(readClient, POTS_AUSD), DEPLOY_BLOCK[POTS_AUSD]!);
  const block = BigInt(blocks.get("0")!);
  const raw = (await readClient.request({
    method: "eth_getLogs",
    params: [{ address: POTS_AUSD, fromBlock: numberToHex(block), toBlock: numberToHex(block), topics: [null, pad(numberToHex(0n), { size: 32 })] }],
  })) as Log[];
  const [made] = parseEventLogs({ abi: POTS_ABI, eventName: "PotCreated", logs: raw });
  assert.ok(made, `PotCreated for pot 0 in block ${block}`);
  assert.equal(getAddress(made.args.creator), MAKER);
});

test("live: requests waiting on pot 0 are read from the chain alone, at the finalized block", async () => {
  const reader = askReader(readClient, POTS_AUSD);
  const at = await reader.finalized();
  const count = await reader.proposalCount(at.number);
  const scan = await findOpenRequests(reader, EMPTY_ASK_SCAN, new Set(["0"]));
  assert.equal(scan.checkedUpTo, Math.min(count, 200));
  for (const r of scan.open) {
    assert.equal(r.potId, "0");
    assert.ok(BigInt(r.expiresAt) >= at.timestamp, "nothing expired is listed");
  }
});
