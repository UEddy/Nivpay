import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { askData, askIn, yesData } from "./payoutLive.ts";

const POTS = getAddress("0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB");
const OTHER = getAddress("0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA");

test("an ask in flight is read back from its own signed bytes, so a reload can say and retry exactly it", async () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const sign = (to: `0x${string}`, data: `0x${string}`) =>
    signer.signTransaction({ chainId: 10143, type: "eip1559", to, data, nonce: 4, gas: 160_000n, maxFeePerGas: 107_100_000_000n, maxPriorityFeePerGas: 2_000_000_000n, value: 0n });
  assert.deepEqual(askIn(await sign(POTS, askData(3n, 1, 280_000_000n)), POTS, 3n), { payee: 1, amount: 280_000_000n });
  assert.equal(askIn(await sign(POTS, askData(3n, 1, 280_000_000n)), POTS, 4n), null, "another pot");
  assert.equal(askIn(await sign(OTHER, askData(3n, 1, 280_000_000n)), POTS, 3n), null, "the other deployment");
  assert.equal(askIn(await sign(POTS, yesData(3n)), POTS, 3n), null, "a yes is not an ask");
  assert.equal(askIn("0x1234", POTS, 3n), null);
});
