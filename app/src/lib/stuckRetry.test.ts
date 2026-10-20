import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { decodeFunctionData, getAddress, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ALLOWANCE_ABI, allowanceFor, allowanceLabel } from "./autocashLive.ts";
import { callOf, recoveryFor } from "./stuckRetry.ts";

// Anvil's default account #0: a published test key, never a real one.
const signer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const DESK = getAddress("0x73A687be03c770A40f06a63a1c1F2b515f344522");
const AUSD = getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
const CAP = 500_000_000n;

async function stuckAllowance() {
  const { data } = allowanceFor(DESK, CAP.toString());
  const raw = await signer.signTransaction({ chainId: 10143, type: "eip1559", to: AUSD, data, nonce: 0, gas: 71_099n, maxFeePerGas: 107_100_000_000n, maxPriorityFeePerGas: 2_000_000_000n });
  return { address: signer.address, nonce: 0, raw, hash: keccak256(raw), label: allowanceLabel(DESK, CAP), submittedAt: 1, replaceable: true };
}

test("Auto cash out's stuck allowance write: Try again sends the very same call, approve(desk, cap), never another", async () => {
  const w = await stuckAllowance();
  assert.equal(recoveryFor(w, (l) => l.startsWith("autocash ")), "retry");
  const call = callOf(w)!;
  assert.deepEqual([call.from, call.to, call.label], [signer.address, AUSD, w.label]);
  const decoded = decodeFunctionData({ abi: ALLOWANCE_ABI, data: call.data });
  assert.equal(decoded.functionName, "approve");
  assert.deepEqual(decoded.args, [DESK, CAP]);
});

test("a write still on its way is followed; another screen's write, or none, is left alone", async () => {
  const w = await stuckAllowance();
  assert.equal(recoveryFor({ ...w, replaceable: false }, (l) => l.startsWith("autocash ")), "follow");
  assert.equal(recoveryFor({ ...w, label: "send 0x1 5" }, (l) => l.startsWith("autocash ")), null);
  assert.equal(recoveryFor(null, () => true), null);
  assert.equal(callOf({ ...w, raw: "0x1234" as Hex }), null, "bytes that aren't a transaction give no call");
});

test("every screen that writes offers Try again for its own stuck write, or hands its writes to one that does", () => {
  const dir = new URL("../screens/", import.meta.url);
  // The hands free voice sheet's write carries Send's own label, and it says to open Send, which offers Try again.
  const handsOff: Record<string, string> = { "VoicePay.tsx": "Send.tsx" };
  const missing: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    if (!/\bsendWrite\(|\bsendSequence\(/.test(src)) continue;
    const other = handsOff[f];
    const ok = /\bretryStuckWrite\(/.test(src) || (other !== undefined && /\bretryStuckWrite\(/.test(readFileSync(new URL(other, dir), "utf8")));
    if (!ok) missing.push(f);
  }
  assert.deepEqual(missing, []);
});
