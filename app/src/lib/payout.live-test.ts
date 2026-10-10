// Live checks against the deployed NivPayPots on Monad testnet: npm run test:live.
// Read only. Requests are run as calls from accounts nobody holds a key
// for (eth_call needs no signature); nothing is signed or broadcast.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ERROR_CODES } from "../copy.ts";
import { POTS_ABI, POTS_READ_ABI } from "./abi.ts";
import { POTS_AUSD, POTS_TESTUSD } from "./config.ts";
import { AppError } from "./errors.ts";
import { feeFor } from "./payout.ts";
import { askData, readFeeTerms, readRequest, refusalOf } from "./payoutLive.ts";
import { readClient } from "./rpc.ts";

const someone = () => privateKeyToAccount(generatePrivateKey()).address;

test("live: the fee the phone shows before any yes is the fee both contracts charge", async () => {
  for (const pots of [POTS_AUSD, POTS_TESTUSD]) {
    const terms = await readFeeTerms(readClient, pots);
    assert.equal(terms.ttl, 604_800n, "requests last 7 days");
    for (const amount of [1n, 199n, 200n, 280_000_000n, 600_000_000n, 9_999_999_999n, 10n ** 15n]) {
      const onChain = await readClient.readContract({ address: pots, abi: POTS_ABI, functionName: "feeOn", args: [amount] });
      assert.equal(feeFor(amount, terms.feeBps, terms.feeCap), onChain, `${pots} ${amount}`);
    }
  }
});

test("live: a request number that doesn't exist reads as a damaged link, code 70", async () => {
  const next = await readClient.readContract({ address: POTS_AUSD, abi: [{ type: "function", name: "proposalCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const, functionName: "proposalCount" });
  await assert.rejects(readRequest(readClient, POTS_AUSD, 0n, next + 1_000n, someone()), (e) => e instanceof AppError && e.code === ERROR_CODES.LINK_DAMAGED);
});

test("live: saying yes to, or taking back, a request that doesn't exist is refused as a call", async () => {
  const me = someone();
  assert.equal((await refusalOf(readClient, POTS_AUSD, me, { functionName: "approve", args: [10n ** 12n] }))?.code, ERROR_CODES.REQUEST_REFUSED);
  assert.equal((await refusalOf(readClient, POTS_AUSD, me, { functionName: "revokeApproval", args: [10n ** 12n] }))?.code, ERROR_CODES.REQUEST_REFUSED);
});

test("live: on a real pot, a stranger can't ask, a decider can, and a zero amount is refused first", async (t) => {
  const count = await readClient.readContract({ address: POTS_AUSD, abi: POTS_READ_ABI, functionName: "potCount" });
  if (count === 0n) return t.skip("no pot on the AUSD deployment yet");
  const potId = 0n;
  const [pot, deciders] = await Promise.all([
    readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getPot", args: [potId] }),
    readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getApprovers", args: [potId] }),
  ]);
  const decider = deciders[0]!;
  const ask = (from: `0x${string}`, amount: bigint) => refusalOf(readClient, POTS_AUSD, from, { functionName: "proposePayout", args: [potId, 0, amount] });
  if (pot.closed || pot.frozen) {
    assert.equal((await ask(decider, 1n))?.code, ERROR_CODES.PAY_POT_STOPPED);
    return;
  }
  assert.equal((await ask(someone(), 1n))?.code, ERROR_CODES.NOT_DECIDER);
  assert.equal((await ask(decider, 0n))?.code, ERROR_CODES.PAY_NO_AMOUNT);
  // A decider's ask runs as a call. In a pot that needs more than one yes it
  // doesn't pay yet, so even an amount over the limit is taken by the
  // contract; the phone's own check (askView) is what stops that.
  if (pot.threshold > 1) {
    assert.equal(await ask(decider, 1n), null);
    const gas = await readClient.estimateGas({ account: decider, to: POTS_AUSD, data: askData(potId, 0, 1n) });
    assert.ok(gas > 100_000n && gas < 200_000n, `an ask costs about 158,000 gas, measured ${gas}`);
  }
});
