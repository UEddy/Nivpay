import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { between, canZoom, cityPlace, fold, labelOffsets, landCopies, lonUnderPot, movedLayout, needsMore, placeOf, routeInto, settleView, worldLayout, WHOLE_WORLD, zoomAt, ZOOM_MAX, ZOOM_MIN, type CityRow, type Place, type Zones } from "./worldmap.ts";
import { personSpots, reverseRoute, VIEW } from "./potmap.ts";

const land = JSON.parse(readFileSync(new URL("../data/world-land.json", import.meta.url), "utf8")) as { land: string[]; zones: Zones };
const cities = JSON.parse(readFileSync(new URL("../data/world-cities.json", import.meta.url), "utf8")) as CityRow[];
const P = (name: string, country?: string): Place => cityPlace(cities, name, country)!;
// Every city one can choose or be found in (lib/cities.ts): the map's fallback.
const more = JSON.parse(readFileSync(new URL("../data/cities.json", import.meta.url), "utf8")) as CityRow[];
const LONDON = P("London", "GB");
const LAGOS = P("Lagos", "NG");
const HOUSTON = P("Houston", "US");
const NAIROBI = P("Nairobi", "KE");
const TOKYO = P("Tokyo", "JP");

const POT = { x: 166, y: 114 };
const insidePot = (x: number, y: number) => ((x - POT.x) / 60) ** 2 + ((y - POT.y) / 58) ** 2 < 1;

test("the bundled world: land outlines, big cities, and time zones at their cities", () => {
  assert.ok(land.land.length > 30 && land.land.join("").length < 20_000, "small enough to come with the map");
  for (const d of land.land) assert.match(d, /^M-?\d+ -?\d+(L-?\d+ -?\d+)+Z$/);
  assert.ok(cities.length > 5000);
  assert.ok(Math.abs(LAGOS.lat - 6.45) < 0.3 && Math.abs(LAGOS.lon - 3.39) < 0.3, "Lagos, Nigeria, not Portugal");
  for (const z of ["Europe/London", "Africa/Lagos", "America/Chicago", "America/New_York", "Asia/Kolkata", "Asia/Calcutta", "America/Sao_Paulo", "Africa/Nairobi", "Asia/Tokyo"]) assert.ok(land.zones[z], z);
});

test("a place comes from the shared city, else the link's city, else the time zone, else nowhere", () => {
  const t = { cities, zones: land.zones };
  assert.deepEqual(placeOf(t, { shared: { city: "Uyo", country: "NG" }, city: "London", timeZone: "Europe/London" }), P("Uyo", "NG"));
  assert.deepEqual(placeOf(t, { city: "  são paulo ", timeZone: "Europe/London" }), P("São Paulo", "BR"));
  assert.deepEqual(placeOf(t, { city: "Houston, Texas" }), HOUSTON);
  assert.deepEqual(placeOf(t, { city: "Somewhere I made up", timeZone: "Africa/Nairobi" }), { lat: land.zones["Africa/Nairobi"]![0] / 100, lon: land.zones["Africa/Nairobi"]![1] / 100 });
  assert.equal(placeOf(t, { city: "Somewhere I made up", timeZone: "UTC" }), null);
  assert.deepEqual(placeOf({ cities: null, zones: land.zones }, { city: "Houston", timeZone: "America/Chicago" }), { lat: land.zones["America/Chicago"]![0] / 100, lon: land.zones["America/Chicago"]![1] / 100 }, "before the cities load, the zone");
  assert.equal(fold("Ẹ̀kọ́ Lagos!"), "ekolagos");
});

test("nobody placed: the usual spots, the world behind", () => {
  const { spots, view } = worldLayout([null, null, null], 2);
  assert.deepEqual(spots, personSpots(3));
  assert.deepEqual(view, WHOLE_WORLD);
});

const cases: [string, (Place | null)[], number][] = [
  ["London, Houston, Nairobi, two payees", [LONDON, HOUSTON, NAIROBI], 2],
  ["London, Lagos, no payees", [LONDON, LAGOS], 0],
  ["one person", [LAGOS], 1],
  ["three in one city", [LONDON, LONDON, LONDON], 2],
  ["five, one unknown", [LONDON, LAGOS, null, TOKYO, HOUSTON], 3],
  ["Tokyo and Houston", [TOKYO, HOUSTON], 1],
];

for (const [name, places, payees] of cases) {
  test(`${name}: everyone on the map, clear of the pot, apart, with a route into the pot`, () => {
    const { spots, view } = worldLayout(places, payees);
    assert.equal(spots.length, places.length);
    for (const s of spots) {
      assert.ok(s.x >= 11 && s.x <= VIEW.width - 11 && s.y >= 11 && s.y <= VIEW.height - 11, `${s.x},${s.y} on the map`);
      assert.ok(!insidePot(s.x, s.y), `${s.x},${s.y} clear of the pot`);
      if (payees > 0) assert.ok(s.x <= 275, `${s.x} clear of the payees`);
      assert.ok(s.label.y + 13 <= VIEW.height && s.label.y >= 8, `label ${s.label.y}`);
      assert.equal(reverseRoute(reverseRoute(s.route)), s.route);
    }
    for (let a = 0; a < spots.length; a++) for (let b = a + 1; b < spots.length; b++) assert.ok(Math.hypot(spots[a]!.x - spots[b]!.x, spots[a]!.y - spots[b]!.y) >= 26, `${a} and ${b} apart`);
    assert.ok(view.k >= 0.85 && view.k <= 4);
  });
}

test("on the map, places keep their order: London north of Lagos, Houston west of both", () => {
  const { spots } = worldLayout([LONDON, LAGOS, HOUSTON], 2);
  const [london, lagos, houston] = spots;
  assert.ok(london!.y < lagos!.y, "north is up");
  assert.ok(houston!.x < london!.x && houston!.x < lagos!.x, "west is left");
});

test("a person far from others sits at their city on the drawn world", () => {
  const places = [LONDON, HOUSTON, NAIROBI];
  const { spots, view } = worldLayout(places, 2);
  places.forEach((p, i) => {
    const x = view.tx + p.lon * view.k;
    const y = view.ty - p.lat * view.k;
    assert.ok(Math.hypot(spots[i]!.x - x, spots[i]!.y - y) < 3, `${i}: ${spots[i]!.x},${spots[i]!.y} vs ${x.toFixed(0)},${y.toFixed(0)}`);
  });
});

test("routes end at the pot's rim", () => {
  const r = routeInto(40, 60);
  const end = r.split(" ").slice(-2).map(Number);
  assert.ok(Math.abs(Math.hypot(end[0]! - 166, end[1]! - 114) - 34) < 1.5, r);
});

test("labels sit clear of the pot, its amount and one another", () => {
  const POT_BOX = { x0: 128, y0: 70, x1: 204, y1: 162 };
  const AMOUNT_BOX = { x0: 126, y0: 164, x1: 206, y1: 197 };
  type B = typeof POT_BOX;
  const area = (a: B, b: B) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  for (const [name, places, payees] of cases) {
    const widths = places.map(() => 64);
    const { spots } = worldLayout(places, payees, widths);
    const boxes = spots.map((s, i) => ({ x0: s.label.x - widths[i]! / 2, y0: s.label.y - 12, x1: s.label.x + widths[i]! / 2, y1: s.label.y + 18 }));
    boxes.forEach((b, i) => {
      assert.ok(area(b, POT_BOX) < 120, `${name}: label ${i} on the pot`);
      assert.ok(area(b, AMOUNT_BOX) < 120, `${name}: label ${i} on the amount`);
      assert.ok(b.x0 >= 0 && b.x1 <= VIEW.width && b.y0 >= 0 && b.y1 <= VIEW.height, `${name}: label ${i} on the map`);
      for (let j = i + 1; j < boxes.length; j++) assert.ok(area(b, boxes[j]!) < 150, `${name}: labels ${i} and ${j} overlap`);
    });
  }
});

const NEW_YORK = P("New York City", "US");
const TORONTO = P("Toronto", "CA");
const MEXICO = P("Mexico City", "MX");
const BUENOS_AIRES = P("Buenos Aires", "AR");
const ABUJA = P("Abuja", "NG");
const where = (v: { k: number; tx: number; ty: number }, p: Place) => ({ x: v.tx + p.lon * v.k, y: v.ty - p.lat * v.k });

test("moved by hand: everyone at their city, the Americas brought out from under the pot", () => {
  const places = [LAGOS, NEW_YORK, TORONTO, MEXICO, BUENOS_AIRES];
  // Zoomed out to the whole world, the pot over the Atlantic covers some of them.
  const whole = settleView({ ...WHOLE_WORLD });
  // Dragged left until the Americas sit left of the pot (Lagos goes under it).
  const dragged = settleView({ ...whole, tx: whole.tx - 70 });
  const spots = movedLayout(dragged, places, 2);
  spots.forEach((s, i) => {
    const q = where(dragged, places[i]!);
    if (i > 0) assert.ok(!s.under, `${i}: ${s.x},${s.y} shows`);
    assert.ok(Math.hypot(s.x - q.x, s.y - q.y) < 41, `${i}: near its city`);
  });
  assert.ok(spots[3]!.y < spots[4]!.y && spots[1]!.y < spots[3]!.y, "north is up");
});

test("moved by hand: the pot covers someone dragged under it, and nobody is pushed off it", () => {
  const v = settleView({ k: 3, tx: 166 - 3.39 * 3, ty: 114 + 6.45 * 3 });
  const [lagos] = movedLayout(v, [LAGOS], 0);
  assert.ok(Math.hypot(lagos!.x - 166, lagos!.y - 114) < 2 && lagos!.under, "Lagos under the pot");
  const off = settleView({ ...v, tx: v.tx + 600 });
  assert.ok(movedLayout(off, [LAGOS], 0)[0]!.under, "past the edge, hidden");
});

test("zooming in brings two people in one country apart, about the point kept still", () => {
  const places = [LAGOS, ABUJA];
  const v0 = settleView({ k: 1.7, tx: 60, ty: 120 });
  const [a0, b0] = places.map((p) => where(v0, p));
  const v1 = zoomAt(v0, 4, a0!.x, a0!.y);
  const [a1, b1] = places.map((p) => where(v1, p));
  assert.ok(Math.hypot(a1!.x - a0!.x, a1!.y - a0!.y) < 0.5, "the point zoomed on stays put");
  assert.ok(Math.hypot(a1!.x - b1!.x, a1!.y - b1!.y) > 3.5 * Math.hypot(a0!.x - b0!.x, a0!.y - b0!.y));
  const spots = movedLayout(v1, places, 0);
  assert.ok(Math.hypot(spots[0]!.x - spots[1]!.x, spots[0]!.y - spots[1]!.y) >= 39, "apart");
});

test("the zoom stops at the whole world and at two towns apart; the buttons know", () => {
  assert.equal(zoomAt(WHOLE_WORLD, 0.1, 166, 114).k, ZOOM_MIN);
  const deep = zoomAt(WHOLE_WORLD, 1000, 166, 114);
  assert.equal(deep.k, ZOOM_MAX);
  assert.ok(!canZoom(deep, 2) && canZoom(deep, 0.5) && !canZoom(zoomAt(WHOLE_WORLD, 0.1, 166, 114), 0.5));
});

test("east and west wrap round; north and south stop", () => {
  const v = settleView({ k: 2, tx: 166 - 179 * 2, ty: 114 });
  const across = settleView({ ...v, tx: v.tx - 10 });
  assert.ok(Math.abs(lonUnderPot(across) - -176) < 1e-6, "past 180 east is the far west");
  assert.deepEqual(landCopies(across), { west: true, east: false });
  // Tokyo on the copy of the world nearest the pot: just west of it, not a world away.
  const [tokyo] = movedLayout(settleView({ k: 2, tx: 166 - -170 * 2, ty: 114 + 35 * 2 }), [TOKYO], 0);
  assert.ok(tokyo!.x < 166 && tokyo!.x > 0, `${tokyo!.x}`);
  assert.ok(settleView({ k: 2, tx: 0, ty: 114 + 89 * 2 }).ty < 114 + 70 * 2, "not up into the Arctic");
});

test("going back to everyone takes the short way round, and ends where the map framed them", () => {
  const a = settleView({ k: 2, tx: 166 - 170 * 2, ty: 114 });
  const b = settleView({ k: 1, tx: 166 - -170 * 1, ty: 114 });
  const half = between(a, b, 0.5);
  assert.ok(Math.abs(lonUnderPot(half)) > 170, "through the 180 line, not across Africa");
  assert.deepEqual(between(a, b, 1), b, "ends on it exactly, not a world along");
  const start = between(a, b, 0);
  assert.ok(Math.abs(start.k - a.k) < 1e-9 && Math.abs(Math.abs(start.tx - a.tx) % (360 * a.k)) < 1e-6, "starts on the same picture");
});

test("while dragging, labels ride with their people", () => {
  const v = settleView({ k: 2, tx: 60, ty: 120 });
  const still = movedLayout(v, [LONDON, LAGOS], 0, [64, 64]);
  const follow = labelOffsets(still);
  const moved = movedLayout(settleView({ ...v, tx: v.tx + 15 }), [LONDON, LAGOS], 0, [64, 64], follow);
  moved.forEach((s, i) => {
    assert.equal(s.label.x - s.x, follow[i]!.dx);
    assert.equal(s.label.y - s.y, follow[i]!.dy);
  });
});

test("a chosen town sits where it is, in its own country, not at its time zone's city", () => {
  const t = { cities, more, zones: land.zones };
  const at = (name: string, country: string) => {
    const r = more.find((c) => c[0] === name && c[1] === country)!;
    return { lat: r[2] / 100, lon: r[3] / 100 };
  };
  // Dschang, Cameroon, and Niagara Falls, Canada: on the full list only.
  for (const [name, country, zone] of [["Dschang", "CM", "Africa/Douala"], ["Niagara Falls", "CA", "America/Toronto"]] as const) {
    assert.equal(cityPlace(cities, name, country), null, `${name} is not a big city`);
    const who = { shared: { city: name, country }, timeZone: zone };
    assert.equal(needsMore(cities, who), true);
    assert.deepEqual(placeOf(t, who), at(name, country));
    assert.deepEqual(placeOf({ cities, zones: land.zones }, who), placeOf({ cities: null, zones: land.zones }, who), "until the full list loads, the time zone");
  }
  // Lagos, Portugal, shared: never Lagos, Nigeria, though the big list has only Nigeria's.
  const algarve = { shared: { city: "Lagos", country: "PT" }, timeZone: "Europe/Lisbon" };
  assert.equal(cityPlace(cities, "Lagos", "PT"), null);
  assert.equal(needsMore(cities, algarve), true);
  assert.deepEqual(placeOf(t, algarve), at("Lagos", "PT"));
  // A town typed into the link, with no country: the full list, the biggest of that name.
  assert.deepEqual(placeOf(t, { city: "Dschang", timeZone: "UTC" }), at("Dschang", "CM"));
  // The country can come with the city too, as the map is told after someone shares theirs on the pot screen.
  assert.deepEqual(placeOf(t, { city: "Lagos", country: "PT" }), at("Lagos", "PT"));
  // A big city needs nothing more, and someone with no city needs nothing at all.
  assert.equal(needsMore(cities, { shared: { city: "Uyo", country: "NG" } }), false);
  assert.equal(needsMore(cities, { city: "London" }), false);
  assert.equal(needsMore(cities, { timeZone: "Europe/London" }), false);
});
