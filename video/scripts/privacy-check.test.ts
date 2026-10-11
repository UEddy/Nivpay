import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameFails, readDenylist } from "./privacy-check.ts";

// Made-up strings only. The real denylist is never read by a test.
test("any @ fails a frame, as does a phone-number-like run", () => {
  assert.equal(frameFails("Pay Eddy on NivPay.", []), false);
  assert.equal(frameFails("someone@example.com", []), true);
  assert.equal(frameFails("just an @ on its own", []), true);
  assert.equal(frameFails("Call +44 7700 900123", []), true);
  assert.equal(frameFails("Your balance $19,100.00", []), false);
});

test("a denylisted string fails a frame whatever its case or line breaks; the result says nothing of what matched", () => {
  const deny = ["examplename exampleson"];
  assert.equal(frameFails("Sent to EXAMPLENAME\nExampleson", deny), true);
  assert.equal(frameFails("Sent to Maya", deny), false);
  assert.equal(typeof frameFails("x", deny), "boolean");
});

test("the denylist is read at run time from a file, skipping blanks and # lines; a missing file is an empty list", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-"));
  try {
    const f = join(dir, "privacy-denylist.txt");
    writeFileSync(f, "# comment\n\n  Some Name  \nother@example.com\r\n");
    assert.deepEqual(readDenylist(f), ["some name", "other@example.com"]);
    assert.deepEqual(readDenylist(join(dir, "missing.txt")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
