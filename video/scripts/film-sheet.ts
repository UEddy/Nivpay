/**
 * A contact sheet of a film, for review: one still every so often, tiled.
 *
 * node scripts/film-sheet.ts <film-x|film-agora|film-demo> [every seconds, default 2] [first s] [last s]
 * Writes .render/<id>-sheet.jpg (git-ignored).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { ffmpegPath } from "./ffmpeg.ts";

const [id, everyArg = "2", fromArg = "0", toArg] = process.argv.slice(2);
if (!id) throw new Error("usage: node scripts/film-sheet.ts <composition id> [every s] [from s] [to s]");
const root = join(import.meta.dirname, "..");
const out = join(root, ".render", `${id}-frames`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const serveUrl = await bundle({ entryPoint: join(root, "src", "index.ts"), publicDir: join(root, "films-public") });
// The bundle is a temp copy of the public dir: delete it when done, or each run leaves one behind.
process.on("exit", () => rmSync(serveUrl, { recursive: true, force: true }));
const comp = await selectComposition({ serveUrl, id, chromiumOptions: { gl: "angle" } });
const every = Math.round(Number(everyArg) * comp.fps);
const first = Math.round(Number(fromArg) * comp.fps);
const last = toArg ? Math.min(comp.durationInFrames - 1, Math.round(Number(toArg) * comp.fps)) : comp.durationInFrames - 1;
let n = 0;
for (let f = first; f <= last; f += every) {
  await renderStill({ serveUrl, composition: comp, frame: f, output: join(out, `${String(n++).padStart(3, "0")}.jpg`), imageFormat: "jpeg", jpegQuality: 80, scale: 0.4, chromiumOptions: { gl: "angle" } });
}
const cols = comp.width > comp.height ? 4 : 5;
execFileSync(ffmpegPath(), ["-loglevel", "error", "-y", "-i", join(out, "%03d.jpg"), "-vf", `tile=${cols}x${Math.ceil(n / cols)}:padding=6:color=white`, "-frames:v", "1", join(root, ".render", `${id}-sheet.jpg`)]);
console.log(`${n} frames, ${comp.durationInFrames / comp.fps} s: .render/${id}-sheet.jpg`);
