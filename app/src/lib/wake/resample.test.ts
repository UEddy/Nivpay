import { test } from "node:test";
import assert from "node:assert/strict";
import { Resampler } from "./resample.ts";

const tone = (hz: number, rate: number, seconds: number) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));
const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

/** The strength of one frequency in 16 kHz samples, as a fraction of a full-scale sine. */
function level(x: Float32Array, hz: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    re += x[i]! * Math.cos((2 * Math.PI * hz * i) / 16_000);
    im += x[i]! * Math.sin((2 * Math.PI * hz * i) / 16_000);
  }
  return (2 * Math.hypot(re, im)) / x.length / 32_767;
}

for (const rate of [48_000, 44_100, 16_000]) {
  test(`${rate} Hz in, 16 kHz out: the length, the pitch and the loudness of speech kept`, () => {
    const r = new Resampler(rate);
    const input = tone(1_000, rate, 1);
    // In pieces, as the worklet hands them over.
    const out: number[] = [];
    for (let i = 0; i < input.length; i += 4096) out.push(...r.push(input.subarray(i, i + 4096)));
    const y = Float32Array.from(out).subarray(800);
    assert.ok(Math.abs(out.length - 16_000) <= 1, `${out.length} samples`);
    assert.ok(Math.abs(level(y, 1_000) - 0.5) < 0.02, `1 kHz at ${level(y, 1_000)}`);
    assert.ok(level(y, 3_000) < 0.01, "no other tone appears");
  });
}

test("sound above 8 kHz is filtered out, not folded down into what the engine hears", () => {
  const r = new Resampler(48_000);
  const y = r.push(tone(12_000, 48_000, 1)).subarray(800);
  // 12 kHz would fold to 4 kHz: it must be at least 30 dB down.
  assert.ok(rms(y) / 32_767 < 0.5 * 0.0316 * Math.SQRT1_2, `left over: ${rms(y) / 32_767}`);
});

test("only down: a microphone slower than 16 kHz is refused", () => {
  assert.throws(() => new Resampler(8_000));
});
