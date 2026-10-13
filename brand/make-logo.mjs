// Builds the NivPay logo set as SVG into <repo>/brand/. The wordmark is Nunito Black converted to outlines.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import opentype from "opentype.js";

const REPO = "C:/Users/Eddy/dev/nivpay";
const OUT = join(REPO, "brand");
const font = opentype.loadSync(join(REPO, "video/node_modules/@fontsource/nunito/files/nunito-latin-900-normal.woff"));

const C = {
  ink: "#3A2317", cream: "#FAF1E4", night: "#1B0F0A", potClay: "#E7C29C", lid: "#C8744A",
  clay: "#A5451F", teal: "#245C5A", saffron: "#D99A2B", gold: "#F2B33D",
};
const POT = "M72 38 C72 50 60 54 50 63 C28 82 23 118 35 146 C47 173 76 186 100 186 C124 186 153 173 165 146 C177 118 172 82 150 63 C140 54 128 50 128 38 Z";

/** The mark in a 200x200 box: the family's pot, the lid that is a lock. */
function mark({ id = "m", outline = C.ink, mono = null } = {}) {
  const f = (c) => mono ?? c;
  const body = mono ? "none" : C.potClay;
  return `
  <defs><clipPath id="${id}-pot"><path d="${POT}"/></clipPath>
    <mask id="${id}-key"><rect width="200" height="200" fill="#fff"/><circle cx="100" cy="135" r="8.5" fill="#000"/><path d="M95 139 L105 139 L108.5 160 L91.5 160 Z" fill="#000"/></mask></defs>
  <g>
    <!-- shackle: the lid's handle is a padlock -->
    <path d="M82 33 V21 a18 18 0 0 1 36 0 V33" fill="none" stroke="${f(outline)}" stroke-width="9" stroke-linecap="round"/>
    <path d="${POT}" fill="${body}"/>
    <g clip-path="url(#${id}-pot)">
      ${mono ? `<path mask="url(#${id}-key)" d="M0 103 Q12.5 96 25 103 T50 103 T75 103 T100 103 T125 103 T150 103 T175 103 T200 103 V200 H0 Z" fill="${mono}"/>` : `
      <rect x="0" y="150" width="200" height="40" fill="${C.clay}"/>
      <rect x="0" y="122" width="200" height="29" fill="${C.teal}"/>
      <path d="M0 103 Q12.5 96 25 103 T50 103 T75 103 T100 103 T125 103 T150 103 T175 103 T200 103 V123 H0 Z" fill="${C.saffron}"/>
      <ellipse cx="60" cy="96" rx="8" ry="22" fill="#fff" opacity="0.28"/>`}
    </g>
    <path d="${POT}" fill="none" stroke="${f(outline)}" stroke-width="7" stroke-linejoin="round"/>
    <rect x="58" y="28" width="84" height="16" rx="8" fill="${mono ? f(outline) : C.lid}" stroke="${f(outline)}" stroke-width="7"/>
    <!-- keyhole -->
    <g fill="${C.cream}" opacity="${mono ? 0 : 1}">
      <circle cx="100" cy="135" r="8.5"/>
      <path d="M95 139 L105 139 L108.5 160 L91.5 160 Z"/>
    </g>
  </g>`;
}

/** The wordmark as outlines: Niv in one colour, Pay in another. Returns paths and the box. */
function wordmark(size, niv, pay, x = 0, baseline = 0) {
  const track = -0.01 * size;
  let cx = x;
  const parts = [];
  for (const [text, color] of [["Niv", niv], ["Pay", pay]]) {
    for (const ch of text) {
      const g = font.charToGlyph(ch);
      parts.push(`<path d="${g.getPath(cx, baseline, size).toPathData(2)}" fill="${color}"/>`);
      cx += (g.advanceWidth / font.unitsPerEm) * size + track;
    }
  }
  // Kerning is small for these pairs; measure the true box from the outlines.
  const bb = font.getPath("NivPay", x, baseline, size).getBoundingBox();
  return { svg: parts.join(""), width: cx - x - track, box: bb };
}

const svg = (w, h, inner, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ""}${inner}</svg>\n`;

mkdirSync(OUT, { recursive: true });
const files = {};

// The mark alone, and in one colour.
files["nivpay-mark.svg"] = svg(200, 200, mark());
files["nivpay-mark-mono-ink.svg"] = svg(200, 200, mark({ id: "mi", mono: C.ink }));
files["nivpay-mark-mono-white.svg"] = svg(200, 200, mark({ id: "mw", mono: "#FFFFFF" }));

// App tiles.
const tile = (bg, id) => `<rect width="512" height="512" rx="116" fill="${bg}"/><g transform="translate(76 70) scale(1.8)">${mark({ id })}</g>`;
files["nivpay-icon-cream.svg"] = svg(512, 512, tile(C.cream, "ic"));
files["nivpay-icon-night.svg"] = svg(512, 512, `<rect width="512" height="512" rx="116" fill="${C.night}"/><circle cx="256" cy="270" r="210" fill="${C.gold}" opacity="0.12"/><g transform="translate(76 70) scale(1.8)">${mark({ id: "in", outline: C.cream })}</g>`);
files["nivpay-icon-clay.svg"] = svg(512, 512, `<rect width="512" height="512" rx="116" fill="${C.clay}"/><g transform="translate(76 70) scale(1.8)">${mark({ id: "icl" })}</g>`);

// Lockups.
function horizontal(niv, pay, bg, id, outline = C.ink) {
  const H = 240, size = 150, gap = 30;
  const w = wordmark(size, niv, pay, H + gap, 172);
  const W = Math.ceil(H + gap + w.width + 12);
  return svg(W, H, `<g transform="scale(1.2)">${mark({ id, outline })}</g>${w.svg}`, bg);
}
function stacked(niv, pay, bg, id, outline = C.ink) {
  const size = 150;
  const probe = wordmark(size, niv, pay, 0, 0);
  const W = Math.ceil(Math.max(probe.width, 280) + 40);
  const w = wordmark(size, niv, pay, (W - probe.width) / 2, 410);
  return svg(W, 450, `<g transform="translate(${(W - 280) / 2} 0) scale(1.4)">${mark({ id, outline })}</g>${w.svg}`, bg);
}
files["nivpay-logo-horizontal.svg"] = horizontal(C.ink, C.clay, null, "h1");
files["nivpay-logo-horizontal-on-dark.svg"] = horizontal("#FFFFFF", C.gold, null, "h2", C.cream);
files["nivpay-logo-stacked.svg"] = stacked(C.ink, C.clay, null, "s1");
files["nivpay-logo-stacked-on-dark.svg"] = stacked("#FFFFFF", C.gold, null, "s2", C.cream);
files["nivpay-wordmark.svg"] = (() => { const w = wordmark(150, C.ink, C.clay, 6, 140); return svg(Math.ceil(w.width + 12), 200, w.svg); })();

for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), body);
console.log(Object.keys(files).join("\n"));

// The app's icons (app/public/icons): the same tiles, square-cornered where the system masks them.
const APP = join(REPO, "app/public/icons");
writeFileSync(join(APP, "icon.svg"), svg(200, 200, `<rect width="200" height="200" rx="44" fill="${C.cream}"/><g transform="translate(22 18) scale(0.78)">${mark({ id: "fav" })}</g>`).replace(' width="200" height="200">', ">"));
// Maskable: full bleed, the mark inside the central 80% safe circle.
writeFileSync(join(APP, "icon-maskable.svg"), svg(200, 200, `<rect width="200" height="200" fill="${C.cream}"/><g transform="translate(43 40) scale(0.57)">${mark({ id: "mask" })}</g>`).replace(' width="200" height="200">', ">"));
// Monad's upload: a full-bleed square, 1000 px (500 to 2000 allowed).
writeFileSync(join(OUT, "nivpay-square-cream.svg"), svg(1000, 1000, `<rect width="1000" height="1000" fill="${C.cream}"/><g transform="translate(160 140) scale(3.4)">${mark({ id: "sq" })}</g>`));
