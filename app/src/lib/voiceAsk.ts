/**
 * Between the three ways voice starts listening (README, "Hey NivPay"): a
 * tap on the microphone button, "Hey NivPay", and a link ending ?voice=1
 * (from a Siri Shortcut, say). The last two ask; the microphone button on
 * Send or a pot's screen, once it is on screen, takes the ask and listens for
 * one sentence. While it listens it says it is busy, and the wake word lets
 * the microphone go.
 */

/** An ask is taken only this soon after it was made; an old one never starts the microphone. */
export const ASK_FRESH_MS = 10_000;

let askedAt = 0;
const askers = new Set<() => void>();
const busyWatchers = new Set<(busy: boolean) => void>();

/** Asks the microphone button on screen, or the next one to show, to listen for one sentence. */
export function askToListen(now = Date.now()): void {
  askedAt = now;
  for (const f of [...askers]) f();
}

/** Takes the ask, if there is a fresh one: true once per ask. */
export function takeAsk(now = Date.now()): boolean {
  const fresh = askedAt > 0 && now - askedAt <= ASK_FRESH_MS;
  askedAt = 0;
  return fresh;
}

/** Called on each ask; returns the way to stop. */
export function onAsk(f: () => void): () => void {
  askers.add(f);
  return () => askers.delete(f);
}

/** The speech service is hearing a sentence (true), or has finished (false). */
export function voiceBusy(busy: boolean): void {
  for (const f of [...busyWatchers]) f(busy);
}

export function onVoiceBusy(f: (busy: boolean) => void): () => void {
  busyWatchers.add(f);
  return () => busyWatchers.delete(f);
}

const settingsWatchers = new Set<() => void>();

/** Voice or the wake word was turned on or off in Profile: the app checks again whether to listen. */
export function voiceSettingsChanged(): void {
  for (const f of [...settingsWatchers]) f();
}

export function onVoiceSettings(f: () => void): () => void {
  settingsWatchers.add(f);
  return () => settingsWatchers.delete(f);
}

/** Whether a link asks for voice: ?voice=1. */
export const asksForVoice = (search: string) => new URLSearchParams(search).get("voice") === "1";

/** The address without ?voice=1, everything else kept. */
export function withoutVoiceAsk(path: string, search: string, hash: string): string {
  const q = new URLSearchParams(search);
  q.delete("voice");
  const rest = q.toString();
  return path + (rest ? `?${rest}` : "") + hash;
}

/** Whether this site may use the microphone without asking: "granted", "denied", or "prompt" when it would ask or can't tell. */
export async function micPermission(): Promise<"granted" | "denied" | "prompt"> {
  try {
    const s = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return s.state === "granted" || s.state === "denied" ? s.state : "prompt";
  } catch {
    return "prompt";
  }
}
