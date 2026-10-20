/**
 * The browser's speech recognition, for voice commands (lib/voice.ts). Only
 * after a tap, for one sentence, then it stops: no wake word, nothing in the
 * background. The phone's own speech service (Google on Android and in
 * Chrome, Apple on iPhone and in Safari) turns the words into text; NivPay
 * gets only the text.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can turn speech into text. Where it can't, the microphone button is hidden. */
export const speechAvailable = () => recognitionClass() !== null;

export class SpeechError extends Error {
  /** "not-allowed" (the microphone was refused), "no-speech", "network", "aborted" and so on, from the browser. */
  readonly reason: string;
  constructor(reason: string) {
    super(`speech: ${reason}`);
    this.reason = reason;
  }
}

/** Listens for one sentence and returns what was heard. `stop` ends it early. */
export function listenOnce(lang = "en-US"): { heard: Promise<string>; stop: () => void } {
  const Class = recognitionClass();
  if (!Class) return { heard: Promise.reject(new SpeechError("unsupported")), stop: () => {} };
  const r = new Class();
  r.lang = lang;
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 1;
  let settled = false;
  const heard = new Promise<string>((resolve, reject) => {
    r.onresult = (e) => {
      settled = true;
      resolve(e.results[0]?.[0]?.transcript?.trim() ?? "");
      r.stop();
    };
    r.onerror = (e) => {
      if (settled) return;
      settled = true;
      reject(new SpeechError(e.error));
    };
    r.onend = () => {
      if (settled) return;
      settled = true;
      reject(new SpeechError("no-speech"));
    };
  });
  r.start();
  return { heard, stop: () => r.abort() };
}

/** Whether this browser can speak, for reading a voice payment back (screens/VoicePay.tsx). */
export const speakingAvailable = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

/**
 * Says `text` aloud with the phone's own voice, and resolves once it has
 * finished, so listening never starts while the phone is still talking.
 * Resolves at once where the browser can't speak (the words are on screen
 * too), and after `limitMs` if the browser never says it finished.
 */
export function say(text: string, lang = "en-US", limitMs = 8_000): Promise<void> {
  if (!speakingAvailable()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, limitMs);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
}

/** Stops anything being said. */
export function stopSaying(): void {
  if (speakingAvailable()) window.speechSynthesis.cancel();
}
