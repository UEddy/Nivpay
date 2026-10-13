import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("sheets: each frame is stamped with its own time, with no offset added", () => {
  const script = readFileSync(join(import.meta.dirname, "sheets.sh"), "utf8");
  // drawtext's %{pts:format:offset} adds its last argument in seconds, so a third field stamps every frame late.
  const stamps = [...script.matchAll(/%\{pts\\:([^}]*)\}/g)].map((m) => m[1]!);
  assert.ok(stamps.length > 0, "sheets.sh stamps the time");
  for (const s of stamps) assert.ok(!s.includes("\\:"), `%{pts\\:${s}} adds an offset to the stamp`);
});
