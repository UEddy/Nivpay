/**
 * What counts as private in a frame of phone footage, read from OCR lines.
 *
 * Nothing here ever returns, prints or stores the text it looked at: callers
 * get categories and boxes only, so a real email, number or name can't leak
 * into a log, a report or a commit.
 */

export type Category =
  | "email address"
  | "phone number"
  | "contact names"
  | "real names"
  | "notification content"
  | "account chooser"
  | "Wi-Fi name"
  | "status bar"
  | "PIN or password entry"
  | "passkey sheet"
  | "share sheet"
  | "denylist";

/** A rectangle as fractions of the frame, 0 to 1. */
export type Box = { x: number; y: number; w: number; h: number };

export type Line = { text: string; box: Box };

export type Hit = { category: Category; box: Box };

const MAIL_HOSTS = /(gmail|googlemail|yahoo|outlook|hotmail|icloud|live|proton|aol|ymail)/i;

/**
 * An email address, or a visible piece of one: text@host.tld, or an "@" with
 * a mail host after it ("...meone@example-mail.com" cut short by a keyboard strip). A
 * lone "@" is not one: OCR reads browser toolbar icons as "@".
 */
export function hasEmail(text: string): boolean {
  if (/[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(text)) return true;
  const at = text.indexOf("@");
  return at >= 0 && MAIL_HOSTS.test(text.slice(at + 1));
}

/**
 * A phone-number-like sequence: 9 or more digits, optionally with spaces,
 * dashes, dots or brackets between them and a leading "+", standing on its
 * own. A run touching letters is part of an ID or a link, not a number; one
 * after "#", "$" or a currency sign is a reference or money; amounts with
 * cents and clock times are never numbers.
 */
export function hasPhoneNumber(text: string): boolean {
  for (const m of text.matchAll(/\+?\(?\d[\d \-().]{6,}\d/g)) {
    const run = m[0];
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    const after = text.slice(m.index + run.length, m.index + run.length + 1);
    if (/[\p{L}#$£€₦@/]/u.test(before) || /[\p{L}@/]/u.test(after)) continue;
    if (/\d[.,]\d{2}$/.test(run.trim()) && !/\d[ -]\d/.test(run)) continue;
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(run.trim())) continue;
    if (/\d{1,2}:\d{2}/.test(run)) continue;
    // A calendar row or a keyboard's number row: groups of one or two digits.
    if (run.trim().split(/[^\d]+/).filter(Boolean).every((g) => g.length <= 2)) continue;
    if (run.replace(/\D/g, "").length >= 9) return true;
  }
  return false;
}

const PATTERNS: [Category, RegExp][] = [
  ["account chooser", /choose an account|use another account|sign in with google|continue as\b|choose a google account|switch account\b(?!.*nivpay)/i],
  ["PIN or password entry", /enter (your )?(pin|password|pattern)|confirm (your )?(pin|password|pattern)|use (pin|password|pattern)\b|wrong pin|incorrect pin|\bPIN\b/],
  ["passkey sheet", /passkey|password manager|use your screen lock|verify it.?s you|touch the fingerprint|use fingerprint|use screen lock|create a passkey|save (a )?passkey|sign in with a passkey/i],
  ["share sheet", /quick share|nearby share|nearby devices|share to\b|share via|copy to clipboard|direct share|\bmore\b.*\bapps\b/i],
  ["notification content", /clear all|notification settings|silent notifications|\bnotifications\b|\breply\b.*\bmark as read\b|mark as read/i],
  ["Wi-Fi name", /wi-?fi|\bssid\b|connected to\b/i],
];

/** Every private thing in one frame's OCR lines, with the line's box. */
export function classify(lines: Line[], denylist: string[] = []): Hit[] {
  const hits: Hit[] = [];
  const deny = denylist.map((d) => d.trim().toLowerCase()).filter((d) => d.length >= 3);
  for (const line of lines) {
    const text = line.text;
    if (hasEmail(text)) hits.push({ category: "email address", box: line.box });
    if (hasPhoneNumber(text)) hits.push({ category: "phone number", box: line.box });
    for (const [category, re] of PATTERNS) if (re.test(text)) hits.push({ category, box: line.box });
    const lower = text.toLowerCase();
    if (deny.some((d) => lower.includes(d))) hits.push({ category: "denylist", box: line.box });
  }
  return hits;
}

/** A lock keypad: three or more lines that are rows of a phone keypad. */
export function looksLikeKeypad(lines: Line[]): boolean {
  const rows = lines.filter((l) => /^\s*[1-9]\s+[2-9]\s+[3-9]\s*$|\bABC\b.*\bDEF\b|\bGHI\b.*\bJKL\b|\bPQRS\b|\bWXYZ\b/.test(l.text));
  return rows.length >= 2;
}

/** Pads a box by a fraction of its own size on every side, clamped to the frame. */
export function pad(box: Box, fraction: number): Box {
  const dx = box.w * fraction;
  const dy = box.h * fraction;
  const x = Math.max(0, box.x - dx);
  const y = Math.max(0, box.y - dy);
  return { x, y, w: Math.min(1, box.x + box.w + dx) - x, h: Math.min(1, box.y + box.h + dy) - y };
}
