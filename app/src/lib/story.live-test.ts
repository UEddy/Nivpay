// Live checks of the pot's story against the real pot 0 on the AUSD pots: npm run test:live.
// Read only. Nothing is signed or broadcast and no key is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, numberToHex, pad, parseEventLogs, type Address, type Log } from "viem";
import { POTS_ABI } from "./abi.ts";
import { DEPLOY_BLOCK, POTS_AUSD } from "./config.ts";
import { creatorReader } from "./discoverLive.ts";
import type { PotEvent } from "./feed.ts";
import { formatAmount } from "./money.ts";
import { readClient } from "./rpc.ts";
import { replaySteps, storyRows } from "./story.ts";
import { learnPotBlocks, PotBlocks } from "./waiting.ts";

class Memory {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
}

const MAKER = getAddress("0x725C9cd75b2C8C29AEbf6a14eE84a3b54C787bC1");

async function potEventsIn(block: bigint): Promise<PotEvent[]> {
  const topic = pad(numberToHex(0n), { size: 32 });
  const q = (topics: (`0x${string}` | null)[]) =>
    readClient.request({ method: "eth_getLogs", params: [{ address: POTS_AUSD, fromBlock: numberToHex(block), toBlock: numberToHex(block), topics }] }) as Promise<Log[]>;
  const raw = [...(await q([null, topic])), ...(await q([null, null, topic]))];
  return parseEventLogs({ abi: POTS_ABI, logs: raw })
    .filter((l) => "potId" in l.args && l.args.potId === 0n)
    .map((l) => ({ name: l.eventName, block: l.blockNumber, logIndex: l.logIndex, tx: l.transactionHash, args: l.args as Record<string, unknown> }));
}

test("live: pot 0's story starts with its maker, and its first pour replays to what the contract says it was worth right after", async (t) => {
  const blocks = new PotBlocks(new Memory(), "ausd");
  await learnPotBlocks(blocks, ["0"], creatorReader(readClient, POTS_AUSD), DEPLOY_BLOCK[POTS_AUSD]!);
  const made = BigInt(blocks.get("0")!);
  const madeEvents = await potEventsIn(made);
  const fin = await readClient.getBlock({ blockTag: "finalized" });
  const named = (a: Address) => `account ending ${a.slice(-4)}`;
  const first = storyRows(madeEvents, { me: "0x0000000000000000000000000000000000000001", nameOf: named, cityOf: () => "", payeeName: () => "", money: (v) => formatAmount(v, 6, "cents"), now: fin.timestamp });
  assert.equal(first[0]?.kind, "made");
  assert.equal(first[0]?.title, `${named(MAKER)} made the pot`);

  // The pour: bisect sharesOf over past state for the block it landed in.
  const deciders = await readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getApprovers", args: [0n], blockNumber: fin.number });
  const funder = (
    await Promise.all(deciders.map(async (a) => ({ a, s: await readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "sharesOf", args: [0n, a], blockNumber: fin.number }) })))
  ).find((x) => x.s > 0n)?.a;
  if (!funder) return t.skip("nobody named on pot 0 holds a share now");
  let lo = made;
  let hi = fin.number;
  while (hi - lo > 1n) {
    const mid = lo + (hi - lo) / 2n;
    const s = await readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "sharesOf", args: [0n, funder], blockNumber: mid });
    if (s > 0n) hi = mid;
    else lo = mid;
  }
  const pour = await potEventsIn(hi);
  const funded = pour.find((e) => e.name === "Funded");
  assert.ok(funded, `Funded in block ${hi}`);
  const steps = replaySteps([...madeEvents, ...pour]);
  const [, worth] = await readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "funderInfo", args: [0n, funder], blockNumber: hi });
  assert.equal(steps.at(-1)!.held[funder.toLowerCase()], worth, "the replay's arithmetic is the contract's");
});
