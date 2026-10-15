/**
 * Which language the app speaks, and how it writes numbers and dates.
 *
 * The app uses the first language in navigator.languages that it has, or
 * English, unless the person picked one in Account details. The phone's
 * region decides how numbers are written: a Mexican phone (es-MX) writes
 * 10.50, a Spanish one (es-ES) 10,50. Picking a language by hand keeps the
 * phone's region for it if the phone has one, else the language's main form.
 *
 * Amounts are typed and shown the reader's way, because a comma or a point
 * that means the opposite of what the reader expects is a money mistake
 * waiting to happen. Anything ambiguous is refused, never guessed.
 *
 * English keeps exactly what the app always showed: "$1,050.00" and dates
 * like "Thu 31 Dec 2026".
 */

export const LANGS = ["en", "fr", "es", "pt"] as const;
export type Lang = (typeof LANGS)[number];

/** Each language in its own words, for the picker. Never translated. */
export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", fr: "Français", es: "Español", pt: "Português" };

/** The main form of each language, where the phone doesn't say which. */
const MAIN_FORM: Record<Lang, string> = { en: "en-US", fr: "fr-FR", es: "es-ES", pt: "pt-BR" };

export type Resolved = { lang: Lang; numberLocale: string; dateLocale: string };

const isLang = (v: string | null | undefined): v is Lang => (LANGS as readonly string[]).includes(v ?? "");
const primary = (tag: string) => tag.split("-")[0]!.toLowerCase();
function canonical(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

export function resolveLanguage(preferred: readonly string[], picked: string | null): Resolved {
  const tags = preferred.map(canonical).filter((t): t is string => t !== null);
  const lang: Lang = isLang(picked) ? picked : ((tags.map(primary).find(isLang) as Lang | undefined) ?? "en");
  if (lang === "en") return { lang, numberLocale: "en-US", dateLocale: "en-GB" };
  // The phone's own form of this language, if it has one with a region; else the main form.
  const regional = tags.find((t) => primary(t) === lang && t.includes("-"));
  const locale = regional ?? MAIN_FORM[lang];
  return { lang, numberLocale: locale, dateLocale: locale };
}

let current: Resolved = { lang: "en", numberLocale: "en-US", dateLocale: "en-GB" };

/** Set once at startup (i18n/start.ts), before any screen loads. */
export function setLanguage(r: Resolved): void {
  current = r;
}
export const language = () => current.lang;
export const numberLocale = () => current.numberLocale;
/** For dates, times and lists ("Ubong and Caterer"). */
export const dateLocale = () => current.dateLocale;

type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const PICK = "nivpay.language.v1";

/** The language picked in Account details, or null to follow the phone. */
export function readPick(kv: Pick<Storage, "getItem">): Lang | null {
  const v = kv.getItem(PICK);
  return isLang(v) ? v : null;
}

export function writePick(kv: KeyValue, lang: Lang | null): void {
  if (lang) kv.setItem(PICK, lang);
  else kv.removeItem(PICK);
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const SPACES = /[\s  ]/g;

/** How this locale writes 1,234,567.5: its group and decimal marks. Spaces count as one. */
export function separators(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  const group = (parts.find((p) => p.type === "group")?.value ?? ",").replace(SPACES, " ");
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  return { group, decimal };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type ParseProblem = "empty" | "format" | "decimals";
export type Parsed = { value: bigint } | { problem: ParseProblem };

/**
 * An amount as this locale writes it, as base units with `decimals`
 * decimals, allowing at most `maxFraction` digits after the mark. Groups must
 * be groups of three; a dollar sign may be typed before or after. Anything
 * else is refused: in French "1,000" has three decimals and is refused, never
 * read as $1, and in English "10,50" is refused, never read as $1,050.
 */
export function parseAmountIn(text: string, decimals: number, locale: string, maxFraction = Math.min(2, decimals)): Parsed {
  const { group, decimal } = separators(locale);
  let t = text.trim().replace(/^(US\$|USD|\$US|\$)\s*/i, "").replace(/\s*(US\$|USD|\$US|\$)$/i, "");
  if (!t) return { problem: "empty" };
  // A space is a group mark only where the locale groups with one.
  t = t.replace(SPACES, group === " " ? " " : "\u0000");
  const m = new RegExp(`^(\\d{1,3}(?:${escape(group)}\\d{3})+|\\d+)(?:${escape(decimal)}(\\d+))?$`).exec(t);
  if (!m) return { problem: "format" };
  const fraction = m[2] ?? "";
  if (fraction.length > maxFraction || fraction.length > decimals) return { problem: "decimals" };
  const whole = m[1]!.split(group).join("");
  return { value: BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0") };
}

const integerFormats = new Map<string, Intl.NumberFormat>();
/** Whole units grouped the locale's way, from a bigint, never a float. */
export function groupedIn(locale: string, whole: bigint): string {
  let f = integerFormats.get(locale);
  if (!f) integerFormats.set(locale, (f = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })));
  return f.format(whole);
}

type Part = { type: string; value: string };
const templates = new Map<string, Part[]>();

/**
 * Dollars the locale's way, built from exact parts: "$1,050.00" in English,
 * "1 050,00 $US" in French, "US$ 1.050,00" in Brazil. The layout comes from
 * Intl; the digits from the bigint.
 */
export function dollarsIn(locale: string, whole: bigint, cents: string | null, negative = false): string {
  let parts = templates.get(locale);
  if (!parts) templates.set(locale, (parts = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).formatToParts(1234.56)));
  const { decimal } = separators(locale);
  let out = "";
  let wrote = false;
  for (const p of parts) {
    if (p.type === "integer" || p.type === "group") {
      if (!wrote) out += groupedIn(locale, whole);
      wrote = true;
    } else if (p.type === "decimal") {
      if (cents !== null) out += decimal;
    } else if (p.type === "fraction") {
      if (cents !== null) out += cents;
    } else out += p.value;
  }
  return `${negative ? "-" : ""}${out.trim()}`;
}
