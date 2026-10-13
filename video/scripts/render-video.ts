/**
 * video:render:agora, video:render:demo, video:render:x. Renders one timeline.
 *
 *   node scripts/render-video.ts <agora-bounty|technical-demo|x-launch> [--draft]
 *
 * A final render refuses while any rule is broken, any fact a caption uses is
 * null, any placeholder is in the timeline, or any clip isn't covered by the
 * redaction map. It renders to .render/, runs video:privacy-check, and moves
 * the file to out/ only when that passes.
 *
 * --draft renders with placeholders and unmeasured facts marked on screen
 * and a "DRAFT, NOT FOR UPLOAD" badge on every frame. A draft stays in
 * .render/ and never reaches out/, which is the only folder ever uploaded.
 */
import { mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { PHONE_FRAME } from "../src/phone/frame.ts";
import { totalFrames } from "../src/timeline.ts";
import { loadMap, loadTimeline, refusals } from "./guard.ts";
import { checkVideo, readDenylist } from "./privacy-check.ts";

const root = join(import.meta.dirname, "..");
// X's own limits for an upload: 2 min 20 s and 512 MB. The timeline's cap is far tighter.
const X_MAX_SECONDS = 140;
const X_MAX_BYTES = 512 * 1024 * 1024;

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const draft = args.includes("--draft");
if (!id) {
  console.error("usage: node scripts/render-video.ts <agora-bounty|technical-demo|x-launch> [--draft]");
  process.exit(2);
}
const timeline = loadTimeline(id);
const map = loadMap();
const { refuse, warnings } = refusals(timeline, map, draft);
for (const w of warnings) console.log(`WARN ${w}`);
if (refuse.length) {
  console.log(`REFUSED ${id}${draft ? " (draft)" : ""}:`);
  for (const r of refuse) console.log(`  ${r}`);
  if (!draft) console.log("A draft with placeholders renders with --draft; it never reaches out/.");
  process.exit(1);
}

const seconds = totalFrames(timeline, map) / timeline.fps;
const serveUrl = await bundle({ entryPoint: join(root, "src", "index.ts"), publicDir: join(root, "footage") });
const inputProps = { timeline, map };
// The 3D phone frame is WebGL, as in scripts/measure-phone.ts.
const chromiumOptions = { gl: "angle" as const };
const composition = await selectComposition({ serveUrl, id, inputProps, chromiumOptions });
mkdirSync(join(root, ".render"), { recursive: true });
const name = draft ? `${id}.draft` : id;
const staged = join(root, ".render", `${name}.mp4`);
const started = performance.now();
await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: staged, inputProps, muted: true, crf: 18, chromiumOptions });
console.log(`rendered ${name}.mp4, ${seconds.toFixed(1)} s planned, ${PHONE_FRAME} phone frame, ${((performance.now() - started) / 1000).toFixed(0)} s to render`);

const hits = await checkVideo(staged, readDenylist());
if (hits.length > 0) {
  console.log(`FAIL privacy check ${name}.mp4 at ${hits.map((t) => `${t.toFixed(2)}s`).join(", ")}. It stays in .render/.`);
  process.exit(1);
}
if (draft) {
  console.log(`PASS privacy check. Draft kept in .render/${name}.mp4, never in out/.`);
  process.exit(0);
}
if (id === "x-launch") {
  const bytes = statSync(staged).size;
  if (seconds > X_MAX_SECONDS || bytes > X_MAX_BYTES) {
    console.log(`FAIL x-launch is over X's limits: ${seconds.toFixed(1)} s, ${(bytes / 1e6).toFixed(1)} MB. It stays in .render/.`);
    process.exit(1);
  }
}
mkdirSync(join(root, "out"), { recursive: true });
renameSync(staged, join(root, "out", `${name}.mp4`));
console.log(`PASS ${name}.mp4, moved to out/`);
