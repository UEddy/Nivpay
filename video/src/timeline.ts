/**
 * One timeline config per video (timelines/<id>.json): clip ids, in and out
 * points, captions and callouts. Swapping footage means editing that file,
 * never code. Everything here is pure, so the rules are tested and the same
 * checks run in Remotion, in the render script and in video:check.
 */
import { fact } from "./facts.ts";
import { timeline as redactedPieces, type Redactions } from "./redactions.ts";
import { FPS, pieceFrames } from "./timing.ts";

/** Which words a video's captions may use. */
export type WordRules = "technical" | "consumer";

/** One phone or PC recording, by its id in footage/redactions.json. A null clip is a placeholder. */
export type Take = { clip: string | null; in: number; out: number };

export type Zoom = { from: number; to: number; x: number; y: number };

export type Segment = {
  id: string;
  /** The SHOTLIST.md shot this footage comes from. */
  shot: string;
  kind: "phone" | "pair" | "explorer" | "card";
  /** What recorded it, for the frame and a placeholder's shape. Default: pc for explorer, else phone. */
  device?: "phone" | "pc";
  /** What the shot shows, in plain words. Drawn on a placeholder; never on real footage. */
  plan: string;
  take?: Take;
  /** The second phone, for "pair": the same length as take. */
  takeB?: Take;
  labelA?: string;
  labelB?: string;
  /** Card only: its length and text. */
  seconds?: number;
  title?: string;
  subtitle?: string;
  url?: boolean;
  caption?: string;
  callout?: string;
  /** Playback speed. Above 1 the segment carries a visible "Sped up" tag. */
  speed?: number;
  /** The "Settled in" moment: never sped up. */
  settle?: boolean;
  /** For the bounty cut: what this segment proves to the judges. */
  proves?: Proof[];
  /** A push-in on the real footage (x-launch). Scales the recording, never redraws it. */
  zoom?: Zoom;
};

export type Proof = "passkey" | "balance" | "settled";

export type Timeline = {
  id: string;
  width: number;
  height: number;
  fps: number;
  /** Hard limits in seconds; video:check fails outside them. */
  minSeconds: number;
  capSeconds: number;
  /** What to aim for; outside it is a warning only. */
  target: [number, number];
  words: WordRules;
  /** Every proof listed must be shown by a segment that ends by this time. */
  provesBy?: { seconds: number; proofs: Proof[] };
  segments: Segment[];
};

export const SPED_UP_TAG = "Sped up";
export const NOT_MEASURED = "[not measured yet]";

// Words no caption uses, in any video.
const ALWAYS_BANNED = [
  "crypto", "cryptocurrency", "blockchain", "web3", "web 3", "wallet", "wallets", "token", "tokens", "gas",
  "onchain", "on-chain", "defi", "nft", "nfts", "stablecoin", "stablecoins", "smart contract", "mint", "minted",
  "minting", "seed phrase", "private key", "airdrop", "ether", "ethereum", "metamask", "dapp", "hodl",
];
// Allowed in the bounty and technical captions, never in the consumer video.
const TECHNICAL_ONLY = ["monad", "ausd", "transaction hash", "ctk", "testnet"];
// Allowed only on the explorer segment of a technical video.
const EXPLORER_ONLY = ["block", "blocks", "contract", "contracts", "explorer", "transaction", "transactions", "hash", "createpot", "fundwithpermit", "monadvision"];
// Any dash other than the plain hyphen.
const DASHES = /[\u2012\u2013\u2014\u2015\u2212]/;

const TOKEN = /\{([a-zA-Z.]+)(\|short)?\}/g;

const words = (text: string, list: string[]) =>
  list.filter((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}($|[^a-z0-9])`, "i").test(text));

/** The text with every {fact} put in; a fact not measured yet reads NOT_MEASURED. */
export function resolve(text: string): string {
  return text.replace(TOKEN, (_, path: string, short?: string) => {
    const v = fact(path);
    if (v === null) return NOT_MEASURED;
    if (v === undefined) return `{${path}}`;
    return short ? `${v.slice(0, 6)}...${v.slice(-4)}` : v;
  });
}

/** Facts a piece of text uses, split into unknown paths and ones not measured yet. */
export function factsUsed(text: string): { unknown: string[]; unmeasured: string[] } {
  const unknown: string[] = [];
  const unmeasured: string[] = [];
  for (const [, path] of text.matchAll(TOKEN)) {
    const v = fact(path!);
    if (v === undefined) unknown.push(path!);
    else if (v === null) unmeasured.push(path!);
  }
  return { unknown, unmeasured };
}

/**
 * What is wrong with one piece of on-screen text, whatever the render: a dash
 * that isn't a hyphen, a digit typed in rather than taken from facts.ts, a
 * fact that doesn't exist, or a word the video's rules don't allow.
 */
export function textProblems(text: string, rules: WordRules, explorer: boolean): string[] {
  const out: string[] = [];
  if (DASHES.test(text)) out.push("has an en or em dash");
  const literal = text.replace(TOKEN, "");
  if (/[0-9]/.test(literal)) out.push("has a digit typed in; numbers come from facts.ts as {path}");
  if (/[{}]/.test(literal)) out.push("has a malformed {fact}");
  const { unknown } = factsUsed(text);
  for (const p of unknown) out.push(`names {${p}}, which is not in facts.ts`);
  const shown = resolve(text);
  let banned = words(shown, ALWAYS_BANNED);
  // "transaction hash" is a technical phrase; take it out before looking for its words alone.
  const rest = rules === "technical" ? shown.replace(/transaction hash/gi, " ") : shown;
  if (rules === "consumer") banned = banned.concat(words(shown, TECHNICAL_ONLY), words(shown, EXPLORER_ONLY));
  else if (!explorer) banned = banned.concat(words(rest, EXPLORER_ONLY));
  for (const w of new Set(banned)) out.push(`uses "${w}", not allowed here`);
  return out;
}

/** Every piece of text a segment puts on screen. */
export function segmentTexts(s: Segment): string[] {
  return [s.caption, s.callout, s.labelA, s.labelB, s.title, s.subtitle].filter((t): t is string => typeof t === "string");
}

const takeSeconds = (t: Take, map: Redactions | null, speed: number): number => {
  const entry = t.clip !== null ? map?.clips[t.clip] : undefined;
  // A placeholder, or a clip whose map is not on this PC, runs for its in to out.
  if (!entry) return (t.out - t.in) / speed;
  return redactedPieces(entry, t.in, t.out).reduce((n, p) => n + pieceFrames(p, speed), 0) / FPS;
};

/** Frames a segment runs for: a card its seconds; footage its redacted length at its speed. */
export function segmentFrames(s: Segment, map: Redactions | null): number {
  if (s.kind === "card") return Math.max(1, Math.round((s.seconds ?? 0) * FPS));
  if (!s.take) return 1;
  return Math.max(1, Math.round(takeSeconds(s.take, map, s.speed ?? 1) * FPS));
}

export const totalFrames = (t: Timeline, map: Redactions | null) => t.segments.reduce((n, s) => n + segmentFrames(s, map), 0);

export const isPlaceholder = (s: Segment) => s.kind !== "card" && (s.take?.clip == null || (s.kind === "pair" && s.takeB?.clip == null));

export type Problems = { hard: string[]; final: string[]; warnings: string[] };

/**
 * hard: refuses every render, draft or final. final: refuses a final render
 * and fails video:check (placeholders, facts not measured yet). warnings:
 * printed only.
 */
export function problems(t: Timeline, map: Redactions | null): Problems {
  const hard: string[] = [];
  const final: string[] = [];
  const warnings: string[] = [];
  if (t.fps !== FPS) hard.push(`${t.id}: fps must be ${FPS}`);
  const ids = new Set<string>();
  let at = 0;
  const proofEnds = new Map<Proof, number>();
  for (const s of t.segments) {
    const where = `${t.id} ${s.id}`;
    if (ids.has(s.id)) hard.push(`${where}: segment id used twice`);
    ids.add(s.id);
    if (DASHES.test(s.plan)) hard.push(`${where}: plan has an en or em dash`);
    for (const text of segmentTexts(s)) {
      for (const p of textProblems(text, t.words, s.kind === "explorer")) hard.push(`${where}: "${text}" ${p}`);
      for (const p of factsUsed(text).unmeasured) final.push(`${where}: {${p}} is not measured yet (null in facts.ts)`);
    }
    const speed = s.speed ?? 1;
    if (!(speed >= 1) || speed > 16) hard.push(`${where}: speed must be from 1 to 16`);
    if (s.settle && speed !== 1) hard.push(`${where}: the "Settled in" moment is never sped up`);
    if (s.kind === "card") {
      if (!(s.seconds! > 0)) hard.push(`${where}: a card needs seconds`);
    } else {
      for (const take of [s.take, s.kind === "pair" ? s.takeB : undefined]) {
        if (s.kind === "pair" && !take) hard.push(`${where}: a pair needs take and takeB`);
        if (!take) continue;
        if (!(take.out > take.in) || take.in < 0) hard.push(`${where}: out must be after in`);
        const entry = take.clip !== null ? map?.clips[take.clip] : undefined;
        if (take.clip !== null && map && !entry) hard.push(`${where}: clip ${take.clip} is not in redactions.json`);
        if (entry && take.out > entry.durationSeconds + 0.05) hard.push(`${where}: out ${take.out} is past the end of clip ${take.clip}`);
      }
      if (!s.take) hard.push(`${where}: footage needs a take`);
      if (s.kind === "pair" && s.take && s.takeB && Math.abs(s.take.out - s.take.in - (s.takeB.out - s.takeB.in)) > 1 / FPS) {
        hard.push(`${where}: both phones must run the same length so they stay in step`);
      }
      if (s.kind === "pair" && (s.takeB?.clip == null) !== (s.take?.clip == null)) hard.push(`${where}: both phones are real or both placeholders`);
      if (isPlaceholder(s)) final.push(`${where}: placeholder for shot ${s.shot}`);
      if (s.zoom && !(s.zoom.from >= 1 && s.zoom.to >= 1 && s.zoom.to <= 3)) hard.push(`${where}: zoom runs from 1 to 3`);
    }
    at += segmentFrames(s, map);
    for (const p of s.proves ?? []) if (!proofEnds.has(p)) proofEnds.set(p, at / FPS);
  }
  const seconds = at / FPS;
  if (seconds > t.capSeconds) hard.push(`${t.id}: ${seconds.toFixed(1)} s is over the ${t.capSeconds} s cap`);
  if (seconds < t.minSeconds) hard.push(`${t.id}: ${seconds.toFixed(1)} s is under the ${t.minSeconds} s minimum`);
  if (seconds < t.target[0] || seconds > t.target[1]) warnings.push(`${t.id}: ${seconds.toFixed(1)} s is outside the ${t.target[0]} to ${t.target[1]} s target`);
  if (t.provesBy) {
    for (const p of t.provesBy.proofs) {
      const end = proofEnds.get(p);
      if (end === undefined) hard.push(`${t.id}: nothing shows "${p}"`);
      else if (end > t.provesBy.seconds) hard.push(`${t.id}: "${p}" is shown by ${end.toFixed(1)} s, after ${t.provesBy.seconds} s`);
    }
  }
  return { hard, final, warnings };
}

/** Where each segment starts, in frames. */
export function starts(t: Timeline, map: Redactions | null): number[] {
  let at = 0;
  return t.segments.map((s) => {
    const here = at;
    at += segmentFrames(s, map);
    return here;
  });
}
