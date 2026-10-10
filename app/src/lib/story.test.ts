import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address, Hex } from "viem";
import type { PotEvent } from "./feed.ts";
import { formatAmount } from "./money.ts";
import { ordered, replayStepMs, replaySteps, storyRows, type StoryNames } from "./story.ts";

const $ = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;
const IDARA = "0x1111111111111111111111111111111111111111" as Address;
const UBONG = "0x2222222222222222222222222222222222222222" as Address;
const ANIEKAN = "0x3333333333333333333333333333333333333333" as Address;
const STRANGER = "0x4444444444444444444444444444444444444444" as Address;
const CATERER = "0x5555555555555555555555555555555555555555" as Address;
const TTL = 604_800n;
const T0 = 1_800_000_000n;

let block = 100;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
/** Events in one request share its tx and block, with rising log indexes. */
function request(...events: [string, Record<string, unknown>][]): PotEvent[] {
  block += 1;
  return events.map(([name, args], logIndex) => ({ name, block: BigInt(block), logIndex, tx: tx(block), args: { potId: 0n, ...args } }));
}

// The contract's own minting: assets * (supply + 10**3) / (assets in pot + 1), rounded down.
let supply = 0n;
let held = 0n;
function minted(assets: bigint): bigint {
  const m = (assets * (supply + 1_000n)) / (held + 1n);
  supply += m;
  held += assets;
  return m;
}
const mIdara = minted($(500));
const mUbong = minted($(400));
const mAniekan = minted($(100));

const story: PotEvent[] = [
  ...request(["PotCreated", { creator: IDARA }]),
  ...request(["Funded", { funder: IDARA, assets: $(500), sharesMinted: mIdara }]),
  ...request(["Funded", { funder: UBONG, assets: $(400), sharesMinted: mUbong }]),
  ...request(["Funded", { funder: ANIEKAN, assets: $(100), sharesMinted: mAniekan }]),
  // Aniekan asks for the Caterer; Ubong's yes pays it.
  ...request(
    ["Proposed", { proposalId: 0n, proposer: ANIEKAN, kind: 0, destIndex: 0, amount: $(600), expiresAt: T0 + TTL }],
    ["Approved", { proposalId: 0n, approver: ANIEKAN, approvals: 1 }],
  ),
  ...request(
    ["Approved", { proposalId: 0n, approver: UBONG, approvals: 2 }],
    ["PayoutExecuted", { proposalId: 0n, destination: CATERER, destIndex: 0, amount: $(600), fee: $(3) }],
  ),
  // A request asked by mistake and withdrawn; one yes given and taken back.
  ...request(
    ["Proposed", { proposalId: 1n, proposer: ANIEKAN, kind: 0, destIndex: 1, amount: $(28), expiresAt: T0 + TTL }],
    ["Approved", { proposalId: 1n, approver: ANIEKAN, approvals: 1 }],
  ),
  ...request(["ProposalCancelled", { proposalId: 1n, proposer: ANIEKAN }]),
  ...request(
    ["Proposed", { proposalId: 2n, proposer: ANIEKAN, kind: 0, destIndex: 1, amount: $(280), expiresAt: T0 + TTL }],
    ["Approved", { proposalId: 2n, approver: ANIEKAN, approvals: 1 }],
  ),
  ...request(["Frozen", { approver: UBONG }]),
  ...request(["Unfrozen", { proposalId: 9n }]),
  ...request(
    ["Approved", { proposalId: 2n, approver: IDARA, approvals: 2 }],
    ["PayoutExecuted", { proposalId: 2n, destination: STRANGER, destIndex: 1, amount: $(280), fee: $(1.4) }],
  ),
  // Idara asks to close early, Ubong agrees.
  ...request(
    ["Proposed", { proposalId: 3n, proposer: IDARA, kind: 1, destIndex: 0, amount: 0n, expiresAt: T0 + TTL }],
    ["Approved", { proposalId: 3n, approver: IDARA, approvals: 1 }],
  ),
  // A yes for a request this pot never asked is not told.
  ...request(["Approved", { proposalId: 4n, approver: UBONG, approvals: 1 }]),
  ...request(
    ["Approved", { proposalId: 3n, approver: UBONG, approvals: 2 }],
    ["Closed", { viaProposal: true, remainingAssets: $(115.6) }],
  ),
];

const names: StoryNames = {
  me: IDARA,
  nameOf: (a) => ({ [IDARA]: "Idara", [UBONG]: "Ubong", [ANIEKAN]: "Aniekan" })[a] ?? `account ending ${a.slice(-4)}`,
  cityOf: (a) => ({ [IDARA]: "London", [UBONG]: "Houston", [ANIEKAN]: "Uyo" })[a] ?? "",
  payeeName: (i) => ["Caterer", "Event hall"][i] ?? "",
  money: (v) => formatAmount(v, 6, "cents"),
  now: T0 + 60n,
};

test("the story tells each finalized event once, in the people's own names", () => {
  const rows = storyRows(story, names);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.title, r.sub]),
    [
      ["made", "You made the pot", "From London"],
      ["added", "You added $500.00", "From London"],
      ["added", "Ubong added $400.00", "From Houston"],
      ["added", "Aniekan added $100.00", "From Uyo"],
      ["asked", "Aniekan asked to pay $600.00 to Caterer", "Agreed"],
      ["paid", "Paid $600.00 to Caterer", "Aniekan asked, Ubong said yes · fee $3.00"],
      ["asked", "Aniekan asked to pay $28.00 to Event hall", "Withdrawn"],
      ["withdrawn", "Aniekan withdrew a request", "To pay $28.00 to Event hall"],
      ["asked", "Aniekan asked to pay $280.00 to Event hall", "Agreed"],
      ["paused", "Ubong paused payments and pour-ins", "Taking a share out still works"],
      ["unpaused", "Payments and pour-ins are back on", ""],
      ["paid", "Paid $280.00 to Event hall", "Aniekan asked, you said yes · fee $1.40"],
      ["asked-close", "You asked to close the pot early", "Agreed"],
      ["closed", "The pot closed early", "You asked, Ubong agreed · $115.60 left to share"],
    ],
  );
  for (const r of rows) assert.match(r.tx, /^0x[0-9a-f]{64}$/, "every row has its receipt");
});

test("a yes on its own, a yes taken back, a request still waiting and one expired each get their row", () => {
  const extra: PotEvent[] = [
    ...story.slice(0, 4),
    ...request(
      ["Proposed", { proposalId: 7n, proposer: ANIEKAN, kind: 0, destIndex: 0, amount: $(50), expiresAt: T0 + TTL }],
      ["Approved", { proposalId: 7n, approver: ANIEKAN, approvals: 1 }],
    ),
    ...request(["Approved", { proposalId: 7n, approver: UBONG, approvals: 2 }]),
    ...request(["ApprovalRevoked", { proposalId: 7n, approver: UBONG, approvals: 1 }]),
    ...request(["Exited", { funder: UBONG, sharesBurned: mUbong, assets: $(400) }]),
    ...request(["Claimed", { funder: STRANGER, sharesBurned: 1n, assets: $(1) }]),
  ];
  const rows = storyRows(extra, names).slice(4);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.title, r.sub]),
    [
      ["asked", "Aniekan asked to pay $50.00 to Caterer", "Waiting for a yes"],
      ["yes", "Ubong said yes", "To pay $50.00 to Caterer"],
      ["took-back", "Ubong took back their yes", "To pay $50.00 to Caterer"],
      ["took-out", "Ubong took $400.00 out", "Their share, before the pot closed"],
      ["share", "Account ending 4444 took their share, $1.00", "What was left, by share"],
    ],
  );
  assert.equal(storyRows(extra, { ...names, now: T0 + TTL + 1n })[4]!.sub, "Expired. Nothing moved.");
});

test("newest first by default, oldest first on request", () => {
  const rows = storyRows(story, names);
  assert.equal(ordered(rows, "newest")[0]!.kind, "closed");
  assert.equal(ordered(rows, "oldest")[0]!.kind, "made");
  assert.deepEqual(ordered(rows, "oldest").map((r) => r.key), rows.map((r) => r.key));
});

test("the replay holds what the contract holds at each step, and ends on its exact split", () => {
  const steps = replaySteps(story);
  assert.deepEqual(steps.map((s) => s.assets), [$(500), $(900), $(1000), $(397), $(115.6)]);
  assert.deepEqual(steps.map((s) => s.payee), [null, null, null, 0, 1]);
  const end = steps.at(-1)!.held;
  // The contract rounds down; the split is $57.80, $46.24 and $11.56 to the cent.
  assert.equal(formatAmount(end[IDARA]!, 6, "cents"), "$57.80");
  assert.equal(formatAmount(end[UBONG]!, 6, "cents"), "$46.24");
  assert.equal(formatAmount(end[ANIEKAN]!, 6, "cents"), "$11.56");
  assert.ok(end[IDARA]! + end[UBONG]! + end[ANIEKAN]! <= $(115.6), "never more than the pot holds");
});

test("the replay takes about 7 s however long the story", () => {
  assert.equal(replayStepMs(0), 0);
  assert.equal(replayStepMs(5), 1_100);
  assert.equal(replayStepMs(14), 500);
  assert.ok(replayStepMs(100) * 100 <= 7_000);
});
