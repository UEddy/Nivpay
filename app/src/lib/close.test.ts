import { test } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { ERROR_CODES } from "../copy.ts";
import { askCloseLabel, closeRefusalFor, closeState, putInBy, shareFraction, splitNow, takeLabel, takeView, totalsOf } from "./close.ts";
import type { PotEvent } from "./feed.ts";
import { formatAmount } from "./money.ts";

const $ = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;
const IDARA = "0x1111111111111111111111111111111111111111";
const UBONG = "0x2222222222222222222222222222222222222222";

/** The contract's own minting and burning, to build share numbers the way it does. */
class Pot {
  assets = 0n;
  supply = 0n;
  shares = new Map<string, bigint>();
  fund(who: string, amount: bigint) {
    const m = (amount * (this.supply + 1_000n)) / (this.assets + 1n);
    this.assets += amount;
    this.supply += m;
    this.shares.set(who, (this.shares.get(who) ?? 0n) + m);
  }
  pay(amount: bigint) {
    this.assets -= amount;
  }
  worth(who: string) {
    return ((this.shares.get(who) ?? 0n) * (this.assets + 1n)) / (this.supply + 1_000n);
  }
}

test("labels for a reload name the pot", () => {
  assert.equal(takeLabel(3n), "take 3");
  assert.equal(askCloseLabel(3n), "ask close 3");
});

test("taking a share out: exit while open, claim once closed, refused with 94 when there is nothing", () => {
  assert.deepEqual(takeView({ closed: false, myShares: 5n, myWorth: $(57.8) }), { action: "exit", amount: $(57.8), refusal: null });
  assert.deepEqual(takeView({ closed: true, myShares: 5n, myWorth: $(57.8) }), { action: "claim", amount: $(57.8), refusal: null });
  const nothing = takeView({ closed: true, myShares: 0n, myWorth: 0n });
  assert.equal(nothing.action, null);
  assert.equal(nothing.refusal?.code, ERROR_CODES.NOTHING_TO_TAKE);
  // Shares worth nothing (the pot was spent) can still be taken: the contract burns them and sends nothing.
  assert.equal(takeView({ closed: false, myShares: 5n, myWorth: 0n }).action, "exit");
});

test("every refusal when closing or taking a share out has its code", () => {
  const cases: [string | undefined, number][] = [
    ["ZeroShares", ERROR_CODES.NOTHING_TO_TAKE],
    ["InsufficientShares", ERROR_CODES.NOTHING_TO_TAKE],
    ["PotNotClosed", ERROR_CODES.NOT_CLOSED_YET],
    ["PotClosed", ERROR_CODES.POT_ALREADY_CLOSED],
    ["NotApprover", ERROR_CODES.NOT_DECIDER],
    ["SafeERC20FailedOperation", ERROR_CODES.TAKE_REFUSED],
    [undefined, ERROR_CODES.TAKE_REFUSED],
  ];
  for (const [name, code] of cases) assert.equal(closeRefusalFor(name).code, code, String(name));
});

test("closed early, closed on its date, or open, judged at the finalized block's time", () => {
  assert.equal(closeState(false, 100n, 50n), "open");
  assert.equal(closeState(true, 100n, 50n), "closed-early");
  assert.equal(closeState(true, 100n, 100n), "closed-on-date", "from endTime on, as _isClosed");
});

const ev = (name: string, n: number, args: Record<string, unknown>): PotEvent => ({ name, block: BigInt(n), logIndex: 0, tx: `0x${n.toString(16).padStart(64, "0")}` as Hex, args });

test("what went in, was paid, went on fees and was taken out", () => {
  const events = [
    ev("Funded", 1, { funder: IDARA, assets: $(500) }),
    ev("Funded", 2, { funder: UBONG, assets: $(400) }),
    ev("Funded", 3, { funder: IDARA, assets: $(100) }),
    ev("PayoutExecuted", 4, { amount: $(600), fee: $(3) }),
    ev("PayoutExecuted", 5, { amount: $(280), fee: $(1.4) }),
  ];
  assert.deepEqual(totalsOf(events), { wentIn: $(1000), paid: $(880), fees: $(4.4), takenOut: 0n, anyTaken: false });
  assert.equal(putInBy(events).get(IDARA), $(600));
  const after = totalsOf([...events, ev("Claimed", 6, { funder: IDARA, assets: $(57.8) })]);
  assert.equal(after.takenOut, $(57.8));
  assert.equal(after.anyTaken, true);
});

test("Mama's 60th: the share follows what was put in, so the reason is said, and the split is the contract's", () => {
  const pot = new Pot();
  pot.fund(IDARA, $(500));
  pot.fund(UBONG, $(400));
  pot.fund("aniekan", $(100));
  pot.pay($(603));
  pot.pay($(281.4));
  assert.equal(shareFraction($(500), $(1000), pot.shares.get(IDARA)!, pot.supply, false), "half");
  assert.equal(shareFraction($(400), $(1000), pot.shares.get(UBONG)!, pot.supply, false), "40%");
  assert.equal(shareFraction($(100), $(1000), pot.shares.get("aniekan")!, pot.supply, false), "10%");
  const split = splitNow(
    [IDARA, UBONG, "aniekan"].map((a) => ({ account: a, worth: pot.worth(a) })),
    pot.assets,
  );
  assert.deepEqual(split.rows.map((r) => formatAmount(r.worth, 6, "cents")), ["$57.80", "$46.24", "$11.56"]);
  assert.ok(split.rest < 10n, "only rounding dust is left over");
});

test("a pour after a payment buys shares at the lower value, so 'half the pot' would mislead and is not said", () => {
  const pot = new Pot();
  pot.fund(IDARA, $(500));
  pot.pay($(400));
  pot.fund(UBONG, $(500));
  assert.equal(shareFraction($(500), $(1000), pot.shares.get(IDARA)!, pot.supply, false), null);
  assert.ok(pot.worth(UBONG) > pot.worth(IDARA), "Ubong bore none of the earlier payment");
});

test("once anyone has taken a share out, what was put in no longer explains a share", () => {
  const pot = new Pot();
  pot.fund(IDARA, $(500));
  pot.fund(UBONG, $(500));
  assert.equal(shareFraction($(500), $(1000), pot.shares.get(IDARA)!, pot.supply, false), "half");
  assert.equal(shareFraction($(500), $(1000), pot.shares.get(IDARA)!, pot.supply, true), null);
  assert.equal(shareFraction($(1000), $(1000), pot.supply, pot.supply, false), "all");
  assert.equal(shareFraction(0n, $(1000), 0n, pot.supply, false), null);
});

test("the split lists people with something to take, and what is left for anyone else", () => {
  const s = splitNow([{ account: IDARA, worth: $(60) }, { account: UBONG, worth: 0n }], $(100));
  assert.deepEqual(s.rows.map((r) => r.account), [IDARA]);
  assert.equal(s.rest, $(40));
});
