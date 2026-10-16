import { personSpots, type PersonSpot } from "./potmap.ts";

/**
 * The pot map's world (screens/PotMap.tsx): each person at their city on a
 * map of the world, the pot and the payees where they always are.
 *
 * Where someone is comes, in order, from the city they shared with the pot
 * (lib/cityShare.ts), the city written in the pot's link, then the time zone
 * their phone gave when they joined. Never a position: a city's own place,
 * from the bundled list (src/data/world-cities.json, cities of 100,000
 * people or more), or a time zone's city (src/data/world-land.json). Someone
 * with none of these isn't put anywhere they may not be: they sit in one of
 * the map's usual spots.
 *
 * The world is drawn in plate carree (x = longitude, y = minus latitude),
 * scaled and moved so everyone placed is on the map and clear of the pot,
 * its amount, the payees and the badge, and as far in as the map allows.
 * Two people in one city sit side by side.
 */

export type Place = { lat: number; lon: number };
export type CityRow = [name: string, country: string, lat100: number, lon100: number];
export type Zones = Record<string, [lat100: number, lon100: number]>;

/** A city or a place written as text, folded so "São Paulo", "sao paulo" and "SAO PAULO" match. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** The biggest city with this name, in this country if one is given ("Lagos", "Lagos, NG" or a shared city). */
export function cityPlace(cities: readonly CityRow[], name: string, country?: string): Place | null {
  const want = fold(name.split(",")[0] ?? "");
  if (!want) return null;
  const hits = cities.filter((c) => fold(c[0]) === want);
  const hit = (country && hits.find((c) => c[1] === country)) || hits[0];
  return hit ? { lat: hit[2] / 100, lon: hit[3] / 100 } : null;
}

export function zonePlace(zones: Zones, zone: string | undefined): Place | null {
  const z = zone ? zones[zone] : undefined;
  return z ? { lat: z[0] / 100, lon: z[1] / 100 } : null;
}

/** Someone's place: their shared city, else the city in the link, else their time zone; null if none is known. */
export function placeOf(t: { cities: readonly CityRow[] | null; zones: Zones }, who: { shared?: { city: string; country: string } | null; city?: string; timeZone?: string }): Place | null {
  if (t.cities && who.shared) {
    const p = cityPlace(t.cities, who.shared.city, who.shared.country);
    if (p) return p;
  }
  if (t.cities && who.city) {
    const p = cityPlace(t.cities, who.city);
    if (p) return p;
  }
  return zonePlace(t.zones, who.timeZone);
}

/** Where the world sits under the map: a point at (lon, lat) is drawn at (tx + lon * k, ty - lat * k). */
export type WorldView = { k: number; tx: number; ty: number };

const POT_C = { x: 166, y: 114 };
const POT_R = { x: 64, y: 62 };
// The amount under the pot, and the room a label beside a dot there would need.
const AMOUNT = { x0: 104, x1: 228, y0: 150, y1: 232 };
const BADGE = { x1: 88, y1: 32 };
const AREA = { x0: 22, y0: 22, y1: 210 };
const MIN_K = 0.9;
const MAX_K = 4;
/** People closer than this get pushed apart. */
const APART = 40;
const LABEL_H = 30;

/**
 * When nobody is placed: the world with the pot over the Atlantic, as in the
 * film, so it covers no continent: the Americas to its left, Europe and
 * Africa to its right.
 */
export const WHOLE_WORLD: WorldView = { k: MIN_K, tx: 166 + 38 * MIN_K, ty: 114 + 18 * MIN_K };

function areaRight(payees: number): number {
  return payees > 0 ? 262 : 320;
}

/** How badly a point sits: 0 is clear of everything. */
function trouble(x: number, y: number, payees: number): number {
  let t = 0;
  const e = ((x - POT_C.x) / POT_R.x) ** 2 + ((y - POT_C.y) / POT_R.y) ** 2;
  if (e < 1) t += 1 + (1 - e) * 2;
  if (x > AMOUNT.x0 && x < AMOUNT.x1 && y > AMOUNT.y0 && y < AMOUNT.y1) t += 1;
  if (x < BADGE.x1 && y < BADGE.y1) t += 1;
  const right = areaRight(payees);
  if (x < AREA.x0) t += 1 + (AREA.x0 - x) / 20;
  if (x > right) t += 1 + (x - right) / 20;
  if (y < AREA.y0) t += 1 + (AREA.y0 - y) / 20;
  if (y > AREA.y1) t += 1 + (y - AREA.y1) / 20;
  return t;
}

const at = (v: WorldView, p: Place) => ({ x: v.tx + p.lon * v.k, y: v.ty - p.lat * v.k });

/** The route from a person into the pot's rim, bowed a little, as on the comps. */
export function routeInto(x: number, y: number): string {
  const dx = POT_C.x - x;
  const dy = POT_C.y - y;
  const d = Math.hypot(dx, dy) || 1;
  const ex = POT_C.x - (dx / d) * 34;
  const ey = POT_C.y - (dy / d) * 34;
  // The control point sits off the straight line, bowing up.
  const mx = (x + ex) / 2 + (dy / d) * 18 * Math.sign(dx || 1);
  const my = (y + ey) / 2 - (Math.abs(dx) / d) * 18;
  const r = (n: number) => Math.round(n);
  return `M${r(x)} ${r(y)} Q${r(mx)} ${r(my)} ${r(ex)} ${r(ey)}`;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** What labels keep clear of: the pot, its amount, the badge, and the payees with theirs. */
function fixedBoxes(payees: number): Box[] {
  const boxes = [
    { x0: 128, y0: 70, x1: 204, y1: 162 },
    { x0: 126, y0: 164, x1: 206, y1: 197 },
    { x0: 0, y0: 0, x1: 88, y1: 32 },
  ];
  if (payees > 0) boxes.push({ x0: 262, y0: 0, x1: VIEW_W, y1: VIEW_H });
  return boxes;
}
const VIEW_W = 342;
const VIEW_H = 232;

/**
 * Each label beside its dot: under it, else above, right or left, whichever
 * covers least of the pot, the payees, the other dots and labels placed
 * before it, and stays on the map. `widths` are the labels' widths.
 */
function placeLabels(points: { x: number; y: number }[], widths: readonly number[], payees: number): PersonSpot["label"][] {
  const fixed = fixedBoxes(payees);
  const dots: Box[] = points.map((p) => ({ x0: p.x - 13, y0: p.y - 13, x1: p.x + 13, y1: p.y + 13 }));
  const boxOf = (l: PersonSpot["label"], w: number): Box => ({ x0: l.x - w / 2, y0: l.y - 12, x1: l.x + w / 2, y1: l.y - 12 + LABEL_H });
  const chosen: (PersonSpot["label"] | null)[] = points.map(() => null);
  const pick = (i: number) => {
    const p = points[i]!;
    const w = widths[i] ?? 70;
    const side = 15 + w / 2;
    const options = [
      { cx: p.x, top: p.y + 12 },
      { cx: p.x, top: p.y - 12 - LABEL_H },
      { cx: p.x + side, top: p.y - LABEL_H / 2 },
      { cx: p.x - side, top: p.y - LABEL_H / 2 },
      { cx: p.x + side - 8, top: p.y + 6 },
      { cx: p.x - side + 8, top: p.y + 6 },
      { cx: p.x + side - 8, top: p.y - 6 - LABEL_H },
      { cx: p.x - side + 8, top: p.y - 6 - LABEL_H },
    ];
    let best = { label: { x: Math.round(p.x), y: Math.round(p.y + 24), anchor: "middle" as const }, cost: Infinity };
    options.forEach((o, n) => {
      const cx = Math.max(w / 2 + 3, Math.min(VIEW_W - w / 2 - 3, o.cx));
      const top = Math.max(3, Math.min(VIEW_H - LABEL_H - 3, o.top));
      const label = { x: Math.round(cx), y: Math.round(top + 12), anchor: "middle" as const };
      const box = boxOf(label, w);
      let cost = n * 5 + Math.hypot(cx - o.cx, top - o.top) * 4;
      for (const f of fixed) cost += overlap(box, f) * 3;
      dots.forEach((d, j) => {
        cost += overlap(box, d) * (j === i ? 10 : 3);
      });
      chosen.forEach((l, j) => {
        if (l && j !== i) cost += overlap(box, boxOf(l, widths[j] ?? 70)) * 8;
      });
      if (cost < best.cost) best = { label, cost };
    });
    chosen[i] = best.label;
  };
  // In order, then once more with everyone's label known.
  for (let i = 0; i < points.length; i++) pick(i);
  for (let i = 0; i < points.length; i++) pick(i);
  return chosen.map((l) => l!);
}

/**
 * Lays out the people: those with a place at it, the world moved to fit;
 * those without in the usual spots that are furthest from everyone placed.
 */
export function worldLayout(places: readonly (Place | null)[], payees: number, widths: readonly number[] = []): { spots: PersonSpot[]; view: WorldView } {
  const shown = places.slice(0, personSpots(places.length).length);
  const known = shown.map((p, i) => ({ p, i })).filter((x): x is { p: Place; i: number } => x.p !== null);
  if (known.length === 0) return { spots: personSpots(shown.length), view: WHOLE_WORLD };

  const lons = known.map((k) => k.p.lon);
  const lats = known.map((k) => k.p.lat);
  const spanLon = Math.max(50, Math.max(...lons) - Math.min(...lons));
  const spanLat = Math.max(30, Math.max(...lats) - Math.min(...lats));
  const right = areaRight(payees);
  // One person alone: their whole continent around them, not one country filling the map.
  const fit = known.length === 1 ? 1.7 : Math.max(MIN_K, Math.min(MAX_K, (right - AREA.x0 - 50) / spanLon, (AREA.y1 - AREA.y0 - 40) / spanLat));
  const midLon = (Math.max(...lons) + Math.min(...lons)) / 2;
  const midLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  // With one person, start them left of the pot rather than on it.
  const goal = known.length === 1 ? { x: 50, y: 100 } : { x: (AREA.x0 + right) / 2, y: (AREA.y0 + AREA.y1) / 2 };

  let best: { view: WorldView; score: number } | null = null;
  for (const k of [fit, fit * 0.8, fit * 0.65].filter((v) => v >= MIN_K * 0.99)) {
    const base = { k, tx: goal.x - midLon * k, ty: goal.y + midLat * k };
    for (let dx = -100; dx <= 100; dx += 10) {
      for (let dy = -80; dy <= 80; dy += 10) {
        const view = { k, tx: base.tx + dx, ty: base.ty + dy };
        let score = Math.hypot(dx, dy) / 40 + (fit - k) / fit;
        for (const { p } of known) {
          const q = at(view, p);
          score += trouble(q.x, q.y, payees) * 100;
        }
        if (!best || score < best.score) best = { view, score };
      }
    }
  }
  const view = best!.view;

  // Placed people at their cities; then the rest in the free spots furthest from them.
  const points: { x: number; y: number }[] = new Array(shown.length);
  for (const { p, i } of known) points[i] = at(view, p);
  const free = personSpots(5).filter((s) => trouble(s.x, s.y, payees) === 0 && !(s.y > 150 && s.x > 110 && s.x < 222));
  for (let i = 0; i < shown.length; i++) {
    if (points[i]) continue;
    const taken = points.filter(Boolean);
    const spot = free
      .map((s) => ({ s, room: Math.min(...taken.map((t) => Math.hypot(t.x - s.x, t.y - s.y)), 999) }))
      .sort((a, b) => b.room - a.room)[0];
    points[i] = spot ? { x: spot.s.x, y: spot.s.y } : { x: 40, y: 60 + i * 30 };
  }
  // People in one city, or very near: pushed apart, a little at a time, then kept clear of the pot.
  for (let round = 0; round < 40; round++) {
    for (let a = 0; a < points.length; a++) {
      for (let b = a + 1; b < points.length; b++) {
        const pa = points[a]!;
        const pb = points[b]!;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let d = Math.hypot(dx, dy);
        if (d >= APART) continue;
        if (d < 0.01) {
          // Same city: side by side, the later one to the right or below.
          dx = Math.cos((b * 2 * Math.PI) / 5);
          dy = Math.sin((b * 2 * Math.PI) / 5);
          d = 1;
        }
        const push = (APART - d) / 2;
        pa.x -= (dx / d) * push;
        pa.y -= (dy / d) * push;
        pb.x += (dx / d) * push;
        pb.y += (dy / d) * push;
      }
    }
    for (const p of points) {
      const e = Math.hypot((p.x - POT_C.x) / POT_R.x, (p.y - POT_C.y) / POT_R.y);
      if (e < 1) {
        const f = 1 / Math.max(e, 0.01);
        p.x = POT_C.x + (p.x - POT_C.x || -1) * f;
        p.y = POT_C.y + (p.y - POT_C.y) * f;
      }
      p.x = Math.max(AREA.x0 - 8, Math.min(areaRight(payees) + 10, p.x));
      p.y = Math.max(AREA.y0 - 6, Math.min(AREA.y1 + 8, p.y));
    }
  }
  const rounded = points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  const labels = placeLabels(rounded, widths, payees);
  const spots = rounded.map(({ x, y }, i) => ({ x, y, route: routeInto(x, y), label: labels[i]! }));
  return { spots, view };
}
