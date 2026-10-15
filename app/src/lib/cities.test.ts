import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import { cityLabel, distanceKm, fold, nearestCity, searchCities, type City } from "./cities.ts";
import { CityChoices, keyFromFragment, open, readCities, seal } from "./cityShare.ts";

const LIST: City[] = [
  ["Lagos", "NG", 645, 339, 15388],
  ["Houston", "US", 2976, -9536, 2314],
  ["São Paulo", "BR", -2355, -4664, 12400],
  ["Uyo", "NG", 505, 793, 436],
  ["Hounslow", "GB", 5147, -36, 103],
];

test("the nearest city to a position, which is used for nothing else", () => {
  assert.equal(nearestCity(LIST, 5.03, 7.92)?.[0], "Uyo");
  assert.equal(nearestCity(LIST, 29.8, -95.4)?.[0], "Houston");
  assert.equal(nearestCity([], 0, 0), null);
  assert.ok(Math.abs(distanceKm(6.45, 3.39, 5.05, 7.93) - 524) < 15, "Lagos to Uyo is about 520 km");
});

test("search by what was typed, accents or not, biggest first", () => {
  assert.deepEqual(searchCities(LIST, "hou").map((c) => c[0]), ["Houston", "Hounslow"]);
  assert.deepEqual(searchCities(LIST, "sao p").map((c) => c[0]), ["São Paulo"]);
  assert.deepEqual(searchCities(LIST, "y"), [], "two letters at least");
  assert.deepEqual(searchCities(LIST, "ago").map((c) => c[0]), ["Lagos"], "a name containing it, after those starting with it");
  assert.equal(fold("  ÉVORA "), "evora");
});

test("a city with its country in the reader's language", () => {
  assert.equal(cityLabel("Houston", "US", "en-US"), "Houston, United States");
  assert.equal(cityLabel("Houston", "US", "fr-FR"), "Houston, États-Unis");
  assert.equal(cityLabel("Uyo", "NG", "pt-BR"), "Uyo, Nigéria");
});

test("the bundled list is GeoNames, trimmed: no position finer than a city, no dashes", () => {
  const all = JSON.parse(readFileSync(new URL("../data/cities.json", import.meta.url), "utf8")) as City[];
  assert.ok(all.length > 30_000, `${all.length} cities`);
  for (const c of all.slice(0, 2000)) {
    assert.equal(c.length, 5);
    assert.ok(Number.isInteger(c[2]) && Number.isInteger(c[3]), "positions to 0.01 degrees, stored as whole numbers");
    assert.match(c[1], /^[A-Z]{2}$/);
  }
  assert.ok(all.some((c) => c[0] === "Uyo" && c[1] === "NG"));
});

const ME = getAddress("0x1A9A136f1cf59899C6b8cfE84ac4df388620467d");
const OTHER = getAddress("0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1");
const FRAGMENT = "AgEABQ.example-pot-link-fragment";

test("only someone with the pot's link can read a city", async () => {
  const key = (await keyFromFragment(FRAGMENT))!;
  const sealed = await seal(key, { account: ME, city: "Houston", country: "US", at: 5 });
  assert.deepEqual(await open(key, sealed, ME), { account: ME, city: "Houston", country: "US", at: 5 });
  assert.equal(await open((await keyFromFragment(FRAGMENT + "x"))!, sealed, ME), null, "another pot's link reads nothing");
  assert.equal(await keyFromFragment(""), null, "a pot opened with no link has no key");
  const tampered = sealed.slice();
  tampered[20] = tampered[20]! ^ 1;
  assert.equal(await open(key, tampered, ME), null);
  assert.equal(await open(key, sealed, OTHER), null, "a server can't move one person's city to another");
  const read = await readCities(key, [{ account: ME, data: sealed }, { account: OTHER, data: sealed }]);
  assert.deepEqual(Object.keys(read), [ME.toLowerCase()]);
});

test("the plain text never holds a position", async () => {
  const key = (await keyFromFragment(FRAGMENT))!;
  const sealed = await seal(key, { account: ME, city: "Uyo", country: "NG", at: 1 });
  assert.ok(sealed.length < 200, "a city and a country, nothing more");
});

test("each pot's offer and share are kept per account on this phone", () => {
  const m = new Map<string, string>();
  const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  const c = new CityChoices(kv, "ausd", ME);
  assert.deepEqual(c.get("4"), { asked: false, shared: null });
  c.set("4", { asked: true, shared: { city: "Uyo", country: "NG" } });
  assert.deepEqual(c.get("4").shared, { city: "Uyo", country: "NG" });
  assert.deepEqual(new CityChoices(kv, "ausd", OTHER).get("4"), { asked: false, shared: null });
});
