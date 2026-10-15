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
