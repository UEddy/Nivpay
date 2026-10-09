import { test } from "node:test";
import assert from "node:assert/strict";
import { CallExecutionError, RawContractError, toFunctionSelector } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { deploymentFrom, POTS_AUSD, POTS_TESTUSD, potsFor } from "./config.ts";
import { AppError, describeFailure, SendFailure } from "./errors.ts";
import { ClaimCooldownError, claimData, cooldownIn, FAUCET_ERRORS, refusalKind, revertData, secondsLeft, secondsUntil } from "./faucet.ts";

test("AUSD is the default deployment; TESTUSD only when asked for", () => {
  assert.equal(deploymentFrom(undefined), "ausd");
  assert.equal(deploymentFrom(""), "ausd");
  assert.equal(deploymentFrom("ausd"), "ausd");
  assert.equal(deploymentFrom("something else"), "ausd");
  assert.equal(deploymentFrom("testusd"), "testusd");
  assert.equal(deploymentFrom(" TESTUSD "), "testusd");
  assert.equal(potsFor("ausd"), POTS_AUSD);
  assert.equal(potsFor("testusd"), POTS_TESTUSD);
});

test("a claim calls requestFunds for the account itself", () => {
  const me = "0x725c9a4bb4c3de2f11ac0e7c9b1e8f0d3a2b7bc1";
  const data = claimData(me);
  assert.equal(data.slice(0, 10), toFunctionSelector("requestFunds(address)"));
  assert.ok(data.toLowerCase().endsWith(me.slice(2).toLowerCase()));
});

test("the faucet's refusals are told apart by selector", () => {
  assert.equal(refusalKind(FAUCET_ERRORS.cooldown), "cooldown");
  assert.equal(refusalKind(FAUCET_ERRORS.ceiling), "ceiling");
  assert.equal(refusalKind(FAUCET_ERRORS.outOfStock), "refused");
  assert.equal(refusalKind("0x"), "refused");
  assert.equal(refusalKind(undefined), "refused");
});

test("revert data is found inside viem's wrapped call errors", () => {
  const wrapped = new CallExecutionError(new RawContractError({ data: FAUCET_ERRORS.ceiling }), {});
  assert.equal(revertData(wrapped), FAUCET_ERRORS.ceiling);
  assert.equal(revertData(new Error("offline")), undefined);
});

test("seconds left in the cooldown are counted from the last claim, never below 1", () => {
  assert.equal(secondsLeft(1_000n, 60n, 1_018n), 42);
  assert.equal(secondsLeft(1_000n, 60n, 1_060n), 1);
  assert.equal(secondsLeft(1_000n, 60n, 2_000n), 1);
});

test("claim refusals have their own codes and plain words", () => {
  const codes = [ERROR_CODES.CLAIM_COOLDOWN, ERROR_CODES.CLAIM_CEILING, ERROR_CODES.CLAIM_REVERTED];
  assert.deepEqual(codes, [60, 61, 62]);
  assert.match(copy.errClaimCooldown(1), /1 second\./);
  assert.match(copy.errClaimCooldown(42), /42 seconds\./);
  assert.match(copy.errClaimCeiling("$100,000"), /\$100,000 or more/);
  assert.match(copy.claimDidNotGoThrough, /No test dollars moved/);
  // A refusal found before sending keeps its code and says nothing was sent.
  const shown = describeFailure(new SendFailure("preparing", false, new AppError(copy.errClaimRefused, ERROR_CODES.CLAIM_REVERTED)));
  assert.equal(shown.code, ERROR_CODES.CLAIM_REVERTED);
  assert.equal(shown.text, `${copy.errClaimRefused} ${copy.nothingWasSent}`);
});

test("a cooldown refusal carries when the next claim is allowed, and counts down to 0", () => {
  const refusal = new ClaimCooldownError(42, 1_000_000);
  assert.equal(refusal.until, 1_042_000);
  assert.equal(refusal.code, ERROR_CODES.CLAIM_COOLDOWN);
  assert.equal(cooldownIn(new SendFailure("preparing", false, refusal)), refusal);
  assert.equal(cooldownIn(refusal), refusal);
  assert.equal(cooldownIn(new SendFailure("preparing", false, new Error("x"))), undefined);
  // The "Try again" button is enabled only at 0, never early.
  assert.equal(secondsUntil(refusal.until, 1_000_000), 42);
  assert.equal(secondsUntil(refusal.until, 1_041_001), 1);
  assert.equal(secondsUntil(refusal.until, 1_042_000), 0);
  assert.equal(secondsUntil(refusal.until, 1_050_000), 0);
});
