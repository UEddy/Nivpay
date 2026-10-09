// Live check against the real AUSD on Monad testnet: npm run test:live.
// Nothing is broadcast. A throwaway key signs a permit the way a pour-in
// does, and AUSD's own permit() is run as a call with it. If the domain or
// the types were wrong, AUSD would refuse it; fundWithPermit would swallow
// that and the pour would fail on the allowance instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { POTS_ABI } from "./abi.ts";
import { AUSD, POTS_AUSD } from "./config.ts";
import { pourData, readPermitTerms } from "./pour.ts";
import { readClient } from "./rpc.ts";

const PERMIT_ABI = [
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

test("live: AUSD accepts the permit a pour-in signs", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const block = await readClient.getBlock({ blockTag: "finalized" });
  const terms = await readPermitTerms(AUSD, owner.address, block.timestamp);
  assert.equal(terms.nonce, 0n, "a fresh account's first permit");
  const data = await pourData(owner, POTS_AUSD, 0n, 400_000_000n, terms);
  const [, amount, deadline, v, r, s] = decodeFunctionData({ abi: POTS_ABI, data }).args as readonly [bigint, bigint, bigint, number, Hex, Hex];
  await readClient.simulateContract({
    account: owner.address,
    address: AUSD,
    abi: PERMIT_ABI,
    functionName: "permit",
    args: [owner.address, POTS_AUSD, amount, deadline, v, r, s],
  });

  // And a permit for a different amount than the one signed is refused.
  await assert.rejects(
    readClient.simulateContract({
      account: owner.address,
      address: AUSD,
      abi: PERMIT_ABI,
      functionName: "permit",
      args: [owner.address, POTS_AUSD, amount + 1n, deadline, v, r, s],
    }),
  );
});
