import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cityPlace, fold, placeOf, routeInto, worldLayout, WHOLE_WORLD, type CityRow, type Place, type Zones } from "./worldmap.ts";
import { personSpots, reverseRoute, VIEW } from "./potmap.ts";

const land = JSON.parse(readFileSync(new URL("../data/world-land.json", import.meta.url), "utf8")) as { land: string[]; zones: Zones };
const cities = JSON.parse(readFileSync(new URL("../data/world-cities.json", import.meta.url), "utf8")) as CityRow[];
const P = (name: string, country?: string): Place => cityPlace(cities, name, country)!;
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
