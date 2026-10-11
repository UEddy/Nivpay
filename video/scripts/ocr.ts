import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { availableParallelism } from "node:os";
import Tesseract from "tesseract.js";
import type { Line } from "./sensitive.ts";

const require = createRequire(import.meta.url);
/** The pinned English data in node_modules: OCR never fetches anything, so no frame or result leaves this PC. */
const langPath = join(dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");

/** A pool of OCR workers that read lines with boxes as fractions of a W x H frame. */
export async function ocrPool(size = Math.max(1, Math.min(6, availableParallelism() - 2))) {
  const scheduler = Tesseract.createScheduler();
  for (let i = 0; i < size; i++) {
    scheduler.addWorker(await Tesseract.createWorker("eng", 1, { langPath, cacheMethod: "none", gzip: true }));
  }
  return {
    /** Lines below minConfidence are dropped; the privacy check passes 0 to keep every guess. */
    async lines(image: string | Buffer, W: number, H: number, minConfidence = 40): Promise<Line[]> {
      const { data } = await scheduler.addJob("recognize", image, {}, { blocks: true });
      const out: Line[] = [];
      for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
        if (l.confidence < minConfidence) continue;
        out.push({ text: l.text.trim(), box: { x: l.bbox.x0 / W, y: l.bbox.y0 / H, w: (l.bbox.x1 - l.bbox.x0) / W, h: (l.bbox.y1 - l.bbox.y0) / H } });
      }
      return out;
    },
    terminate: () => scheduler.terminate(),
  };
}

/** Width and height from a JPEG's start-of-frame marker. */
export function jpegSize(b: Buffer): { W: number; H: number } {
  for (let i = 2; i < b.length; ) {
    const marker = b[i + 1]!;
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { H: b.readUInt16BE(i + 5), W: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("not a JPEG");
}
