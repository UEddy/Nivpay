import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ERROR_CODES } from "./copy.ts";
import { formatAmount } from "./lib/money.ts";
import { feeFor } from "./lib/payout.ts";

/**
 * docs/DEMO.md is read aloud on camera, so its numbers are checked against
 * the app's own arithmetic and the contract's share conversion, not trusted.
 */
const DEMO = readFileSync(new URL("../../docs/DEMO.md", import.meta.url), "utf8");

const DECIMALS = 6;
const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10n ** BigInt(DECIMALS - 2);
const cents = (v: bigint) => formatAmount(v, DECIMALS, "cents");
// Both deployed pots, read from the chain: feeBps 50, feeCap 50 AUSD (README, Contract addresses).
const FEE_BPS = 50n;
const FEE_CAP = 50_000_000n;
// The gas grant function's limit on sent requests (app/api/fund/index.ts, MAX_SENT_TXS).
const MAX_SENT = 10;

/** NivPayPots' conversions: virtual shares and assets, offset 3, rounded down for the caller. */
const OFFSET = 1_000n;
class Pot {
  assets = 0n;
  shares = 0n;
  held = new Map<string, bigint>();
  fund(who: string, amount: bigint) {
    const minted = (amount * (this.shares + OFFSET)) / (this.assets + 1n);
    this.held.set(who, (this.held.get(who) ?? 0n) + minted);
    this.shares += minted;
    this.assets += amount;
  }
  pay(amount: bigint): bigint {
    const fee = feeFor(amount, FEE_BPS, FEE_CAP);
    this.assets -= amount + fee;
    return fee;
  }
  take(who: string): bigint {
    const mine = this.held.get(who) ?? 0n;
    const out = (mine * (this.assets + 1n)) / (this.shares + OFFSET);
    this.held.set(who, 0n);
    this.shares -= mine;
    this.assets -= out;
    return out;
  }
}

test("the demo's fees, what is left and each share match the app and the contract", () => {
  const pot = new Pot();
  pot.fund("Idara", usd(500));
  pot.fund("Ubong", usd(400));
  pot.fund("Aniekan", usd(100));
  const caterer = pot.pay(usd(600));
  assert.equal(cents(caterer), "$3.00");
  assert.equal(cents(pot.assets), "$397.00");
  const hall = pot.pay(usd(280));
  assert.equal(cents(hall), "$1.40");
  assert.equal(cents(caterer + hall), "$4.40");
  assert.equal(cents(pot.assets), "$115.60");

  // In the order the script takes them.
  const takes: [string, string, string][] = [
    ["Ubong", "$46.24", "$69.36"],
    ["Idara", "$57.80", "$11.56"],
    ["Aniekan", "$11.56", "$0.00"],
  ];
  for (const [who, share, after] of takes) {
    assert.equal(cents(pot.take(who)), share, who);
    assert.equal(cents(pot.assets), after, `pot after ${who}`);
  }

  for (const figure of ["$3.00", "$1.40", "$4.40", "$397.00", "$115.60", "$46.24", "$57.80", "$11.56", "$69.36"]) {
    assert.ok(DEMO.includes(figure), `DEMO.md states ${figure}`);
  }
});

test("every account in the demo stays under the gas grant's limit of sent requests", () => {
  const counts = [...DEMO.matchAll(/^\| (Idara|Ubong|Aniekan|Caterer, Event hall) \| .* \| (\d+) \|$/gm)].map((m) => Number(m[2]));
  assert.deepEqual(counts, [6, 5, 5, 0]);
  for (const n of counts) assert.ok(n < MAX_SENT);
  // The bounty path: Idara sends 5 in a take, under the limit, and a second take on her account would reach it.
  const bounty = /Idara sends (\d+) \(the claim, the \$25 payment, then the\s+setup, the allowance and the exchange/.exec(DEMO);
  const sent = Number(bounty?.[1]);
  assert.equal(sent, 5);
  assert.ok(sent < MAX_SENT && sent * 2 >= MAX_SENT);
});

test("every code the demo names is a code the app can show", () => {
  const known = new Set<number>(Object.values(ERROR_CODES));
  const named = [...DEMO.matchAll(/Code (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(named.length > 0);
  for (const n of named) assert.ok(known.has(n), `Code ${n}`);
});
