import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceNote } from "./connection.ts";

test("a balance read while connected carries no note", () => {
  assert.equal(balanceNote(false, Date.UTC(2026, 9, 10, 14, 2), "UTC"), null);
});

test("offline or after a failed read, the last balance is marked not up to date, with when it was read", () => {
  assert.equal(balanceNote(true, Date.UTC(2026, 9, 10, 14, 2), "UTC"), "Not up to date. Last checked at 14:02.");
  assert.equal(balanceNote(true, Date.UTC(2026, 9, 10, 14, 2), "Europe/London"), "Not up to date. Last checked at 15:02.");
});

test("with nothing read yet there is no balance to mark", () => {
  assert.equal(balanceNote(true, null), null);
});
