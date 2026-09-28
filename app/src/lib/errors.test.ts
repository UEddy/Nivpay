import { test } from "node:test";
import assert from "node:assert/strict";
import { MeraError } from "@category-labs/mera";
import { HttpRequestError } from "viem";
import { describeFailure, NotEnoughGasError, SendFailure, shortDetail, WrongPasskeyError, type SendStage } from "./errors.ts";
import { WriteInFlightError } from "./writes.ts";
import { parseAmount } from "./money.ts";

const BEFORE: SendStage[] = ["preparing", "gas grant", "passkey", "signing", "broadcast"];

test("'Nothing was sent' appears only when nothing was broadcast", () => {
  for (const stage of BEFORE) {
    const d = describeFailure(new SendFailure(stage, false, new Error("x")));
    assert.match(d.text, /Nothing was sent\./, stage);
  }
  for (const stage of [...BEFORE, "confirming"] as SendStage[]) {
    const d = describeFailure(new SendFailure(stage, true, new Error("x")));
    assert.doesNotMatch(d.text, /nothing was sent/i, stage);
    assert.match(d.text, /was sent but isn't confirmed/, stage);
  }
});

test("errors outside the send flow never claim anything about sending", () => {
  assert.doesNotMatch(describeFailure(new Error("x")).text, /sent/i);
  assert.doesNotMatch(describeFailure(new MeraError("PRF_UNAVAILABLE", "x")).text, /sent/i);
});

test("every failure carries a short reason naming the stage", () => {
  const gas = new NotEnoughGasError("Your account couldn't be made ready.", "HTTP 502 FUNDER_KEY_MALFORMED, could not send the grant");
  assert.deepEqual(describeFailure(new SendFailure("gas grant", false, gas)), {
    text: "Your account couldn't be made ready. Nothing was sent.",
    reason: "gas grant: HTTP 502 FUNDER_KEY_MALFORMED, could not send the grant",
  });
  assert.equal(describeFailure(new SendFailure("passkey", false, new MeraError("PRF_UNAVAILABLE", "x"))).reason, "passkey: passkey PRF_UNAVAILABLE");
  assert.equal(describeFailure(new SendFailure("preparing", false, new WriteInFlightError())).reason, "preparing: a write is already in flight");
  assert.equal(describeFailure(new SendFailure("passkey", false, new WrongPasskeyError())).reason, "passkey: passkey for a different account");
});

test("custom errors keep their own messages instead of the generic one", () => {
  // The bug behind "Something went wrong": the app compared e.name, which
  // these classes never set, so their messages were thrown away.
  const gas = new NotEnoughGasError("Your account couldn't be made ready for this.", "r");
  assert.equal(gas.name, "NotEnoughGasError");
  assert.equal(new WriteInFlightError().name, "WriteInFlightError");
  assert.match(describeFailure(new SendFailure("gas grant", false, gas)).text, /couldn't be made ready/);
  assert.match(describeFailure(new SendFailure("preparing", false, new WriteInFlightError())).text, /still going through/);
});

test("reasons are one short line with long hex removed", () => {
  const long = new Error(`request failed for 0x${"ab".repeat(100)}\nsecond line`);
  const r = shortDetail(long);
  assert.ok(!r.includes("abab"));
  assert.ok(!r.includes("\n"));
  assert.ok(r.length <= 100);
  const viem = new HttpRequestError({ url: "https://testnet-rpc.monad.xyz", status: 503 });
  assert.match(shortDetail(viem), /HTTP request failed/);
});

test("'1,000' with its comma parses to 1000 test dollars", () => {
  assert.equal(parseAmount("1,000", 6), 1_000_000_000n);
  assert.equal(parseAmount("1,000.00", 6), 1_000_000_000n);
});
