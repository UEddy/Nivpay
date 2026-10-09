// Live check against the real pots contracts on Monad testnet: npm run test:live.
// Read only. Runs discovery for a throwaway account through Multicall3 at the
// finalized block, the way Home does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { POTS_ABI } from "./abi.ts";
import { POTS_AUSD, POTS_TESTUSD } from "./config.ts";
import { EMPTY_SCAN, findPots, NEW_PER_POLL } from "./discover.ts";
import { potsReader } from "./discoverLive.ts";
import { readClient } from "./rpc.ts";

for (const [name, pots] of [["AUSD", POTS_AUSD], ["TESTUSD", POTS_TESTUSD]] as const) {
  test(`live: discovery reads the ${name} pots and finds nothing for an account named nowhere`, async () => {
    const someone = privateKeyToAccount(generatePrivateKey()).address;
    const scan = await findPots(potsReader(readClient, pots), EMPTY_SCAN, someone);
    const count = Number(await readClient.readContract({ address: pots, abi: POTS_ABI, functionName: "potCount", blockTag: "finalized" }));
    assert.ok(scan.checkedUpTo <= count && scan.checkedUpTo === Math.min(count, NEW_PER_POLL), `checked ${scan.checkedUpTo} of ${count}`);
    assert.deepEqual(scan.found, []);
    assert.equal(scan.decimals, 6);
  });
}
