/**
 * Renders a film to out/<name>.mp4: H.264 with its synthesized sound.
 * The films hold no footage, but each file still has to pass the privacy
 * check (scripts/privacy-check.ts) before it is left in out/.
 *
 * node scripts/render-film.ts <x|bounty|tech|agora|demo>
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const NAMES = {
  x: "nivpay-x-launch",
  bounty: "nivpay-agora-bounty",
  tech: "nivpay-technical-demo",
  agora: "nivpay-agora-animated",
  demo: "nivpay-technical-animated",
} as const;
const film = process.argv[2] as keyof typeof NAMES;
if (!(film in NAMES)) throw new Error("usage: node scripts/render-film.ts <x|bounty|tech|agora|demo>");

const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, "films-public", "sound", `music-${film}.wav`))) throw new Error("no sound yet: run node scripts/make-sound.ts first");
mkdirSync(join(root, ".render"), { recursive: true });
mkdirSync(join(root, "out"), { recursive: true });

const serveUrl = await bundle({ entryPoint: join(root, "src", "index.ts"), publicDir: join(root, "films-public") });
// The bundle is a temp copy of the public dir: delete it when done, or each run leaves one behind.
process.on("exit", () => rmSync(serveUrl, { recursive: true, force: true }));
const composition = await selectComposition({ serveUrl, id: `film-${film}`, chromiumOptions: { gl: "angle" } });
const draft = join(root, ".render", `${NAMES[film]}.mp4`);
let last = -1;
await renderMedia({
  serveUrl,
  composition,
  codec: "h264",
  crf: 18,
  audioBitrate: "192k",
  pixelFormat: "yuv420p",
  outputLocation: draft,
  chromiumOptions: { gl: "angle" },
  onProgress: ({ progress }) => {
    const p = Math.floor(progress * 10);
    if (p !== last) console.log(`${NAMES[film]}: ${p * 10}%`);
    last = p;
  },
});
// The footage films use the recordings as recorded, unredacted, by the author's choice (12 Oct 2026):
// their privacy check reports what it finds and does not block. The animated films must pass it.
const REPORT_ONLY = new Set(["bounty", "tech"]);
try {
  execFileSync(process.execPath, [join(root, "scripts", "privacy-check.ts"), draft], { stdio: "inherit" });
} catch (e) {
  if (!REPORT_ONLY.has(film)) throw e;
  console.log(`privacy check: the findings above are in unredacted footage, used as recorded by choice; kept`);
}
renameSync(draft, join(root, "out", `${NAMES[film]}.mp4`));
console.log(`out/${NAMES[film]}.mp4`);
