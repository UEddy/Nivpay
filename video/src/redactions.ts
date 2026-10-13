/**
 * The redaction map for raw phone footage, and the rules that make it fail
 * closed. The map itself lives in footage/redactions.json, which is
 * git-ignored with the footage: it holds categories, times and rectangles
 * only, never the text that was seen.
 */

export const CATEGORIES = [
  "email address",
  "phone number",
  "contact names",
  "real names",
  "notification content",
  "account chooser",
  "Wi-Fi name",
  "status bar",
  "PIN or password entry",
  // Not in the first list, found in the rehearsal: a keyboard's clipboard
  // history, the recent-apps view and browser history show personal content.
  "personal screen",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** A rectangle as fractions of the frame, 0 to 1, already padded. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Blurred and tinted for its whole time range, already padded. */
export type Region = { start: number; end: number; rect: Rect; category: Category; note?: string };

/** Taken out of the timeline and replaced by a black hold with a true caption. */
export type Cut = { start: number; end: number; category: Category; caption: string; note?: string };

/** A black stretch the phone itself recorded (the fingerprint prompt), kept and captioned. */
export type Hold = { start: number; end: number; caption: string };

export type ClipEntry = {
  file: string;
  phone: string;
  width: number;
  height: number;
  durationSeconds: number;
  /** Fraction of the frame's height cropped off the top: the status bar and notification area, always, and the browser's toolbar where it shows. */
  statusBar: number;
  /** Fraction cropped off the bottom: the browser's bottom toolbar or the phone's navigation bar. */
  bottomBar?: number;
  /** Fraction of the width cropped off each side: black bars a recorder added around the screen (pillarbox). */
  sideBars?: number;
  /** Set once every frame of the clip was looked at. A clip not reviewed never renders. */
  reviewed: boolean;
  regions: Region[];
  cuts: Cut[];
  holds: Hold[];
  usableForOnboarding?: boolean;
  note?: string;
};

export type Redactions = { version: 1; clips: Record<string, ClipEntry> };

/** The longest a black hold may run, for a cut or for the phone's own blackout. */
export const MAX_HOLD_SECONDS = 2.5;
export const SCREEN_LOCK_CAPTION = "Confirm with your screen lock";
export const FINGERPRINT_CAPTION = "Confirm with fingerprint";

export class RedactionError extends Error {}

const inUnit = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const isTime = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

function checkRange(where: string, r: { start: unknown; end: unknown }, duration: number) {
  if (!isTime(r.start) || !isTime(r.end) || (r.end as number) <= (r.start as number)) throw new RedactionError(`${where}: start and end must be times with end after start`);
  if ((r.start as number) > duration + 1) throw new RedactionError(`${where}: starts after the clip ends`);
}

/** Reads and checks the map. Anything malformed refuses to render, rather than rendering unredacted. */
export function parseRedactions(text: string): Redactions {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new RedactionError(`redactions.json is not valid JSON: ${(e as Error).message}`);
  }
  if (data?.version !== 1 || typeof data.clips !== "object" || data.clips === null) throw new RedactionError("redactions.json needs version 1 and a clips object");
  for (const [id, c] of Object.entries<any>(data.clips)) {
    const where = `clip ${id}`;
    if (typeof c.file !== "string" || !isTime(c.durationSeconds) || !(c.width > 0) || !(c.height > 0)) throw new RedactionError(`${where}: file, size and duration are required`);
    if (!inUnit(c.statusBar) || c.statusBar <= 0) throw new RedactionError(`${where}: statusBar must crop a fraction of the top`);
    if (c.bottomBar !== undefined && (!inUnit(c.bottomBar) || c.statusBar + c.bottomBar >= 0.5)) throw new RedactionError(`${where}: bottomBar must be a small fraction of the frame`);
    if (c.sideBars !== undefined && (!inUnit(c.sideBars) || c.sideBars >= 0.25)) throw new RedactionError(`${where}: sideBars must be a small fraction of the width`);
    if (typeof c.reviewed !== "boolean") throw new RedactionError(`${where}: reviewed must be true or false`);
    for (const key of ["regions", "cuts", "holds"]) if (!Array.isArray(c[key])) throw new RedactionError(`${where}: ${key} must be a list`);
    c.regions.forEach((r: any, i: number) => {
      checkRange(`${where} region ${i}`, r, c.durationSeconds);
      if (!CATEGORIES.includes(r.category)) throw new RedactionError(`${where} region ${i}: unknown category`);
      const q = r.rect;
      if (!q || ![q.x, q.y, q.w, q.h].every(inUnit) || q.w <= 0 || q.h <= 0 || q.x + q.w > 1.0001 || q.y + q.h > 1.0001) throw new RedactionError(`${where} region ${i}: rect must lie inside the frame`);
    });
    c.cuts.forEach((r: any, i: number) => {
      checkRange(`${where} cut ${i}`, r, c.durationSeconds);
      if (!CATEGORIES.includes(r.category) || typeof r.caption !== "string" || !r.caption) throw new RedactionError(`${where} cut ${i}: needs a category and a caption`);
    });
    c.holds.forEach((r: any, i: number) => {
      checkRange(`${where} hold ${i}`, r, c.durationSeconds);
      if (typeof r.caption !== "string" || !r.caption) throw new RedactionError(`${where} hold ${i}: needs a caption`);
    });
  }
  return data as Redactions;
}

/** The part of the frame that is shown, as fractions: the crops taken off. */
export function visibleArea(entry: ClipEntry): Rect {
  const side = entry.sideBars ?? 0;
  return { x: side, y: entry.statusBar, w: 1 - side * 2, h: 1 - entry.statusBar - (entry.bottomBar ?? 0) };
}

/** Width and height in pixels of the shown part, each even, as an encoder needs. */
export function visiblePixels(entry: ClipEntry): { width: number; height: number } {
  const v = visibleArea(entry);
  const even = (n: number) => Math.round(n / 2) * 2;
  return { width: even(entry.width * v.w), height: even(entry.height * v.h) };
}

/** The padding the map is written with: half a second either side, a tenth of the box on every side. */
export function padRegion(start: number, end: number, rect: Rect, seconds = 0.5, fraction = 0.1): { start: number; end: number; rect: Rect } {
  const dx = Math.max(rect.w * fraction, 0.01);
  const dy = Math.max(rect.h * fraction, 0.01);
  const x = Math.max(0, rect.x - dx);
  const y = Math.max(0, rect.y - dy);
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return {
    start: Math.max(0, r(start - seconds)),
    end: r(end + seconds),
    rect: { x: r(x), y: r(y), w: r(Math.min(1, rect.x + rect.w + dx) - x), h: r(Math.min(1, rect.y + rect.h + dy) - y) },
  };
}

export type Piece = { kind: "clip"; from: number; to: number } | { kind: "hold"; seconds: number; caption: string };

/**
 * The timeline for source seconds [from, to) of a clip: every cut is taken
 * out and replaced by a black hold of at most 2.5 s with its caption, and
 * every blackout the phone recorded is held at most 2.5 s with its caption.
 */
export function timeline(entry: ClipEntry, from: number, to: number): Piece[] {
  type Gap = { start: number; end: number; caption: string };
  const gaps: Gap[] = [...entry.cuts, ...entry.holds]
    .filter((g) => g.end > from && g.start < to)
    .map((g) => ({ start: Math.max(from, g.start), end: Math.min(to, g.end), caption: g.caption }))
    .sort((a, b) => a.start - b.start);
  // Overlapping gaps become one, keeping the first caption (a cut is never shortened by a hold).
  const merged: Gap[] = [];
  for (const g of gaps) {
    const last = merged.at(-1);
    if (last && g.start <= last.end) last.end = Math.max(last.end, g.end);
    else merged.push({ ...g });
  }
  const pieces: Piece[] = [];
  let at = from;
  for (const g of merged) {
    if (g.start > at) pieces.push({ kind: "clip", from: at, to: g.start });
    pieces.push({ kind: "hold", seconds: Math.min(MAX_HOLD_SECONDS, g.end - g.start), caption: g.caption });
    at = g.end;
  }
  if (at < to) pieces.push({ kind: "clip", from: at, to });
  return pieces;
}

/** The longest one frame may be held on screen. */
export const MAX_FRAME_HOLD_SECONDS = 4;

/** Why the frame at `at` can't be held for `seconds`: inside a cut or a blackout, or held too long. Null when it can. */
export function heldFrameProblem(entry: ClipEntry, at: number, seconds: number): string | null {
  if (!(seconds > 0) || seconds > MAX_FRAME_HOLD_SECONDS) return `a held frame runs for more than 0 and at most ${MAX_FRAME_HOLD_SECONDS} s`;
  if (at < 0 || at > entry.durationSeconds) return `a held frame at ${at} s is outside the clip`;
  if ([...entry.cuts, ...entry.holds].some((g) => at >= g.start && at <= g.end)) return `the frame at ${at} s is inside a cut or a blackout, so it can't be held`;
  return null;
}

/** The regions to cover at a source time. */
export function regionsAt(entry: ClipEntry, t: number): Region[] {
  return entry.regions.filter((r) => t >= r.start && t <= r.end);
}

/** One hit from the frame scan: what was found, where and when. Never the text. */
export type ScanHit = { t: number; category: string; box: Rect };

const covers = (r: Rect, b: Rect) => b.x >= r.x - 1e-6 && b.y >= r.y - 1e-6 && b.x + b.w <= r.x + r.w + 1e-6 && b.y + b.h <= r.y + r.h + 1e-6;

/**
 * Fails closed. A clip renders only when it has an entry, the entry says it
 * was reviewed, and every private thing the scan found in the stretch being
 * rendered is either cut, inside the cropped status bar, or under a region
 * for that time.
 */
const NOT_PRIVATE = new Set(["passkey sheet"]);

export function assertRenderable(id: string, map: Redactions, from: number, to: number, hits: ScanHit[] | null): ClipEntry {
  const entry = map.clips[id];
  if (!entry) throw new RedactionError(`clip ${id} has no entry in redactions.json, so it can't be rendered`);
  if (!entry.reviewed) throw new RedactionError(`clip ${id} isn't marked reviewed in redactions.json, so it can't be rendered`);
  if (hits === null) throw new RedactionError(`clip ${id} has no frame scan (footage/_scans/${id}.scan.json), so nothing proves it is covered`);
  for (const h of hits) {
    if (h.t < from || h.t > to) continue;
    // A marker of where a sheet is, not private in itself; what the sheet shows is caught under its own category.
    if (NOT_PRIVATE.has(h.category)) continue;
    if (h.box.y + h.box.h <= entry.statusBar) continue;
    if (h.box.y >= 1 - (entry.bottomBar ?? 0)) continue;
    if (h.box.x + h.box.w <= (entry.sideBars ?? 0) || h.box.x >= 1 - (entry.sideBars ?? 0)) continue;
    if (entry.cuts.some((c) => h.t >= c.start && h.t <= c.end)) continue;
    if (regionsAt(entry, h.t).some((r) => covers(r.rect, h.box))) continue;
    throw new RedactionError(`clip ${id}: ${h.category} at ${h.t.toFixed(1)} s is not covered by any region or cut`);
  }
  return entry;
}
