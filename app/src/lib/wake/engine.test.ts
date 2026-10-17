import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, EmbeddingStream, melFilters, MelStream, parseModel, WakeDetector, type WakeModel } from "./engine.ts";

/**
 * The engine against openWakeWord's front end, worked out in Python
 * (app/scripts/wake/make_audio.py writes testdata/reference.json), on sound
 * recorded from voices the model never trained on: "Hey NivPay" in an
 * everyday room, words like it, and ordinary talk.
 */
const here = (p: string) => new URL(p, import.meta.url);
const buf = readFileSync(here("../../../public/wake/hey-nivpay-v1.bin"));
const model: WakeModel = parseModel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const reference = JSON.parse(readFileSync(here("testdata/reference.json"), "utf8")) as { mel: number[][]; melFrames: number; embeddings: number[][]; scores: number[] };

/** A 16 kHz, 16-bit, one channel WAV file's samples. */
function wav(name: string): Int16Array {
  const b = readFileSync(here(`testdata/${name}`));
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assert.equal(b.toString("ascii", 0, 4), "RIFF");
  let at = 12;
  while (at < b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      assert.equal(view.getUint16(at + 8, true), 1, "PCM");
      assert.equal(view.getUint16(at + 10, true), 1, "one channel");
      assert.equal(view.getUint32(at + 12, true), 16_000, "16 kHz");
    }
    if (id === "data") return new Int16Array(b.buffer.slice(b.byteOffset + at + 8, b.byteOffset + at + 8 + size));
    at += 8 + size + (size % 2);
  }
  throw new Error("no data");
}

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};

test("the mel filters are librosa's: 32 bands from 60 Hz to 3.8 kHz, nothing above", () => {
  const w = melFilters();
  // Bin k is k × 31.25 Hz: the first band starts above 60 Hz, the last ends below 3.8 kHz.
  for (let m = 0; m < 32; m++) {
    assert.equal(w[1 * 32 + m], 0);
    assert.equal(w[122 * 32 + m], 0);
  }
  assert.ok(w[2 * 32 + 0]! > 0 && w[121 * 32 + 31]! > 0);
});

test("mel frames and speech embeddings match openWakeWord's, frame by frame", () => {
  const pcm = wav("hey-nivpay.wav");
  const mels: Float32Array[] = [];
  new MelStream().push(pcm, (m) => mels.push(m));
  assert.equal(mels.length, reference.melFrames);
  reference.mel.forEach((row, i) => assert.ok(maxDiff(row, mels[i]!) < 1e-3, `mel frame ${i}: ${maxDiff(row, mels[i]!)}`));
  const embed = new EmbeddingStream(model.embedding);
  const out = mels.map((m) => embed.push(m)).filter((e): e is Float32Array => e !== null);
  assert.equal(out.length, reference.embeddings.length);
  reference.embeddings.forEach((row, i) => assert.ok(maxDiff(row, out[i]!) < 1e-2, `embedding ${i}: ${maxDiff(row, out[i]!)}`));
});

test("the classifier's scores match the trained model's in Python", () => {
  const pcm = wav("hey-nivpay.wav");
  const scores: number[] = [];
  const d = new WakeDetector(model);
  // In pieces of uneven size, as the microphone hands them over.
  for (let i = 0, n = 1; i < pcm.length; i += n, n = (n * 7 + 3) % 3000) scores.push(...d.push(pcm.subarray(i, i + n)));
  assert.equal(scores.length, reference.scores.length);
  assert.ok(maxDiff(scores, reference.scores) < 1e-3, `${maxDiff(scores, reference.scores)}`);
});

/** How many times it wakes over a recording, with the 2 s refractory. */
function wakes(name: string): { count: number; max: number } {
  let count = 0;
  const d = new WakeDetector(model, () => count++);
  const scores = d.push(wav(name));
  return { count, max: Math.max(...scores) };
}

test("“Hey NivPay”, recorded from a voice it never trained on, wakes it once", () => {
  const r = wakes("hey-nivpay.wav");
  assert.equal(r.count, 1, `max score ${r.max}`);
});

// The closest ones, which sometimes do ("hey Liv, pay", "hey, need pay"…), are measured by
// app/scripts/wake/evaluate.py and listed in the README, not asserted here.
test("words like it don't wake it: “navy pay”, “NivPay” alone, “hey Siri”, “hey Niv”, “hey Kev, pay”…", () => {
  const r = wakes("similar.wav");
  assert.equal(r.count, 0, `max score ${r.max}, threshold ${model.threshold}`);
});

test("ordinary talk never wakes it", () => {
  const r = wakes("talk.wav");
  assert.equal(r.count, 0, `max score ${r.max}, threshold ${model.threshold}`);
});

test("silence and quiet hiss never wake it", () => {
  let count = 0;
  const d = new WakeDetector(model, () => count++);
  d.push(new Float32Array(16_000 * 5));
  d.push(Float32Array.from({ length: 16_000 * 5 }, () => (Math.random() - 0.5) * 60));
  assert.equal(count, 0);
});

test("the model file: the speech embedding's 20 layers, a classifier on 16 embeddings, a threshold held for a few scores", () => {
  assert.equal(model.embedding.filter((l) => l.kind === "conv").length, 20);
  assert.equal(model.window, 16);
  assert.equal(model.dense[0]!.w.shape[1], 16 * 96);
  assert.ok(model.threshold > 0 && model.threshold < 1);
  assert.ok(model.hold >= 1 && model.hold <= 4, "a lone high score is not a wake; a held one is, within a third of a second");
  assert.ok(classify(model, Array.from({ length: 16 }, () => new Float32Array(96))) < model.threshold, "nothing heard is not a wake");
});

test("a damaged or foreign file is refused, not half read", () => {
  const bytes = new Uint8Array(buf);
  assert.throws(() => parseModel(new TextEncoder().encode("hello world!").buffer as ArrayBuffer), /not a wake word model/);
  assert.throws(() => parseModel(bytes.slice(0, 50_000).buffer), /cut short/);
});
