/**
 * video:render. Renders source seconds [from, to) of one clip, redacted, and
 * only puts it in out/ once video:privacy-check passes on it.
 *
 *   npm run video:render -- <clip> <from> <to> <name>
 *
 * Refuses before rendering when the clip has no reviewed entry in
 * footage/redactions.json, has no frame scan, or has a private thing in the
 * stretch that no region or cut covers. Renders to .render/ (git-ignored);
 * a file that fails the privacy check stays there and never reaches out/.
 */
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { assertRenderable, parseRedactions } from "../src/redactions.ts";
import { checkVideo, readDenylist } from "./privacy-check.ts";
import { scanHits } from "./scans.ts";

const root = join(import.meta.dirname, "..");

const [clip, fromText, toText, name] = process.argv.slice(2);
if (!clip || !fromText || !toText || !name || !/^[\w-]+$/.test(name)) {
  console.error("usage: npm run video:render -- <clip> <from seconds> <to seconds> <name>");
  process.exit(2);
}
const from = Number(fromText);
const to = Number(toText);
const mapFile = join(root, "footage", "redactions.json");
if (!existsSync(mapFile)) throw new Error("footage/redactions.json is missing: nothing can be rendered without it");
const map = parseRedactions(readFileSync(mapFile, "utf8"));
assertRenderable(clip, map, from, to, scanHits(clip));

const serveUrl = await bundle({ entryPoint: join(root, "src", "index.ts"), publicDir: join(root, "footage") });
const inputProps = { clip, from, to, map };
const composition = await selectComposition({ serveUrl, id: "RedactedClip", inputProps });
mkdirSync(join(root, ".render"), { recursive: true });
const staged = join(root, ".render", `${name}.mp4`);
await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: staged, inputProps, muted: true });

const hits = await checkVideo(staged, readDenylist());
if (hits.length > 0) {
  console.log(`FAIL ${name}.mp4 at ${hits.map((t) => `${t.toFixed(2)}s`).join(", ")}. It stays in .render/ and is not in out/.`);
  process.exit(1);
}
mkdirSync(join(root, "out"), { recursive: true });
renameSync(staged, join(root, "out", `${name}.mp4`));
console.log(`PASS ${name}.mp4, moved to out/`);
