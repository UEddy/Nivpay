/**
 * The microphone's rate (usually 48 or 44.1 kHz) down to the 16 kHz the wake
 * word engine reads, in pieces as they come. A windowed-sinc low-pass at
 * 7.2 kHz first, so nothing above 8 kHz folds back in, then linear
 * interpolation at the new rate. Samples come out in 16-bit units, as the
 * engine expects.
 */
export class Resampler {
  private readonly step: number;
  private readonly taps: Float64Array;
  private readonly hist: Float64Array;
  /** Position of the next output sample, in input samples since the last filtered one. */
  private pos = 0;
  private prev = 0;
  private readonly gain: number;

  constructor(fromRate: number, toRate = 16_000, gain = 32_767) {
    if (!(fromRate >= toRate)) throw new Error("resample: only down");
    this.step = fromRate / toRate;
    this.gain = gain;
    const n = 31;
    const cutoff = 7_200 / fromRate;
    const taps = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = i - (n - 1) / 2;
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      taps[i] = sinc * hann;
      sum += taps[i]!;
    }
    for (let i = 0; i < n; i++) taps[i] = taps[i]! / sum;
    this.taps = taps;
    this.hist = new Float64Array(n);
  }

  /** Input samples (-1 to 1) in; 16 kHz samples out. */
  push(input: ArrayLike<number>): Float32Array {
    const out: number[] = [];
    const n = this.taps.length;
    for (let i = 0; i < input.length; i++) {
      // A ring would do; 31 taps are cheap enough to shift.
      this.hist.copyWithin(0, 1);
      this.hist[n - 1] = input[i]!;
      let y = 0;
      for (let k = 0; k < n; k++) y += this.taps[k]! * this.hist[k]!;
      // Output samples falling between the previous filtered sample and this one.
      while (this.pos <= 1) {
        out.push((this.prev + (y - this.prev) * this.pos) * this.gain);
        this.pos += this.step;
      }
      this.pos -= 1;
      this.prev = y;
    }
    return Float32Array.from(out);
  }
}
