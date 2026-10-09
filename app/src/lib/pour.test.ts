import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, getAddress, recoverTypedDataAddress, serializeSignature, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { POTS_ABI } from "./abi.ts";
import { AUSD } from "./config.ts";
import { PERMIT_TYPES, pourData } from "./pour.ts";

// A throwaway key that lives only in this test's memory.
const ubong = privateKeyToAccount(generatePrivateKey());
const POTS = getAddress("0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB");
// AUSD's permit domain as read from its eip712Domain(): the name is "Agora Dollar", not name().
const domain = { name: "Agora Dollar", version: "1", chainId: 10143, verifyingContract: AUSD } as const;

test("a pour-in is fundWithPermit for exactly the amount, with a permit only its owner could sign", async () => {
  const terms = { domain, nonce: 3n, deadline: 1_800_000_000n };
  const data = await pourData(ubong, POTS, 7n, 400_000_000n, terms);
  const { functionName, args } = decodeFunctionData({ abi: POTS_ABI, data });
  assert.equal(functionName, "fundWithPermit");
  const [potId, amount, deadline, v, r, s] = args as readonly [bigint, bigint, bigint, number, Hex, Hex];
  assert.equal(potId, 7n);
  assert.equal(amount, 400_000_000n);
  assert.equal(deadline, terms.deadline);
  assert.ok(v === 27 || v === 28, `v is ${v}`);

  const signer = await recoverTypedDataAddress({
    domain,
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: { owner: ubong.address, spender: POTS, value: amount, nonce: terms.nonce, deadline },
    signature: serializeSignature({ r, s, v: BigInt(v) }),
  });
  assert.equal(signer, ubong.address);

  // The same signature says nothing about any other amount, spender or nonce.
  for (const [k, value] of [["value", 400_000_001n], ["nonce", 4n]] as const) {
    const other = await recoverTypedDataAddress({
      domain,
      types: PERMIT_TYPES,
      primaryType: "Permit",
      message: { owner: ubong.address, spender: POTS, value: amount, nonce: terms.nonce, deadline, [k]: value },
      signature: serializeSignature({ r, s, v: BigInt(v) }),
    });
    assert.notEqual(other, ubong.address, k);
  }
});
