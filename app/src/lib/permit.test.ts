import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address, Hex } from "viem";
import { PermitDomainError, readPermitDomain, type DomainReader } from "./permit.ts";
import { AUSD, TESTUSD } from "./config.ts";

// Recorded from the live tokens on Monad testnet, 27 Sep 2026, with eth_call
// at the finalized block. permit.live-test.ts checks the same thing live.
const ZERO32 = `0x${"00".repeat(32)}`;
const RECORDED: Record<string, { domain: readonly unknown[]; separator: Hex }> = {
  [AUSD]: {
    domain: ["0x0f", "Agora Dollar", "1", 10143n, AUSD, ZERO32, []],
    separator: "0x7ff7d6b4bdc3e260c85cf89f8779b1ac80120e3c277f7db4900739a507f03ea1",
  },
  [TESTUSD]: {
    domain: ["0x0f", "NivPay Test Dollar", "1", 10143n, TESTUSD, ZERO32, []],
    separator: "0x3d13360882b9ca9cdede4a635a11e57ad487b28f269eed0f913b14457b794b31",
  },
};

function stub(domain: readonly unknown[], separator: Hex): DomainReader {
  return {
    async readContract({ functionName }) {
      return functionName === "eip712Domain" ? domain : separator;
    },
  };
}

function recorded(token: Address) {
  const r = RECORDED[token];
  if (!r) throw new Error(`nothing recorded for ${token}`);
  return r;
}

for (const token of [AUSD, TESTUSD]) {
  test(`permit domain from eip712Domain() matches DOMAIN_SEPARATOR() for ${token}`, async () => {
    const r = recorded(token);
    const domain = await readPermitDomain(stub(r.domain, r.separator), token);
    assert.equal(domain.name, r.domain[1]);
    assert.equal(domain.version, "1");
    assert.equal(domain.chainId, 10143);
    assert.equal(domain.verifyingContract, token);
  });
}

test("AUSD: a domain built from name() instead of eip712Domain() is refused", async () => {
  const r = recorded(AUSD);
  const fromName = ["0x0f", "AUSD", "1", 10143n, AUSD, ZERO32, []];
  await assert.rejects(readPermitDomain(stub(fromName, r.separator), AUSD), PermitDomainError);
});

test("a domain for another chain is refused", async () => {
  const r = recorded(TESTUSD);
  const otherChain = ["0x0f", "NivPay Test Dollar", "1", 1n, TESTUSD, ZERO32, []];
  await assert.rejects(readPermitDomain(stub(otherChain, r.separator), TESTUSD), /not 10143/);
});

test("a domain naming another contract is refused", async () => {
  const r = recorded(TESTUSD);
  const otherContract = ["0x0f", "NivPay Test Dollar", "1", 10143n, AUSD, ZERO32, []];
  await assert.rejects(readPermitDomain(stub(otherContract, r.separator), TESTUSD), /as its contract/);
});
