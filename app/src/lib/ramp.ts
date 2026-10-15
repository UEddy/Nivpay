import { groupedIn, numberLocale, parseAmountIn, separators } from "./locale.ts";
/**
 * Add money and Cash out, in the person's own currency: the quotes, shared by
 * the phone (screens/Money.tsx) and the test desk (api/ramp/index.ts, which
 * keeps its own copy of this table and these quotes; a test fails if the two
 * ever differ).
 *
 * In test mode this is a simulation. The rates are fixed TEST rates, not live
 * ones, no bank is involved, and only test AUSD moves. On mainnet a licensed
 * partner quotes and does the bank side (README, "Mainnet plan").
 *
 * Pure, with no imports. Money is bigint: dollars in AUSD base units (6
 * decimals), local money in its minor units (kobo, pence, cents; whole yen).
 * Every division rounds down and every fee rounds up, so a quote never
 * creates money.
 */

export type Route = "ramp" | "local" | "aggregator";

export type Currency = {
  code: string;
  symbol: string;
  /** Digits after the decimal point: 2 for most, 0 for JPY and XOF. */
  digits: number;
  /** A fixed TEST rate, not live: local minor units for one dollar. */
  testMinorPerDollar: bigint;
  /** Which partner serves it on mainnet (README, "Mainnet plan"). */
  route: Route;
};

/** AUSD's decimals. */
export const DOLLAR_DECIMALS = 6;
const DOLLAR = 10n ** BigInt(DOLLAR_DECIMALS);
const CENT = DOLLAR / 100n;

/** Not live: fixed for test mode, so a quote is the same on the phone and on the desk. */
export const RATES_ARE_LIVE = false;

export const CURRENCIES: readonly Currency[] = [
  { code: "NGN", symbol: "₦", digits: 2, testMinorPerDollar: 155_000n, route: "local" },
  { code: "GBP", symbol: "£", digits: 2, testMinorPerDollar: 79n, route: "ramp" },
  { code: "USD", symbol: "$", digits: 2, testMinorPerDollar: 100n, route: "ramp" },
  { code: "EUR", symbol: "€", digits: 2, testMinorPerDollar: 92n, route: "local" },
  { code: "GHS", symbol: "GH₵", digits: 2, testMinorPerDollar: 1_550n, route: "local" },
  { code: "KES", symbol: "KSh", digits: 2, testMinorPerDollar: 12_900n, route: "local" },
  { code: "ZAR", symbol: "R", digits: 2, testMinorPerDollar: 1_820n, route: "local" },
  { code: "XOF", symbol: "CFA", digits: 0, testMinorPerDollar: 605n, route: "aggregator" },
  { code: "EGP", symbol: "E£", digits: 2, testMinorPerDollar: 4_850n, route: "aggregator" },
  { code: "CAD", symbol: "CA$", digits: 2, testMinorPerDollar: 137n, route: "ramp" },
  { code: "AUD", symbol: "A$", digits: 2, testMinorPerDollar: 152n, route: "ramp" },
  { code: "INR", symbol: "₹", digits: 2, testMinorPerDollar: 8_350n, route: "local" },
  { code: "CNY", symbol: "CN¥", digits: 2, testMinorPerDollar: 725n, route: "local" },
  { code: "AED", symbol: "AED", digits: 2, testMinorPerDollar: 367n, route: "aggregator" },
  { code: "BRL", symbol: "R$", digits: 2, testMinorPerDollar: 540n, route: "aggregator" },
  { code: "MXN", symbol: "MX$", digits: 2, testMinorPerDollar: 1_800n, route: "aggregator" },
  { code: "PHP", symbol: "₱", digits: 2, testMinorPerDollar: 5_700n, route: "aggregator" },
  { code: "JPY", symbol: "¥", digits: 0, testMinorPerDollar: 150n, route: "aggregator" },
];

export function currencyFor(code: string): Currency | undefined {
  return CURRENCIES.find((c) => c.code === code);
}

/** Per request, on the dollar side: $1 to $100. */
export const MIN_DOLLARS = 1n * DOLLAR;
export const MAX_DOLLARS = 100n * DOLLAR;
/** The test desk's fee, 1 percent, rounded up to the cent. */
export const FEE_BPS = 100n;

export type Limit = "too-small" | "too-large" | null;

export function limitFor(dollars: bigint): Limit {
  if (dollars < MIN_DOLLARS) return "too-small";
  if (dollars > MAX_DOLLARS) return "too-large";
  return null;
}

/** The fee on `dollars`, rounded up to a whole cent. */
function feeOn(dollars: bigint): bigint {
  const raw = (dollars * FEE_BPS + 9_999n) / 10_000n;
  return ((raw + CENT - 1n) / CENT) * CENT;
}

export type AddQuote = {
  currency: string;
  /** What the person pays, in local minor units. */
  localMinor: bigint;
  /** That money in dollars, rounded down to the cent. */
  gross: bigint;
  fee: bigint;
  /** What arrives in the account: gross minus the fee. */
  received: bigint;
  limit: Limit;
};

/** Paying `localMinor` in from a bank: what arrives as dollars. Rounds down. */
export function quoteAdd(currency: Currency, localMinor: bigint): AddQuote {
  const safe = localMinor > 0n ? localMinor : 0n;
  const cents = (safe * 100n) / currency.testMinorPerDollar;
  const gross = cents * CENT;
  const fee = gross > 0n ? feeOn(gross) : 0n;
  const received = gross > fee ? gross - fee : 0n;
  return { currency: currency.code, localMinor: safe, gross, fee, received, limit: limitFor(gross) };
}

export type CashOutQuote = {
  currency: string;
  /** Dollars leaving the account. */
  dollars: bigint;
  fee: bigint;
  /** What the bank gets, in local minor units. Rounds down. */
  bankGets: bigint;
  limit: Limit;
};

/** Cashing `dollars` out to a bank: what the bank gets, in local money. */
export function quoteCashOut(currency: Currency, dollars: bigint): CashOutQuote {
  const safe = dollars > 0n ? dollars : 0n;
  const fee = safe > 0n ? feeOn(safe) : 0n;
  const net = safe > fee ? safe - fee : 0n;
  const bankGets = (net * currency.testMinorPerDollar) / DOLLAR;
  return { currency: currency.code, dollars: safe, fee, bankGets, limit: limitFor(safe) };
}

// ---------------------------------------------------------------------------
// Which currency to start with
// ---------------------------------------------------------------------------

const ZONES: Record<string, string> = {
  "Africa/Lagos": "NGN",
  "Africa/Accra": "GHS",
  "Africa/Nairobi": "KES",
  "Africa/Johannesburg": "ZAR",
  "Africa/Cairo": "EGP",
  "Africa/Dakar": "XOF",
  "Africa/Abidjan": "XOF",
  "Africa/Bamako": "XOF",
  "Africa/Lome": "XOF",
  "Africa/Ouagadougou": "XOF",
  "Africa/Niamey": "XOF",
  "Africa/Porto-Novo": "XOF",
  "Europe/London": "GBP",
  "Europe/Belfast": "GBP",
  "America/Toronto": "CAD",
  "America/Vancouver": "CAD",
  "America/Edmonton": "CAD",
  "America/Winnipeg": "CAD",
  "America/Halifax": "CAD",
  "America/Mexico_City": "MXN",
  "America/Monterrey": "MXN",
  "America/Tijuana": "MXN",
  "America/Cancun": "MXN",
  "America/Sao_Paulo": "BRL",
  "America/Manaus": "BRL",
  "America/Recife": "BRL",
  "Asia/Kolkata": "INR",
  "Asia/Calcutta": "INR",
  "Asia/Shanghai": "CNY",
  "Asia/Chongqing": "CNY",
  "Asia/Dubai": "AED",
  "Asia/Manila": "PHP",
  "Asia/Tokyo": "JPY",
};

const REGIONS: Record<string, string> = {
  NG: "NGN", GB: "GBP", US: "USD", GH: "GHS", KE: "KES", ZA: "ZAR", EG: "EGP",
  SN: "XOF", CI: "XOF", ML: "XOF", BF: "XOF", NE: "XOF", TG: "XOF", BJ: "XOF",
  CA: "CAD", AU: "AUD", IN: "INR", CN: "CNY", AE: "AED", BR: "BRL", MX: "MXN", PH: "PHP", JP: "JPY",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", PT: "EUR", BE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR",
};

/** Euro countries' zones, beyond the table above. */
const EURO_ZONES = new Set([
  "Europe/Berlin", "Europe/Paris", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam", "Europe/Dublin", "Europe/Lisbon",
  "Europe/Brussels", "Europe/Vienna", "Europe/Helsinki", "Europe/Athens", "Europe/Luxembourg", "Europe/Bratislava",
  "Europe/Ljubljana", "Europe/Tallinn", "Europe/Riga", "Europe/Vilnius", "Europe/Malta", "Europe/Zagreb",
]);

/**
 * The currency to start with: from the phone's time zone, then its languages'
 * regions ("en-NG"), then dollars. Africa/Lagos gives NGN.
 */
export function defaultCurrency(timeZone: string | undefined, languages: readonly string[] = []): string {
  if (timeZone) {
    const byZone = ZONES[timeZone] ?? (EURO_ZONES.has(timeZone) ? "EUR" : undefined) ?? (timeZone.startsWith("Australia/") ? "AUD" : undefined);
    if (byZone) return byZone;
  }
  for (const lang of languages) {
    const region = /^[a-z]{2,3}(?:-[A-Za-z]{4})?-([A-Z]{2})\b/i.exec(lang)?.[1]?.toUpperCase();
    const code = region ? REGIONS[region] : undefined;
    if (code) return code;
  }
  return "USD";
}

// ---------------------------------------------------------------------------
// Showing local money exactly
// ---------------------------------------------------------------------------

/** Local minor units as text, from the bigint, never a float, the reader's way: "₦76,725.00" in English, "₦76 725,00" in French. */
export function formatLocal(currency: Currency, minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const unit = 10n ** BigInt(currency.digits);
  const locale = numberLocale();
  const whole = groupedIn(locale, abs / unit);
  const fraction = currency.digits > 0 ? separators(locale).decimal + (abs % unit).toString().padStart(currency.digits, "0") : "";
  const gap = /[A-Za-z]$/.test(currency.symbol) ? " " : "";
  return `${negative ? "-" : ""}${currency.symbol}${gap}${whole}${fraction}`;
}

/**
 * Text typed in local money as minor units, or null, read the reader's way
 * (lib/locale.ts): no more decimals than the currency has, anything
 * ambiguous refused.
 */
export function parseLocal(currency: Currency, text: string): bigint | null {
  const r = parseAmountIn(text, currency.digits, numberLocale(), currency.digits);
  return "value" in r ? r.value : null;
}

// ---------------------------------------------------------------------------
// References, like "NVP-7K3QX9"
// ---------------------------------------------------------------------------

/** No 0, O, 1 or I: a reference is read aloud and typed into a bank app. */
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const REF_LENGTH = 6;

/** A short reference from at least six random bytes. */
export function referenceFrom(bytes: Uint8Array): string {
  if (bytes.length < REF_LENGTH) throw new Error("a reference needs six bytes");
  let out = "";
  for (let i = 0; i < REF_LENGTH; i++) out += REF_ALPHABET[bytes[i]! & 31];
  return `NVP-${out}`;
}

/** The reference for a cash out, derived from its transaction, so asking twice gives the same one. */
export function referenceForTx(tx: string): string {
  const hex = tx.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("not a transaction id");
  // The last six bytes, so the reference doesn't simply repeat the start of the id.
  const bytes = new Uint8Array(REF_LENGTH);
  for (let i = 0; i < REF_LENGTH; i++) bytes[i] = parseInt(hex.slice(64 - 2 * (REF_LENGTH - i), 66 - 2 * (REF_LENGTH - i)), 16);
  return referenceFrom(bytes);
}

/** A reference is exactly this shape; anything else is refused. */
export function isReference(text: string): boolean {
  return new RegExp(`^NVP-[${REF_ALPHABET}]{${REF_LENGTH}}$`).test(text);
}
