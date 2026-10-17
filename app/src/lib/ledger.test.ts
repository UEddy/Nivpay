import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PotEvent } from "./feed.ts";
import { agreesWithContract, anyPaymentMade, cardsFor, ledgerOf, type Ledger } from "./ledger.ts";

/**
 * A model of the pot contract's money (src/NivPayPots.sol: _fund, _redeem,
 * _executePayout, _feeOn, funderInfo), written apart from lib/ledger.ts: the
 * same mulDiv rounding down and the same 10^3 virtual shares and 1 virtual
 * unit. It makes the events a pot would emit, and says what funderInfo
 * would return. test/vectors/ledger.json ties it to the real contract.
 */
class PotModel {
  assets = 0n;
  shares = 0n;
  held = new Map<string, bigint>();
  events: PotEvent[] = [];
  /** For each payment, who held shares when it was made. */
  holdersAt: Set<string>[] = [];
  private n = 0;
  readonly feeBps: bigint;
  readonly feeCap: bigint;
  constructor(feeBps = 50n, feeCap = 5_000_000n) {
    this.feeBps = feeBps;
    this.feeCap = feeCap;
  }
  private emit(name: string, args: Record<string, unknown>) {
    this.n++;
    this.events.push({ name, block: BigInt(this.n), logIndex: 0, tx: `0x${this.n.toString(16).padStart(64, "0")}`, args });
  }
  fund(who: string, amount: bigint): boolean {
    const minted = (amount * (this.shares + 1_000n)) / (this.assets + 1n);
    if (minted === 0n) return false;
    this.assets += amount;
    this.shares += minted;
    this.held.set(who, (this.held.get(who) ?? 0n) + minted);
    this.emit("Funded", { potId: 0n, funder: who, assets: amount, sharesMinted: minted });
    return true;
  }
  exit(who: string, part: bigint, closed = false): boolean {
    const mine = this.held.get(who) ?? 0n;
    if (part === 0n || part > mine) return false;
    const out = (part * (this.assets + 1n)) / (this.shares + 1_000n);
    this.held.set(who, mine - part);
    this.shares -= part;
    this.assets -= out;
    this.emit(closed ? "Claimed" : "Exited", { potId: 0n, funder: who, sharesBurned: part, assets: out });
    return true;
  }
  pay(destIndex: number, amount: bigint): boolean {
    let fee = (amount * this.feeBps) / 10_000n;
    if (fee > this.feeCap) fee = this.feeCap;
    if (amount === 0n || this.assets < amount + fee) return false;
    this.holdersAt.push(new Set([...this.held].filter(([, s]) => s > 0n).map(([a]) => a)));
    this.assets -= amount + fee;
    this.emit("PayoutExecuted", { proposalId: BigInt(this.holdersAt.length), potId: 0n, to: `payee${destIndex}`, destIndex, amount, fee });
    return true;
  }
  funderInfo(who: string): bigint {
    return ((this.held.get(who) ?? 0n) * (this.assets + 1n)) / (this.shares + 1_000n);
  }
  all(): Record<string, bigint> {
    return Object.fromEntries([...this.held.keys()].map((a) => [a, this.funderInfo(a)]));
  }
}

const $ = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n; // 6 decimals

/** Every card adds up exactly, in cents, and stays close to the truth. */
function checkCards(ledger: Ledger, model: PotModel, where: string) {
  for (const p of ledger.people) {
    assert.equal(p.left, p.putIn - p.payments - p.fees - p.takenOut + p.rounding, `${where}: ${p.account}'s lines add up`);
    assert.equal(
      p.parts.reduce((a, x) => a + x.cents, 0n),
      p.payments,
      `${where}: ${p.account}'s payments list adds up to its line`,
    );
    assert.ok(p.rounding >= -3n && p.rounding <= 3n, `${where}: ${p.account}'s rounding is ${p.rounding} cents`);
    assert.equal(p.replayedLeftUnits, model.funderInfo(p.account), `${where}: ${p.account}'s left is funderInfo's`);
    // A part of a payment only for payments made while this person had money in.
    const paidIn = new Set(p.parts.map((x) => x.payment));
    model.holdersAt.forEach((holders, k) => {
      assert.equal(paidIn.has(k), holders.has(p.account), `${where}: ${p.account} and payment ${k}`);
    });
  }
}

test("a late joiner bears none of an earlier payment, an early leaver none of a later one", () => {
  const m = new PotModel();
  m.fund("ana", $(500));
  m.fund("ben", $(500));
  m.pay(0, $(600)); // Caterer: $600 + $3 fee, half each
  m.fund("cleo", $(300)); // after the Caterer
  m.exit("ben", m.held.get("ben")!); // Ben takes his part out
  m.pay(1, $(200)); // Hall: $200 + $1 fee, shared by Ana and Cleo
  const ledger = ledgerOf(m.events, 6, m.all());
  const [ana, ben, cleo] = ["ana", "ben", "cleo"].map((a) => ledger.people.find((p) => p.account === a)!);

  assert.deepEqual(
    ana!.parts.map((x) => x.payment),
    [0, 1],
  );
  assert.equal(ana!.parts[0]!.cents, 300_00n, "half of the Caterer");
  assert.deepEqual(
    ben!.parts.map((x) => x.payment),
    [0],
    "nothing of the Hall: he had left",
  );
  assert.deepEqual(
    cleo!.parts.map((x) => x.payment),
    [1],
    "nothing of the Caterer: she joined after",
  );
  // Ana held $198.50 of the pot's $498.50 when the Hall was paid: 39.8% of $200.
  assert.equal(ana!.parts[1]!.cents, 79_64n);
  assert.equal(cleo!.parts[0]!.cents, 120_36n);
  assert.equal(ben!.takenOut, 198_50n);
  assert.equal(ben!.left, 0n);
  assert.equal(ben!.inPot, false);
  assert.equal(ana!.left + cleo!.left <= 498_50n - 201_00n, true);
  checkCards(ledger, m, "worked pot");
});

test("in random pots the lines always add up exactly: late joiners, early exits, several payments, top-ups, a full drain", () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  // What the runs went through, so a narrower generator can't pass unnoticed.
  const seen = { payments: 0, exits: 0, lateJoiners: 0, leftEarly: 0, rounded: 0, maxRounding: 0n };
  for (let run = 0; run < 400; run++) {
    const m = new PotModel(BigInt(Math.floor(rand() * 101)), pick([1_000_000n, 5_000_000n, 10n ** 18n]));
    const people = Array.from({ length: 2 + Math.floor(rand() * 5) }, (_, i) => `p${i}`);
    for (let step = 0; step < 4 + Math.floor(rand() * 16); step++) {
      const r = rand();
      const who = pick(people);
      if (r < 0.45) m.fund(who, BigInt(Math.floor(rand() * 900_00) + 1) * 10_000n + BigInt(Math.floor(rand() * 10_000)));
      else if (r < 0.75) m.pay(Math.floor(rand() * 3), BigInt(Math.floor(rand() * Number(m.assets) * 0.6)));
      else if (r < 0.9) m.exit(who, ((m.held.get(who) ?? 0n) * BigInt(Math.floor(rand() * 100) + 1)) / 100n);
      else m.pay(0, (m.assets * 10_000n) / (10_000n + m.feeBps) - 1n); // nearly everything
    }
    const closed = rand() < 0.3;
    if (closed) for (const who of people) m.exit(who, m.held.get(who) ?? 0n, true);
    const contract = m.all();
    const ledger = ledgerOf(m.events, 6, contract);
    assert.equal(ledger.totalAssets, m.assets, `run ${run}: what the pot holds`);
    assert.equal(ledger.totalShares, m.shares, `run ${run}: its shares`);
    assert.ok(agreesWithContract(ledger, contract), `run ${run}: agrees with funderInfo`);
    checkCards(ledger, m, `run ${run}`);
    seen.payments += ledger.payments.length;
    seen.exits += m.events.filter((e) => e.name === "Exited" || e.name === "Claimed").length;
    for (const p of ledger.people) {
      const first = m.events.findIndex((e) => e.name === "Funded" && e.args.funder === p.account);
      if (m.events.slice(0, first).some((e) => e.name === "PayoutExecuted")) seen.lateJoiners++;
      if (!p.inPot && ledger.payments.some((x) => !p.parts.some((y) => y.payment === x.index))) seen.leftEarly++;
      const r = p.rounding < 0n ? -p.rounding : p.rounding;
      if (r) seen.rounded++;
      if (r > seen.maxRounding) seen.maxRounding = r;
    }
    // Everyone's parts of a payment come to the payment, within a cent each.
    ledger.payments.forEach((pay) => {
      const sum = ledger.people.reduce((a, p) => a + (p.parts.find((x) => x.payment === pay.index)?.cents ?? 0n), 0n);
      const cents = pay.amount / 10_000n;
      assert.ok(sum >= cents - BigInt(ledger.people.length) - 1n && sum <= cents + BigInt(ledger.people.length), `run ${run}: payment ${pay.index}`);
    });
  }
  assert.ok(seen.payments > 800 && seen.exits > 300 && seen.lateJoiners > 200 && seen.leftEarly > 50, JSON.stringify(seen, (_, v) => (typeof v === "bigint" ? `${v}` : v)));
  assert.ok(seen.rounded > 0, "some cards needed a Rounding line, and still added up");
});

/** Pots run on NivPayPots itself; test/PotsLedger.t.sol replays each on the contract and checks every number. */
const vectors = JSON.parse(readFileSync(new URL("../../../test/vectors/ledger.json", import.meta.url), "utf8")) as {
  count: number;
  pots: { feeBps: string; feeCap: string; people: number; kind: number[]; who: number[]; amount: string[]; result: string[]; left: string[]; totalAssets: string; totalShares: string }[];
};

test("on every pot recorded from NivPayPots, the model gives the contract's numbers and the cards agree with funderInfo", () => {
  assert.equal(vectors.pots.length, vectors.count);
  const kinds = vectors.pots.flatMap((v) => v.kind);
  assert.ok(vectors.count >= 20 && [0, 1, 2, 3, 4].every((k) => kinds.filter((x) => x === k).length >= 10), "funds, exits, payments, closes and claims all recorded");
  vectors.pots.forEach((v, n) => {
    const m = new PotModel(BigInt(v.feeBps), BigInt(v.feeCap));
    const who = (i: number) => `p${i}`;
    const last = () => m.events.at(-1)!.args;
    v.kind.forEach((kind, k) => {
      const [p, amount, result] = [who(v.who[k]!), BigInt(v.amount[k]!), BigInt(v.result[k]!)];
      const at = `pot ${n}, action ${k}`;
      if (kind === 0) {
        assert.ok(m.fund(p, amount), at);
        assert.equal(last().sharesMinted, result, `${at}: sharesMinted`);
      } else if (kind === 1) {
        assert.ok(m.exit(p, amount), at);
        assert.equal(last().assets, result, `${at}: exit`);
      } else if (kind === 2) {
        assert.ok(m.pay(v.who[k]!, amount), at);
        assert.equal(last().fee, result, `${at}: fee`);
      } else if (kind === 4) {
        assert.ok(m.exit(p, m.held.get(p) ?? 0n, true), at);
        assert.equal(last().assets, result, `${at}: claim`);
      }
    });
    const left = Object.fromEntries(v.left.map((x, i) => [who(i), BigInt(x)]));
    v.left.forEach((x, i) => assert.equal(m.funderInfo(who(i)), BigInt(x), `pot ${n}: p${i}'s funderInfo`));
    const ledger = ledgerOf(m.events, 6, left);
    assert.equal(ledger.totalAssets, BigInt(v.totalAssets), `pot ${n}: what the pot holds`);
    assert.equal(ledger.totalShares, BigInt(v.totalShares), `pot ${n}: its shares`);
    assert.ok(agreesWithContract(ledger, left), `pot ${n}: the replay gives funderInfo`);
    checkCards(ledger, m, `pot ${n}`);
  });
});

test("Left for you is the contract's number; until the events and the numbers agree, the cards wait", () => {
  const m = new PotModel();
  m.fund("ana", $(100));
  m.pay(0, $(40));
  const read = m.all();
  const ledger = ledgerOf(m.events, 6, read);
  assert.equal(ledger.people[0]!.leftUnits, read.ana);
  assert.ok(agreesWithContract(ledger, read));
  // A newer event the replay hasn't read yet: the contract says less.
  const later = { ana: read.ana! - 1_000_000n };
  const stale = ledgerOf(m.events, 6, later);
  assert.equal(stale.people[0]!.left, (read.ana! - 1_000_000n) / 10_000n, "the contract's number is still the one shown");
  assert.equal(agreesWithContract(stale, later), false);
  assert.ok(agreesWithContract(ledgerOf(m.events, 6, {}), {}), "with nothing read, the replay is all there is");
});

test("the rounding is said, never hidden: a third of a cent each way still adds up", () => {
  const m = new PotModel(0n);
  for (const who of ["a", "b", "c"]) m.fund(who, $(1));
  m.pay(0, 1_000_000n); // $1 split three ways
  m.pay(0, 1_000_000n);
  const ledger = ledgerOf(m.events, 6, m.all());
  for (const p of ledger.people) {
    assert.equal(p.payments, 67n, "two thirds of $2, rounded once");
    assert.equal(p.left, p.putIn - p.payments - p.fees - p.takenOut + p.rounding);
  }
  checkCards(ledger, m, "thirds");
});

test("cards: mine first, then everyone in the order they first put money in", () => {
  const m = new PotModel();
  m.fund("0xbbb", $(10));
  m.fund("0xaaa", $(10));
  m.fund("0xccc", $(10));
  assert.deepEqual(
    cardsFor(ledgerOf(m.events, 6), "0xCCC").map((p) => p.account),
    ["0xccc", "0xbbb", "0xaaa"],
  );
  assert.deepEqual(
    cardsFor(ledgerOf(m.events, 6), "0xddd").map((p) => p.account),
    ["0xbbb", "0xaaa", "0xccc"],
    "someone with no money in sees everyone else's",
  );
});

test("whether a payment has been made yet", () => {
  const m = new PotModel();
  m.fund("a", $(10));
  assert.equal(anyPaymentMade(m.events), false);
  m.pay(0, $(1));
  assert.equal(anyPaymentMade(m.events), true);
});
