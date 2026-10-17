import { getAddress, isAddress, type Address } from "viem";

/**
 * Notifications on the phone (Web Push), the parts with no browser in them:
 * the kinds and their settings, what a push carries, the screen a tap opens,
 * and the texts the service worker shows (README, "Notifications on the
 * phone").
 *
 * A push never carries a name or a pot's link. It carries the kind, the
 * language of the phone, the pot's name as the chain has it, and an amount
 * only if the person turned on "Show amounts on the lock screen".
 */

export const PUSH_KINDS = ["received", "sent", "chippedIn", "askYes", "request", "potNamesYou"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

export type PushSettings = { kinds: Record<PushKind, boolean>; amounts: boolean };

/** On at first: money in, money into your pots, a yes asked of you, a request from a person. */
export const DEFAULT_SETTINGS: PushSettings = {
  kinds: { received: true, sent: false, chippedIn: true, askYes: true, request: true, potNamesYou: false },
  amounts: false,
};

/** Settings as stored or sent: every kind present, anything else dropped. */
export function cleanSettings(raw: unknown): PushSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as { kinds?: Record<string, unknown>; amounts?: unknown };
  const kinds = { ...DEFAULT_SETTINGS.kinds };
  for (const k of PUSH_KINDS) if (typeof r.kinds?.[k] === "boolean") kinds[k] = r.kinds[k] as boolean;
  return { kinds, amounts: r.amounts === true };
}

/** What a push carries. Short keys: a push is small. */
export type PushPayload = {
  /** Kind. */
  k: PushKind;
  /** Language of the phone it goes to. */
  l: string;
  /** Pot number, pot name and request number, where it is about one. */
  p?: string;
  n?: string;
  r?: string;
  /** Amount in base units, its decimals and symbol: only with amounts on. */
  a?: string;
  d?: number;
  s?: string;
};

/** Where a tap goes. */
export type Go = { kind: "receive" } | { kind: "notes" } | { kind: "pot"; potId: string } | { kind: "request"; potId: string; proposalId: string };

export function goFor(p: Pick<PushPayload, "k" | "p" | "r">): Go {
  if (p.k === "received") return { kind: "receive" };
  if (p.k === "askYes" && p.p && p.r) return { kind: "request", potId: p.p, proposalId: p.r };
  if ((p.k === "chippedIn" || p.k === "potNamesYou") && p.p) return { kind: "pot", potId: p.p };
  return { kind: "notes" };
}

export function goUrl(g: Go): string {
  if (g.kind === "pot") return `/?go=pot&pot=${g.potId}`;
  if (g.kind === "request") return `/?go=request&pot=${g.potId}&ask=${g.proposalId}`;
  return `/?go=${g.kind}`;
}

/** The screen a tapped notification asked for, from the page's query. Null for anything else. */
export function parseGo(search: string): Go | null {
  const q = new URLSearchParams(search);
  const pot = q.get("pot") ?? "";
  const ask = q.get("ask") ?? "";
  const num = (v: string) => /^\d{1,20}$/.test(v);
  // A pot on NivPayPotsV2 is "v2:" and its number (potstore.ts potKey).
  const potNum = (v: string) => /^(v2:)?\d{1,20}$/.test(v);
  switch (q.get("go")) {
    case "receive":
      return { kind: "receive" };
    case "notes":
      return { kind: "notes" };
    case "pot":
      return potNum(pot) ? { kind: "pot", potId: pot } : null;
    case "request":
      return potNum(pot) && num(ask) ? { kind: "request", potId: pot, proposalId: ask } : null;
    default:
      return null;
  }
}

/** Accounts as sent with a subscription: valid, checksummed, at most `max`. */
export function cleanAccounts(raw: unknown, max = 200): Address[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((a): a is string => typeof a === "string" && isAddress(a)).map((a) => getAddress(a)))].slice(0, max) : [];
}

/**
 * The texts a push shows, per language, built from the dictionaries with
 * "{amount}" and "{pot}" left in for the service worker to fill. Put into
 * sw.js at build time (sw-build.ts), so every word still comes from copy.
 */
export type PushTexts = Record<string, Record<string, string>>;

type Dictionary = {
  pushReceived: (amount: string) => string;
  pushReceivedNoAmount: string;
  pushSent: (amount: string) => string;
  pushSentNoAmount: string;
  pushChippedIn: (amount: string, pot: string) => string;
  pushChippedInNoAmount: (pot: string) => string;
  pushAskYes: (amount: string, pot: string) => string;
  pushAskYesNoAmount: (pot: string) => string;
  pushRequest: string;
  pushPotNamesYou: (pot: string) => string;
  pushTitle: string;
};

export function pushTexts(dictionaries: Record<string, Dictionary>): PushTexts {
  const A = "{amount}";
  const P = "{pot}";
  return Object.fromEntries(
    Object.entries(dictionaries).map(([lang, c]) => [
      lang,
      {
        title: c.pushTitle,
        received: c.pushReceived(A),
        receivedNoAmount: c.pushReceivedNoAmount,
        sent: c.pushSent(A),
        sentNoAmount: c.pushSentNoAmount,
        chippedIn: c.pushChippedIn(A, P),
        chippedInNoAmount: c.pushChippedInNoAmount(P),
        askYes: c.pushAskYes(A, P),
        askYesNoAmount: c.pushAskYesNoAmount(P),
        request: c.pushRequest,
        requestNoAmount: c.pushRequest,
        potNamesYou: c.pushPotNamesYou(P),
        potNamesYouNoAmount: c.pushPotNamesYou(P),
      },
    ]),
  );
}
