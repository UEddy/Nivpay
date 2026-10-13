/**
 * Every sound in the films, synthesized here from nothing: an Afrobeats
 * style groove at 120 bpm for each film and the effects (coins, the lid, the
 * lock, pops, whooshes). No sample, no loop and no music from anyone else, so
 * there is nothing to clear (CREDITS.md).
 *
 * node scripts/make-sound.ts   writes films-public/sound/*.wav (git-ignored), the films' only public files
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FILM_SOUND, type Section } from "../src/films/sound.ts";

const SR = 44100;
const OUT = join(import.meta.dirname, "..", "films-public", "sound");

// Deterministic noise, so a re-run writes the same files.
let seed = 1234567;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);

function wav(path: string, l: Float32Array, r: Float32Array = l) {
  let peak = 0;
  for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
  const gain = peak > 0 ? 0.7 / peak : 1;
  const buf = Buffer.alloc(44 + l.length * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + l.length * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(l.length * 4, 40);
  for (let i = 0; i < l.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i] * gain)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i] * gain)) * 32767), 46 + i * 4);
  }
  writeFileSync(path, buf);
}

/** Adds a mono voice into a stereo pair at a pan (-1 left, 1 right). */
function add(l: Float32Array, r: Float32Array, at: number, v: Float32Array, gain: number, pan = 0) {
  const i0 = Math.round(at * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < v.length && i0 + i < l.length; i++) {
    if (i0 + i < 0) continue;
    l[i0 + i] += v[i] * gl;
    r[i0 + i] += v[i] * gr;
  }
}

function voice(dur: number, f: (t: number, i: number) => number) {
  const v = new Float32Array(Math.round(dur * SR));
  for (let i = 0; i < v.length; i++) v[i] = f(i / SR, i);
  return v;
}

/** A sine whose frequency follows fr(t), integrated so it never clicks. */
function sweep(dur: number, fr: (t: number) => number, env: (t: number) => number, shape = (x: number) => x) {
  let ph = 0;
  return voice(dur, (t) => {
    ph += (2 * Math.PI * fr(t)) / SR;
    return shape(Math.sin(ph)) * env(t);
  });
}

function highpass(v: Float32Array, cut: number) {
  const a = 1 / (1 + 2 * Math.PI * cut / SR);
  let py = 0, px = 0;
  for (let i = 0; i < v.length; i++) {
    const y = a * (py + v[i] - px);
    px = v[i];
    v[i] = py = y;
  }
  return v;
}

function lowpass(v: Float32Array, cut: (t: number) => number) {
  let y = 0;
  for (let i = 0; i < v.length; i++) {
    const a = 1 - Math.exp((-2 * Math.PI * cut(i / SR)) / SR);
    y += a * (v[i] - y);
    v[i] = y;
  }
  return v;
}

const bandpass = (v: Float32Array, lo: number, hi: number) => lowpass(highpass(v, lo), () => hi);
const noise = (dur: number, env: (t: number) => number) => voice(dur, (t) => rnd() * env(t));

// ---------- drums and instruments ----------

const kick = () => sweep(0.45, (t) => 46 + 110 * Math.exp(-t * 32), (t) => Math.exp(-t * 7) * Math.min(1, t * 800), (x) => Math.tanh(x * 1.6));
const shaker = (accent: number) => highpass(noise(0.07, (t) => Math.exp(-t * 70) * accent), 6000);
const rim = () => {
  const n = bandpass(noise(0.06, (t) => Math.exp(-t * 90)), 1500, 4000);
  const s = sweep(0.06, () => 1750, (t) => Math.exp(-t * 120) * 0.6);
  return n.map((x, i) => x + s[i]);
};
const clap = () => {
  const v = noise(0.22, (t) => {
    const hits = [0, 0.011, 0.023].reduce((a, h) => a + (t >= h ? Math.exp(-(t - h) * 140) : 0), 0);
    return hits * 0.6 + (t > 0.023 ? Math.exp(-(t - 0.023) * 22) * 0.5 : 0);
  });
  return bandpass(v, 900, 3500);
};
/** The log drum: a sine that drops onto its note, softly clipped. */
const logDrum = (f: number, len = 0.42) =>
  sweep(len, (t) => f * (1 + 0.55 * Math.exp(-t * 45)), (t) => Math.exp(-t * 5.5) * Math.min(1, t * 400), (x) => Math.tanh(x * 2.2) * 0.9);
/** A marimba-ish pluck. */
const pluck = (f: number) => {
  const a = sweep(0.6, () => f, (t) => Math.exp(-t * 7) * Math.min(1, t * 600));
  const b = sweep(0.6, () => f * 4, (t) => Math.exp(-t * 22) * 0.25);
  return a.map((x, i) => x + b[i]);
};
const pad = (fs: number[], dur: number) =>
  voice(dur, (t) => {
    const env = Math.min(1, t / 0.6) * Math.min(1, (dur - t) / 0.6);
    return fs.reduce((a, f) => a + Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(2 * Math.PI * f * 1.003 * t) * 0.4, 0) * env * 0.12;
  });

// D minor: Dm7, Bbmaj7, Fmaj7, C7. One chord a bar.
const CHORDS = [
  { root: 38, notes: [62, 65, 69, 72] },
  { root: 34, notes: [58, 62, 65, 69] },
  { root: 41, notes: [60, 64, 65, 69] },
  { root: 36, notes: [60, 64, 67, 70] },
];

const BEAT = 0.5;
const SIX = BEAT / 4;
const BAR = BEAT * 4;

function music(len: number, sections: Section[]) {
  const n = Math.round(len * SR);
  const l = new Float32Array(n), r = new Float32Array(n);
  const K = kick(), R = rim(), C = clap();
  const levelAt = (t: number) => sections.find((s) => t >= s.from && t < s.to)?.kind ?? "full";
  for (let bar = 0; bar * BAR < len; bar++) {
    const t0 = bar * BAR;
    const kind = levelAt(t0 + 0.01);
    const ch = CHORDS[bar % 4];
    if (kind === "intro" || kind === "break") add(l, r, t0, pad(ch.notes.map(midi), BAR + 0.2), kind === "break" ? 0.9 : 0.7);
    if (kind === "tense") {
      add(l, r, t0, pad([midi(38), midi(45)], BAR + 0.2), 0.8);
      for (let b = 0; b < 4; b++) add(l, r, t0 + b * BEAT, kick(), 0.35);
      for (let s = 0; s < 16; s++) add(l, r, t0 + s * SIX, highpass(noise(0.02, (t) => Math.exp(-t * 200)), 4000), s % 4 === 0 ? 0.18 : 0.08, 0.3);
      continue;
    }
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * SIX;
      // Shakers on every sixteenth, swung a touch, in every section but the outro tail.
      const swing = s % 2 ? 0.012 : 0;
      if (kind !== "outro" || bar * BAR < len - BAR) add(l, r, t + swing, shaker([0.9, 0.35, 0.6, 0.4][s % 4]), kind === "intro" ? 0.12 : 0.2, 0.35);
      if (kind === "intro" || kind === "break") continue;
      if ([0, 7, 8].includes(s)) add(l, r, t, K, 0.95);
      if ([3, 6, 11, 14].includes(s)) add(l, r, t, R, 0.28, -0.3);
      if ([4, 12].includes(s)) add(l, r, t, C, 0.32, 0.1);
      if ([0, 3, 7, 10, 14].includes(s)) add(l, r, t, logDrum(midi(ch.root + (s === 10 ? 7 : s === 14 ? 12 : 0))), 0.55);
      if ([2, 6, 10, 13].includes(s)) {
        const note = ch.notes[(s + bar) % ch.notes.length];
        add(l, r, t + swing, pluck(midi(note)), 0.16, s % 4 === 2 ? -0.4 : 0.4);
      }
    }
  }
  // Fades: in over half a second, out over the last bar.
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const g = Math.min(1, t / 0.5) * Math.min(1, (len - t) / BAR);
    l[i] *= g;
    r[i] *= g;
  }
  return [l, r] as const;
}

// ---------- effects ----------

const FX: Record<string, () => Float32Array> = {
  pop: () => sweep(0.16, (t) => 520 + 900 * Math.min(1, t / 0.05), (t) => Math.exp(-t * 28) * Math.min(1, t * 500)),
  whoosh: () => lowpass(noise(0.5, (t) => Math.sin((Math.PI * t) / 0.5) ** 2), (t) => 300 + 4500 * Math.sin((Math.PI * t) / 0.5) ** 2),
  rise: () => lowpass(noise(0.7, (t) => (t / 0.7) ** 2), (t) => 400 + 6000 * (t / 0.7) ** 2),
  coin: () => {
    const hit = (d: number) => voice(0.6, (t) => (t < d ? 0 : [2637, 3951, 5274, 6645].reduce((a, f, k) => a + Math.sin(2 * Math.PI * f * (t - d)) * Math.exp(-(t - d) * (9 + k * 5)) / (k + 1), 0)));
    const a = hit(0), b = hit(0.075);
    return a.map((x, i) => x + b[i] * 0.55);
  },
  thunk: () => {
    const s = sweep(0.4, (t) => 70 + 80 * Math.exp(-t * 25), (t) => Math.exp(-t * 11), (x) => Math.tanh(x * 2));
    const n = lowpass(noise(0.4, (t) => Math.exp(-t * 30)), () => 900);
    return s.map((x, i) => x + n[i] * 0.6);
  },
  lock: () => {
    const c = (d: number) => highpass(noise(0.2, (t) => (t < d ? 0 : Math.exp(-(t - d) * 300))), 2500);
    const a = c(0), b = c(0.055);
    const s = sweep(0.2, () => 2200, (t) => (t < 0.055 ? 0 : Math.exp(-(t - 0.055) * 40) * 0.4));
    return a.map((x, i) => x + b[i] + s[i]);
  },
  tick: () => highpass(noise(0.03, (t) => Math.exp(-t * 300)), 3000),
  chime: () => voice(1.2, (t) => [74, 78, 81, 86].reduce((a, m, k) => {
    const d = k * 0.07;
    return t < d ? a : a + (Math.sin(2 * Math.PI * midi(m) * (t - d)) + 0.3 * Math.sin(4 * Math.PI * midi(m) * (t - d))) * Math.exp(-(t - d) * 4);
  }, 0)),
  buzz: () => voice(0.45, (t) => Math.tanh(Math.sin(2 * Math.PI * 140 * t) * 4) * (t < 0.17 || (t > 0.22 && t < 0.4) ? 1 : 0) * 0.5),
  stamp: () => {
    const s = sweep(0.35, (t) => 55 + 60 * Math.exp(-t * 30), (t) => Math.exp(-t * 14), (x) => Math.tanh(x * 3));
    const n = lowpass(noise(0.35, (t) => Math.exp(-t * 45)), () => 2500);
    return s.map((x, i) => x + n[i] * 0.5);
  },
  scan: () => sweep(0.6, (t) => 380 + 700 * (t / 0.6), (t) => Math.sin((Math.PI * t) / 0.6) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 22 * t))),
  ding: () => voice(1.0, (t) => (Math.sin(2 * Math.PI * 1568 * t) + 0.4 * Math.sin(2 * Math.PI * 3136 * t) + 0.2 * Math.sin(2 * Math.PI * 4704 * t)) * Math.exp(-t * 4.5)),
  pour: () => lowpass(noise(1.1, (t) => Math.sin((Math.PI * t) / 1.1) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 13 * t))), () => 1800),
};

mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(FX)) {
  wav(join(OUT, `${name}.wav`), make());
}
for (const [id, s] of Object.entries(FILM_SOUND)) {
  const [l, r] = music(s.length, s.sections);
  wav(join(OUT, `music-${id}.wav`), l, r);
}
console.log(`wrote ${Object.keys(FX).length} effects and ${Object.keys(FILM_SOUND).length} music beds to films-public/sound/`);
