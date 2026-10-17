import { WakeDetector, type WakeModel } from "./engine.ts";

/**
 * Listening for "Hey NivPay" while the app is open (README, "Hey NivPay"):
 * when the microphone is on, when it stops, and what happens on a wake. No
 * browser in here; the microphone and the clock are handed in, so the rules
 * are tested (session.test.ts).
 *
 * The rules: the microphone is on only while this says "listening". It stops
 * when the app goes to the background or the screen locks, after 5 minutes
 * with no tap, key or wake, and while the phone's speech service hears the
 * one sentence after a wake (the two never share the microphone). Every stop
 * says why. Sound never leaves the phone from here: samples go to the
 * detector and nowhere else.
 */

/** Five minutes with no tap, key or wake, and it stops. */
export const IDLE_MS = 5 * 60_000;

export type WakeStop = "background" | "idle" | "mic-refused" | "mic-lost" | "unavailable" | "user";

export type WakeState =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "listening" }
  /** Heard it: the microphone is off while one sentence is heard. */
  | { kind: "paused" }
  /** The browser wants a tap before the microphone can start. */
  | { kind: "needs-tap" }
  | { kind: "stopped"; why: WakeStop };

export class MicError extends Error {
  readonly reason: "refused" | "needs-tap" | "unavailable";
  constructor(reason: "refused" | "needs-tap" | "unavailable") {
    super(`mic: ${reason}`);
    this.reason = reason;
  }
}

/** The microphone, on. */
export type Mic = {
  stop(): void;
  /** A short sound, and a buzz where the phone can, to say it heard. */
  chime(): Promise<void>;
};

/** Starts the microphone: 16 kHz samples in 16-bit units to `onSamples`, `onLost` if it goes. Throws MicError. */
export type MicStarter = (onSamples: (samples: Float32Array) => void, onLost: () => void) => Promise<Mic>;

/** What hears the wake word: samples in, `onWake` when heard. The engine's WakeDetector, or a stand-in in tests. */
export type Detector = { push(samples: ArrayLike<number>): unknown };
export type MakeDetector = (model: WakeModel, onWake: () => void) => Detector;

type Timers = {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

const realTimers: Timers = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class WakeSession {
  private state: WakeState = { kind: "off" };
  private mic: Mic | null = null;
  /** Bumped on every start and stop, so a start that finishes late knows it was overtaken. */
  private gen = 0;
  private lastUse = 0;
  private idleTimer: unknown = null;
  private readonly deps: {
    loadModel: () => Promise<WakeModel>;
    startMic: MicStarter;
    onState: (s: WakeState) => void;
    onWake: () => void;
    timers: Timers;
    detector: MakeDetector;
  };

  constructor(deps: {
    loadModel: () => Promise<WakeModel>;
    startMic: MicStarter;
    onState: (s: WakeState) => void;
    onWake: () => void;
    timers?: Timers;
    detector?: MakeDetector;
  }) {
    this.deps = { ...deps, timers: deps.timers ?? realTimers, detector: deps.detector ?? ((model, onWake) => new WakeDetector(model, onWake)) };
  }

  get current(): WakeState {
    return this.state;
  }

  private set(s: WakeState): void {
    this.state = s;
    this.deps.onState(s);
  }

  /** Turns the microphone on and listens. Call it from a tap where it can be: some browsers start sound only then. */
  async start(): Promise<void> {
    if (this.state.kind === "listening" || this.state.kind === "starting") return;
    const gen = ++this.gen;
    this.set({ kind: "starting" });
    this.used();
    let mic: Mic;
    try {
      const model = await this.deps.loadModel();
      if (gen !== this.gen) return;
      const detector = this.deps.detector(model, () => this.heard(gen));
      mic = await this.deps.startMic(
        (samples) => {
          if (gen === this.gen && this.state.kind === "listening") detector.push(samples);
        },
        () => {
          if (gen === this.gen) this.stop("mic-lost");
        },
      );
    } catch (e) {
      if (gen !== this.gen) return;
      const reason = e instanceof MicError ? e.reason : "unavailable";
      if (reason === "needs-tap") this.set({ kind: "needs-tap" });
      else this.stopped(reason === "refused" ? "mic-refused" : "unavailable");
      return;
    }
    if (gen !== this.gen) {
      mic.stop();
      return;
    }
    this.mic = mic;
    this.set({ kind: "listening" });
    this.armIdle();
  }

  /** Turns the microphone off, saying why. */
  stop(why: WakeStop): void {
    if (this.state.kind === "off" || this.state.kind === "stopped") return;
    this.stopped(why);
  }

  /** Off for good: the switch was turned off, or the account changed. Says nothing. */
  off(): void {
    this.release();
    this.set({ kind: "off" });
  }

  /** The speech service is about to hear a sentence (a tap on the microphone button): the microphone is let go. */
  pause(): void {
    if (this.state.kind !== "listening" && this.state.kind !== "starting") return;
    this.release();
    this.set({ kind: "paused" });
  }

  /** The sentence is over: listening again, unless it stopped meanwhile. */
  resume(): void {
    if (this.state.kind === "paused") void this.start();
  }

  /** A tap or a key: the 5 minutes start again. */
  used(): void {
    this.lastUse = this.deps.timers.now();
  }

  private stopped(why: WakeStop): void {
    this.release();
    this.set({ kind: "stopped", why });
  }

  private release(): void {
    this.gen++;
    if (this.idleTimer !== null) this.deps.timers.clear(this.idleTimer);
    this.idleTimer = null;
    const mic = this.mic;
    this.mic = null;
    mic?.stop();
  }

  private armIdle(): void {
    if (this.idleTimer !== null) this.deps.timers.clear(this.idleTimer);
    const left = this.lastUse + IDLE_MS - this.deps.timers.now();
    this.idleTimer = this.deps.timers.set(() => {
      this.idleTimer = null;
      if (this.state.kind !== "listening") return;
      if (this.deps.timers.now() - this.lastUse >= IDLE_MS) this.stop("idle");
      else this.armIdle();
    }, Math.max(left, 0));
  }

  private heard(gen: number): void {
    if (gen !== this.gen || this.state.kind !== "listening") return;
    this.used();
    const mic = this.mic;
    // No more samples to the detector, and the microphone is let go once the chime is played.
    this.gen++;
    this.mic = null;
    if (this.idleTimer !== null) this.deps.timers.clear(this.idleTimer);
    this.idleTimer = null;
    this.set({ kind: "paused" });
    const done = () => {
      mic?.stop();
      this.deps.onWake();
    };
    if (!mic) return done();
    mic.chime().then(done, done);
  }
}
