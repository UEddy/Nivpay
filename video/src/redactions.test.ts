import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertRenderable,
  FINGERPRINT_CAPTION,
  padRegion,
  parseRedactions,
  RedactionError,
  regionsAt,
  SCREEN_LOCK_CAPTION,
  timeline,
  type ClipEntry,
  type Redactions,
} from "./redactions.ts";

const entry = (over: Partial<ClipEntry> = {}): ClipEntry => ({
  file: "rehearsal/sample.mp4",
  phone: "A, Galaxy S24",
  width: 1080,
  height: 2340,
  durationSeconds: 60,
  statusBar: 0.045,
  reviewed: true,
  regions: [],
  cuts: [],
  holds: [],
  ...over,
});
const map = (e: ClipEntry): Redactions => ({ version: 1, clips: { sample: e } });

test("a clip with no entry, or not marked reviewed, refuses to render", () => {
  assert.throws(() => assertRenderable("other", map(entry()), 0, 60, []), /no entry/);
  assert.throws(() => assertRenderable("sample", map(entry({ reviewed: false })), 0, 60, []), /isn't marked reviewed/);
  assert.throws(() => assertRenderable("sample", map(entry()), 0, 60, null), /no frame scan/);
});

test("a scan hit not under a region or a cut refuses to render; covered, cropped or cut ones pass", () => {
  const hit = { t: 11.5, category: "email address", box: { x: 0.2, y: 0.87, w: 0.6, h: 0.03 } };
  assert.throws(() => assertRenderable("sample", map(entry()), 0, 60, [hit]), RedactionError);
  const region = { start: 11, end: 12, rect: { x: 0, y: 0.8, w: 1, h: 0.2 }, category: "email address" as const };
  assert.doesNotThrow(() => assertRenderable("sample", map(entry({ regions: [region] })), 0, 60, [hit]));
  const cut = { start: 10, end: 13, category: "PIN or password entry" as const, caption: SCREEN_LOCK_CAPTION };
  assert.doesNotThrow(() => assertRenderable("sample", map(entry({ cuts: [cut] })), 0, 60, [hit]));
  const statusBarHit = { t: 4, category: "email address", box: { x: 0.1, y: 0.01, w: 0.3, h: 0.02 } };
  assert.doesNotThrow(() => assertRenderable("sample", map(entry()), 0, 60, [statusBarHit]));
  // A region that covers only part of the hit is not enough.
  const short = { ...region, rect: { x: 0.3, y: 0.8, w: 0.7, h: 0.2 } };
  assert.throws(() => assertRenderable("sample", map(entry({ regions: [short] })), 0, 60, [hit]), /not covered/);
  const bottomHit = { t: 4, category: "email address", box: { x: 0.1, y: 0.95, w: 0.3, h: 0.02 } };
  assert.throws(() => assertRenderable("sample", map(entry()), 0, 60, [bottomHit]), /not covered/);
  assert.doesNotThrow(() => assertRenderable("sample", map(entry({ bottomBar: 0.06 })), 0, 60, [bottomHit]));
  // Where a passkey sheet is says nothing private by itself.
  assert.doesNotThrow(() => assertRenderable("sample", map(entry()), 0, 60, [{ ...hit, category: "passkey sheet" }]));
  // Outside the stretch being rendered, a hit doesn't block it.
  assert.doesNotThrow(() => assertRenderable("sample", map(entry()), 20, 30, [hit]));
});

test("a cut leaves the timeline and becomes a black hold of at most 2.5 s with its caption", () => {
  const e = entry({ cuts: [{ start: 19.7, end: 24.7, category: "PIN or password entry", caption: SCREEN_LOCK_CAPTION }] });
  assert.deepEqual(timeline(e, 10, 30), [
    { kind: "clip", from: 10, to: 19.7 },
    { kind: "hold", seconds: 2.5, caption: SCREEN_LOCK_CAPTION },
    { kind: "clip", from: 24.7, to: 30 },
  ]);
});

test("the phone's own fingerprint blackout is held as recorded when short, and never past 2.5 s", () => {
  const short = entry({ holds: [{ start: 40.8, end: 41.8, caption: FINGERPRINT_CAPTION }] });
  const [, hold] = timeline(short, 30, 50);
  assert.equal(hold?.kind, "hold");
  assert.ok(hold?.kind === "hold" && Math.abs(hold.seconds - 1) < 1e-9 && hold.caption === FINGERPRINT_CAPTION);
  const long = entry({ holds: [{ start: 10, end: 16, caption: FINGERPRINT_CAPTION }] });
  assert.deepEqual(timeline(long, 0, 20)[1], { kind: "hold", seconds: 2.5, caption: FINGERPRINT_CAPTION });
});

test("overlapping cuts become one hold, and a cut at the edge of the stretch leaves no empty clip piece", () => {
  const e = entry({
    cuts: [
      { start: 5, end: 8, category: "PIN or password entry", caption: SCREEN_LOCK_CAPTION },
      { start: 7, end: 9, category: "account chooser", caption: SCREEN_LOCK_CAPTION },
    ],
  });
  assert.deepEqual(timeline(e, 5, 12), [
    { kind: "hold", seconds: 2.5, caption: SCREEN_LOCK_CAPTION },
    { kind: "clip", from: 9, to: 12 },
  ]);
});

test("regions apply for their whole time range, padding included", () => {
  const p = padRegion(11, 11.5, { x: 0.2, y: 0.85, w: 0.6, h: 0.05 });
  assert.equal(p.start, 10.5);
  assert.equal(p.end, 12);
  assert.ok(p.rect.x < 0.2 && p.rect.y < 0.85 && p.rect.x + p.rect.w > 0.8 && p.rect.y + p.rect.h > 0.9);
  const e = entry({ regions: [{ ...p, category: "contact names" }] });
  assert.equal(regionsAt(e, 10.5).length, 1);
  assert.equal(regionsAt(e, 12).length, 1);
  assert.equal(regionsAt(e, 12.1).length, 0);
});

test("a malformed map refuses to load rather than render unredacted", () => {
  const good = JSON.stringify(map(entry()));
  assert.doesNotThrow(() => parseRedactions(good));
  assert.throws(() => parseRedactions("{"), RedactionError);
  assert.throws(() => parseRedactions(JSON.stringify({ version: 2, clips: {} })), RedactionError);
  const outside = entry({ regions: [{ start: 1, end: 2, rect: { x: 0.5, y: 0.5, w: 0.6, h: 0.1 }, category: "email address" }] });
  assert.throws(() => parseRedactions(JSON.stringify(map(outside))), /inside the frame/);
  const backwards = entry({ cuts: [{ start: 5, end: 4, category: "PIN or password entry", caption: SCREEN_LOCK_CAPTION }] });
  assert.throws(() => parseRedactions(JSON.stringify(map(backwards))), /end after start/);
  const noCrop = { ...entry(), statusBar: 0 };
  assert.throws(() => parseRedactions(JSON.stringify(map(noCrop))), /statusBar/);
  const unknown = entry({ regions: [{ start: 1, end: 2, rect: { x: 0, y: 0, w: 1, h: 1 }, category: "something else" as never }] });
  assert.throws(() => parseRedactions(JSON.stringify(map(unknown))), /unknown category/);
});
