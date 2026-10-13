import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClipEntry } from "../redactions.ts";
import { checkedScreenFile, RawFootageError, screenFileFor, screenStamp, stampFileFor } from "./screens.ts";

test("a phone screen reads only redacted files from footage/_screens/", () => {
  assert.equal(checkedScreenFile("_screens/main-A-1_12.0_30.5.mp4"), "_screens/main-A-1_12.0_30.5.mp4");
  for (const raw of ["final/main-A-1.mp4", "rehearsal/1000335864.mp4", "_screens/../final/main-A-1.mp4", "_screens\\..\\x.mp4", "screens/x.mp4"]) {
    assert.throws(() => checkedScreenFile(raw), RawFootageError, raw);
  }
});

test("each take and speed has its own screen file, inside _screens/, with a stamp beside it", () => {
  const f = screenFileFor({ clip: "main-A-1", in: 12, out: 30.5 }, 2);
  assert.equal(f, "_screens/main-A-1_12.00_30.50_x2.00.mp4");
  assert.equal(checkedScreenFile(f), f);
  assert.notEqual(screenFileFor({ clip: "main-A-1", in: 12, out: 30.5 }, 1), f);
  assert.equal(stampFileFor(f), "_screens/main-A-1_12.00_30.50_x2.00.stamp.json");
});

test("any change to the clip's redaction entry makes its screen files stale", () => {
  const entry: ClipEntry = { file: "final/a.mp4", phone: "A", width: 1080, height: 2340, durationSeconds: 60, statusBar: 0.04, reviewed: true, regions: [], cuts: [], holds: [] };
  const take = { clip: "a", in: 1, out: 5 };
  const before = screenStamp(entry, take, 1);
  assert.equal(screenStamp({ ...entry }, take, 1), before);
  assert.notEqual(screenStamp({ ...entry, regions: [{ start: 2, end: 3, rect: { x: 0, y: 0, w: 1, h: 0.1 }, category: "contact names" }] }, take, 1), before);
  assert.notEqual(screenStamp(entry, take, 2), before);
  assert.notEqual(screenStamp(entry, { ...take, out: 6 }, 1), before);
});

test("a held frame has its own screen file and stamp", () => {
  const take = { clip: "a", in: 31.5, out: 31.6 };
  const held = screenFileFor({ ...take, hold: 3 }, 1);
  assert.equal(held, "_screens/a_31.50_31.60_x1.00_h3.00.mp4");
  assert.notEqual(held, screenFileFor(take, 1));
  const entry: ClipEntry = { file: "final/a.mp4", phone: "A", width: 1080, height: 2340, durationSeconds: 60, statusBar: 0.04, reviewed: true, regions: [], cuts: [], holds: [] };
  assert.notEqual(screenStamp(entry, { ...take, hold: 3 }, 1), screenStamp(entry, take, 1));
  assert.equal(screenStamp(entry, take, 1), JSON.stringify({ entry, clip: "a", in: 31.5, out: 31.6, speed: 1 }));
});
