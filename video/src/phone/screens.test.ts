import { test } from "node:test";
import assert from "node:assert/strict";
import { checkedScreenFile, RawFootageError } from "./screens.ts";

test("a phone screen reads only redacted files from footage/_screens/", () => {
  assert.equal(checkedScreenFile("_screens/main-A-1_12.0_30.5.mp4"), "_screens/main-A-1_12.0_30.5.mp4");
  for (const raw of ["final/main-A-1.mp4", "rehearsal/1000335864.mp4", "_screens/../final/main-A-1.mp4", "_screens\\..\\x.mp4", "screens/x.mp4"]) {
    assert.throws(() => checkedScreenFile(raw), RawFootageError, raw);
  }
});
