/** Prints each clip's OCR hits as time ranges per category with their union box. Categories and numbers only. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const dir = join(import.meta.dirname, "..", "footage", "_frames");
for (const f of readdirSync(dir).filter((f) => f.endsWith(".scan.json")).sort()) {
  const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
  type R = { cat: string; t0: number; t1: number; x0: number; y0: number; x1: number; y1: number };
  const open = new Map<string, R>();
  const out: R[] = [];
  for (const fr of s.frames) {
    const here = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
    const cats = fr.hits.map((h: any) => ({ ...h, category: h.box.y + h.box.h < 0.045 ? `${h.category} (status bar)` : h.category }));
    if (fr.keypad) cats.push({ category: "keypad", box: { x: 0, y: 0.5, w: 1, h: 0.5 } });
    for (const h of cats) {
      const b = here.get(h.category) ?? { x0: 1, y0: 1, x1: 0, y1: 0 };
      b.x0 = Math.min(b.x0, h.box.x); b.y0 = Math.min(b.y0, h.box.y);
      b.x1 = Math.max(b.x1, h.box.x + h.box.w); b.y1 = Math.max(b.y1, h.box.y + h.box.h);
      here.set(h.category, b);
    }
    for (const [cat, r] of open) if (!here.has(cat) && fr.t - r.t1 > 1.0) { out.push(r); open.delete(cat); }
    for (const [cat, b] of here) {
      const r = open.get(cat);
      if (r) { r.t1 = fr.t; r.x0 = Math.min(r.x0, b.x0); r.y0 = Math.min(r.y0, b.y0); r.x1 = Math.max(r.x1, b.x1); r.y1 = Math.max(r.y1, b.y1); }
      else open.set(cat, { cat, t0: fr.t, t1: fr.t, ...b });
    }
  }
  out.push(...open.values());
  out.sort((a, b) => a.t0 - b.t0);
  console.log(`== ${s.clip}`);
  for (const r of out) console.log(`  ${r.cat.padEnd(32)} ${r.t0.toFixed(1)}-${r.t1.toFixed(1)}  y ${r.y0.toFixed(2)}-${r.y1.toFixed(2)} x ${r.x0.toFixed(2)}-${r.x1.toFixed(2)}`);
}
