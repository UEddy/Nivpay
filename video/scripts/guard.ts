/**
 * The render guard, shared by video:render:* and video:check. A final render
 * refuses, and video:check fails, while a timeline breaks a rule, uses a fact
 * not measured yet, holds a placeholder, or names footage the redaction map
 * doesn't cover. With the 3D phone, a real take also refuses until
 * video:screens has rendered its redacted screen file from today's map.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { nullFacts } from "../src/facts.ts";
import { assertRenderable, parseRedactions, type Redactions } from "../src/redactions.ts";
import { PHONE_FRAME, type PhoneFrame } from "../src/phone/frame.ts";
import { screenFileFor, screenStamp, stampFileFor } from "../src/phone/screens.ts";
import { onPhone, problems, type Take, type Timeline } from "../src/timeline.ts";
import { scanHits } from "./scans.ts";

const root = join(import.meta.dirname, "..");

export const TIMELINE_IDS = ["agora-bounty", "technical-demo", "x-launch"] as const;

export function loadTimeline(id: string): Timeline {
  const f = join(root, "timelines", `${id}.json`);
  if (!existsSync(f)) throw new Error(`no timeline ${id}: expected one of ${TIMELINE_IDS.join(", ")}`);
  return JSON.parse(readFileSync(f, "utf8")) as Timeline;
}

export function loadMap(): Redactions | null {
  const f = join(root, "footage", "redactions.json");
  return existsSync(f) ? parseRedactions(readFileSync(f, "utf8")) : null;
}

/** Every real take the 3D phone shows, with the speed its screen file runs at. */
export function phoneTakes(t: Timeline): { segment: string; take: Take & { clip: string }; speed: number }[] {
  return t.segments.flatMap((s) =>
    onPhone(s)
      ? [s.take, s.kind === "pair" ? s.takeB : undefined].flatMap((take) => (take && take.clip !== null ? [{ segment: s.id, take: { ...take, clip: take.clip }, speed: s.speed ?? 1 }] : []))
      : [],
  );
}

/** Why a 3D screen file can't be used: missing, or rendered from a different map, take or speed. Null when it is current. */
export function staleScreen(map: Redactions, take: Take & { clip: string }, speed: number): string | null {
  const file = join(root, "footage", screenFileFor(take, speed));
  const stamp = join(root, "footage", stampFileFor(screenFileFor(take, speed)));
  if (!existsSync(file) || !existsSync(stamp)) return `no redacted screen file for clip ${take.clip} ${take.in} to ${take.out} s; run npm run video:screens`;
  const entry = map.clips[take.clip];
  if (!entry || readFileSync(stamp, "utf8") !== screenStamp(entry, take, speed)) return `the screen file for clip ${take.clip} ${take.in} to ${take.out} s was rendered from an older redaction map; run npm run video:screens`;
  return null;
}

/** Everything that stops a render of this timeline. A draft ignores placeholders and facts not measured yet; nothing else. */
export function refusals(t: Timeline, map: Redactions | null, draft: boolean, frame: PhoneFrame = PHONE_FRAME): { refuse: string[]; warnings: string[] } {
  const p = problems(t, map);
  const refuse = [...p.hard];
  if (!draft) refuse.push(...p.final);
  for (const s of t.segments) {
    for (const take of [s.take, s.takeB]) {
      if (!take || take.clip === null) continue;
      if (!map) {
        refuse.push(`${t.id} ${s.id}: footage/redactions.json is not on this PC, so clip ${take.clip} can't be checked`);
        continue;
      }
      try {
        assertRenderable(take.clip, map, take.in, take.out, scanHits(take.clip));
      } catch (e) {
        refuse.push(`${t.id} ${s.id}: ${(e as Error).message}`);
      }
    }
  }
  if (frame === "3d" && map) {
    for (const { segment, take, speed } of phoneTakes(t)) {
      const why = staleScreen(map, take, speed);
      if (why) refuse.push(`${t.id} ${segment}: ${why}`);
    }
  }
  return { refuse, warnings: p.warnings };
}

/** Facts still null, for video:check. */
export const unmeasured = () => nullFacts();
