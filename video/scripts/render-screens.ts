/**
 * video:screens. Renders what the 3D phone's screen shows for every real
 * phone take in the timelines: the take redacted (RedactedClip: crop, blur,
 * cuts and holds), at its segment's speed. Each file is privacy-checked in
 * .render/_screens/ and only moved into footage/_screens/, the one folder the
 * phone may read, once that passes, with a stamp of the map it came from.
 *
 *   npm run video:screens [-- <timeline id> ...]
 *
 * A take whose screen file is current is skipped. The flat frame needs none
 * of this: it redacts as it renders.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { assertRenderable } from "../src/redactions.ts";
import { screenFileFor, screenStamp, stampFileFor } from "../src/phone/screens.ts";
import { loadMap, loadTimeline, phoneTakes, staleScreen, TIMELINE_IDS } from "./guard.ts";
import { checkVideo, readDenylist } from "./privacy-check.ts";
import { scanHits } from "./scans.ts";

const root = join(import.meta.dirname, "..");
const ids = process.argv.slice(2).length ? process.argv.slice(2) : [...TIMELINE_IDS];
const map = loadMap();

const wanted = new Map<string, { take: Parameters<typeof screenFileFor>[0]; speed: number }>();
for (const id of ids) for (const { take, speed } of phoneTakes(loadTimeline(id))) wanted.set(screenFileFor(take, speed), { take, speed });
if (wanted.size === 0) {
  console.log("PASS no real phone takes in the timelines yet: nothing to render");
  process.exit(0);
}
if (!map) throw new Error("footage/redactions.json is missing: nothing can be rendered without it");

const todo = [...wanted].filter(([, w]) => staleScreen(map, w.take, w.speed) !== null);
console.log(`${wanted.size} screen files wanted, ${todo.length} to render`);
if (todo.length === 0) process.exit(0);

const serveUrl = await bundle({ entryPoint: join(root, "src", "index.ts"), publicDir: join(root, "footage") });
const denylist = readDenylist();
let failed = false;
for (const [file, { take, speed }] of todo) {
  assertRenderable(take.clip, map, take.in, take.out, scanHits(take.clip));
  const entry = map.clips[take.clip]!;
  const inputProps = { clip: take.clip, from: take.in, to: take.out, map, speed, holdFontSize: entry.width * 0.07, hold: take.hold };
  const composition = await selectComposition({ serveUrl, id: "RedactedClip", inputProps });
  const staged = join(root, ".render", file);
  mkdirSync(dirname(staged), { recursive: true });
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: staged, inputProps, muted: true, crf: 16 });
  const hits = await checkVideo(staged, denylist);
  if (hits.length > 0) {
    failed = true;
    console.log(`FAIL privacy check ${file} at ${hits.map((t) => `${t.toFixed(2)}s`).join(", ")}. It stays in .render/ and the phone can't show it.`);
    continue;
  }
  const dest = join(root, "footage", file);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(staged, dest);
  writeFileSync(join(root, "footage", stampFileFor(file)), screenStamp(entry, take, speed));
  console.log(`PASS ${file}`);
}
process.exit(failed ? 1 : 0);
