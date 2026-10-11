/**
 * The render guard, shared by video:render:* and video:check. A final render
 * refuses, and video:check fails, while a timeline breaks a rule, uses a fact
 * not measured yet, holds a placeholder, or names footage the redaction map
 * doesn't cover.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { nullFacts } from "../src/facts.ts";
import { assertRenderable, parseRedactions, type Redactions } from "../src/redactions.ts";
import { problems, type Timeline } from "../src/timeline.ts";
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

/** Everything that stops a render of this timeline. A draft ignores placeholders and facts not measured yet; nothing else. */
export function refusals(t: Timeline, map: Redactions | null, draft: boolean): { refuse: string[]; warnings: string[] } {
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
  return { refuse, warnings: p.warnings };
}

/** Facts still null, for video:check. */
export const unmeasured = () => nullFacts();
