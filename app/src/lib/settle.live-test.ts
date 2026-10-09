// Live check against Agora's Instant Settlement pair on Monad testnet: npm run test:live.
// Read only. Quotes as the app does and runs the first-time steps as calls; nothing is signed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AUSD, CTK, SETTLEMENT_PAIR, SETTLEMENT_WHITELISTER } from "./config.ts";
import { readClient } from "./rpc.ts";
import { amountOut, quote, settlementCalls } from "./settle.ts";
import { readSettlement } from "./settleLive.ts";

const S = { pair: SETTLEMENT_PAIR, whitelister: SETTLEMENT_WHITELISTER, dollar: AUSD, other: CTK };
const someone = () => privateKeyToAccount(generatePrivateKey()).address;

test("live: a fresh account gets a quote that matches the pair's own formula, and needs the one-time setup", async () => {
  const me = someone();
  const { state, deadline } = await readSettlement(readClient, S, me, 10_000_000n);
  assert.equal(state.inDecimals, 6);
  assert.equal(state.outDecimals, 18);
  assert.equal(state.outSymbol, "CTK");
  assert.equal(state.quotedOut, amountOut(10_000_000n, state.price, state.fee).out, "our formula is the pair's");
  const q = quote(state, 10_000_000n, deadline);
  assert.deepEqual([q.needsSetup, q.needsAllowance], [true, true]);
  assert.ok(q.minOut > 0n && q.minOut <= q.out);
});

test("live: the one-time setup and the allowance run as calls from a fresh account", async () => {
  const me = someone();
  const { state, deadline } = await readSettlement(readClient, S, me, 10_000_000n);
  const [setup, allow] = settlementCalls(S, quote(state, 10_000_000n, deadline), me, someone());
  await readClient.call({ account: me, to: setup!.to, data: setup!.data });
  const gas = await readClient.estimateGas({ account: me, to: allow!.to, data: allow!.data });
  assert.ok(gas < 100_000n, `allowance gas ${gas}`);
});
