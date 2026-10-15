/**
 * Cities, for "Show where you're chipping in from". A world list from
 * GeoNames (cities of 15,000 people or more, CC BY 4.0, README "Third-party
 * code and licenses"), bundled with the app and loaded only when someone asks
 * for their city, never with the first screen. No outside service is asked
 * anything: the phone's position, at low accuracy, is turned into a city here
 * and then forgotten. Only the city ever leaves the phone, and only for the
 * people in one pot (lib/cityShare.ts).
 *
 * Each row: [name, country code, latitude x 100, longitude x 100, thousands of people], biggest first.
 */
export type City = [name: string, country: string, lat100: number, lon100: number, popK: number];

export async function loadCities(): Promise<City[]> {
  return (await import("../data/cities.json")).default as City[];
}

const RAD = Math.PI / 180;

/** Great-circle distance in km between two points in degrees. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The city nearest a position. The position is used for this and nothing else. */
export function nearestCity(list: readonly City[], lat: number, lon: number): City | null {
  let best: City | null = null;
  let bestKm = Infinity;
  for (const c of list) {
    const km = distanceKm(lat, lon, c[2] / 100, c[3] / 100);
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  }
  return best;
}

/** Lower case, accents off, so "sao paulo" finds São Paulo. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Cities whose name starts with what was typed, then those containing it, biggest first. */
export function searchCities(list: readonly City[], query: string, limit = 8): City[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const starts: City[] = [];
  const contains: City[] = [];
  for (const c of list) {
    const n = fold(c[0]);
    if (n.startsWith(q)) starts.push(c);
    else if (contains.length < limit && n.includes(q)) contains.push(c);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

const regions = new Map<string, Intl.DisplayNames>();
/** "Houston, United States", with the country in the reader's language. */
export function cityLabel(name: string, country: string, locale: string): string {
  let names = regions.get(locale);
  if (!names) regions.set(locale, (names = new Intl.DisplayNames([locale], { type: "region" })));
  let where = country;
  try {
    where = names.of(country) ?? country;
  } catch {
    // An unknown code: show the code.
  }
  return `${name}, ${where}`;
}
