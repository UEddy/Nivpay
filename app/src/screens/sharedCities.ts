import { useEffect, useState } from "react";
import { fetchCities, keyFromFragment, readCities, type SharedCity } from "../lib/cityShare.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";

/**
 * The cities the people in a pot shared with it (lib/cityShare.ts), read with
 * the link's key; none without a link. `reads` goes up to read them again,
 * after this person shares or removes theirs. `enabled` says whether the pot
 * takes cities at all.
 */
export function useSharedCities(fragment: string | undefined, potId: string, reads = 0): { cities: Record<string, SharedCity>; enabled: boolean } {
  const [cities, setCities] = useState<Record<string, SharedCity>>({});
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!fragment) return;
    let live = true;
    void (async () => {
      const key = await keyFromFragment(fragment);
      const found = await fetchCities(DEPLOYMENT, potId);
      if (!live) return;
      setEnabled(found.enabled);
      if (key && found.enabled) {
        const read = await readCities(key, found.entries);
        if (live) setCities(read);
      }
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [fragment, potId, reads]);
  return { cities, enabled };
}

/** A person, at the city they shared with the pot if they did, with its country, for the map. */
export function atSharedCity<P extends { account: string; city: string }>(p: P, shared: Record<string, SharedCity>): P & { country?: string } {
  const s = shared[p.account.toLowerCase()];
  return s ? { ...p, city: s.city, country: s.country } : p;
}
