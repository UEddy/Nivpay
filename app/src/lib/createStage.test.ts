import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Hex } from "viem";
import { copy } from "../copy.ts";
import { createView, progressLine, type CreateInput, type CreateView } from "./createStage.ts";
import { checkDraft, newDraft, withDecider, withInvited, withoutInvited, withPayeeAccount, type Draft } from "./draft.ts";

const IDARA = getAddress("0x725c9a4bb4c3de2f11ac0e7c9b1e8f0d3a2b7bc1");
const UBONG = getAddress("0x1111111111111111111111111111111111111111");
const CATERER = getAddress("0x3333333333333333333333333333333333333333");
const POTS = getAddress("0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB");
const LIMITS = { maxDeciders: 10, maxPayees: 10 };
const NOW = 1_791_000_000n; // Oct 2026
const INVITE: Hex = "0x0303030303030303";
const SLOT: Hex = "0x0101010101010101";

/** The draft at each step of making a pot, in order. */
function blank(): Draft {
  return newDraft(IDARA, "Europe/London", 0, (n) => new Uint8Array(n).fill(7));
}
function invited(): Draft {
  const d = { ...blank(), name: "Mama’s 60th", me: { city: "London", timeZone: "Europe/London" }, closes: "2026-12-31" };
  return withInvited({ ...d, payees: [{ slot: SLOT, name: "Caterer", cap: "700000000" }] }, INVITE, "Ubong");
}
function replied(): Draft {
  return withDecider(withoutInvited(invited(), INVITE), { account: UBONG, name: "Ubong", city: "Houston", timeZone: "America/Chicago" });
}
function everyoneIn(): Draft {
  return withPayeeAccount(replied(), SLOT, CATERER, "reply");
}
function sent(): Draft {
  return { ...everyoneIn(), sending: { people: [], shares: [], attempts: [{ hash: `0x${"11".repeat(32)}`, labelsSignature: `0x${"22".repeat(65)}` }] } };
}
function made(unsigned = false): Draft {
  const d = { ...everyoneIn(), sending: undefined };
  return unsigned
    ? { ...d, made: { potId: "4", block: "66100000", fragment: "", unsigned: { createdIn: `0x${"11".repeat(32)}`, people: [], shares: [] } } }
    : { ...d, made: { potId: "4", block: "66100000", fragment: "abc" } };
}

function view(draft: Draft, over: Partial<CreateInput> = {}): CreateView {
  const ready = Boolean(checkDraft(draft, LIMITS, NOW, POTS).args);
  return createView({ draft, step: null, stuck: false, unconfirmed: false, ready, phase: "draft", ...over });
}

/** Every stage before the pot is final looks and reads like a draft. */
function assertDraft(v: CreateView) {
  assert.equal(v.made, false);
  assert.equal(v.status, "Draft, not made yet");
  assert.equal(v.lid, "open", "lid open");
  assert.equal(v.lock, false, "no lock");
  assert.equal(v.badge, "draft");
  assert.notEqual(v.primary.action, "add-share", "no share or chip in action");
  assert.notEqual(v.primary.action, "sign-names");
  for (const text of [v.status, v.progress, v.line, v.primary.label]) {
    const said = (text ?? "").replace(/not made yet/gi, "");
    assert.doesNotMatch(said, /\b(made|locked|locking|live)\b/i, `says it is done: ${text}`);
  }
}

test("before any invite: a draft, nobody invited, Make the pot not available", () => {
  const v = view(blank());
  assertDraft(v);
  assert.equal(v.stage, "collecting");
  assert.equal(v.editable, true);
  assert.equal(v.progress, copy.progressNobody);
  assert.deepEqual(v.primary, { action: "make", label: "Make the pot", enabled: false, busy: false });
});

test("after an invite goes out: a draft that names who it is waiting for", () => {
  const v = view(invited());
  assertDraft(v);
  assert.equal(v.stage, "collecting");
  assert.equal(v.progress, "Waiting for a reply from Ubong and Caterer.");
  assert.equal(v.primary.enabled, false);
});

test("after a reply link comes back: who replied and who hasn't", () => {
  const v = view(replied());
  assertDraft(v);
  assert.equal(v.stage, "collecting");
  assert.equal(v.progress, "Replied: Ubong. Waiting for Caterer.");
  assert.equal(v.primary.enabled, false);
});

test("once everyone is added: still a draft, and Make the pot is the one primary action", () => {
  const v = view(everyoneIn());
  assertDraft(v);
  assert.equal(v.stage, "ready");
  assert.equal(v.editable, true);
  assert.equal(v.progress, "Everyone has replied: Ubong and Caterer.");
  assert.equal(v.line, copy.createReady);
  assert.deepEqual(v.primary, { action: "make", label: "Make the pot", enabled: true, busy: false });
});

test("a pending invite holds Make the pot back even when everything else is in", () => {
  const v = view(withInvited(everyoneIn(), "0x0404040404040404", "Efe"));
  assertDraft(v);
  assert.equal(v.stage, "collecting");
  assert.equal(v.progress, "Replied: Ubong and Caterer. Waiting for Efe.");
  assert.equal(v.primary.enabled, false);
});

test("on the confirm sheet and through the fingerprint: a draft, nothing sent, nothing to tap", () => {
  for (const step of ["preparing", "getting-ready", "confirm"] as const) {
    const v = view(everyoneIn(), { step });
    assertDraft(v);
    assert.equal(v.stage, "preparing");
    assert.equal(v.editable, false);
    assert.equal(v.progress, null);
    assert.equal(v.primary.enabled, false);
    assert.equal(v.primary.busy, true);
  }
  assert.equal(view(everyoneIn(), { step: "confirm" }).primary.label, copy.stepConfirm);
});

test("after the fingerprint, while waiting for Finalized: a draft that says it was sent and isn't a pot yet", () => {
  for (const [draft, step] of [[sent(), "sending"], [sent(), "landing"], [sent(), null]] as const) {
    const v = view(draft, { step });
    assertDraft(v);
    assert.equal(v.stage, "waiting");
    assert.equal(v.editable, false);
    assert.equal(v.line, copy.createWaiting);
    assert.equal(v.primary.enabled, false);
  }
  assert.equal(view(sent(), { step: "sending" }).primary.label, "Sending…");
  assert.equal(view(sent(), { step: "landing" }).primary.label, "Confirming…");
});

test("sent but not confirmed: still a draft, with Check again", () => {
  const v = view(sent(), { unconfirmed: true });
  assertDraft(v);
  assert.equal(v.stage, "unconfirmed");
  assert.deepEqual(v.primary, { action: "check-again", label: "Check again", enabled: true, busy: false });
});

test("dropped or turned down: the same draft, with Try again on the same request", () => {
  const v = view(sent(), { stuck: true });
  assertDraft(v);
  assert.equal(v.stage, "stuck");
  assert.equal(v.editable, false, "the names signed for it can't change under it");
  assert.deepEqual(v.primary, { action: "try-again", label: "Try again", enabled: true, busy: false });
});

test("reverted or replaced: the draft comes back as it was, ready to make again", () => {
  const v = view({ ...sent(), sending: undefined });
  assertDraft(v);
  assert.equal(v.stage, "ready");
  assert.equal(v.editable, true);
});

test("final and its number read: made, but the lid and lock wait for the motion", () => {
  const before = view(made());
  assert.equal(before.made, true);
  assert.equal(before.status, null);
  assert.equal(before.lid, "open");
  assert.equal(before.lock, false);
  for (const phase of ["locked", "flying", "landed"] as const) {
    const v = view(made(), { phase });
    assert.equal(v.stage, "made");
    assert.equal(v.lid, "shut");
    assert.equal(v.lock, true);
    assert.equal(v.badge, "live");
    assert.deepEqual(v.primary, { action: "add-share", label: copy.addYourShare, enabled: true, busy: false });
  }
});

test("made with names still to sign: the names step, nothing else", () => {
  const v = view(made(true), { phase: "landed" });
  assert.equal(v.stage, "made-unsigned");
  assert.deepEqual(v.primary, { action: "sign-names", label: copy.signTheNames, enabled: true, busy: false });
  assert.equal(view(made(true), { phase: "landed", step: "confirm" }).primary.busy, true);
});

test("the motion alone never makes a pot: no number, no lid, no lock", () => {
  for (const phase of ["locked", "flying", "landed"] as const) {
    assertDraft(view(everyoneIn(), { phase }));
    assertDraft(view(sent(), { phase, step: "landing" }));
  }
  assertDraft(view({ ...everyoneIn(), made: { potId: "", block: "", fragment: "" } }, { phase: "landed" }));
});

test("the progress line reads naturally for one, two and three names", () => {
  let d = invited();
  d = withInvited(d, "0x0505050505050505", "Aniekan");
  assert.equal(progressLine(d), "Waiting for a reply from Ubong, Aniekan and Caterer.");
});
