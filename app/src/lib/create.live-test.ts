// Live check against the real AUSD pots contract on Monad testnet: npm run test:live.
// Nothing is signed or broadcast. createPot runs as a call and a gas estimate
// from throwaway accounts, so it shows the arguments the app builds are the
// ones the deployed contract accepts, and that its refusals decode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseError, ContractFunctionRevertedError, getAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ERC20_READ_ABI, POTS_ABI, POTS_READ_ABI } from "./abi.ts";
import { AUSD, POTS_AUSD } from "./config.ts";
import { checkDraft, newDraft, withDecider, withPayeeAccount, type Draft } from "./draft.ts";
import { readClient } from "./rpc.ts";

const someone = (): Address => privateKeyToAccount(generatePrivateKey()).address;

test("live: a draft becomes a createPot the AUSD pots contract accepts", async () => {
  const block = await readClient.getBlock({ blockTag: "finalized" });
  const at = { blockNumber: block.number } as const;
  const [maxDeciders, maxPayees, asset, potCount] = await Promise.all([
    readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "MAX_APPROVERS", ...at }),
    readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "MAX_DESTINATIONS", ...at }),
    readClient.readContract({ address: POTS_AUSD, abi: POTS_READ_ABI, functionName: "token", ...at }),
    readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "potCount", ...at }),
  ]);
  assert.equal(getAddress(asset), AUSD, "the AUSD pots are bound to AUSD");
  const decimals = await readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "decimals", ...at });
  const unit = 10n ** BigInt(decimals);

  const creator = someone();
  let draft: Draft = {
    ...newDraft(creator, "Europe/London", 0, (n) => crypto.getRandomValues(new Uint8Array(n))),
    name: "Mama’s 60th",
    me: { city: "London", timeZone: "Europe/London" },
    closes: "2026-12-31",
    payees: [
      { slot: "0x0101010101010101", name: "Caterer", cap: (700n * unit).toString() },
      { slot: "0x0202020202020202", name: "Event hall", cap: (300n * unit).toString() },
    ],
  };
  draft = withDecider(draft, { account: someone(), name: "Ubong", city: "Houston", timeZone: "America/Chicago" });
  draft = withDecider(draft, { account: someone(), name: "Aniekan", city: "Uyo", timeZone: "Africa/Lagos" });
  draft = withPayeeAccount(draft, "0x0101010101010101", someone(), "reply");
  draft = withPayeeAccount(draft, "0x0202020202020202", someone(), "pasted");

  const { missing, args } = checkDraft(draft, { maxDeciders: Number(maxDeciders), maxPayees: Number(maxPayees) }, block.timestamp, POTS_AUSD);
  assert.deepEqual(missing, []);
  assert.ok(args);

  const { result } = await readClient.simulateContract({ account: creator, address: POTS_AUSD, abi: POTS_ABI, functionName: "createPot", args });
  assert.equal(result, potCount, "it would be the next pot");
  const gas = await readClient.estimateContractGas({ account: creator, address: POTS_AUSD, abi: POTS_ABI, functionName: "createPot", args });
  console.log(`createPot would make pot ${result}, gas ${gas}, at finalized block ${block.number}, MAX_APPROVERS ${maxDeciders}, MAX_DESTINATIONS ${maxPayees}`);

  // A closing time already past is refused by the contract, and the refusal decodes.
  const past = [args[0], args[1], args[2], args[3], args[4], args[5], block.timestamp - 60n] as const;
  try {
    await readClient.simulateContract({ account: creator, address: POTS_AUSD, abi: POTS_ABI, functionName: "createPot", args: past });
    assert.fail("a past closing time should be refused");
  } catch (error) {
    const revert = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    assert.ok(revert instanceof ContractFunctionRevertedError);
    assert.equal(revert.data?.errorName, "EndTimeInPast");
  }
});
