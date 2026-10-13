import { test } from "node:test";
import assert from "node:assert/strict";
import { AT_REST, MOTION, poseAt, zoomWindow } from "./pose.ts";

test("a still segment is face-on and motionless on every frame", () => {
  for (let f = 0; f < 300; f += 7) assert.deepEqual(poseAt(f, 300, 30, true), AT_REST);
});

test("a moving segment starts and ends face-on, and never tilts past its limits", () => {
  const near = (p: { rotX: number; rotY: number; lift: number }) => Math.abs(p.rotX) < 1e-9 && Math.abs(p.rotY) < 1e-9 && Math.abs(p.lift) < 1e-9;
  assert.ok(near(poseAt(0, 300, 30, false)));
  assert.ok(near(poseAt(300, 300, 30, false)));
  let moved = 0;
  for (let f = 0; f <= 300; f++) {
    const p = poseAt(f, 300, 30, false);
    assert.ok(Math.abs(p.rotY) <= MOTION.rotY + 1e-9 && Math.abs(p.rotX) <= MOTION.rotX + 1e-9 && Math.abs(p.lift) <= MOTION.lift + 1e-9);
    moved = Math.max(moved, Math.abs(p.rotY));
  }
  assert.ok(moved > MOTION.rotY * 0.5, "it does move");
});

test("motion is slow: never more than 0.3 degrees a frame (9 degrees a second)", () => {
  const limit = (0.3 * Math.PI) / 180;
  for (const n of [60, 120, 300, 600]) {
    for (let f = 1; f <= n; f++) {
      const a = poseAt(f - 1, n, 30, false);
      const b = poseAt(f, n, 30, false);
      assert.ok(Math.abs(b.rotY - a.rotY) < limit && Math.abs(b.rotX - a.rotX) < limit, `frame ${f} of ${n}`);
    }
  }
});

test("a push-in shows the same part of the screen as the flat frame's CSS scale", () => {
  assert.deepEqual(zoomWindow(1, 0.3, 0.7), { repeat: 1, offsetX: 0, offsetY: 0 });
  // Twice as close on the top left: the top left quarter, rows from halfway up to the top.
  assert.deepEqual(zoomWindow(2, 0, 0), { repeat: 0.5, offsetX: 0, offsetY: 0.5 });
  assert.deepEqual(zoomWindow(2, 1, 1), { repeat: 0.5, offsetX: 0.5, offsetY: 0 });
  // A point at the origin stays where it was on screen, as CSS transform-origin does.
  for (const [s, x, y] of [[1.5, 0.5, 0.42], [3, 0.2, 0.9]] as const) {
    const w = zoomWindow(s, x, y);
    assert.ok(Math.abs(w.offsetX + x * w.repeat - x) < 1e-12);
    assert.ok(Math.abs(w.offsetY + (1 - y) * w.repeat - (1 - y)) < 1e-12);
  }
});
