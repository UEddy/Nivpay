/**
 * Renders the phone frame prototypes (WebGL and CSS 3D, 10 s each) and
 * prints how many seconds of rendering one second of video costs on this PC.
 * Output goes to .render/, never out/.
 *
 *   node scripts/measure-phone.ts [3d|css]
 */
import { mkdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const root = join(import.meta.dirname, "..");
const which = process.argv.slice(2).filter((a) => a === "3d" || a === "css");
const serveUrl = await bundle({ entryPoint: join(root, "src", "index.ts"), publicDir: join(root, "footage") });
mkdirSync(join(root, ".render"), { recursive: true });
for (const r of which.length ? which : ["3d", "css"]) {
  const id = `phone-prototype-${r}`;
  const chromiumOptions = { gl: "angle" as const };
  const composition = await selectComposition({ serveUrl, id, inputProps: {}, chromiumOptions });
  const started = performance.now();
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: join(root, ".render", `${id}.mp4`), muted: true, chromiumOptions, crf: 18 });
  const secs = (performance.now() - started) / 1000;
  const video = composition.durationInFrames / composition.fps;
  console.log(`${id}: ${secs.toFixed(1)} s to render ${video.toFixed(1)} s, ${(secs / video).toFixed(2)} s per second of video (concurrency default, ${availableParallelism()} threads)`);
}
