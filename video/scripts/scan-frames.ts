/**
 * Reads every extracted frame under footage/_frames/<clip>/ with OCR and
 * writes footage/_frames/<clip>.scan.json: per frame, its time, the
 * categories of private things found with their boxes, and a short hash of
 * the frame's text so identical screens can be grouped. Never the text.
 *
 *   node scripts/scan-frames.ts <clip> [fps]
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jpegSize, ocrPool } from "./ocr.ts";
import { classify, looksLikeKeypad } from "./sensitive.ts";

const clip = process.argv[2];
const fps = Number(process.argv[3] ?? 2);
if (!clip) throw new Error("usage: scan-frames.ts <clip> [fps]");
const dir = join(import.meta.dirname, "..", "footage", "_frames", clip);
const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
const { W, H } = jpegSize(readFileSync(join(dir, files[0]!)));
const ocr = await ocrPool();

const frames = await Promise.all(
  files.map(async (f, i) => {
    const lines = await ocr.lines(join(dir, f), W, H);
    const hash = createHash("sha256").update(lines.map((l) => l.text).join("\n")).digest("hex").slice(0, 10);
    return { t: i / fps, hash, words: lines.length, keypad: looksLikeKeypad(lines), hits: classify(lines) };
  }),
);
await ocr.terminate();
writeFileSync(join(dir, "..", `${clip}.scan.json`), JSON.stringify({ clip, fps, frames }));
console.log(`${clip}: ${frames.length} frames, ${frames.filter((f) => f.hits.length || f.keypad).length} flagged`);
