import { copy } from "../copy.ts";

/**
 * Help and support: an email or a WhatsApp chat, opened with what support
 * needs already written in, the app version and the last code the person
 * saw. The Account ID goes in only if they tick the box. No chat widget and
 * no outside script: just a mailto: link and a wa.me link.
 *
 * Each contact comes from the build (VITE_SUPPORT_EMAIL, VITE_SUPPORT_WHATSAPP)
 * and its button is hidden while it is missing or malformed.
 */

/** A plain email address, or null. */
export function supportEmail(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  // Nothing that could add mail headers or a second address.
  return /^[^\s@<>"?&=,;]+@[^\s@<>"?&=,;]+\.[^\s@<>"?&=,;]+$/.test(v) ? v : null;
}

/** A WhatsApp number as wa.me wants it: digits only, country code first, or null. */
export function supportWhatsApp(raw: string | undefined): string | null {
  const digits = (raw ?? "").replace(/[\s()+-]/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export type SupportFacts = {
  version: string;
  code: number | null;
  accountId: string | null;
  /** The last answers to this account's sends (lib/sendLog.ts), one line each; only with the Account ID. */
  sends?: string[];
};

/** The words written in for support. */
export function supportBody(f: SupportFacts): string {
  return [
    copy.supportPrompt,
    "",
    "",
    "---",
    copy.supportVersionLine(f.version),
    f.code === null ? copy.supportNoCode : copy.supportCodeLine(f.code),
    ...(f.accountId ? [copy.supportAccountLine(f.accountId)] : []),
    ...(f.accountId && f.sends?.length ? [copy.supportSendsLine, ...f.sends] : []),
  ].join("\n");
}

export function emailLink(to: string, f: SupportFacts): string {
  const subject = f.code === null ? copy.supportSubject : copy.supportSubjectCode(f.code);
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(supportBody(f))}`;
}

export function whatsAppLink(number: string, f: SupportFacts): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(supportBody(f))}`;
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;
const LAST_CODE = "nivpay.lastcode.v1";

/** The last code a notice showed on this phone, so support can be told without anyone reading it out. */
export class LastCodeStore {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  get(): number | null {
    const v = Number(this.kv.getItem(LAST_CODE));
    return Number.isInteger(v) && v >= 10 && v <= 99 ? v : null;
  }

  shown(code: number): void {
    this.kv.setItem(LAST_CODE, String(code));
  }
}
