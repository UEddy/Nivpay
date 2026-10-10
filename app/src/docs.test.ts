import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import { ERROR_CODES } from "./copy.ts";
import { AUSD, AUSD_FAUCET, CTK, DEPLOY_BLOCK, POTS_AUSD, POTS_TESTUSD, SETTLEMENT_PAIR, SETTLEMENT_WHITELISTER, TESTUSD } from "./lib/config.ts";
import { formatAmount } from "./lib/money.ts";
import { feeFor } from "./lib/payout.ts";

/**
 * docs/DEMO.md is read aloud on camera, so its numbers are checked against
 * the app's own arithmetic and the contract's share conversion, not trusted.
 */
const doc = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const DEMO = doc("docs/DEMO.md");
const README = doc("README.md");
const CODES_DOC = doc("docs/ERROR-CODES.md");

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

test("docs/ERROR-CODES.md has a row for exactly the codes the app can show, each once", () => {
  const rows = [...CODES_DOC.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1]));
  assert.equal(new Set(rows).size, rows.length, "a code has two rows");
  assert.deepEqual([...rows].sort((a, b) => a - b), [...new Set<number>(Object.values(ERROR_CODES))].sort((a, b) => a - b));
});

test("every contract in the README's address table is the one the app uses", () => {
  const table = README.slice(README.indexOf("## Contract addresses"), README.indexOf("## What the contract can and cannot do"));
  const expected: [string, string][] = [
    ["NivPayPots on AUSD", POTS_AUSD],
    ["NivPayPots on TESTUSD", POTS_TESTUSD],
    ["NivPayTestDollar (TESTUSD)", TESTUSD],
    ["AUSD (Agora)", AUSD],
    ["Agora AUSD faucet", AUSD_FAUCET],
    ["Agora Instant Settlement pair, AUSD and CTK", SETTLEMENT_PAIR],
    ["Agora whitelister", SETTLEMENT_WHITELISTER],
    ["CTK (ConstantToken)", CTK],
  ];
  for (const [name, address] of expected) {
    const row = table.split("\n").find((l) => l.startsWith(`| ${name} |`));
    assert.ok(row, name);
    const [linked, shown] = [/address\/(0x[0-9a-fA-F]{40})\)/.exec(row)?.[1], /`(0x[0-9a-fA-F]{40})`/.exec(row)?.[1]];
    assert.equal(linked, address, `${name} link`);
    assert.equal(shown, address, `${name} text`);
  }
  // The pots deploy blocks the app starts its reads from are the ones in the receipts the README points to.
  assert.equal(DEPLOY_BLOCK[POTS_AUSD], 66096162n);
  assert.equal(DEPLOY_BLOCK[POTS_TESTUSD], 66096818n);
});

test("every transaction under Monad integration links to its own hash on MonadVision, and the missing ones are marked", () => {
  const section = README.slice(README.indexOf("## Monad integration"), README.indexOf("## Contract addresses"));
  const links = [...section.matchAll(/\[`(0x[0-9a-f]{64})`\]\(https:\/\/testnet\.monadvision\.com\/tx\/(0x[0-9a-f]{64})\)/g)];
  for (const name of ["CreatePot, pot 0", "FundWithPermit, the first deposit in pot 0", "Add test dollars, a faucet claim"]) {
    assert.match(section, new RegExp(`^\| ${name} \| \[\`0x[0-9a-f]{64}\`\]`, "m"), name);
  }
  assert.ok(links.length >= 5);
  for (const [, shown, linked] of links) assert.equal(shown, linked);
  assert.equal(new Set(links.map((l) => l[1])).size, links.length, "a hash is listed twice");
  assert.equal([...section.matchAll(/\[PLACEHOLDER: fill in after the phone test\]/g)].length, 2);
  // Accounts named there are written with their checksum, as the app shows them.
  for (const [, a] of section.matchAll(/`(0x[0-9a-fA-F]{40})`/g)) assert.equal(a, getAddress(a!));
});

test("docs/PERF-S10.md covers the five motions, and every demo step it points to exists", () => {
  const perf = doc("docs/PERF-S10.md");
  const rows = [...perf.matchAll(/^\| (Timeline Replay|Close|Create|ChipIn|Approve) \|/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(rows)].sort(), ["Approve", "ChipIn", "Close", "Create", "Timeline Replay"]);
  const steps = [...perf.matchAll(/DEMO\.md step (\d+\.\d+)(?: or (\d+\.\d+))?|after step (\d+\.\d+)/g)].flatMap((m) => [m[1], m[2], m[3]].filter(Boolean) as string[]);
  assert.ok(steps.length >= 5);
  for (const s of steps) assert.match(DEMO, new RegExp(`^\| ${s.replace(".", "\.")} \|`, "m"), `DEMO.md step ${s}`);
  assert.match(perf, /https:\/\/developer\.samsung\.com\/android-usb-driver/);
});

test("the README's contract claims point at the source lines that prove them", () => {
  const sol = doc("src/NivPayPots.sol").split("\n");
  const at = (line: number) => sol[line - 1] ?? "";
  const expect: [number, RegExp][] = [
    [47, /PROPOSAL_TTL = 7 days/],
    [48, /MAX_FEE_BPS = 100/],
    [237, /feeBps_ > MAX_FEE_BPS/],
    [268, /endTime <= block\.timestamp\) revert EndTimeInPast/],
    [337, /pot\.frozen\) revert PotFrozen/],
    [357, /_shares\[potId\]\[msg\.sender\] \+= sharesMinted/],
    [370, /function exit\(/],
    [378, /!_isClosed\(pot\)\) revert PotNotClosed/],
    [386, /shares > held\) revert InsufficientShares/],
    [392, /_shares\[potId\]\[msg\.sender\] = held - shares/],
    [418, /pot\.frozen\) revert PotFrozen/],
    [471, /PROPOSAL_TTL\) revert ProposalExpired/],
    [475, /ProposalKind\.Payout && pot\.frozen/],
    [518, /pot\.frozen = false/],
    [531, /pot\.frozen\) revert PotFrozen/],
    [560, /feesAccrued \+= fee/],
    [579, /_isApprover\[potId\]\[msg\.sender\]\) revert NotApprover/],
    [580, /pot\.frozen\) revert PotFrozen/],
    [604, /msg\.sender != feeRecipient\) revert NotFeeRecipient/],
    [627, /closedFlag \|\| block\.timestamp >= pot\.endTime/],
  ];
  for (const [line, re] of expect) assert.match(at(line), re, `src/NivPayPots.sol:${line}`);
  assert.equal(sol.filter((l) => /pot\.frozen = false/.test(l)).length, 1, "one place unpauses");
  assert.equal(sol.filter((l) => /_shares\[potId\]\[[^\]]+\] (\+?=|-=)/.test(l)).length, 2, "shares are written in two places only");
  const code = sol.filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(code, /\bowner\b|Ownable|AccessControl|delegatecall|selfdestruct|assembly/, "outside comments");
  assert.match(README, /\| A pause stops pour-ins and payments, never exits \| frozen is checked in `_fund` \(337\)/);
});
