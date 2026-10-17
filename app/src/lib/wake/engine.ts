/**
 * "Hey NivPay", heard on the phone (README, "Hey NivPay"). The parts with no
 * browser in them: sound in, a score out every 80 ms.
 *
 * The design is openWakeWord's (Apache-2.0): a mel spectrogram, Google's
 * speech embedding (Apache-2.0) turning each 0.76 s of it into 96 numbers
 * every 80 ms, and a small classifier, trained for this app only, reading the
 * last 16 of those. Written out here in plain TypeScript, with no WebAssembly,
 * so the page's Content Security Policy stays as it is. The mel filters are
 * worked out here; the weights come from one file (public/wake/, made by
 * app/scripts/wake/export.py).
 *
 * The embedding is fully convolutional along time, and its three pools in
 * time add up to the 8 mel frames between embeddings, so each layer is worked
 * out once per new row and kept, not again for every window. The result is
 * the same as openWakeWord's window by window (engine.test.ts).
 */

export const SAMPLE_RATE = 16_000;
/** 10 ms between mel frames. */
export const HOP = 160;
const NFFT = 512;
const WIN = 400;
const BINS = NFFT / 2 + 1;
export const MEL_BANDS = 32;
export const EMBED = 96;

/** A tensor from the weights file. */
export type Tensor = { shape: number[]; data: Float32Array };

export type WakeModel = {
  /** The speech embedding, in order. */
  embedding: Layer[];
  /** Embeddings the classifier reads. */
  window: number;
  /** Dense layers, each [out][in] and [out], ReLU between them, a sigmoid at the end. */
  dense: { w: Tensor; b: Tensor }[];
  /** A score at or above this is the wake word… */
  threshold: number;
  /** …this many times in a row, 80 ms apart: a lone high score is not. */
  hold: number;
};

export type Layer = { kind: "conv"; w: Tensor; b: Tensor } | { kind: "act"; alpha: number; floor: number } | { kind: "pool"; time: number; freq: number };

const MAGIC = "NPWW";

/**
 * Reads the weights file: "NPWW", a little-endian u32 header length, a JSON
 * header naming each tensor's shape in order, then the tensors as
 * little-endian float32, the first starting at a multiple of 4.
 */
export function parseModel(buf: ArrayBuffer): WakeModel {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 8 || new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error("wake: not a wake word model");
  const view = new DataView(buf);
  const headerLen = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as {
    version: number;
    tensors: { name: string; shape: number[] }[];
    embedding: ({ conv: string } | { act: [number, number] } | { pool: [number, number] })[];
    window: number;
    dense: string[];
    threshold: number;
    hold?: number;
  };
  if (header.version !== 1) throw new Error(`wake: model version ${header.version}`);
  let at = Math.ceil((8 + headerLen) / 4) * 4;
  const tensors = new Map<string, Tensor>();
  for (const t of header.tensors) {
    const n = t.shape.reduce((a, b) => a * b, 1);
    if (at + n * 4 > buf.byteLength) throw new Error("wake: model cut short");
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = view.getFloat32(at + i * 4, true);
    tensors.set(t.name, { shape: t.shape, data });
    at += n * 4;
  }
  const get = (name: string): Tensor => {
    const t = tensors.get(name);
    if (!t) throw new Error(`wake: no ${name}`);
    return t;
  };
  const embedding: Layer[] = header.embedding.map((l) => {
    if ("conv" in l) return { kind: "conv", w: get(`${l.conv}.w`), b: get(`${l.conv}.b`) };
    if ("act" in l) return { kind: "act", alpha: l.act[0], floor: l.act[1] };
    return { kind: "pool", time: l.pool[0], freq: l.pool[1] };
  });
  return {
    embedding,
    window: header.window,
    dense: header.dense.map((d) => ({ w: get(`${d}.w`), b: get(`${d}.b`) })),
    threshold: header.threshold,
    hold: header.hold ?? 1,
  };
}

// ---- Mel spectrogram ------------------------------------------------------

/**
 * 32 triangular mel filters from 60 Hz to 3.8 kHz over the 257 bins of a 512
 * point spectrum at 16 kHz, Slaney's mel scale and area normalised: librosa's
 * filters.mel(sr=16000, n_fft=512, n_mels=32, fmin=60, fmax=3800), the ones
 * openWakeWord's melspectrogram model holds. [bin][band].
 */
export function melFilters(): Float64Array {
  const fSp = 200 / 3;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fSp;
  const logStep = Math.log(6.4) / 27;
  const toMel = (f: number) => (f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logStep : f / fSp);
  const toHz = (m: number) => (m >= minLogMel ? minLogHz * Math.exp(logStep * (m - minLogMel)) : fSp * m);
  const lo = toMel(60);
  const hi = toMel(3_800);
  const edges = Array.from({ length: MEL_BANDS + 2 }, (_, i) => toHz(lo + ((hi - lo) * i) / (MEL_BANDS + 1)));
  const w = new Float64Array(BINS * MEL_BANDS);
  for (let m = 0; m < MEL_BANDS; m++) {
    const [a, b, c] = [edges[m]!, edges[m + 1]!, edges[m + 2]!];
    const norm = 2 / (c - a);
    for (let k = 0; k < BINS; k++) {
      const f = (k * SAMPLE_RATE) / NFFT;
      const v = Math.max(0, Math.min((f - a) / (b - a), (c - f) / (c - b)));
      w[k * MEL_BANDS + m] = v * norm;
    }
  }
  return w;
}

/** A periodic Hann window of 400 samples, centred in 512, as openWakeWord's. */
const WINDOW = (() => {
  const w = new Float64Array(NFFT);
  for (let n = 0; n < WIN; n++) w[56 + n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / WIN);
  return w;
})();

const BITREV = (() => {
  const r = new Uint16Array(NFFT);
  const bits = Math.log2(NFFT);
  for (let i = 0; i < NFFT; i++) {
    let x = i;
    let y = 0;
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    r[i] = y;
  }
  return r;
})();
const COS = Float64Array.from({ length: NFFT / 2 }, (_, k) => Math.cos((2 * Math.PI * k) / NFFT));
const SIN = Float64Array.from({ length: NFFT / 2 }, (_, k) => -Math.sin((2 * Math.PI * k) / NFFT));

/** The power spectrum of one windowed frame of 512 samples, into `power` (257 bins). */
function powerSpectrum(frame: Float64Array, re: Float64Array, im: Float64Array, power: Float64Array): void {
  for (let i = 0; i < NFFT; i++) {
    re[BITREV[i]!] = frame[i]! * WINDOW[i]!;
    im[i] = 0;
  }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1;
    const step = NFFT / size;
    for (let start = 0; start < NFFT; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step]!;
        const s = SIN[k * step]!;
        const a = start + k;
        const b = a + half;
        const tr = re[b]! * c - im[b]! * s;
        const ti = re[b]! * s + im[b]! * c;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
  for (let k = 0; k < BINS; k++) power[k] = re[k]! * re[k]! + im[k]! * im[k]!;
}

/** Turns samples (16 kHz, in 16-bit units) into mel frames, 32 numbers every 10 ms. */
export class MelStream {
  private readonly melW = melFilters();
  private readonly buf = new Float64Array(NFFT);
  private len = 0;
  private readonly frame = new Float64Array(NFFT);
  private readonly re = new Float64Array(NFFT);
  private readonly im = new Float64Array(NFFT);
  private readonly power = new Float64Array(BINS);

  /** Each new frame, as soon as its 512 samples are in. */
  push(samples: ArrayLike<number>, onFrame: (mel: Float32Array) => void): void {
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.len++] = samples[i]!;
      if (this.len === NFFT) {
        this.frame.set(this.buf);
        onFrame(this.melFrame());
        // Keep the 352 samples the next frame shares with this one.
        this.buf.copyWithin(0, HOP, NFFT);
        this.len = NFFT - HOP;
      }
    }
  }

  private melFrame(): Float32Array {
    powerSpectrum(this.frame, this.re, this.im, this.power);
    const out = new Float32Array(MEL_BANDS);
    const w = this.melW;
    for (let m = 0; m < MEL_BANDS; m++) {
      let e = 0;
      for (let k = 0; k < BINS; k++) e += this.power[k]! * w[k * MEL_BANDS + m]!;
      // 10·log10, floored at 1e-10, then openWakeWord's x/10 + 2.
      out[m] = Math.log10(Math.max(e, 1e-10)) + 2;
    }
    return out;
  }
}

// ---- Speech embedding, streamed ------------------------------------------

/**
 * One layer of the embedding, fed a row (one step in time) at a time. A row
 * is [freq][channel] with a column of zeros either side, so a convolution
 * across frequency reads one unbroken run of numbers.
 */
type Stage = { push(row: Float32Array): Float32Array | null };

/**
 * A convolution valid in time (kt rows) and "same" across frequency (kf 1 or
 * 3), with the activation after it, if any, done as each value is written.
 */
function convStage(w: Tensor, b: Tensor, freq: number, act: { alpha: number; floor: number } | null): Stage {
  const [co, ci, kt, kf] = w.shape as [number, number, number, number];
  if (co % 4) throw new Error("wake: output channels not a multiple of 4");
  // Re-laid out as [out][dt][df][in]: for one output and one row in time, the
  // weights then line up with the row's numbers from column f - pad onwards.
  const wt = new Float32Array(co * kt * kf * ci);
  for (let o = 0; o < co; o++)
    for (let c = 0; c < ci; c++)
      for (let dt = 0; dt < kt; dt++)
        for (let df = 0; df < kf; df++) wt[((o * kt + dt) * kf + df) * ci + c] = w.data[((o * ci + c) * kt + dt) * kf + df]!;
  const bias = b.data;
  const run = kf * ci;
  // Column f's run starts at padded column f + 1 - pad.
  const shift = 1 - ((kf - 1) >> 1);
  const alpha = act ? act.alpha : 1;
  const floor = act ? act.floor : -Infinity;
  const rows: Float32Array[] = [];
  return {
    push(row) {
      rows.push(row);
      if (rows.length > kt) rows.shift();
      if (rows.length < kt) return null;
      const out = new Float32Array((freq + 2) * co);
      const act = (v: number) => {
        if (v < 0) v *= alpha;
        return v > floor ? v : floor;
      };
      // Four output channels at a time (every layer has a multiple of 4), so each input
      // number is read once for four of them.
      for (let o = 0; o < co; o += 4) {
        const w0 = o * kt * run;
        const w1 = w0 + kt * run;
        const w2 = w1 + kt * run;
        const w3 = w2 + kt * run;
        // And two frequencies at a time, so each weight is read once for both.
        for (let f = 0; f < freq; f += 2) {
          const two = f + 1 < freq;
          let a0 = bias[o]!;
          let a1 = bias[o + 1]!;
          let a2 = bias[o + 2]!;
          let a3 = bias[o + 3]!;
          let b0 = a0;
          let b1 = a1;
          let b2 = a2;
          let b3 = a3;
          const start = (f + shift) * ci;
          // The second frequency's run starts one column later. With only one frequency left,
          // it reads the first's again and its sums are dropped.
          const next = two ? ci : 0;
          for (let dt = 0; dt < kt; dt++) {
            const r = rows[dt]!;
            const d = dt * run;
            for (let j = 0; j < run; j++) {
              const x = r[start + j]!;
              const y = r[start + next + j]!;
              const v0 = wt[w0 + d + j]!;
              const v1 = wt[w1 + d + j]!;
              const v2 = wt[w2 + d + j]!;
              const v3 = wt[w3 + d + j]!;
              a0 += v0 * x;
              a1 += v1 * x;
              a2 += v2 * x;
              a3 += v3 * x;
              b0 += v0 * y;
              b1 += v1 * y;
              b2 += v2 * y;
              b3 += v3 * y;
            }
          }
          const at = (f + 1) * co + o;
          out[at] = act(a0);
          out[at + 1] = act(a1);
          out[at + 2] = act(a2);
          out[at + 3] = act(a3);
          if (two) {
            out[at + co] = act(b0);
            out[at + co + 1] = act(b1);
            out[at + co + 2] = act(b2);
            out[at + co + 3] = act(b3);
          }
        }
      }
      return out;
    },
  };
}

/** Max pooling, time × freq, pairing rows from the first one in. */
function poolStage(time: number, freq: number, freqIn: number, channels: number): { stage: Stage; freqOut: number } {
  const freqOut = Math.floor(freqIn / freq);
  let held: Float32Array[] = [];
  return {
    freqOut,
    stage: {
      push(row) {
        held.push(row);
        if (held.length < time) return null;
        const out = new Float32Array((freqOut + 2) * channels);
        for (let fo = 0; fo < freqOut; fo++)
          for (let c = 0; c < channels; c++) {
            let m = -Infinity;
            for (const r of held)
              for (let k = 0; k < freq; k++) {
                const v = r[(fo * freq + k + 1) * channels + c]!;
                if (v > m) m = v;
              }
            out[(fo + 1) * channels + c] = m;
          }
        held = [];
        return out;
      },
    },
  };
}

/** Mel frames in, a 96-number embedding out every 8 frames, from the 76 frames before. */
export class EmbeddingStream {
  private readonly stages: Stage[] = [];

  constructor(layers: Layer[]) {
    let freq = MEL_BANDS;
    let channels = 1;
    layers.forEach((l, i) => {
      if (l.kind === "conv") {
        if (l.w.shape[1] !== channels) throw new Error("wake: embedding shape");
        const next = layers[i + 1];
        this.stages.push(convStage(l.w, l.b, freq, next?.kind === "act" ? next : null));
        channels = l.w.shape[0]!;
      } else if (l.kind === "pool") {
        const p = poolStage(l.time, l.freq, freq, channels);
        this.stages.push(p.stage);
        freq = p.freqOut;
      } else if (layers[i - 1]?.kind !== "conv") {
        throw new Error("wake: an activation with no convolution before it");
      }
    });
    if (freq !== 1 || channels !== EMBED) throw new Error("wake: embedding shape");
  }

  /** One mel frame in; the embedding when one is complete. */
  push(mel: Float32Array): Float32Array | null {
    let row: Float32Array | null = new Float32Array(MEL_BANDS + 2);
    row.set(mel, 1);
    for (const s of this.stages) {
      row = s.push(row);
      if (!row) return null;
    }
    // The last row is one column wide: its 96 channels, between the zeros.
    return row.slice(EMBED, 2 * EMBED);
  }
}

// ---- Classifier and decision ---------------------------------------------

/** The classifier's score, 0 to 1, for the last `window` embeddings, oldest first. */
export function classify(model: WakeModel, embeddings: readonly Float32Array[]): number {
  let x = new Float64Array(model.window * EMBED);
  embeddings.forEach((e, i) => x.set(e, i * EMBED));
  model.dense.forEach((d, li) => {
    const [out, inp] = d.w.shape as [number, number];
    const y = new Float64Array(out);
    for (let o = 0; o < out; o++) {
      let acc = d.b.data[o]!;
      const base = o * inp;
      for (let i = 0; i < inp; i++) acc += d.w.data[base + i]! * x[i]!;
      y[o] = li < model.dense.length - 1 ? Math.max(acc, 0) : acc;
    }
    x = y;
  });
  return 1 / (1 + Math.exp(-x[0]!));
}

/** How long after a wake nothing else wakes it: 2 s. */
export const REFRACTORY_MS = 2_000;

/**
 * Samples in, "heard it" out. Feed it 16 kHz audio in 16-bit units, in any
 * size of piece; it calls `onWake` once each time the score stays at or above
 * the model's threshold for `hold` scores in a row, and not again for 2 s.
 */
export class WakeDetector {
  private readonly model: WakeModel;
  private readonly mel: MelStream;
  private readonly embed: EmbeddingStream;
  private readonly recent: Float32Array[] = [];
  /** Embeddings until it may wake again. */
  private quiet = 0;
  /** Scores in a row at or above the threshold. */
  private run = 0;
  private readonly onWake: () => void;

  constructor(model: WakeModel, onWake: () => void = () => {}) {
    this.model = model;
    this.onWake = onWake;
    this.mel = new MelStream();
    this.embed = new EmbeddingStream(model.embedding);
  }

  /** Feeds samples; returns the scores worked out on the way, one per 80 ms. */
  push(samples: ArrayLike<number>): number[] {
    const scores: number[] = [];
    this.mel.push(samples, (frame) => {
      const e = this.embed.push(frame);
      if (!e) return;
      this.recent.push(e);
      if (this.recent.length > this.model.window) this.recent.shift();
      if (this.recent.length < this.model.window) return;
      const s = classify(this.model, this.recent);
      scores.push(s);
      if (this.quiet > 0) {
        this.quiet--;
        this.run = 0;
        return;
      }
      this.run = s >= this.model.threshold ? this.run + 1 : 0;
      if (this.run >= this.model.hold) {
        this.quiet = Math.ceil(REFRACTORY_MS / (8 * 10));
        this.run = 0;
        this.onWake();
      }
    });
    return scores;
  }
}
