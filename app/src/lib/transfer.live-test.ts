// Live check against real AUSD on Monad testnet: npm run test:live.
// Read only. Runs transfers as calls and reads Transfer logs; nothing is signed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Log } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ERC20_READ_ABI } from "./abi.ts";
import { AUSD, AUSD_FAUCET } from "./config.ts";
import { readClient } from "./rpc.ts";
import { incomingSource, transferData, transferRefused } from "./transfer.ts";

const someone = () => privateKeyToAccount(generatePrivateKey()).address;

test("live: a transfer the account can afford runs as a call; one it can't is a refusal, not an error", async () => {
  // The faucet holds AUSD, so a call from it shows the happy path without any key.
  assert.equal(await transferRefused(readClient, AUSD, AUSD_FAUCET, someone(), 1n), false);
  assert.equal(await transferRefused(readClient, AUSD, someone(), someone(), 1n), true);
});

test("live: the transfer the app signs is accepted by AUSD as a gas estimate", async () => {
  const gas = await readClient.estimateGas({ account: AUSD_FAUCET, to: AUSD, data: transferData(someone(), 1_000_000n) });
  assert.ok(gas > 21_000n && gas < 200_000n, `gas ${gas}`);
});

test("live: incoming payments are read from finalized logs within the 100 block limit", async () => {
  const finalized = (await readClient.getBlock({ blockTag: "finalized" })).number;
  const me = someone();
  const source = incomingSource(AUSD, me, async () => finalized, (params) => readClient.request({ method: "eth_getLogs", params: [params] }) as Promise<Log[]>);
  assert.deepEqual(await source.logs(finalized - 100n, finalized), []);
  const balance = await readClient.readContract({ address: AUSD, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [me] });
  assert.equal(balance, 0n);
});
