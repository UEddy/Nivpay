import { useDictionary } from "../copy.ts";
import { readPick, resolveLanguage, setLanguage, writePick, type Lang, type Resolved } from "../lib/locale.ts";
import type { Dictionary } from "./en.ts";

/**
 * Chooses the language once, before any screen loads (main.tsx), so every
 * module that reads `copy` or formats a date reads the same one. Only the
 * language in use is downloaded; English needs nothing.
 *
 * The app follows the phone: when its languages change, the app reloads into
 * the new one, unless the person picked one in Account details. A reload is
 * safe at any moment: a request in flight is saved on the phone and picked up
 * again.
 */
const LOADERS: Record<Exclude<Lang, "en">, () => Promise<Dictionary>> = {
  fr: () => import("./fr.ts").then((m) => m.fr),
  es: () => import("./es.ts").then((m) => m.es),
  pt: () => import("./pt.ts").then((m) => m.pt),
};

const ENGLISH: Resolved = { lang: "en", numberLocale: "en-US", dateLocale: "en-GB" };

function picked(): Lang | null {
  try {
    return readPick(localStorage);
  } catch {
    return null;
  }
}

const phoneLanguages = () => (navigator.languages?.length ? navigator.languages : [navigator.language ?? "en"]);

export async function startLanguage(): Promise<Resolved> {
  let chosen = resolveLanguage(phoneLanguages(), picked());
  if (chosen.lang !== "en") {
    try {
      useDictionary(await LOADERS[chosen.lang]());
    } catch {
      // The words couldn't load (offline on a first visit): English, whole, rather than half a language.
      chosen = ENGLISH;
    }
  }
  setLanguage(chosen);
  document.documentElement.lang = chosen.lang === "en" ? "en" : chosen.dateLocale;
  window.addEventListener("languagechange", () => {
    const next = resolveLanguage(phoneLanguages(), picked());
    if (next.lang !== chosen.lang || next.numberLocale !== chosen.numberLocale) location.reload();
  });
  return chosen;
}

/** Picks a language in Account details, or null to follow the phone again, and reloads into it. */
export function pickLanguage(lang: Lang | null): void {
  try {
    writePick(localStorage, lang);
  } catch {
    return;
  }
  location.reload();
}
