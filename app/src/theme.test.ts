import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Light and dark follow the phone (prefers-color-scheme), with no toggle and
 * nothing stored. Every colour is a token in one of two lists in styles.css:
 * the light :root, and the dark :root inside the media query. Nothing else in
 * the app names a colour, so a new screen can't come out unreadable in one
 * mode. Text keeps a contrast of at least 4.5 to 1 in both.
 */
const SRC = import.meta.dirname;
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const STYLES = read("styles.css");
const POT = read("pot.css");

const DARK_OPEN = "@media (prefers-color-scheme: dark) {";

/** The declarations of the first `:root {` block at or after `from`. */
function rootBlock(css: string, from: number): { start: number; end: number; tokens: Record<string, string> } {
  const start = css.indexOf(":root {", from);
  assert.ok(start >= 0, "a :root block");
  const end = css.indexOf("}", start);
  const tokens: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) tokens[m[1]!] = m[2]!.trim();
  return { start, end, tokens };
}

const light = rootBlock(STYLES, 0);
const darkAt = STYLES.indexOf(DARK_OPEN);
const dark = rootBlock(STYLES, darkAt);
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|:\s*(white|black)\s*;/;
const isColour = (v: string) => COLOUR.test(`: ${v};`);

test("dark mode follows the phone through one media query, with nothing stored and no toggle", () => {
  assert.ok(darkAt > light.end, "the dark list comes after the light one");
  assert.equal(STYLES.split(DARK_OPEN).length - 1, 1, "one dark list");
  assert.equal(POT.includes("prefers-color-scheme"), false, "pot.css uses the tokens, it has no colours of its own");
  assert.match(light.tokens["color-scheme"] ?? STYLES.slice(light.start, light.end), /color-scheme:\s*light dark/);
  const app = read("App.tsx") + read("screens", "ui.tsx");
  assert.doesNotMatch(app, /prefers-color-scheme|colorScheme|data-theme|theme.*localStorage/i, "no toggle, nothing stored");
  const html = read("..", "index.html");
  assert.match(html, /<meta name="color-scheme" content="light dark" \/>/);
  assert.match(html, /<meta name="theme-color" content="#[0-9A-Fa-f]{6}" media="\(prefers-color-scheme: light\)" \/>/);
  assert.match(html, /<meta name="theme-color" content="#[0-9A-Fa-f]{6}" media="\(prefers-color-scheme: dark\)" \/>/);
});

test("every colour token has a dark value, and the browser chrome matches each mode's background", () => {
  const colours = Object.keys(light.tokens).filter((k) => isColour(light.tokens[k]!));
  assert.ok(colours.length > 20);
  for (const k of colours) assert.ok(dark.tokens[k], `${k} has a dark value`);
  for (const k of Object.keys(dark.tokens)) assert.ok(light.tokens[k], `${k} is a light token too`);
  const html = read("..", "index.html");
  const meta = (mode: string) => new RegExp(`content="(#[0-9A-Fa-f]{6})" media="\\(prefers-color-scheme: ${mode}\\)"`).exec(html)?.[1]?.toLowerCase();
  assert.equal(meta("light"), light.tokens["--bg"]!.toLowerCase());
  assert.equal(meta("dark"), dark.tokens["--bg"]!.toLowerCase());
});

test("no colour appears outside the two token lists, in any stylesheet or screen", () => {
  const strip = (css: string, blocks: { start: number; end: number }[]) =>
    blocks.reduceRight((s, b) => s.slice(0, b.start) + s.slice(b.end), css).replace(/\/\*[\s\S]*?\*\//g, "");
  const offenders: string[] = [];
  const scan = (name: string, text: string) =>
    text.split("\n").forEach((line, i) => {
      if (COLOUR.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  scan("styles.css", strip(STYLES, [light, dark]));
  scan("pot.css", POT.replace(/\/\*[\s\S]*?\*\//g, ""));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
    });
  for (const f of files(SRC)) {
    for (const [i, line] of readFileSync(f, "utf8").split("\n").entries()) {
      if (/["'`]#[0-9a-fA-F]{3,8}["'`]|\brgba?\(|\bhsla?\(/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// WCAG 2 relative luminance and contrast.
function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Text token on background token, as the stylesheets use them. */
const PAIRS: [string, string][] = [
  ...["--bg", "--card", "--chip", "--input-bg", "--map-paper", "--request-bubble"].map((bg) => ["--ink", bg] as [string, string]),
  ...["--bg", "--card", "--chip", "--input-bg"].map((bg) => ["--muted", bg] as [string, string]),
  ...["--bg", "--card", "--chip"].map((bg) => ["--primary-text", bg] as [string, string]),
  ...["--bg", "--card"].map((bg) => ["--danger", bg] as [string, string]),
  ["--on-primary", "--primary"],
  ["--on-primary", "--primary-pressed"],
  ["--person-2", "--card"],
  ["--person-2", "--bg"],
  ["--person-3-text", "--card"],
  ...["--person-1", "--person-2", "--person-3-text", "--person-4", "--person-5"].map((t) => [t, "--map-paper"] as [string, string]),
];

for (const [mode, tokens] of [
  ["light", light.tokens],
  ["dark", dark.tokens],
] as const) {
  test(`text keeps a contrast of at least 4.5 to 1 in ${mode} mode`, () => {
    const low: string[] = [];
    for (const [fg, bg] of PAIRS) {
      const c = contrast(tokens[fg]!, tokens[bg]!);
      if (c < 4.5) low.push(`${fg} on ${bg}: ${c.toFixed(2)}`);
    }
    assert.deepEqual(low, []);
  });
}

test("the contrast check itself", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");
});
