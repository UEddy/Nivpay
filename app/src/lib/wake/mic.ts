import { parseModel, type WakeModel } from "./engine.ts";
import { Resampler } from "./resample.ts";
import { MicError, type Mic } from "./session.ts";
import { wakeSupported } from "./support.ts";

/**
 * The browser's half of "Hey NivPay": the microphone through an audio
 * worklet (public/wake/capture.js) to the page, resampled to 16 kHz, and the
 * model file. All on the phone; nothing here sends sound anywhere.
 */

/** The model file, versioned in its name, so a phone never keeps an old one under a new app. */
export const MODEL_URL = "/wake/hey-nivpay-v1.bin";
const WORKLET_URL = "/wake/capture.js";

let model: Promise<WakeModel> | null = null;

/** The model, fetched once (about 1.5 MB, only when listening is on) and kept for the page. */
export function loadModel(): Promise<WakeModel> {
  model ??= fetch(MODEL_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`wake: model ${r.status}`);
      return r.arrayBuffer();
    })
    .then(parseModel)
    .catch((e: unknown) => {
      model = null;
      throw e;
    });
  return model;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Two rising notes, 0.25 s, and a buzz where the phone can. */
function chime(ctx: AudioContext): Promise<void> {
  try {
    navigator.vibrate?.([40, 30, 40]);
  } catch {
    // No vibration here.
  }
  try {
    const t = ctx.currentTime + 0.02;
    [880, 1320].forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      const at = t + i * 0.11;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.2, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.11);
    });
  } catch {
    // No sound: the screen still shows it heard.
  }
  // A little longer than the notes, so the speech service doesn't hear them.
  return sleep(300);
}

/** Starts the microphone for the wake word. Throws MicError: refused, needs a tap first, or not possible here. */
export async function startMic(onSamples: (samples: Float32Array) => void, onLost: () => void): Promise<Mic> {
  if (!wakeSupported()) throw new MicError("unavailable");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    throw new MicError(name === "NotAllowedError" || name === "SecurityError" ? "refused" : "unavailable");
  }
  let ctx: AudioContext | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const t of stream.getTracks()) t.stop();
    void ctx?.close().catch(() => {});
  };
  try {
    ctx = new AudioContext();
    // Without a tap, some browsers keep sound off: resume() then waits for one.
    if (ctx.state !== "running") await Promise.race([ctx.resume(), sleep(1500)]);
    if ((ctx.state as AudioContextState) !== "running") throw new MicError("needs-tap");
    await ctx.audioWorklet.addModule(WORKLET_URL);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "nivpay-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);
    const resampler = new Resampler(ctx.sampleRate);
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!stopped) onSamples(resampler.push(e.data));
    };
    for (const t of stream.getAudioTracks())
      t.addEventListener("ended", () => {
        if (!stopped) onLost();
      });
    const running = ctx;
    return { stop, chime: () => chime(running) };
  } catch (e) {
    stop();
    throw e instanceof MicError ? e : new MicError("unavailable");
  }
}
