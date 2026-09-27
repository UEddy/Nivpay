// Live check against the real tokens on Monad testnet: npm run test:live.
// Kept out of `npm test` so a flaky public RPC cannot fail the everyday suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readPermitDomain } from "./permit.ts";
import { readClient } from "./rpc.ts";
import { AUSD, TESTUSD } from "./config.ts";

for (const [label, token] of [["AUSD", AUSD], ["TESTUSD", TESTUSD]] as const) {
  test(`live: ${label} permit domain from eip712Domain() matches DOMAIN_SEPARATOR()`, async () => {
    const domain = await readPermitDomain(readClient, token);
    assert.equal(domain.chainId, 10143);
    assert.equal(domain.verifyingContract, token);
    console.log(`${label}: name "${domain.name}", version "${domain.version}"`);
  });
}
