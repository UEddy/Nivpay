import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * docs/MOTION.md, "Smooth on cheap Android phones": only transform, opacity
 * and stroke-dashoffset ever animate. Checked on every stylesheet and on the
 * transitions the screens set inline.
 */
const ALLOWED = new Set(["transform", "opacity", "stroke-dashoffset"]);
const SHEETS = ["styles.css", "pot.css"].map((f) => [f, readFileSync(new URL(`./${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")] as const);

/** The body of each block that starts at `open`, by matching braces. */
function blockAt(css: string, open: number): string {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

/** Every plain rule: its selector and its declarations, nested ones included. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) out.push({ selector: m[1]!.trim(), body: m[2]! });
  return out;
}

function declarations(body: string): [string, string][] {
  return body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      return [d.slice(0, i).trim(), d.slice(i + 1).replace(/!important/, "").trim()] as [string, string];
    });
}

/** "transform 380ms ease, opacity 200ms" to the properties it transitions. */
function transitioned(value: string): string[] {
  return value.split(/,(?![^(]*\))/).map((part) => part.trim().split(/\s+/)[0]!);
}

const keyframes = SHEETS.flatMap(([file, css]) =>
  [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map((m) => ({ file, name: m[1]!, body: blockAt(css, m.index! + m[0].length - 1) })),
);
const allRules = SHEETS.flatMap(([file, css]) => rules(css).map((r) => ({ file, ...r })));

test("keyframes animate only transform, opacity and stroke-dashoffset", () => {
  assert.ok(keyframes.length > 5);
  const wrong: string[] = [];
  for (const k of keyframes) {
    for (const frame of rules(k.body)) {
      for (const [prop] of declarations(frame.body)) if (!ALLOWED.has(prop)) wrong.push(`${k.file} @keyframes ${k.name} animates ${prop}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("every transition names only transform, opacity or stroke-dashoffset, never all", () => {
  const wrong: string[] = [];
  for (const r of allRules) {
    const decls = declarations(r.body);
    const props = decls.filter(([p]) => p === "transition" || p === "transition-property");
    for (const [p, v] of props) {
      for (const name of p === "transition" ? transitioned(v) : v.split(",").map((s) => s.trim())) {
        if (!ALLOWED.has(name) && name !== "none") wrong.push(`${r.file} "${r.selector}" transitions ${name}`);
      }
    }
    // A duration with no property transitions "all", which includes layout and paint.
    if (decls.some(([p]) => p === "transition-duration") && props.length === 0) {
      wrong.push(`${r.file} "${r.selector}" sets a transition duration with no property, so everything would transition`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("every animation used is one of the keyframes defined here", () => {
  const names = new Set(keyframes.map((k) => k.name));
  for (const r of allRules) {
    for (const [p, v] of declarations(r.body)) {
      if (p !== "animation" && p !== "animation-name") continue;
      const name = v.split(/\s+/)[0]!;
      if (name === "none") continue;
      assert.ok(names.has(name), `${r.file} "${r.selector}" uses ${name}`);
    }
  }
});

test("transitions set inline by the screens move only stroke-dashoffset", () => {
  const map = readFileSync(new URL("./screens/PotMap.tsx", import.meta.url), "utf8");
  // Each is `transitionProperty: <condition> ? "<a>" : "<b>"`.
  const inline = [...map.matchAll(/transitionProperty:[^?\n]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/g)];
  assert.ok(inline.length > 0);
  assert.equal(inline.length, [...map.matchAll(/transitionProperty:/g)].length, "every inline transition is read");
  for (const m of inline) for (const name of [m[1]!, m[2]!]) assert.ok(name === "none" || ALLOWED.has(name), m[0]);
});
