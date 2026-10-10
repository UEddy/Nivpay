// Live checks of closing and taking a share out, against the real pot 0 on the AUSD pots: npm run test:live.
// Read only: every request is run as a call (eth_call needs no signature). Nothing is signed or sent, no key is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ERROR_CODES } from "../copy.ts";
import { POTS_ABI } from "./abi.ts";
import { closeState, takeView } from "./close.ts";
import { askCloseCall, closeRefusalOf, takeCall } from "./closeLive.ts";
import { POTS_AUSD } from "./config.ts";
import { readClient } from "./rpc.ts";

const someone = () => privateKeyToAccount(generatePrivateKey()).address;

test("live: on pot 0, taking a share out works for whoever holds one, in its present state, and nobody else", async () => {
  const fin = await readClient.getBlock({ blockTag: "finalized" });
  const at = { blockNumber: fin.number } as const;
  const [pot, deciders] = await Promise.all([
    readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getPot", args: [0n], ...at }),
    readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getApprovers", args: [0n], ...at }),
  ]);
  const infos = await Promise.all(deciders.map((d) => readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "funderInfo", args: [0n, d], ...at })));
  const i = infos.findIndex(([s]) => s > 0n);
  assert.ok(i >= 0, "someone named on pot 0 holds a share");
  const [shares, worth] = infos[i]!;
  const holder = deciders[i]!;
  const view = takeView({ closed: pot.closed, myShares: shares, myWorth: worth });
  assert.equal(view.action, pot.closed ? "claim" : "exit");
  assert.equal(await closeRefusalOf(readClient, POTS_AUSD, holder, takeCall(0n, view.action!, shares)), null, "the holder's whole share comes out");
  // More shares than held, and nobody's share at all.
  assert.equal((await closeRefusalOf(readClient, POTS_AUSD, holder, takeCall(0n, "exit", shares + 1n)))?.code, ERROR_CODES.NOTHING_TO_TAKE);
  assert.equal((await closeRefusalOf(readClient, POTS_AUSD, someone(), takeCall(0n, "exit", 1n)))?.code, ERROR_CODES.NOTHING_TO_TAKE);
  if (!pot.closed) {
    assert.equal((await closeRefusalOf(readClient, POTS_AUSD, holder, takeCall(0n, "claim", shares)))?.code, ERROR_CODES.NOT_CLOSED_YET, "leftovers wait for close");
    assert.equal(closeState(pot.closed, pot.endTime, fin.timestamp), "open");
  } else {
    assert.equal((await closeRefusalOf(readClient, POTS_AUSD, someone(), takeCall(0n, "claim", 0n)))?.code, ERROR_CODES.NOTHING_TO_TAKE);
  }
});

test("live: on pot 0, only a decider can ask to close it early, and not once it is closed", async () => {
  const pot = await readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getPot", args: [0n] });
  const [decider] = await readClient.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getApprovers", args: [0n] });
  assert.equal((await closeRefusalOf(readClient, POTS_AUSD, someone(), askCloseCall(0n)))?.code, pot.closed ? ERROR_CODES.POT_ALREADY_CLOSED : ERROR_CODES.NOT_DECIDER);
  assert.equal((await closeRefusalOf(readClient, POTS_AUSD, decider!, askCloseCall(0n)))?.code ?? null, pot.closed ? ERROR_CODES.POT_ALREADY_CLOSED : null);
  // Recording the close is for after the date: before it, the contract says not closed yet.
  if (!pot.closed) assert.equal((await closeRefusalOf(readClient, POTS_AUSD, someone(), { functionName: "closePot", args: [0n] }))?.code, ERROR_CODES.NOT_CLOSED_YET);
});
