import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copy } from "../../app/src/copy.ts";
import { formatAmount } from "../../app/src/lib/money.ts";
import { feeFor } from "../../app/src/lib/payout.ts";
import { replaySteps } from "../../app/src/lib/story.ts";
import type { PotEvent } from "../../app/src/lib/feed.ts";
import { fact, FACTS, nullFacts, README_ROWS, shortHex } from "./facts.ts";

const doc = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const DECIMALS = 6;
const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10n ** BigInt(DECIMALS - 2);
const cents = (v: bigint) => formatAmount(v, DECIMALS, "cents");
const auto = (v: bigint) => formatAmount(v, DECIMALS, "auto");
// Both deployed pots, read from the chain (README, Contract addresses): feeBps 50, feeCap 50 AUSD.
const FEE_BPS = 50n;
const FEE_CAP = 50_000_000n;
const OFFSET = 1_000n;

/**
 * Mama's 60th as events, with shares minted by the contract's own rule
 * (virtual offset 10**3, rounding down), then read back through the app's
 * replay, which is what the phone shows as each person's share.
 */
function mamas60th() {
  const P = FACTS.pot;
  const who = { eddy: "0x00000000000000000000000000000000000000e1", maya: "0x00000000000000000000000000000000000000a2", daniel: "0x00000000000000000000000000000000000000d3" } as const;
  const events: PotEvent[] = [];
  let assets = 0n;
  let supply = 0n;
  let block = 1n;
  const push = (name: string, args: Record<string, unknown>) => events.push({ name, block: block++, logIndex: 0, tx: `0x${block.toString(16).padStart(64, "0")}`, args });
  for (const [k, put] of [["eddy", P.pours.eddy], ["maya", P.pours.maya], ["daniel", P.pours.daniel]] as const) {
    const amount = usd(Number(put.replace(/[$,]/g, "")));
    const minted = (amount * (supply + OFFSET)) / (assets + 1n);
    assets += amount;
    supply += minted;
    push("Funded", { funder: who[k], assets: amount, sharesMinted: minted });
  }
  const fees: bigint[] = [];
  for (const [i, pay] of [P.caterer.amount, P.eventHall.amount].entries()) {
    const amount = usd(Number(pay.replace(/[$,]/g, "")));
    const fee = feeFor(amount, FEE_BPS, FEE_CAP);
    fees.push(fee);
    push("PayoutExecuted", { destIndex: BigInt(i), amount, fee });
  }
  return { steps: replaySteps(events), fees, who };
}

test("the pours, fees, what is left and each share are the app's own arithmetic", () => {
  const P = FACTS.pot;
  const { steps, fees, who } = mamas60th();
  assert.equal(auto(steps[2]!.assets), P.total);
  assert.equal(cents(fees[0]!), P.caterer.fee);
  assert.equal(cents(steps[3]!.assets), P.caterer.after);
  assert.equal(cents(fees[1]!), P.eventHall.fee);
  assert.equal(cents(steps[4]!.assets), P.eventHall.after);
  assert.equal(cents(steps[4]!.assets), P.left);
  assert.equal(cents(fees[0]! + fees[1]!), P.fees);
  assert.equal(auto(usd(600) + usd(280)), P.paidOut);
  const held = steps[4]!.held;
  assert.equal(cents(held[who.eddy]!), P.shares.eddy);
  assert.equal(cents(held[who.maya]!), P.shares.maya);
  assert.equal(cents(held[who.daniel]!), P.shares.daniel);
  // Eddy put in half, so half of what is left: the reason the app says out loud.
  assert.equal(usd(500) * 2n, usd(1000));
  assert.equal(P.eddyFraction, "half");
  // Payments stay under each payee's limit.
  assert.ok(usd(600) <= usd(Number(FACTS.cast.caterer.limit.slice(1))));
  assert.ok(usd(280) <= usd(Number(FACTS.cast.eventHall.limit.slice(1))));
  // The fee rule as the facts state it.
  assert.equal(`${Number(FEE_BPS) / 100}%`, P.feeRate);
  assert.equal(auto(FEE_CAP), P.feeCap);
});

test("the bounty amounts are the ones the app formats and the script uses", () => {
  const B = FACTS.bounty;
  assert.equal(auto(usd(10_000)), B.testDollars);
  assert.equal(cents(usd(10_000)), B.balanceAfterClaim);
  assert.equal(auto(usd(25)), B.send);
  assert.equal(cents(usd(25)), B.received);
  assert.equal(auto(usd(10)), B.otherCurrencySend);
  // The send has no fee: NivPay covers it.
  const DEMO = doc("docs/DEMO.md");
  for (const s of [B.testDollars, B.balanceAfterClaim, `Amount **${B.send}**`, B.received, `You send **${B.otherCurrencySend}**`]) assert.ok(DEMO.includes(s), s);
});

test("the names, cities, pot and closing time are docs/SEEDING.md's and docs/DEMO.md's", () => {
  const SEEDING = doc("docs/SEEDING.md");
  const DEMO = doc("docs/DEMO.md");
  for (const p of [FACTS.cast.eddy, FACTS.cast.maya, FACTS.cast.daniel]) {
    assert.match(SEEDING, new RegExp(`^\\| ${p.name} \\| ${p.phone} \\| ${p.name} \\| ${p.city} \\|`, "m"), p.name);
  }
  assert.ok(DEMO.includes(`**${FACTS.cast.caterer.name}**, up to **${FACTS.cast.caterer.limit}**`));
  assert.ok(DEMO.includes(`**${FACTS.cast.eventHall.name}**, up to **${FACTS.cast.eventHall.limit}**`));
  assert.ok(DEMO.includes(`**${FACTS.pot.name}**`));
  assert.ok(DEMO.includes(`**${FACTS.pot.closesOn}**`));
  assert.ok(SEEDING.includes(`(${FACTS.pot.closesUtc.replace(" UTC", "")} UTC)`) || SEEDING.includes(FACTS.pot.closesUtc));
  assert.ok(DEMO.includes(`**${FACTS.pot.yesNeeded}** of ${FACTS.pot.deciders}`));
});

test("every address and hash is the README's, and the measured block time is the map's", () => {
  const README = doc("README.md");
  for (const [k, a] of Object.entries(FACTS.contracts)) assert.ok(README.includes(`[\`${a}\`](https://testnet.monadvision.com/address/${a})`), k);
  for (const [k, h] of Object.entries(FACTS.hashes.showcase)) assert.ok(README.includes(`[\`${h}\`](https://testnet.monadvision.com/tx/${h})`), k);
  // Pot 0 stays in the README as the showcase.
  assert.match(README, /^\| CreatePot, pot 0 \|/m);
  assert.match(doc("docs/APP-CONTRACT-MAP.md"), /\*\*Block time: 0\.31 s\.\*\*/);
  assert.equal(FACTS.chain.blockTime, "about 300 ms");
});

test("fact() reads a path, says null for unmeasured and undefined for unknown; nullFacts lists them", () => {
  assert.equal(fact("pot.caterer.fee"), "$3.00");
  assert.equal(fact("measured.sendSettle", { measured: { sendSettle: null } }), null);
  assert.equal(fact("pot.nothing"), undefined);
  assert.equal(fact("pot"), undefined);
  assert.deepEqual(nullFacts({ a: { b: null, c: "x" }, d: null }), ["a.b", "d"]);
  assert.ok(nullFacts().includes("hashes.take.send"));
  assert.equal(shortHex(FACTS.hashes.showcase.createPot), "0x6d1d...199c");
});

/** What disagrees between the README's take rows and facts.ts. Empty when they agree. */
function takeRowProblems(readme: string, take: Record<string, string | null>): string[] {
  const section = readme.slice(readme.indexOf("## Monad integration"), readme.indexOf("## Contract addresses"));
  const out: string[] = [];
  for (const [key, name] of Object.entries(README_ROWS)) {
    const row = section.split("\n").find((l) => l.startsWith(`| ${name} |`));
    const h = take[key] ?? null;
    const link = h === null ? "" : `[\`${h}\`](https://testnet.monadvision.com/tx/${h})`;
    if (!row) out.push(`${key}: no README row "${name}"`);
    else if (h === null && !row.includes("[PLACEHOLDER:")) out.push(`${key}: null in facts.ts but the README row is filled in`);
    else if (h !== null && row.includes("[PLACEHOLDER:")) out.push(`${key}: the README row still says PLACEHOLDER`);
    else if (h !== null && !row.includes(link)) out.push(`${key}: facts.ts and the README row differ`);
  }
  return out;
}

test("the README and facts.ts agree on every take hash: both blank, or both the same hash", () => {
  assert.deepEqual(takeRowProblems(doc("README.md"), FACTS.hashes.take), []);
  const h = `0x${"ab".repeat(32)}`;
  const g = `0x${"cd".repeat(32)}`;
  const doc_ = (rows: string[]) => ["## Monad integration", ...rows, "## Contract addresses"].join("\n");
  const filled = (name: string, x: string) => `| ${name} | [\`${x}\`](https://testnet.monadvision.com/tx/${x}) | 1 | t | w |`;
  const blank = (name: string) => `| ${name} | [PLACEHOLDER: fill in after the recording] | | | |`;
  const rest = [README_ROWS.fundWithPermit, README_ROWS.send, README_ROWS.swap].map(blank);
  const none = { createPot: null, fundWithPermit: null, send: null, swap: null };
  assert.deepEqual(takeRowProblems(doc_([filled(README_ROWS.createPot, h), ...rest]), { ...none, createPot: h }), []);
  assert.match(takeRowProblems(doc_([filled(README_ROWS.createPot, h), ...rest]), none).join(), /null in facts\.ts but the README row is filled in/);
  assert.match(takeRowProblems(doc_([blank(README_ROWS.createPot), ...rest]), { ...none, createPot: h }).join(), /still says PLACEHOLDER/);
  assert.match(takeRowProblems(doc_([filled(README_ROWS.createPot, g), ...rest]), { ...none, createPot: h }).join(), /differ/);
  assert.match(takeRowProblems(doc_(rest), none).join(), /no README row/);
});

test("the confirm step is the app's own sheet: Sending to account ending and the last four", () => {
  const id = "0x00000000000000000000000000000000000AbCd1";
  assert.equal(copy.sendingTo(copy.accountEnding(id)), "Sending to account ending bCd1");
});
