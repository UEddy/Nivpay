/**
 * Where things sit on the pot map (viewBox 342 x 232, docs/design/README.md).
 * Three people and two payees land exactly on the comps' positions and
 * routes. Other counts use more slots around the pot for people and an even
 * column on the right for payees. Past what fits, the rest are counted, not
 * drawn, to keep the map under about 60 elements.
 */

export const VIEW = { width: 342, height: 232 } as const;
export const POT = { x: 118, y: 66, size: 96 } as const;

export type Anchor = "start" | "middle";

export type PersonSpot = {
  x: number;
  y: number;
  /** Quadratic route from the city into the pot. */
  route: string;
  label: { x: number; y: number; anchor: Anchor };
};

export type PayeeSpot = {
  x: number;
  y: number;
  /** Quadratic route from the pot out to the payee. */
  route: string;
  label: { x: number; y: number };
};

// The first three are the comps' London, Houston and Uyo, in join order.
const PERSON_SPOTS: PersonSpot[] = [
  { x: 236, y: 30, route: "M236 30 Q224 58 180 78", label: { x: 254, y: 27, anchor: "start" } },
  { x: 38, y: 96, route: "M38 96 Q80 52 131 112", label: { x: 38, y: 121, anchor: "middle" } },
  // One line lower than the comp's (201), so a city longer than "Uyo" clears the second payee's "up to" line at the same height.
  { x: 214, y: 204, route: "M214 204 Q206 170 182 153", label: { x: 233, y: 214, anchor: "start" } },
  { x: 52, y: 182, route: "M52 182 Q100 186 136 146", label: { x: 52, y: 207, anchor: "middle" } },
  { x: 112, y: 26, route: "M112 26 Q142 34 150 72", label: { x: 128, y: 23, anchor: "start" } },
];

export const MAX_DRAWN_PEOPLE = PERSON_SPOTS.length;
export const MAX_DRAWN_PAYEES = 3;

/** The comps' two payee routes, kept exact. */
const TWO_PAYEES: PayeeSpot[] = [
  { x: 304, y: 92, route: "M201 114 Q248 80 290 92", label: { x: 304, y: 120 } },
  { x: 304, y: 160, route: "M199 131 Q246 158 290 160", label: { x: 304, y: 188 } },
];

function payeeAt(y: number): PayeeSpot {
  // The route leaves the pot's right side a little above or below its middle,
  // and bows the same way the comps' routes do.
  const startY = Math.round(122 + (y - 126) * 0.25);
  const control = y <= 126 ? y - 12 : y - 2;
  return { x: 304, y, route: `M200 ${startY} Q247 ${control} 290 ${y}`, label: { x: 304, y: y + 28 } };
}

export function personSpots(count: number): PersonSpot[] {
  return PERSON_SPOTS.slice(0, Math.max(0, Math.min(count, MAX_DRAWN_PEOPLE)));
}

export function payeeSpots(count: number): PayeeSpot[] {
  const n = Math.max(0, Math.min(count, MAX_DRAWN_PAYEES));
  if (n === 2) return TWO_PAYEES;
  if (n === 1) return [payeeAt(126)];
  if (n === 3) return [payeeAt(40), payeeAt(112), payeeAt(184)];
  return [];
}

/** Draws the same quadratic in the other direction, for things leaving the pot. */
export function reverseRoute(route: string): string {
  const m = /^M(-?[\d.]+) (-?[\d.]+) Q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/.exec(route);
  if (!m) throw new Error(`not a quadratic route: ${route}`);
  const [, x0, y0, cx, cy, x1, y1] = m;
  return `M${x1} ${y1} Q${cx} ${cy} ${x0} ${y0}`;
}

/** The comps' people colours, then more from the same earthy family, differing in lightness. */
export const PERSON_COLORS = [
  { fill: "var(--person-1)", route: "var(--person-1)", text: "var(--person-1)" },
  { fill: "var(--person-2)", route: "var(--person-2)", text: "var(--person-2)" },
  { fill: "var(--person-3)", route: "var(--person-3-route)", text: "var(--person-3-text)" },
  { fill: "var(--person-4)", route: "var(--person-4)", text: "var(--person-4)" },
  { fill: "var(--person-5)", route: "var(--person-5)", text: "var(--person-5)" },
] as const;
