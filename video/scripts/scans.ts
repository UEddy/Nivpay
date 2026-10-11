import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanHit } from "../src/redactions.ts";

const root = join(import.meta.dirname, "..");

/** A clip's frame scan as hits (categories and boxes only), or null when it has none on this PC. */
export function scanHits(clip: string): ScanHit[] | null {
  const f = join(root, "footage", "_scans", `${clip}.scan.json`);
  if (!existsSync(f)) return null;
  const scan = JSON.parse(readFileSync(f, "utf8"));
  return scan.frames.flatMap((fr: { t: number; hits: { category: string; box: ScanHit["box"] }[]; keypad: boolean }) => [
    ...fr.hits.map((h) => ({ t: fr.t, category: h.category, box: h.box })),
    ...(fr.keypad ? [{ t: fr.t, category: "PIN or password entry", box: { x: 0, y: 0.5, w: 1, h: 0.5 } }] : []),
  ]);
}
