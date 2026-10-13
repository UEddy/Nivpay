/**
 * Cuts every segment in src/films/clips.ts from the recordings in footage/
 * to films-public/clips/<id>.mp4: constant 30 fps, sped up as listed, the
 * last frame held as listed, no sound, at most 1600 px tall. The films play
 * only these files, so a render never bundles footage/.
 *
 * node scripts/cut-clips.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SEGS, type Seg } from "../src/films/clips.ts";
import { ffmpegPath } from "./ffmpeg.ts";

const root = join(import.meta.dirname, "..");
const out = join(root, "films-public", "clips");
mkdirSync(out, { recursive: true });

const dark: Record<string, [number, number][]> = {};
for (const [id, seg] of Object.entries(SEGS) as [string, Seg][]) {
  const speed = seg.speed ?? 1;
  const filters = [`setpts=(PTS-STARTPTS)/${speed}`, "fps=30", "scale=-2:'min(1600,ih)'"];
  if (seg.hold) filters.push(`tpad=stop_mode=clone:stop_duration=${seg.hold}`);
  execFileSync(ffmpegPath(), [
    "-v", "error", "-y",
    "-ss", String(seg.from), "-to", String(seg.to), "-i", join(root, "footage", seg.src),
    "-vf", filters.join(","), "-an",
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-g", "15", "-keyint_min", "15", "-movflags", "+faststart",
    join(out, `${id}.mp4`),
  ]);
  // Where the phone hid its screen (the fingerprint prompt): black stretches, in seconds as played.
  const probe = spawnSync(ffmpegPath(), ["-i", join(out, `${id}.mp4`), "-vf", "blackdetect=d=0.25:pic_th=0.97", "-an", "-f", "null", "-"], { encoding: "utf8" });
  dark[id] = [...probe.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  console.log(id, dark[id].length ? `dark ${JSON.stringify(dark[id])}` : "");
}
writeFileSync(join(root, "src", "films", "dark.json"), `${JSON.stringify(dark, null, 1)}\n`);
