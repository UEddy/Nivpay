import { test } from "node:test";
import assert from "node:assert/strict";
import { lint } from "./denylist-lint.ts";

// Made-up strings only. The real denylist is never read by a test.
test("a clean list has no findings; comments are skipped and blank lines only counted", () => {
  const r = lint("# names\nexamplename exampleson\n\nother@example.com\n   \nexample town\n");
  assert.deepEqual(r.findings, []);
  assert.equal(r.blank, 2);
});

test("short lines, labels, semicolon lists, cast names and duplicates are found by line number", () => {
  const r = lint(["abc", "Email: someone@example.com", "Contacts; Alpha, Beta", "Maya", "  eddy ", "Example Name", "example name", "https://example.com/x"].join("\n"));
  const at = (n: number) => r.findings.filter((f) => f.line === n).map((f) => f.reason).join(" | ");
  assert.match(at(1), /shorter than 4/);
  assert.match(at(2), /looks like a label/);
  assert.match(at(3), /holds a ';'/);
  assert.match(at(4), /equals a cast name/);
  assert.match(at(5), /equals a cast name/);
  assert.equal(at(6), "");
  assert.match(at(7), /duplicate of line 6/);
  // A link's colon is not a label.
  assert.equal(at(8), "");
});

test("a finding never carries the line's text", () => {
  const r = lint("Secret: examplevalue\nxy");
  const out = JSON.stringify(r);
  assert.equal(out.includes("examplevalue"), false);
  assert.equal(out.includes("Secret"), false);
  assert.equal(out.includes("xy"), false);
});
