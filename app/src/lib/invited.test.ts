import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Address, type Hex } from "viem";
import { copy } from "../copy.ts";
import type { FoundPot } from "./discover.ts";
import { answered, creationBlock, InvitedStore, matchInvites, SCAN_PAGES_PER_POLL, STALE_MS, type CreatorReader } from "./invited.ts";
import { NO_SLOT, ROLE, verifyLabels, type Invite } from "./invites.ts";
import { linkFor } from "./potstore.ts";

const IDARA = getAddress("0x1111111111111111111111111111111111117bc1");
const UBONG = getAddress("0x2222222222222222222222222222222222224e2a");
const ANIEKAN = getAddress("0x3333333333333333333333333333333333339f10");
const DRAFT: Hex = "0x00112233445566778899aabbccddeeff";

const invite: Invite = {
  kind: "invite",
  draftId: DRAFT,
  role: ROLE.decider,
  slot: NO_SLOT,
  from: "Idara",
  potName: "Mama’s 60th",
  payeeName: "",
  inviter: IDARA,
  share: 0n,
};

function memory() {
  const map = new Map<string, string>();
  return new InvitedStore({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) });
}

test("an answered invite keeps the pot name, the inviter's account and the suggested share", () => {
  const row = answered({ ...invite, role: ROLE.payee, slot: "0x0102030405060708", share: 600_000_000n }, "ausd", UBONG, 1_000, {
    block: 47_000_000n,
    potCount: 12,
  });
  assert.equal(row.potName, "Mama’s 60th");
  assert.equal(row.from, "Idara");
  assert.equal(row.inviter, IDARA);
  assert.equal(row.share, "600000000");
  assert.deepEqual(row.since, { block: "47000000", potCount: 12 });
  assert.equal(row.answeredAt, 1_000);
});

test("an answer given offline is kept without where things stood", () => {
  const row = answered(invite, "ausd", UBONG, 1_000);
  assert.equal(row.since, undefined);
});

test("a version 1 invite is remembered with no inviter account", () => {
  const row = answered({ ...invite, inviter: null }, "ausd", UBONG, 1_000);
  assert.equal(row.inviter, null);
});

test("Home lists each account's own waiting invites, newest first, and answering again replaces the row", () => {
  const store = memory();
  store.put(answered(invite, "ausd", UBONG, 1_000));
  store.put(answered({ ...invite, draftId: "0xffeeddccbbaa99887766554433221100", potName: "Rent" }, "ausd", UBONG, 2_000));
  store.put(answered(invite, "ausd", ANIEKAN, 1_500));
  store.put(answered(invite, "testusd", UBONG, 1_500));
  assert.deepEqual(
    store.forAccount("ausd", UBONG, 3_000).map((r) => r.potName),
    ["Rent", "Mama’s 60th"],
  );
  store.put(answered({ ...invite, potName: "Mama’s 60th party" }, "ausd", UBONG, 2_500));
  assert.deepEqual(
    store.forAccount("ausd", UBONG, 3_000).map((r) => r.potName),
    ["Mama’s 60th party", "Rent"],
  );
});

test("a pot still waiting after 14 days is removed", () => {
  const store = memory();
  store.put(answered(invite, "ausd", UBONG, 0));
  assert.equal(store.forAccount("ausd", UBONG, STALE_MS).length, 1, "kept on day 14");
  assert.equal(store.forAccount("ausd", UBONG, STALE_MS + 1).length, 0, "gone after");
  assert.equal(store.forAccount("ausd", UBONG, 0).length, 0, "and gone from storage, not just hidden");
});

test("damaged storage reads as nothing waiting", () => {
  const store = new InvitedStore({ getItem: () => "{not json", setItem: () => {} });
  assert.deepEqual(store.forAccount("ausd", UBONG, 0), []);
  const odd = new InvitedStore({ getItem: () => JSON.stringify([{ account: "nope" }, null]), setItem: () => {} });
  assert.deepEqual(odd.forAccount("ausd", UBONG, 0), []);
});

test("the waiting row says who invited and that the pot isn't made yet", () => {
  assert.equal(copy.invitedWaiting("Mama’s 60th", "Idara"), "Invited to Mama’s 60th by Idara. Waiting for the pot to be made.");
  assert.equal(copy.invitedShare("$600"), "Suggested share $600, not checked yet.");
});

// ---------------------------------------------------------------------------
// Matching an answered invite to the pot its inviter made
// ---------------------------------------------------------------------------

type FakePot = { creator: Address; block: bigint; deciders: Address[]; payees: Address[] };
const STRANGER = getAddress("0x4444444444444444444444444444444444440d0d");
const CATERER = getAddress("0x5555555555555555555555555555555555551c1c");
const DEPLOYED = 1_000n;

/** A pots contract in memory: pot n is pots[n]. Counts every read. */
function fakeChain(pots: FakePot[], opts: { pastState?: boolean; head?: bigint } = {}) {
  const calls = { finalized: 0, potCountAt: 0, created: 0, members: 0 };
  const reader: CreatorReader = {
    finalized: async () => (calls.finalized++, opts.head ?? 10_000n),
    potCountAt: async (at) => {
      calls.potCountAt++;
      if (opts.pastState === false) throw new Error("state not available");
      return pots.filter((p) => p.block <= at).length;
    },
    created: async (from, to, creator, potId) => {
      calls.created++;
      assert.ok(to - from <= 100n, "pages stay inside the log limit");
      return pots
        .map((p, i) => ({ potId: BigInt(i), ...p }))
        .filter((p) => p.block >= from && p.block <= to && p.creator === creator && (potId === undefined || p.potId === potId))
        .map((p) => ({ potId: p.potId, block: p.block }));
    },
    members: async (potId) => (calls.members++, { deciders: pots[Number(potId)]!.deciders, payees: pots[Number(potId)]!.payees }),
  };
  return { reader, calls };
}

const foundPot = (potId: number, roles: FoundPot["roles"], name = "Mama’s 60th"): FoundPot => ({
  potId: String(potId),
  roles,
  name,
  totalAssets: "0",
  endTime: "0",
  closed: false,
});

const waitingFor = (over: Partial<Invite> = {}, since?: { block: bigint; potCount: number }) => answered({ ...invite, ...over }, "ausd", UBONG, 0, since);

test("bisecting the pot count finds the block a pot was made in", async () => {
  const pots: FakePot[] = [3_000n, 3_000n, 4_217n, 9_999n].map((block) => ({ creator: IDARA, block, deciders: [], payees: [] }));
  const { reader } = fakeChain(pots);
  assert.equal(await creationBlock(reader, 0n, DEPLOYED, 10_000n), 3_000n);
  assert.equal(await creationBlock(reader, 2n, DEPLOYED, 10_000n), 4_217n);
  assert.equal(await creationBlock(reader, 3n, 4_217n, 10_000n), 9_999n);
});

test("waiting: with no pot naming this account, nothing is read", async () => {
  const { reader, calls } = fakeChain([]);
  const [row] = await matchInvites([waitingFor()], [], reader, DEPLOYED);
  assert.equal(row!.match, undefined);
  assert.deepEqual(calls, { finalized: 0, potCountAt: 0, created: 0, members: 0 });
});

test("matched: a pot the inviter made that names this account becomes the invite's pot", async () => {
  const pots: FakePot[] = [
    { creator: STRANGER, block: 2_000n, deciders: [STRANGER], payees: [CATERER] },
    { creator: IDARA, block: 5_432n, deciders: [IDARA, UBONG, ANIEKAN], payees: [CATERER] },
  ];
  const { reader } = fakeChain(pots);
  const [row] = await matchInvites([waitingFor({}, { block: 5_000n, potCount: 1 })], [foundPot(1, ["decides"])], reader, DEPLOYED);
  assert.deepEqual(row!.match, { potId: "1", block: "5432", deciders: [IDARA, UBONG, ANIEKAN], payees: [CATERER] });
});

test("never on a name alone: a pot with the same name made by someone else is not matched", async () => {
  const pots: FakePot[] = [{ creator: STRANGER, block: 5_432n, deciders: [STRANGER, UBONG], payees: [CATERER] }];
  const { reader, calls } = fakeChain(pots);
  const [row] = await matchInvites([waitingFor({}, { block: 5_000n, potCount: 0 })], [foundPot(0, ["decides"], "Mama’s 60th")], reader, DEPLOYED);
  assert.equal(row!.match, undefined);
  assert.deepEqual(row!.notFrom, ["0"], "remembered, so it isn't checked again");
  const before = { ...calls };
  await matchInvites([row!], [foundPot(0, ["decides"])], reader, DEPLOYED);
  assert.deepEqual(calls, before, "no reads the second time");
});

test("never on the inviter alone: a pot the inviter made that doesn't name this account in the invited role is not a candidate", async () => {
  const pots: FakePot[] = [{ creator: IDARA, block: 5_432n, deciders: [IDARA], payees: [UBONG] }];
  const { reader, calls } = fakeChain(pots);
  // Invited to decide, but named only as someone the pot can pay.
  const [row] = await matchInvites([waitingFor({}, { block: 5_000n, potCount: 0 })], [foundPot(0, ["paid"])], reader, DEPLOYED);
  assert.equal(row!.match, undefined);
  assert.equal(calls.created, 0);
  // Invited to be paid, it matches.
  const [payee] = await matchInvites([waitingFor({ role: ROLE.payee, slot: "0x0102030405060708" }, { block: 5_000n, potCount: 0 })], [foundPot(0, ["paid"])], reader, DEPLOYED);
  assert.equal(payee!.match?.potId, "0");
});

test("a pot made before the invite was answered is not a candidate", async () => {
  const pots: FakePot[] = [{ creator: IDARA, block: 2_000n, deciders: [IDARA, UBONG], payees: [CATERER] }];
  const { reader, calls } = fakeChain(pots);
  const [row] = await matchInvites([waitingFor({}, { block: 5_000n, potCount: 1 })], [foundPot(0, ["decides"])], reader, DEPLOYED);
  assert.equal(row!.match, undefined);
  assert.equal(calls.created, 0);
});

test("one pot is matched to one invite: two invites from the same person take two pots", async () => {
  const pots: FakePot[] = [
    { creator: IDARA, block: 5_100n, deciders: [IDARA, UBONG], payees: [CATERER] },
    { creator: IDARA, block: 5_200n, deciders: [IDARA, UBONG], payees: [CATERER] },
  ];
  const { reader } = fakeChain(pots);
  const rows = [waitingFor({}, { block: 5_000n, potCount: 0 }), waitingFor({ draftId: "0xffeeddccbbaa99887766554433221100" }, { block: 5_000n, potCount: 0 })];
  const out = await matchInvites(rows, [foundPot(1, ["decides"]), foundPot(0, ["decides"])], reader, DEPLOYED);
  assert.deepEqual(out.map((r) => r.match?.potId), ["0", "1"]);
});

test("an invite made before it carried the inviter's account is never matched", async () => {
  const pots: FakePot[] = [{ creator: IDARA, block: 5_432n, deciders: [IDARA, UBONG], payees: [CATERER] }];
  const { reader, calls } = fakeChain(pots);
  const [row] = await matchInvites([waitingFor({ inviter: null })], [foundPot(0, ["decides"])], reader, DEPLOYED);
  assert.equal(row!.match, undefined);
  assert.equal(calls.finalized, 0);
});

test("answered offline: the search starts from when the pots were deployed", async () => {
  const pots: FakePot[] = [{ creator: IDARA, block: 5_432n, deciders: [IDARA, UBONG], payees: [CATERER] }];
  const { reader } = fakeChain(pots);
  const [row] = await matchInvites([waitingFor()], [foundPot(0, ["decides"])], reader, DEPLOYED);
  assert.equal(row!.match?.block, "5432");
});

test("without past state, the inviter's pots are read forward a few pages per poll, and the place is kept", async () => {
  const pots: FakePot[] = [{ creator: IDARA, block: 9_000n, deciders: [IDARA, UBONG], payees: [CATERER] }];
  const { reader, calls } = fakeChain(pots, { pastState: false });
  let [row] = await matchInvites([waitingFor({}, { block: 5_000n, potCount: 0 })], [foundPot(0, ["decides"])], reader, DEPLOYED);
  assert.equal(row!.match, undefined, "4,000 blocks is more than one poll reads");
  assert.equal(calls.created, SCAN_PAGES_PER_POLL);
  assert.equal(row!.scannedTo, String(5_000n + BigInt(SCAN_PAGES_PER_POLL) * 101n - 1n));
  [row] = await matchInvites([row!], [foundPot(0, ["decides"])], reader, DEPLOYED);
  assert.deepEqual(row!.match, { potId: "0", block: "9000", deciders: [IDARA, UBONG], payees: [CATERER] });
});

test("without past state, a candidate the inviter didn't make is set aside once the search reaches the present", async () => {
  const pots: FakePot[] = [{ creator: STRANGER, block: 5_050n, deciders: [STRANGER, UBONG], payees: [CATERER] }];
  const { reader } = fakeChain(pots, { pastState: false, head: 5_500n });
  const [row] = await matchInvites([waitingFor({}, { block: 5_000n, potCount: 0 })], [foundPot(0, ["decides"])], reader, DEPLOYED);
  assert.equal(row!.match, undefined);
  assert.deepEqual(row!.notFrom, ["0"]);
  assert.equal(row!.scannedTo, "5500");
});

test("without past state, a pot the search passed before discovery found it still matches", async () => {
  const pots: FakePot[] = [{ creator: IDARA, block: 5_050n, deciders: [IDARA, UBONG], payees: [CATERER] }];
  const { reader } = fakeChain(pots, { pastState: false, head: 5_500n });
  // Discovery hasn't reached pot 0 yet, but some other pot names this account.
  let [row] = await matchInvites([waitingFor({}, { block: 5_000n, potCount: 0 })], [], reader, DEPLOYED);
  assert.equal(row!.scannedTo, undefined, "nothing to look for yet");
  [row] = await matchInvites([row!], [foundPot(0, ["decides"])], reader, DEPLOYED);
  assert.equal(row!.match?.potId, "0");
});

test("a matched pot stays on Home after 14 days; only waiting rows are dropped", () => {
  const store = memory();
  const match = { potId: "0", block: "5432", deciders: [IDARA, UBONG], payees: [CATERER] };
  store.put({ ...answered(invite, "ausd", UBONG, 0), match });
  store.put(answered({ ...invite, draftId: "0xffeeddccbbaa99887766554433221100" }, "ausd", UBONG, 0));
  const later = store.forAccount("ausd", UBONG, STALE_MS * 3);
  assert.deepEqual(later.map((r) => r.match?.potId), ["0"]);
});

test("a matched pot opens with no link: no names, so nothing to verify and people show by account ending", async () => {
  const link = linkFor({ deployment: "ausd", potId: "7", block: "5432", fragment: "", name: "", addedAt: 0 });
  assert.ok(link);
  assert.equal(link.potId, 7n);
  assert.equal(link.block, 5_432n);
  assert.deepEqual(link.people, []);
  assert.equal(await verifyLabels(IDARA, link, "0x00", IDARA), false);
  assert.equal(linkFor({ deployment: "ausd", potId: "7", block: "", fragment: "", name: "", addedAt: 0 }), null);
  assert.equal(linkFor({ deployment: "ausd", potId: "7", block: "1", fragment: "zzzz", name: "", addedAt: 0 }), null);
});

test("a matched pot reads as invited, with everyone else by the end of their account", () => {
  assert.equal(copy.invitedBy("Idara"), "Invited by Idara. Open it here, no link needed.");
  assert.equal(copy.alsoInIt([copy.accountEnding(IDARA), copy.accountEnding(CATERER)]), `Also in it: account ending ${IDARA.slice(-4)} and account ending ${CATERER.slice(-4)}.`);
});

test("the name an account calls itself on this phone changes no invite and no match", async () => {
  const { AccountStore } = await import("./accounts.ts");
  const kv = new Map<string, string>();
  const accounts = new AccountStore({ getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => void kv.set(k, v) });
  const pots: FakePot[] = [{ creator: IDARA, block: 5_432n, deciders: [IDARA, UBONG, ANIEKAN], payees: [CATERER] }];
  const rows = [waitingFor({}, { block: 5_000n, potCount: 0 })];
  accounts.upsert({ address: UBONG, name: "Ubong" });
  const before = await matchInvites(rows, [foundPot(0, ["decides"])], fakeChain(pots).reader, DEPLOYED);
  accounts.rename(UBONG, "Someone else entirely");
  const after = await matchInvites(rows, [foundPot(0, ["decides"])], fakeChain(pots).reader, DEPLOYED);
  assert.equal(before[0]!.match?.potId, "0", "the invite is matched to the pot");
  assert.deepEqual(after, before);
  assert.equal(after[0]!.from, invite.from, "the inviter's name is the one in the invite");
  assert.ok(!JSON.stringify(after).includes("Someone else"));
});
