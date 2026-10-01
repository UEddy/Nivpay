import { test } from "node:test";
import assert from "node:assert/strict";
import { MeraError } from "@category-labs/mera";
import { ERROR_CODES } from "../copy.ts";
import { AppError, describeFailure, NotEnoughGasError, SendFailure, setupFailure, WrongPasskeyError, type SendStage } from "./errors.ts";
import { WriteInFlightError } from "./writes.ts";
import { parseAmount } from "./money.ts";

const BEFORE: SendStage[] = ["preparing", "gas grant", "passkey", "signing", "broadcast"];

test("'Nothing was sent' appears only when nothing was broadcast", () => {
  for (const stage of BEFORE) {
    assert.match(describeFailure(new SendFailure(stage, false, new Error("x"))).text, /Nothing was sent\./, stage);
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

test("each failure gets its own neutral code", () => {
  const code = (e: unknown) => describeFailure(e).code;
  assert.equal(code(new MeraError("PASSKEY_OPERATION_FAILED", "x")), ERROR_CODES.PASSKEY_CANCELLED);
  assert.equal(code(new MeraError("PRF_UNAVAILABLE", "x")), ERROR_CODES.PASSKEY_UNSUPPORTED);
  assert.equal(code(new MeraError("CRYPTO_UNAVAILABLE", "x")), ERROR_CODES.BROWSER_MISSING_FEATURE);
  assert.equal(code(new MeraError("SESSION_ENDED", "x")), ERROR_CODES.PASSKEY_TIMED_OUT);
  assert.equal(code(new WrongPasskeyError()), ERROR_CODES.WRONG_PASSKEY);
  assert.equal(code(new SendFailure("preparing", false, new WriteInFlightError())), ERROR_CODES.IN_FLIGHT);
  assert.equal(code(new SendFailure("signing", false, new Error("x"))), ERROR_CODES.SIGNING);
  assert.equal(code(new SendFailure("broadcast", false, new Error("x"))), ERROR_CODES.SAVING);
  assert.equal(code(new SendFailure("confirming", true, new Error("x"))), ERROR_CODES.CONFIRMING);
  assert.equal(code(new Error("x")), ERROR_CODES.UNKNOWN);
});

test("the setup service's answers map to distinct codes, and its words never reach the screen", () => {
  const cases: [number, { error?: string; code?: string }, number][] = [
    [502, { code: "FUNDER_KEY_MALFORMED" }, ERROR_CODES.SETUP_KEY_MALFORMED],
    [502, { code: "FUNDER_KEY_MISMATCH" }, ERROR_CODES.SETUP_KEY_MISMATCH],
    [502, { code: "SEND_FAILED" }, ERROR_CODES.SETUP_SEND_FAILED],
    [502, { code: "RPC_FAILED" }, ERROR_CODES.SETUP_READ_FAILED],
    [503, { error: "funding is paused" }, ERROR_CODES.SETUP_PAUSED],
    [503, { error: "funding is paused, the funder is at its floor" }, ERROR_CODES.SETUP_PAUSED],
    [503, { error: "funding is not configured" }, ERROR_CODES.SETUP_KEY_MALFORMED],
    [409, { error: "this account has reached its limit" }, ERROR_CODES.SETUP_LIMIT_REACHED],
    [409, { error: "only personal accounts can be funded" }, ERROR_CODES.SETUP_REFUSED],
    [403, { error: "same origin only" }, ERROR_CODES.SETUP_REFUSED],
    [404, {}, ERROR_CODES.SETUP_REFUSED],
  ];
  for (const [status, body, expected] of cases) {
    const e = setupFailure(status, body);
    assert.equal(e.code, expected, JSON.stringify([status, body]));
    const shown = describeFailure(new SendFailure("gas grant", false, e));
    assert.doesNotMatch(shown.text, /HTTP|FUNDER|SEND_FAILED|RPC|funding|gas/i, shown.text);
  }
});

test("custom errors keep their own names and messages", () => {
  const gas = new NotEnoughGasError("Your account couldn't be made ready for this.", ERROR_CODES.SETUP_REFUSED);
  assert.equal(gas.name, "NotEnoughGasError");
  assert.ok(gas instanceof AppError);
  assert.equal(new WriteInFlightError().name, "WriteInFlightError");
  assert.match(describeFailure(new SendFailure("gas grant", false, gas)).text, /couldn't be made ready/);
});

test("'1,000' with its comma parses to 1000 test dollars", () => {
  assert.equal(parseAmount("1,000", 6), 1_000_000_000n);
  assert.equal(parseAmount("1,000.00", 6), 1_000_000_000n);
});
