import { test } from "node:test";
import assert from "node:assert/strict";
import { copy } from "../copy.ts";
import { SLOW_AFTER_MS, slowStepLine } from "./slowStep.ts";

test("a step before the passkey says what it is waiting for once it runs long", () => {
  assert.equal(slowStepLine("preparing", SLOW_AFTER_MS - 1), null);
  assert.equal(slowStepLine("preparing", SLOW_AFTER_MS), copy.slowPreparing);
  assert.equal(slowStepLine("getting-ready", SLOW_AFTER_MS), copy.slowGettingReady);
});

test("nothing is said once the passkey is asked for or anything is sent, or when idle", () => {
  for (const step of ["confirm", "sending", "landing", null]) assert.equal(slowStepLine(step, 60_000), null, String(step));
});

test("the waiting lines say nothing has been sent, which is true before the passkey", () => {
  for (const line of [copy.slowPreparing, copy.slowGettingReady]) assert.match(line, /Nothing has been sent\.$/);
});
