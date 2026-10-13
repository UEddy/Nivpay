/**
 * The films' plans, in bars of the music: 120 bpm, so a beat is half a
 * second (15 frames) and a bar is 2 s (60 frames). Every scene starts on a
 * bar, so every cut lands on the downbeat. The music for each film is
 * arranged from the same list (scripts/make-sound.ts), so a scene's mood and
 * its music change together.
 */

import { segSeconds } from "./clips.ts";

export const FPS = 30;
export const BEAT = 15;
export const BAR = 60;

export type Mood = "intro" | "full" | "break" | "tense" | "outro";
export type Section = { from: number; to: number; kind: Mood };
/** A scene lasts some bars of the music, or, for real footage, some seconds. */
export type ScenePlan = { id: string; mood: Mood } & ({ bars: number; secs?: never } | { secs: number; bars?: never });


/** A footage scene: the segments it plays, plus a little air. */
const foot = (pad: number, ...ids: Parameters<typeof segSeconds>) => Math.ceil((segSeconds(...ids) + pad) * 2) / 2;

export const PLANS = {
  x: [
    { id: "hook", bars: 2, mood: "intro" },
    { id: "chat", bars: 2, mood: "intro" },
    { id: "meet", bars: 1, mood: "full" },
    { id: "pour", bars: 3, mood: "full" },
    { id: "lock", bars: 2, mood: "full" },
    { id: "pocket", bars: 2, mood: "break" },
    { id: "yes", bars: 2, mood: "full" },
    { id: "uses", bars: 2, mood: "full" },
    { id: "end", bars: 2, mood: "outro" },
  ],
  agora: [
    { id: "hook", bars: 2, mood: "intro" },
    { id: "title", bars: 2, mood: "full" },
    { id: "passkey", bars: 6, mood: "full" },
    { id: "balance", bars: 5, mood: "full" },
    { id: "send", bars: 9, mood: "full" },
    { id: "receipt", bars: 4, mood: "break" },
    { id: "currency", bars: 7, mood: "full" },
    { id: "business", bars: 4, mood: "full" },
    { id: "stack", bars: 4, mood: "full" },
    { id: "end", bars: 3, mood: "outro" },
  ],
  demo: [
    { id: "hook", bars: 3, mood: "intro" },
    { id: "title", bars: 2, mood: "full" },
    { id: "problem", bars: 6, mood: "break" },
    { id: "make", bars: 7, mood: "full" },
    { id: "chipin", bars: 9, mood: "full" },
    { id: "yes", bars: 9, mood: "full" },
    { id: "rogue", bars: 9, mood: "tense" },
    { id: "close", bars: 6, mood: "full" },
    { id: "ledger", bars: 4, mood: "break" },
    { id: "proof", bars: 4, mood: "full" },
    { id: "stack", bars: 7, mood: "full" },
    { id: "end", bars: 3, mood: "outro" },
  ],
  /** The Agora bounty, from the real recordings. */
  bounty: [
    { id: "hook", bars: 2, mood: "intro" },
    { id: "title", bars: 2, mood: "full" },
    { id: "passkey", secs: foot(0.5, "passkey"), mood: "full" },
    { id: "balance", secs: foot(0.5, "claim"), mood: "full" },
    { id: "send", secs: foot(1, "sendTyping", "sendFinal"), mood: "full" },
    { id: "receipt", secs: foot(0.5, "explorer48"), mood: "break" },
    { id: "currency", secs: foot(1, "ctkReview", "ctkSheet", "ctkSteps"), mood: "full" },
    { id: "swapReceipt", secs: foot(0.5, "ctkExplorer"), mood: "break" },
    { id: "business", bars: 2, mood: "full" },
    { id: "end", bars: 3, mood: "outro" },
  ],
  /** The technical demo, from the real recordings. */
  tech: [
    { id: "hook", bars: 2, mood: "intro" },
    { id: "title", bars: 2, mood: "full" },
    { id: "onboard", secs: foot(0.5, "passkeyFast", "claimShort"), mood: "full" },
    { id: "make", secs: foot(0.5, "potDraft", "potCheck", "potMade"), mood: "full" },
    { id: "pour", secs: foot(0.5, "pour"), mood: "full" },
    { id: "ask", secs: foot(0.5, "askLeader", "askWaiting"), mood: "break" },
    { id: "yes", secs: foot(0.5, "yesEddy"), mood: "full" },
    { id: "send", secs: foot(0.5, "sendFinal"), mood: "full" },
    { id: "explorer", secs: foot(0.5, "explorer013"), mood: "break" },
    { id: "currency", secs: foot(0.5, "ctkReview", "ctkSheet", "ctkSteps"), mood: "full" },
    { id: "proof", bars: 2, mood: "full" },
    { id: "end", bars: 3, mood: "outro" },
  ],
} satisfies Record<string, ScenePlan[]>;

export type FilmId = keyof typeof PLANS;

/** A scene's length in frames. */
export const sceneFrames = (s: ScenePlan) => (s.secs !== undefined ? Math.round(s.secs * FPS) : s.bars * BAR);
export const filmFrames = (id: FilmId) => (PLANS[id] as ScenePlan[]).reduce((n, s) => n + sceneFrames(s), 0);

/** Where each scene starts, in frames. */
export function sceneStarts(id: FilmId): Record<string, { from: number; frames: number }> {
  let at = 0;
  const out: Record<string, { from: number; frames: number }> = {};
  for (const s of PLANS[id] as ScenePlan[]) {
    out[s.id] = { from: at, frames: sceneFrames(s) };
    at += sceneFrames(s);
  }
  return out;
}

export const FILM_SOUND = Object.fromEntries(
  (Object.keys(PLANS) as FilmId[]).map((id) => {
    let t = 0;
    const sections: Section[] = (PLANS[id] as ScenePlan[]).map((s) => {
      const len = sceneFrames(s) / FPS;
      const sec = { from: t, to: t + len, kind: s.mood };
      t += len;
      return sec;
    });
    return [id, { length: t, sections }];
  }),
) as Record<FilmId, { length: number; sections: Section[] }>;
