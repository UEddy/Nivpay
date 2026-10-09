import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ERROR_CODES } from "../copy.ts";
import { DraftStore, newDraft, withInvited, type Draft } from "./draft.ts";
import { AppError } from "./errors.ts";
import { NO_SLOT, ROLE, signReply, type Invite } from "./invites.ts";
import { acceptReply } from "./replies.ts";

// Throwaway keys that live only in this test's memory.
const idara = privateKeyToAccount(generatePrivateKey());
const ubong = privateKeyToAccount(generatePrivateKey());
const chidi = privateKeyToAccount(generatePrivateKey());
const POTS = getAddress("0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB");
const SLOT: Hex = "0x0102030405060708";

function setup() {
  const map = new Map<string, string>();
  const store = new DraftStore({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) });
  const draft: Draft = {
    ...newDraft(idara.address, "Europe/London", 0, (n) => new Uint8Array(n).fill(9)),
    name: "Mama’s 60th",
    payees: [{ slot: SLOT, name: "Caterer", cap: "700000000" }],
  };
  store.put(draft);
  const invite = (role: 0 | 1): Invite => ({
    kind: "invite",
    draftId: draft.id,
    role,
    slot: role === ROLE.payee ? SLOT : NO_SLOT,
    from: "Idara",
    potName: draft.name,
    payeeName: role === ROLE.payee ? "Caterer" : "",
    inviter: idara.address,
    share: 0n,
  });
  return { store, draft, invite };
}

const code = (expected: number) => (e: unknown) => e instanceof AppError && e.code === expected;

test("a signed decider reply joins the draft, once", async () => {
  const { store, draft, invite } = setup();
  const reply = await signReply(ubong, POTS, invite(ROLE.decider), { account: ubong.address, name: "Ubong", city: "Houston", timeZone: "America/Chicago" });
  const { text } = await acceptReply(store, POTS, reply);
  assert.equal(text, "Ubong joined as a decider.");
  await acceptReply(store, POTS, reply);
  const saved = store.get(draft.id)!;
  assert.deepEqual(saved.deciders.map((d) => d.account), [ubong.address]);
  assert.equal(saved.threshold, 2);
});

test("a signed payee reply fills its slot", async () => {
  const { store, draft, invite } = setup();
  const reply = await signReply(chidi, POTS, invite(ROLE.payee), { account: chidi.address, name: "Chidi", city: "Uyo", timeZone: "Africa/Lagos" });
  const { text } = await acceptReply(store, POTS, reply);
  assert.equal(text, "Chidi will be paid as Caterer.");
  assert.equal(store.get(draft.id)!.payees[0]!.account, chidi.address);
  assert.equal(store.get(draft.id)!.payees[0]!.via, "reply");
});

test("replies are refused when tampered, unknown, or too late", async () => {
  const { store, draft, invite } = setup();
  const person = { account: ubong.address, name: "Ubong", city: "Houston", timeZone: "America/Chicago" };
  const reply = await signReply(ubong, POTS, invite(ROLE.decider), person);

  await assert.rejects(acceptReply(store, POTS, { ...reply, person: { ...person, name: "Mallory" } }), code(ERROR_CODES.REPLY_UNVERIFIED));
  await assert.rejects(acceptReply(store, POTS, { ...reply, draftId: "0xffffffffffffffffffffffffffffffff" }), code(ERROR_CODES.REPLY_NOT_HERE));
  const gone = await signReply(chidi, POTS, { ...invite(ROLE.payee), slot: "0x0909090909090909" }, { ...person, account: chidi.address });
  await assert.rejects(acceptReply(store, POTS, gone), code(ERROR_CODES.REPLY_NOT_HERE));

  store.put({ ...draft, sending: { hash: `0x${"11".repeat(32)}`, labelsSignature: `0x${"22".repeat(65)}`, people: [], shares: [] } });
  await assert.rejects(acceptReply(store, POTS, reply), code(ERROR_CODES.REPLY_TOO_LATE));
  assert.equal(store.get(draft.id)!.deciders.length, 0, "nothing was added");
});

test("a reply to a named invite answers it, and an older unnamed one leaves the rest waiting", async () => {
  const { store, draft, invite } = setup();
  const named: Hex = "0x0a0a0a0a0a0a0a0a";
  store.put(withInvited(withInvited(draft, named, "Ubong"), "0x0b0b0b0b0b0b0b0b", "Efe"));
  const ubongPerson = { account: ubong.address, name: "Ubong", city: "Houston", timeZone: "America/Chicago" };
  await acceptReply(store, POTS, await signReply(ubong, POTS, { ...invite(ROLE.decider), slot: named }, ubongPerson));
  assert.deepEqual(store.get(draft.id)!.invited, [{ slot: "0x0b0b0b0b0b0b0b0b", name: "Efe" }]);

  const chidiPerson = { account: chidi.address, name: "Chidi", city: "Uyo", timeZone: "Africa/Lagos" };
  await acceptReply(store, POTS, await signReply(chidi, POTS, invite(ROLE.decider), chidiPerson));
  const saved = store.get(draft.id)!;
  assert.deepEqual(saved.deciders.map((d) => d.name), ["Ubong", "Chidi"]);
  assert.deepEqual(saved.invited, [{ slot: "0x0b0b0b0b0b0b0b0b", name: "Efe" }]);
});
