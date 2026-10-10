import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAID_MOTION } from "./payout.ts";
import { createSchedule, LID_DROP_MS, paidSchedule, prefersReducedMotion } from "./reduced.ts";

test("reads the phone's reduced motion setting, and is off where there is no way to ask", () => {
  assert.equal(prefersReducedMotion((q) => ({ matches: q === "(prefers-reduced-motion: reduce)" })), true);
  assert.equal(prefersReducedMotion(() => ({ matches: false })), false);
  assert.equal(prefersReducedMotion(undefined), false);
});

test("a payment's motion, reduced or not, lands the numbers before or with the payee's check, never before it starts", () => {
  for (const reduced of [false, true]) {
    const s = paidSchedule(reduced);
    const at = (k: string) => s.find((x) => x.kind === k)!.at;
    for (const k of ["stream", "check", "done"]) assert.ok(s.some((x) => x.kind === k), `${k} when reduced=${reduced}`);
    for (const x of s) assert.ok(x.at >= 0);
    assert.ok(at("stream") <= at("check"));
    assert.ok(at("check") <= at("done"));
  }
  assert.deepEqual(paidSchedule(true).map((x) => x.at), [0, 0, 0], "reduced: all at once, no tilt and no stream drawn");
  assert.ok(!paidSchedule(true).some((x) => x.kind === "tilt" || x.kind === "upright"));
  assert.equal(paidSchedule(false).at(-1)!.at, PAID_MOTION.done);
});

test("a made pot shows as made at once with reduced motion, and after the lid and the invites without", () => {
  assert.deepEqual(createSchedule(true, 3), [{ at: 0, kind: "landed" }]);
  const full = createSchedule(false, 3);
  assert.deepEqual(full.map((x) => x.kind), ["locked", "flying", "landed"]);
  assert.equal(full[1]!.at, LID_DROP_MS);
  assert.equal(full[2]!.at, LID_DROP_MS + 900 + 280);
  assert.equal(createSchedule(false, 0)[2]!.at, LID_DROP_MS + 900);
});

const escaped = (text: string) => text.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
const css = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const reducedBlocks = (text: string) => {
  const out: string[] = [];
  for (const m of text.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{/g)) {
    let depth = 0;
    for (let i = m.index! + m[0].length - 1; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}" && --depth === 0) {
        out.push(text.slice(m.index!, i));
        break;
      }
    }
  }
  return out.join("\n");
};

test("with reduced motion nothing loops or flies, and only opacity cross-fades", () => {
  const block = reducedBlocks(css("styles.css"));
  assert.match(block, /\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation: none !important;/);
  assert.match(block, /transition-property: opacity !important;/);
  assert.match(block, /transition-duration: 150ms !important;/);
});

test("every loop has a still mark with reduced motion, so a waiting state never looks done", () => {
  const pot = css("pot.css");
  const looping = [...pot.matchAll(/([^{}]+)\{[^{}]*animation:[^;]*infinite[^;]*;[^{}]*\}/g)].map((m) => m[1]!.trim());
  assert.ok(looping.length >= 5, looping.join(" | "));
  // These stand still as they are: a dotted route, and a badge that says Live.
  const stillAlready = new Set([".route.march", ".map-badge.live .dot .ping"]);
  const block = reducedBlocks(pot);
  for (const sel of looping) {
    if (stillAlready.has(sel)) continue;
    assert.match(block, new RegExp(escaped(sel) + String.raw`\s*\{[^}]*opacity`), `${sel} has no still mark`);
  }
  // The dotted route is drawn without its march.
  assert.match(pot, /\.route\.dots\s*\{[^}]*stroke-dasharray/);
});
