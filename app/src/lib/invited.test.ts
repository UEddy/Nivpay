import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Hex } from "viem";
import { copy } from "../copy.ts";
import { answered, InvitedStore, STALE_MS } from "./invited.ts";
import { NO_SLOT, ROLE, type Invite } from "./invites.ts";

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
