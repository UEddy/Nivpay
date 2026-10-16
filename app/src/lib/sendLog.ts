import { getAddress, isAddress, type Address } from "viem";
import type { SendAnswer } from "./writes.ts";

/**
 * The node's last few answers to this phone's broadcasts, per account
 * (writes.ts records each one). For Get help: they say whether a stuck
 * request was taken, turned down or never answered, which the chain alone
 * can't tell afterwards. Times, transaction hashes and short results only:
 * nothing secret, and nothing a payment depends on.
 */

/** How many answers are kept per account. */
export const SENDS_KEPT = 5;
const KEY = "nivpay.sendlog.v1";

export type LoggedSend = { hash: string; at: number; result: string };

type KeyValue = Pick<Storage, "getItem" | "setItem">;

function read(kv: KeyValue): Record<string, LoggedSend[]> {
  try {
    const raw = JSON.parse(kv.getItem(KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, LoggedSend[]>) : {};
  } catch {
    return {};
  }
}

/** Adds one answer; the oldest go past SENDS_KEPT. */
export function logSend(kv: KeyValue, a: SendAnswer): void {
  if (!isAddress(a.address)) return;
  const all = read(kv);
  const who = getAddress(a.address);
  const mine = Array.isArray(all[who]) ? all[who]! : [];
  all[who] = [...mine, { hash: a.hash, at: a.at, result: a.result.slice(0, 160) }].slice(-SENDS_KEPT);
  kv.setItem(KEY, JSON.stringify(all));
}

/** This account's kept answers, oldest first. */
export function recentSends(kv: KeyValue, account: Address): LoggedSend[] {
  const mine = read(kv)[getAddress(account)];
  return Array.isArray(mine) ? mine.filter((s) => s && typeof s.hash === "string" && typeof s.at === "number" && typeof s.result === "string").slice(-SENDS_KEPT) : [];
}

/** The kind of answer, for showing in plain words. */
export function sendKind(result: string): "accepted" | "refused" | "unanswered" {
  return result === "accepted" ? "accepted" : result.startsWith("refused") ? "refused" : "unanswered";
}

/** One line for the support message: time, transaction, result. */
export const sendLine = (s: LoggedSend) => `${new Date(s.at).toISOString()} ${s.hash} ${s.result}`;
