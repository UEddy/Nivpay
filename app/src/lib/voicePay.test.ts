import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import { heardYesNo, planVoiceSend } from "./voicePay.ts";
import { PAYMENTS_WITH_PERSON, VOICE_CAP, type VoiceState } from "./voice.ts";

const ANA = getAddress("0x1111111111111111111111111111111111111111");
const ANNA = getAddress("0x2222222222222222222222222222222222222222");
const BEN = getAddress("0x3333333333333333333333333333333333333333");
const ids = Array.from({ length: PAYMENTS_WITH_PERSON }, (_, i) => `tx${i}`);
const state = (trusted: Address[]): VoiceState => ({ on: true, wake: true, explained: true, trusted, withPerson: Object.fromEntries(trusted.map((a) => [a, ids])) });
const contacts = [
  { account: ANA, name: "Ana" },
  { account: ANNA, name: "Anna" },
  { account: BEN, name: "Ben" },
];
const $ = (n: number) => BigInt(n) * 10n ** 6n;

test("a heard send pays one trusted contact, paid before, up to $200", () => {
  const plan = planVoiceSend({ kind: "send", amount: $(20), name: "Ben" }, contacts, state([BEN]), [BEN]);
  assert.deepEqual(plan, { kind: "pay", to: contacts[2], amount: $(20) });
  assert.equal(planVoiceSend({ kind: "send", amount: VOICE_CAP, name: "Ben" }, contacts, state([BEN]), [BEN]).kind, "pay");
});

test("never anyone voice may not pay: not trusted, never paid, or too few payments together", () => {
  assert.deepEqual(planVoiceSend({ kind: "send", amount: $(20), name: "Ben" }, contacts, state([]), [BEN]), { kind: "no-contact", name: "Ben" });
  assert.equal(planVoiceSend({ kind: "send", amount: $(20), name: "Ben" }, contacts, state([BEN]), []).kind, "no-contact");
  const few: VoiceState = { ...state([BEN]), withPerson: { [BEN]: ids.slice(1) } };
  assert.equal(planVoiceSend({ kind: "send", amount: $(20), name: "Ben" }, contacts, few, [BEN]).kind, "no-contact");
  assert.equal(planVoiceSend({ kind: "send", amount: $(20), name: "Zed" }, contacts, state([BEN]), [BEN]).kind, "no-contact");
});

test("over $200, or a pot command, is refused before anything is read back", () => {
  assert.deepEqual(planVoiceSend({ kind: "send", amount: VOICE_CAP + 1n, name: "Ben" }, contacts, state([BEN]), [BEN]), { kind: "over-cap" });
  assert.deepEqual(planVoiceSend({ kind: "put", amount: $(20), pot: "Trip" }, contacts, state([BEN]), [BEN]), { kind: "not-send" });
});

test("two close names are offered to pick, never guessed", () => {
  const plan = planVoiceSend({ kind: "send", amount: $(5), name: "Ana" }, contacts, state([ANA, ANNA]), [ANA, ANNA]);
  assert.equal(plan.kind, "pick");
  assert.deepEqual(plan.kind === "pick" && plan.options.map((o) => o.name).sort(), ["Ana", "Anna"]);
});

test("a yes is only a whole yes", () => {
  for (const y of ["yes", "Yes.", "yeah", "Yep!", "okay", "OK please", "yes please", "send it", "yeah, send it", "go ahead", "That's right", "confirm"]) assert.equal(heardYesNo(y), "yes", y);
  for (const n of ["no", "No.", "nope", "cancel", "stop", "yes no", "no, yes", "don't send it", "wait", "not Ana"]) assert.equal(heardYesNo(n), "no", n);
  for (const x of ["", "   ", "please", "send 20 dollars to Ana", "yes to Ben", "yesterday", "maybe", "yes send 50", "I guess", "Ana"]) assert.equal(heardYesNo(x), null, x);
});
