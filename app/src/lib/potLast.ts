import { getAddress, isAddress, isAddressEqual, type Address, type Hex } from "viem";
import { copy } from "../copy.ts";
import type { PotEvent } from "./feed.ts";
import { shownText32 } from "./text32.ts";

/**
 * The last thing that happened in a pot, for its row on the Pots tab: from
 * the pot's own finalized events, the ones its screen already reads (feed.ts),
 * remembered per pot so the list shows it at once and updates quietly. Only
 * pot numbers, accounts, amounts and block numbers are kept: all public.
 */

export type PotLast =
  | { kind: "made"; block: string }
  | { kind: "putIn"; block: string; who: Address; amount: string }
  | { kind: "asked"; block: string; payee: string; amount: string }
  | { kind: "askedClose"; block: string }
  | { kind: "yes"; block: string; who: Address }
  | { kind: "paid"; block: string; payee: string; amount: string }
  | { kind: "tookOut"; block: string; who: Address }
  | { kind: "closed"; block: string };

/** What happened in a pot last, or null if its events say nothing that a row would show. */
export function lastOf(events: PotEvent[]): PotLast | null {
  const created = events.find((e) => e.name === "PotCreated");
  const labels = Array.isArray(created?.args.destinationLabels) ? (created!.args.destinationLabels as Hex[]).map((l) => shownText32(l)) : [];
  const payee = (i: unknown) => labels[Number(i)] ?? "";
  const sorted = [...events].sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1));
  for (const e of sorted) {
    const block = e.block.toString();
    const a = e.args;
    switch (e.name) {
      case "PotCreated":
        return { kind: "made", block };
      case "Funded":
        return { kind: "putIn", block, who: getAddress(String(a.funder)), amount: String(a.assets) };
      case "Proposed":
        return Number(a.kind) === 1 ? { kind: "askedClose", block } : { kind: "asked", block, payee: payee(a.destIndex), amount: String(a.amount) };
      case "Approved":
        return { kind: "yes", block, who: getAddress(String(a.approver)) };
      case "PayoutExecuted":
        return { kind: "paid", block, payee: payee(a.destIndex), amount: String(a.amount) };
      case "Exited":
      case "Claimed":
        return { kind: "tookOut", block, who: getAddress(String(a.funder)) };
      case "Closed":
        return { kind: "closed", block };
      default:
        // A revoked yes, a cancelled request, a pause: not what a row leads with.
        continue;
    }
  }
  return null;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "2h ago", "yesterday", "3d ago", in the language given; "now" under a minute. */
export function timeAgo(thenSeconds: number, nowSeconds: number, locale: string): string {
  const diff = Math.max(0, nowSeconds - thenSeconds);
  // English reads "2h ago" in its narrow style; others' narrow styles are terse ("-2 h" in French), so short there.
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: locale.toLowerCase().startsWith("en") ? "narrow" : "short" });
  for (const [unit, size] of UNITS) {
    if (diff >= size) return rtf.format(-Math.floor(diff / size), unit);
  }
  return rtf.format(0, "second");
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;

/** The last event of each pot, per deployment, on this phone. */
export class PotLastStore {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string) {
    this.kv = kv;
    this.key = `nivpay.potlast.v1.${deployment}`;
  }

  all(): Record<string, PotLast> {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "{}") as Record<string, PotLast>;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      const out: Record<string, PotLast> = {};
      for (const [potId, v] of Object.entries(raw)) {
        if (/^\d+$/.test(potId) && v && typeof v.kind === "string" && typeof v.block === "string" && (!("who" in v) || isAddress(String(v.who)))) out[potId] = v;
      }
      return out;
    } catch {
      return {};
    }
  }

  /** Keeps the newer of what is kept and what is given. Returns whether it changed. */
  put(potId: string, last: PotLast): boolean {
    const all = this.all();
    const old = all[potId];
    if (old && BigInt(old.block) > BigInt(last.block)) return false;
    if (old && JSON.stringify(old) === JSON.stringify(last)) return false;
    try {
      this.kv.setItem(this.key, JSON.stringify({ ...all, [potId]: last }));
      window.dispatchEvent?.(new CustomEvent("nivpay:potlast"));
    } catch {
      // Storage refused, or no window in a test: the row shows what it holds.
    }
    return true;
  }
}

export type LineNames = {
  me: Address;
  /** A person's name: a contact's, an account on this phone, an @username, else the end of their account. */
  who: (account: Address) => string;
  money: (units: bigint) => string;
  /** "2h ago", or null while the time isn't known. */
  when: string | null;
  /** The pot is closed and this account has a share to take. */
  shareReady: boolean;
};

/** The row's second line: what happened last, and how long ago. */
export function lastLine(last: PotLast, n: LineNames): string {
  if (n.shareReady) return copy.lastClosedShare;
  const who = (a: Address) => (isAddressEqual(a, n.me) ? copy.youCap : n.who(a));
  const payee = (p: string) => p || copy.unnamedPayee;
  let text: string;
  switch (last.kind) {
    case "made":
      text = copy.lastMade;
      break;
    case "putIn":
      text = copy.lastPutIn(who(last.who), n.money(BigInt(last.amount)));
      break;
    case "asked":
      text = copy.lastAsked(payee(last.payee), n.money(BigInt(last.amount)));
      break;
    case "askedClose":
      text = copy.lastAskedClose;
      break;
    case "yes":
      text = copy.lastYes(who(last.who));
      break;
    case "paid":
      text = copy.lastPaid(payee(last.payee), n.money(BigInt(last.amount)));
      break;
    case "tookOut":
      text = copy.lastTookOut(who(last.who));
      break;
    case "closed":
      text = copy.lastClosed;
      break;
  }
  return n.when ? copy.withWhen(text, n.when) : text;
}
