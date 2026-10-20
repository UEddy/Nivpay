import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import { changeLimit, checkSpend, recordAutoCash, DAY_MS, DEFAULT_LIMIT, finishSpend, FRESH, leftToday, limitNow, LimitStore, recordSpend, settle, usedToday, type Spend } from "./limits.ts";

const usd = (d: number) => BigInt(Math.round(d * 100)) * 10_000n;
const T = 1_800_000_000_000;
const spend = (id: string, dollars: number, at = T, extra: Partial<Spend> = {}): Spend => ({ id, kind: "send", amount: usd(dollars).toString(), at, final: false, ...extra });

test("the default is $1,000 in any 24 hours", () => {
  assert.equal(DEFAULT_LIMIT, usd(1000));
  assert.deepEqual(checkSpend(FRESH, usd(1000), T), { ok: true, left: usd(1000) });
  assert.deepEqual(checkSpend(FRESH, usd(1000.01), T), { ok: false, left: usd(1000) });
});

test("payments in flight count from the moment they are sent, and a failed one stops counting", () => {
  let s = recordSpend(FRESH, spend("7", 600));
  assert.equal(usedToday(s, T), usd(600), "in flight");
  assert.deepEqual(checkSpend(s, usd(500), T), { ok: false, left: usd(400) });
  s = recordSpend(s, spend("7", 600, T + 5));
  assert.equal(usedToday(s, T), usd(600), "a retry on the same nonce counts once");
  s = finishSpend(s, "7", "final");
  assert.equal(usedToday(s, T + 10), usd(600));
  s = recordSpend(s, spend("8", 300));
  s = finishSpend(s, "8", "failed");
  assert.equal(usedToday(s, T + 10), usd(600), "reverted or replaced: it never left");
});

test("any 24 hours: a payment stops counting a day after it was sent", () => {
  const s = recordSpend(recordSpend(FRESH, spend("1", 700, T)), spend("2", 200, T + DAY_MS / 2));
  assert.equal(leftToday(s, T + DAY_MS - 1), usd(100));
  assert.equal(leftToday(s, T + DAY_MS), usd(800), "the first one is a day old");
  assert.equal(settle(s, T + DAY_MS).spends.length, 1);
  assert.equal(leftToday(recordSpend(FRESH, spend("3", 5000)), T), 0n, "never negative");
});

test("lowering takes effect at once; raising takes 24 hours, and says when it did", () => {
  const lower = changeLimit(FRESH, usd(200), T);
  assert.equal(limitNow(lower, T), usd(200));
  assert.equal(lower.raise, null);
  const raised = changeLimit(lower, usd(5000), T);
  assert.equal(limitNow(raised, T + DAY_MS - 1), usd(200), "not yet");
  assert.deepEqual(raised.raise, { limit: usd(5000).toString(), startsAt: T + DAY_MS });
  const later = settle(raised, T + DAY_MS);
  assert.equal(BigInt(later.limit), usd(5000));
  assert.deepEqual(later.raised, { limit: usd(5000).toString(), at: T + DAY_MS });
  // Lowering while a raise waits drops the raise.
  const changedMind = changeLimit(raised, usd(100), T + 1);
  assert.equal(changedMind.raise, null);
  assert.equal(limitNow(changedMind, T + DAY_MS * 2), usd(100));
  // Asking again for the limit it already has drops a raise waiting.
  assert.equal(changeLimit(raised, usd(200), T + 2).raise, null);
});

test("what the phone keeps survives damage and is per account and deployment", () => {
  const m = new Map<string, string>();
  const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  const me = getAddress("0x1A9A136f1cf59899C6b8cfE84ac4df388620467d");
  const store = new LimitStore(kv, "ausd", me);
  assert.deepEqual(store.get(), FRESH);
  store.update((s) => recordSpend(changeLimit(s, usd(50), T), spend("1", 10)));
  assert.equal(limitNow(store.get(), T), usd(50));
  assert.equal(store.get().spends.length, 1);
  assert.deepEqual(new LimitStore(kv, "testusd", me).get(), FRESH);
  m.set(`nivpay.limit.v1.ausd.${me}`, JSON.stringify({ limit: "-5", spends: "x" }));
  assert.deepEqual(store.get(), FRESH);
});

test("every way money leaves checks the limit before signing, and counts what it sends", () => {
  const screens: [string, string[]][] = [
    ["../screens/Send.tsx", ['"send"', '"currency"']],
    ["../screens/ChipIn.tsx", ['"pour"']],
    ["../screens/Money.tsx", ['"cashout"']],
  ];
  for (const [file, kinds] of screens) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(text, /checkDailyLimit\(/, `${file} checks the limit`);
    assert.match(text, /spendSent\(/, `${file} counts what it sends`);
    assert.match(text, /spendEnded\(/, `${file} settles what it sent`);
    for (const k of kinds) assert.ok(text.includes(k), `${file} counts ${k}`);
  }
  // Taking a share out never counts.
  assert.doesNotMatch(readFileSync(new URL("../screens/Close.tsx", import.meta.url), "utf8"), /checkDailyLimit|spendSent/);
});

test("auto cash out's moves count towards the limit, each once, from when the desk made them", () => {
  const now = Date.UTC(2026, 9, 20, 9, 40);
  const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
  let s = recordAutoCash(FRESH, [{ tx: tx(1), dollars: 50_000_000n, at: now - 1000 }]);
  s = recordAutoCash(s, [{ tx: tx(1).replace("0x", "0x").toUpperCase().replace("0X", "0x"), dollars: 50_000_000n, at: now - 1000 }, { tx: tx(2), dollars: 20_000_000n, at: now - DAY_MS - 1 }]);
  assert.equal(usedToday(s, now), 50_000_000n, "once each; one older than a day no longer counts");
  assert.ok(s.spends.every((x) => x.kind === "cashout" && x.final));
  assert.equal(checkSpend(s, DEFAULT_LIMIT - 50_000_000n, now).ok, true);
  assert.equal(checkSpend(s, DEFAULT_LIMIT - 49_999_999n, now).ok, false);
});
