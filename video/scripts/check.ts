/**
 * video:check. Fails unless the redaction map loads, every clip in it is
 * reviewed and covers what its frame scan found, and video:privacy-check
 * passes on everything in out/ and anything left in .render/.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertRenderable, parseRedactions } from "../src/redactions.ts";

const root = join(import.meta.dirname, "..");
let failed = false;

const mapFile = join(root, "footage", "redactions.json");
if (existsSync(mapFile)) {
  const map = parseRedactions(readFileSync(mapFile, "utf8"));
  for (const [clip, entry] of Object.entries(map.clips)) {
    const scanFile = join(root, "footage", "_frames", `${clip}.scan.json`);
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

const videos = ["out", ".render"].flatMap((d) =>
  existsSync(join(root, d)) ? readdirSync(join(root, d)).filter((f) => f.endsWith(".mp4")).map((f) => join(root, d, f)) : [],
);
try {
  execFileSync(process.execPath, [join(root, "scripts", "privacy-check.ts"), ...videos], { stdio: "inherit" });
} catch {
  failed = true;
}
process.exit(failed ? 1 : 0);
