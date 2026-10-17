import { test } from "node:test";
import assert from "node:assert/strict";
import type { WakeModel } from "./engine.ts";
import { IDLE_MS, MicError, WakeSession, type Mic, type WakeState } from "./session.ts";

/** A clock that only moves when told, and timers that fire when it passes them. */
function fakeTimers() {
  let now = 1_000_000;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    set: (fn: () => void, ms: number) => {
      const id = next++;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h: unknown) => void due.delete(h as number),
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const first = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!first) break;
        due.delete(first[0]);
        now = first[1].at;
        first[1].fn();
      }
      now = end;
    },
    pending: () => due.size,
  };
}

/** A microphone that records what happened to it, and lets the test feed it sound. */
function fakeMics(fail: (MicError | null)[] = []) {
  const opened: { feed: (s: Float32Array) => void; lose: () => void; stopped: boolean; chimed: boolean }[] = [];
  const start = async (onSamples: (s: Float32Array) => void, onLost: () => void): Promise<Mic> => {
    const err = fail.shift();
    if (err) throw err;
    const m = { feed: onSamples, lose: onLost, stopped: false, chimed: false };
    opened.push(m);
    return {
      stop: () => void (m.stopped = true),
      chime: async () => void (m.chimed = true),
    };
  };
  return { start, opened, last: () => opened[opened.length - 1]! };
}

/** The detector stand-in: hears the wake word in any piece of sound whose first sample is 1. */
const markerDetector = (_m: WakeModel, onWake: () => void) => ({
  push(s: ArrayLike<number>) {
    if (s[0] === 1) onWake();
  },
});
const WAKE = Float32Array.of(1, 0, 0);
const QUIET = Float32Array.of(0, 0, 0);
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(fail: (MicError | null)[] = []) {
  const timers = fakeTimers();
  const mics = fakeMics(fail);
  const states: WakeState["kind"][] = [];
  let wakes = 0;
  const session = new WakeSession({
    loadModel: async () => ({}) as WakeModel,
    startMic: mics.start,
    onState: (s) => states.push(s.kind),
    onWake: () => void wakes++,
    timers,
    detector: markerDetector,
  });
  return { session, timers, mics, states, wakes: () => wakes };
}

test("the microphone is on only while it says listening, and the bar's state follows it", async () => {
  const { session, mics, states } = setup();
  await session.start();
  assert.deepEqual(states, ["starting", "listening"]);
  assert.equal(mics.opened.length, 1);
  assert.equal(mics.last().stopped, false);
  session.stop("user");
  assert.equal(mics.last().stopped, true);
  assert.deepEqual(session.current, { kind: "stopped", why: "user" });
});

test("a wake: the chime, the microphone let go, then the app is told; it listens again after the sentence", async () => {
  const { session, mics, wakes } = setup();
  await session.start();
  const first = mics.last();
  first.feed(QUIET);
  assert.equal(wakes(), 0);
  first.feed(WAKE);
  await flush();
  assert.equal(first.chimed, true);
  assert.equal(first.stopped, true, "the speech service never shares the microphone with the wake word");
  assert.equal(wakes(), 1);
  assert.equal(session.current.kind, "paused");
  // Sound still arriving from the old microphone goes nowhere.
  first.feed(WAKE);
  await flush();
  assert.equal(wakes(), 1);
  session.resume();
  await flush();
  assert.equal(session.current.kind, "listening");
  assert.equal(mics.opened.length, 2);
  assert.equal(mics.last().stopped, false);
});

test("going to the background or locking the screen stops it, and says so", async () => {
  const { session, mics } = setup();
  await session.start();
  session.stop("background");
  assert.deepEqual(session.current, { kind: "stopped", why: "background" });
  assert.equal(mics.last().stopped, true);
  // Nothing more is heard from it.
  mics.last().feed(WAKE);
  await flush();
  assert.equal(session.current.kind, "stopped");
});

test("5 minutes with no tap, key or wake: it stops and says why; a tap puts the 5 minutes back", async () => {
  const { session, timers, mics } = setup();
  await session.start();
  timers.advance(IDLE_MS - 1);
  assert.equal(session.current.kind, "listening");
  timers.advance(1);
  assert.deepEqual(session.current, { kind: "stopped", why: "idle" });
  assert.equal(mics.last().stopped, true);

  await session.start();
  timers.advance(4 * 60_000);
  session.used();
  timers.advance(4 * 60_000);
  assert.equal(session.current.kind, "listening", "a tap 4 minutes in keeps it on");
  timers.advance(60_000);
  assert.deepEqual(session.current, { kind: "stopped", why: "idle" });
  assert.equal(timers.pending(), 0, "no timer left behind");
});

test("a wake counts as use", async () => {
  const { session, timers, mics } = setup();
  await session.start();
  timers.advance(4 * 60_000);
  mics.last().feed(WAKE);
  await flush();
  session.resume();
  await flush();
  timers.advance(4 * 60_000);
  assert.equal(session.current.kind, "listening");
});

test("a browser that wants a tap first says so, and a tap starts it", async () => {
  const { session } = setup([new MicError("needs-tap")]);
  await session.start();
  assert.equal(session.current.kind, "needs-tap");
  await session.start();
  assert.equal(session.current.kind, "listening");
});

test("a refused microphone, or none, stops it with the reason", async () => {
  const refused = setup([new MicError("refused")]);
  await refused.session.start();
  assert.deepEqual(refused.session.current, { kind: "stopped", why: "mic-refused" });
  const none = setup([new MicError("unavailable")]);
  await none.session.start();
  assert.deepEqual(none.session.current, { kind: "stopped", why: "unavailable" });
});

test("the microphone taken away while listening stops it", async () => {
  const { session, mics } = setup();
  await session.start();
  mics.last().lose();
  assert.deepEqual(session.current, { kind: "stopped", why: "mic-lost" });
});

test("a stop while the microphone is still starting wins: the late microphone is turned off at once", async () => {
  const timers = fakeTimers();
  let release: () => void = () => {};
  const late = { stopped: false };
  const session = new WakeSession({
    loadModel: async () => ({}) as WakeModel,
    startMic: () =>
      new Promise<Mic>((resolve) => {
        release = () => resolve({ stop: () => void (late.stopped = true), chime: async () => {} });
      }),
    onState: () => {},
    onWake: () => {},
    timers,
    detector: markerDetector,
  });
  const starting = session.start();
  await flush();
  session.stop("background");
  release();
  await starting;
  assert.equal(late.stopped, true);
  assert.deepEqual(session.current, { kind: "stopped", why: "background" });
});

test("a tap on the microphone button lets the wake word's microphone go, and it comes back after", async () => {
  const { session, mics } = setup();
  await session.start();
  session.pause();
  assert.equal(session.current.kind, "paused");
  assert.equal(mics.last().stopped, true);
  session.resume();
  await flush();
  assert.equal(session.current.kind, "listening");
  assert.equal(mics.opened.length, 2);
});

test("resume does nothing once stopped or off: only a person starts it again", async () => {
  const { session, mics } = setup();
  await session.start();
  session.stop("idle");
  session.resume();
  await flush();
  assert.equal(session.current.kind, "stopped");
  session.off();
  session.resume();
  await flush();
  assert.equal(session.current.kind, "off");
  assert.equal(mics.opened.length, 1);
});
