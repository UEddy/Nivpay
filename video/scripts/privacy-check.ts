/**
 * video:privacy-check. Samples a rendered mp4 every 0.25 s, reads each frame
 * with OCR on this PC (pinned data, nothing fetched), and fails on any "@",
 * any phone-number-like run, or any line of privacy-denylist.txt.
 *
 * The denylist is read at run time only. Its contents, the text OCR read and
 * the strings matched are never printed, logged or written: the only output
 * is PASS or FAIL, with the timestamps of the frames that matched.
 *
 *   node scripts/privacy-check.ts [file.mp4 ...]     (default: every mp4 in out/)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ffmpegPath } from "./ffmpeg.ts";
import { jpegSize, ocrPool } from "./ocr.ts";
import { hasPhoneNumber } from "./sensitive.ts";

export const SAMPLE_EVERY_SECONDS = 0.25;
const root = join(import.meta.dirname, "..");

/** The denylist's entries, lower-cased. Empty or missing means only the built-in rules apply. */
export function readDenylist(path = join(root, "privacy-denylist.txt")): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** Whether one frame's text breaks a rule. Returns a yes or no only, never what matched. */
export function frameFails(text: string, denylist: string[]): boolean {
  if (text.includes("@")) return true;
  if (text.split(/\r?\n/).some(hasPhoneNumber)) return true;
  const lower = text.toLowerCase();
  // Matched with spacing and line breaks evened out, as OCR splits words.
  const squashed = lower.replace(/\s+/g, " ");
  return denylist.some((d) => squashed.includes(d.replace(/\s+/g, " ")));
}

/** Timestamps (seconds) of the sampled frames that fail. An empty list is a pass. */
export async function checkVideo(file: string, denylist: string[]): Promise<number[]> {
  mkdirSync(join(root, ".cache"), { recursive: true });
  const dir = mkdtempSync(join(root, ".cache", "privacy-"));
  try {
    execFileSync(ffmpegPath(), ["-v", "error", "-i", file, "-vf", `fps=${1 / SAMPLE_EVERY_SECONDS}`, "-q:v", "2", join(dir, "s%06d.jpg")]);
    const frames = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
    if (frames.length === 0) throw new Error("no frames could be read from the video");
    const { W, H } = jpegSize(readFileSync(join(dir, frames[0]!)));
    const ocr = await ocrPool();
    try {
      const results = await Promise.all(
        frames.map(async (f, i) => {
          const lines = await ocr.lines(join(dir, f), W, H, 0);
          return frameFails(lines.map((l) => l.text).join("\n"), denylist) ? i * SAMPLE_EVERY_SECONDS : null;
        }),
      );
      return results.filter((t): t is number => t !== null);
    } finally {
      await ocr.terminate();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && import.meta.filename === process.argv[1];
if (isMain) {
  const outDir = join(root, "out");
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : existsSync(outDir)
      ? readdirSync(outDir).filter((f) => f.endsWith(".mp4")).map((f) => join(outDir, f))
      : [];
  if (files.length === 0) {
    console.log("PASS (no videos to check)");
    process.exit(0);
  }
  const denylist = readDenylist();
  let failed = false;
  for (const file of files) {
    const hits = await checkVideo(file, denylist);
    if (hits.length === 0) console.log(`PASS ${file}`);
    else {
      failed = true;
      console.log(`FAIL ${file} at ${hits.map((t) => `${t.toFixed(2)}s`).join(", ")}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
