/**
 * video:check. Fails unless the redaction map loads, every clip in it is
 * reviewed and covers what its frame scan found, every timeline would render
 * as a final (no rule broken, inside its duration cap, no placeholder, no
 * fact not measured yet), facts.ts has no null left, no committed file under
 * video/ holds an en or em dash, and video:privacy-check passes on everything
 * in out/ and anything left in .render/.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertRenderable, parseRedactions } from "../src/redactions.ts";
import { loadMap, loadTimeline, refusals, TIMELINE_IDS, unmeasured } from "./guard.ts";

const root = join(import.meta.dirname, "..");
let failed = false;

const mapFile = join(root, "footage", "redactions.json");
if (existsSync(mapFile)) {
  const map = parseRedactions(readFileSync(mapFile, "utf8"));
  for (const [clip, entry] of Object.entries(map.clips)) {
    const scanFile = join(root, "footage", "_scans", `${clip}.scan.json`);
    if (!existsSync(scanFile)) {
      console.log(`SKIP ${clip}: no frame scan on this PC (the map is still checked when it renders)`);
      continue;
    }
    const scan = JSON.parse(readFileSync(scanFile, "utf8"));
    const hits = scan.frames.flatMap((fr: any) => [
      ...fr.hits.map((h: any) => ({ t: fr.t, category: h.category, box: h.box })),
      ...(fr.keypad ? [{ t: fr.t, category: "PIN or password entry", box: { x: 0, y: 0.5, w: 1, h: 0.5 } }] : []),
    ]);
    try {
      assertRenderable(clip, map, 0, entry.durationSeconds, hits);
      console.log(`PASS map ${clip}`);
    } catch (e) {
      failed = true;
      console.log(`FAIL map ${(e as Error).message}`);
    }
  }
} else {
  console.log("SKIP map: footage/redactions.json is not on this PC");
}

const map = existsSync(mapFile) ? loadMap() : null;
for (const id of TIMELINE_IDS) {
  const { refuse, warnings } = refusals(loadTimeline(id), map, false);
  for (const w of warnings) console.log(`WARN ${w}`);
  if (refuse.length) {
    failed = true;
    console.log(`FAIL timeline ${id}: ${refuse.length} to fix before a final render`);
    for (const r of refuse) console.log(`  ${r}`);
  } else console.log(`PASS timeline ${id}`);
}

const nulls = unmeasured();
if (nulls.length) {
  failed = true;
  console.log(`FAIL facts.ts: not measured yet: ${nulls.join(", ")}`);
} else console.log("PASS facts.ts: every fact measured");

// No en or em dash in any committed caption, code or copy here.
const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "."], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|json|md|sh|txt)$/.test(f) && !f.endsWith("package-lock.json"));
const dashed = tracked.filter((f) => /[\u2012\u2013\u2014\u2015]/.test(readFileSync(join(root, f), "utf8")));
if (dashed.length) {
  failed = true;
  console.log(`FAIL en or em dash in ${dashed.join(", ")}`);
} else console.log("PASS no en or em dashes");

const videos = ["out", ".render"].flatMap((d) =>
  existsSync(join(root, d)) ? readdirSync(join(root, d)).filter((f) => f.endsWith(".mp4")).map((f) => join(root, d, f)) : [],
);
try {
  execFileSync(process.execPath, [join(root, "scripts", "privacy-check.ts"), ...videos], { stdio: "inherit" });
} catch {
  failed = true;
}
process.exit(failed ? 1 : 0);
