// Makes app/src/data/world-land.json and world-cities.json, the pot map's world (README, "Third-party code and licenses"):
//  * land: Natural Earth's 110m land outlines (public domain), simplified (Douglas-Peucker, 0.5 degrees),
//    without Antarctica and islands too small to see, as SVG paths in tenths of a degree (x = longitude,
//    y = minus latitude), so the app can scale them to any part of the world;
//  * cities: the cities of 100,000 people or more from src/data/cities.json, for turning a city's name
//    into a place on the map: [name, country, latitude x 100, longitude x 100];
//  * zones: each time zone this Node knows, at the city it is named after, for people with no city.
//
// node scripts/make_world.mjs <ne_110m_land.geojson>
import { readFileSync, writeFileSync } from "node:fs";

const TOLERANCE = 0.5;
const MIN_AREA = 6; // square degrees of bounding box

const land = JSON.parse(readFileSync(process.argv[2], "utf8"));
const cities = JSON.parse(readFileSync(new URL("../src/data/cities.json", import.meta.url), "utf8"));

function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > far) {
        far = d;
        at = i;
      }
    }
    if (far > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const paths = [];
for (const f of land.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    const ring = poly[0];
    const lats = ring.map((p) => p[1]);
    const lons = ring.map((p) => p[0]);
    if (Math.min(...lats) < -60) continue; // Antarctica
    if ((Math.max(...lons) - Math.min(...lons)) * (Math.max(...lats) - Math.min(...lats)) < MIN_AREA) continue;
    // A ring ends where it starts: simplify it as two halves, split at the point farthest from its start.
    let split = 1;
    for (let i = 1; i < ring.length; i++) if (Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]) > Math.hypot(ring[split][0] - ring[0][0], ring[split][1] - ring[0][1])) split = i;
    const s = [...simplify(ring.slice(0, split + 1), TOLERANCE).slice(0, -1), ...simplify(ring.slice(split), TOLERANCE)];
    if (s.length < 4) continue;
    const pts = s.map(([lon, lat]) => [Math.round(lon * 10), Math.round(-lat * 10)]);
    paths.push("M" + pts.map((p) => p.join(" ")).join("L") + "Z");
  }
}

const big = cities.filter((c) => c[4] >= 100).map((c) => [c[0], c[1], c[2], c[3]]);

// Zones a phone may report under another name than this Node's list, and zone cities spelled otherwise in GeoNames.
const MORE_ZONES = ["Asia/Kolkata", "Asia/Calcutta", "Asia/Ho_Chi_Minh", "Asia/Saigon", "Europe/Kyiv", "Europe/Kiev", "Asia/Yangon", "Asia/Rangoon", "Asia/Kathmandu", "Asia/Katmandu", "America/Argentina/Buenos_Aires", "America/Buenos_Aires", "America/Nuuk", "America/Godthab", "Atlantic/Faroe", "Asia/Thimphu", "Asia/Dhaka", "Asia/Ulaanbaatar", "America/Indiana/Indianapolis", "America/Kentucky/Louisville"];
const SPELLED = { Calcutta: "Kolkata", Saigon: "Ho Chi Minh City", Kiev: "Kyiv", Rangoon: "Yangon", Katmandu: "Kathmandu", Godthab: "Nuuk", Faeroe: "Tórshavn", Faroe: "Tórshavn", Thimbu: "Thimphu", Dacca: "Dhaka", "Ulan Bator": "Ulaanbaatar", "Ho Chi Minh": "Ho Chi Minh City", "New York": "New York City", Kuwait: "Kuwait City", Panama: "Panama City", Bahrain: "Manama", Qatar: "Doha", Brunei: "Bandar Seri Begawan", "El Salvador": "San Salvador", Guatemala: "Guatemala City", Malta: "Valletta", Tirane: "Tirana", Asmera: "Asmara", Ndjamena: "N'Djamena", "St Johns": "St. John's", Cordoba: "Córdoba", Busingen: "Büsingen am Hochrhein", Urumqi: "Ürümqi" };
const fold = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const zones = {};
for (const z of new Set([...Intl.supportedValuesOf("timeZone"), ...MORE_ZONES])) {
  const raw = z.split("/").pop().replace(/_/g, " ");
  const name = SPELLED[raw] ?? raw;
  const hit = cities.find((c) => c[0] === name) ?? cities.find((c) => fold(c[0]) === fold(name));
  if (hit) zones[z] = [hit[2], hit[3]];
}

// The land and the zones come with the map; the cities load when a city has to be found.
writeFileSync(new URL("../src/data/world-land.json", import.meta.url), JSON.stringify({ land: paths, zones }));
writeFileSync(new URL("../src/data/world-cities.json", import.meta.url), JSON.stringify(big));
console.log(`${paths.length} land paths, ${paths.join("").length} characters; ${big.length} cities; ${Object.keys(zones).length} zones`);
