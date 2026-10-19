import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUSD, CHAIN, DEPLOY_BLOCK, POTS_AUSD, POTS_TESTUSD, POTS_V2, POTS_V2_DEPLOY_BLOCK, RPC_URL, TESTUSD } from "./config.ts";

test("viem's monadTestnet is chain 10143 on the public testnet RPC", () => {
  assert.equal(CHAIN.id, 10143);
  assert.ok(CHAIN.testnet);
  assert.deepEqual(CHAIN.rpcUrls.default.http, [RPC_URL]);
});

// The repo's broadcast receipts are the source of truth for every address.
type Receipt = {
  receipts: { contractAddress: string; blockNumber: string }[];
  transactions: { arguments: string[] | null }[];
};
function receipt(script: string): Receipt {
  const path = new URL(`../../../broadcast/${script}/10143/run-latest.json`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as Receipt;
}
function deployed(script: string) {
  const r = receipt(script).receipts[0];
  if (!r) throw new Error(`no receipt in ${script}`);
  return { address: r.contractAddress.toLowerCase(), block: BigInt(r.blockNumber) };
}

test("addresses and deploy blocks match the committed broadcast receipts", () => {
  const ausdPots = deployed("Deploy.s.sol");
  const testDollar = deployed("DeployTestDollar.s.sol");
  const testPots = deployed("DeployTestDollarPots.s.sol");
  assert.equal(POTS_AUSD.toLowerCase(), ausdPots.address);
  assert.equal(TESTUSD.toLowerCase(), testDollar.address);
  assert.equal(POTS_TESTUSD.toLowerCase(), testPots.address);
  assert.equal(DEPLOY_BLOCK[POTS_AUSD], ausdPots.block);
  assert.equal(DEPLOY_BLOCK[POTS_TESTUSD], testPots.block);
});

test("AUSD is the token the AUSD pots were deployed with", () => {
  const args = receipt("Deploy.s.sol").transactions[0]?.arguments;
  assert.equal(String(args?.[0]).toLowerCase(), AUSD.toLowerCase());
});

test("the TESTUSD pots were deployed with the TESTUSD token", () => {
  const args = receipt("DeployTestDollarPots.s.sol").transactions[0]?.arguments;
  assert.equal(String(args?.[0]).toLowerCase(), TESTUSD.toLowerCase());
});

test("NivPayPotsV2: both addresses, blocks and settings match their committed receipts", () => {
  // Deployed AUSD first, then TESTUSD; forge keeps each run under its own name.
  const runs = { ausd: "run-1792427989315.json", testusd: "run-1792428373919.json" } as const;
  for (const [deployment, run] of Object.entries(runs) as [keyof typeof runs, string][]) {
    const r = JSON.parse(readFileSync(new URL(`../../../broadcast/DeployPotsV2.s.sol/10143/${run}`, import.meta.url), "utf8")) as Receipt;
    const at = r.receipts[0]!;
    assert.equal(POTS_V2?.[deployment].toLowerCase(), at.contractAddress.toLowerCase(), deployment);
    assert.equal(POTS_V2_DEPLOY_BLOCK?.[deployment], BigInt(at.blockNumber), deployment);
    const args = r.transactions[0]?.arguments ?? [];
    assert.equal(String(args[0]).toLowerCase(), (deployment === "ausd" ? AUSD : TESTUSD).toLowerCase(), `${deployment} token`);
    assert.deepEqual(args.slice(4).map(String), ["259200", "604800"], `${deployment}: 72 hours and 7 days`);
  }
});
