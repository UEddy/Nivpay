import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { editDistance, matchName, parseVoice, PAYMENTS_WITH_PERSON, payableByVoice, spokenKey, VOICE_CAP, voiceCanPay, VoiceStore, withinVoiceCap, wordsToNumber } from "./voice.ts";

const $ = (d: number) => BigInt(Math.round(d * 100)) * 10_000n;
const amountOf = (heard: string) => {
  const c = parseVoice(heard);
  return c ? c.amount : null;
};

test("the two commands, as the brief says them", () => {
  assert.deepEqual(parseVoice("send 100 dollars to mum"), { kind: "send", amount: $(100), name: "mum" });
  assert.deepEqual(parseVoice("send 100 USD to Mum"), { kind: "send", amount: $(100), name: "Mum" });
  assert.deepEqual(parseVoice("put 50 into Mama's 60th"), { kind: "put", amount: $(50), pot: "Mama's 60th" });
  assert.deepEqual(parseVoice("Pay $25 to Idara."), { kind: "send", amount: $(25), name: "Idara" });
  assert.deepEqual(parseVoice("put fifty dollars in Birthday"), { kind: "put", amount: $(50), pot: "Birthday" });
  assert.deepEqual(parseVoice("send 100USD to Mum"), { kind: "send", amount: $(100), name: "Mum" });
});

test("tricky amounts: fifteen and fifty, 1,000, a hundred and fifty, cents", () => {
  assert.equal(amountOf("send fifteen dollars to mum"), $(15));
  assert.equal(amountOf("send fifty dollars to mum"), $(50));
  assert.equal(amountOf("send 15 dollars to mum"), $(15));
  assert.equal(amountOf("send 50 dollars to mum"), $(50));
  assert.equal(amountOf("send 1,000 dollars to mum"), $(1000));
  assert.equal(amountOf("send 1000 dollars to mum"), $(1000));
  assert.equal(amountOf("send a hundred and fifty dollars to mum"), $(150));
  assert.equal(amountOf("send one hundred fifty dollars to mum"), $(150));
  assert.equal(amountOf("send twenty five dollars to mum"), $(25));
  assert.equal(amountOf("send two thousand five hundred dollars to mum"), $(2500));
  assert.equal(amountOf("send a thousand dollars to mum"), $(1000));
  assert.equal(amountOf("send 12.50 dollars to mum"), $(12.5));
  assert.equal(amountOf("send $9.99 to mum"), $(9.99));
  assert.equal(wordsToNumber(["nineteen"]), 19);
  assert.equal(wordsToNumber(["ninety"]), 90);
  assert.equal(wordsToNumber(["one", "thousand", "and", "five"]), 1005);
});

test("amounts it must refuse rather than guess", () => {
  for (const heard of [
    "send fifteen fifty dollars to mum",
    "send fifty fifteen dollars to mum",
    "send five five dollars to mum",
    "send 1,00 dollars to mum",
    "send 10,0000 dollars to mum",
    "send 12.505 dollars to mum",
    "send 0 dollars to mum",
    "send zero dollars to mum",
    "send minus 5 dollars to mum",
    "send -5 dollars to mum",
    "send a dollars to mum",
    "send hundred and dollars to mum",
    "send 100 euros to mum",
    "send 100 pounds to mum",
    "send 100 naira to mum",
    "send 5 cents to mum",
    "send a million dollars to mum",
  ]) {
    assert.equal(parseVoice(heard), null, heard);
  }
  assert.equal(wordsToNumber(["fifteen", "fifty"]), null);
  assert.equal(wordsToNumber(["a"]), null);
  assert.equal(wordsToNumber(["and", "five"]), null);
});

test("anything that isn't one of the two commands is refused: settings, limits, contacts, yeses, two at once", () => {
  for (const heard of [
    "",
    "hello",
    "send money to mum",
    "send all my money to mum",
    "send mum 100 dollars",
    "send 100 dollars",
    "send 100 dollars mum",
    "change my limit to 500",
    "raise my daily limit to 5000 dollars",
    "set limit to 100 dollars",
    "add mum as a contact",
    "trust mum for voice",
    "mark mum as trusted",
    "approve the payment",
    "say yes to the caterer",
    "yes",
    "send 100 dollars to mum and 50 to dad",
    "send 100 dollars to mum then pay 50 to dad",
    "send 100 dollars to mum and send 5 to dad",
    "send 100 dollars to 0x725C9cd75b2C8C29AEbf6a14eE84a3b54C787bC1",
    "send 100 dollars to account 4",
    "receive 100 dollars from mum",
    "withdraw 50 from Birthday",
    "take 50 out of Birthday",
    "put 50 into",
    "put 50 dollars on red",
  ]) {
    assert.equal(parseVoice(heard), null, heard);
  }
});

test("names: matched only among the options, close ones shown together", () => {
  const people = [
    { name: "Mum", id: 1 },
    { name: "Idara", id: 2 },
    { name: "Idaro", id: 3 },
    { name: "Ubong", id: 4 },
  ];
  assert.deepEqual(matchName("mum", people).map((p) => p.id), [1]);
  assert.deepEqual(matchName("my mum", people).map((p) => p.id), [1]);
  assert.deepEqual(matchName("Ubong.", people).map((p) => p.id), [4]);
  assert.deepEqual(matchName("Idara", people).map((p) => p.id), [2, 3], "two close names: both, the exact one first");
  assert.deepEqual(matchName("dad", people), [], "never a name that isn't there");
  assert.deepEqual(matchName("", people), []);
  assert.equal(spokenKey("Mama’s 60th"), spokenKey("mamas 60th"));
  assert.deepEqual(matchName("Mamas sixtieth", [{ name: "Mama's 60th" }]), [], "words for numbers are not guessed into pot names");
  assert.deepEqual(matchName("Mama's 60th", [{ name: "Mama’s 60th" }, { name: "Birthday" }]).length, 1);
  assert.equal(editDistance("kitten", "sitting"), 3);
});

test("voice pays only someone with 10 payments together on this phone, paid at least once, and marked trusted", () => {
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
  const me = getAddress("0x4444444444444444444444444444444444444444");
  const mum = getAddress("0x1111111111111111111111111111111111111111");
  const idara = getAddress("0x2222222222222222222222222222222222222222");
  const ubong = getAddress("0x3333333333333333333333333333333333333333");
  const contacts = [{ account: mum, name: "Mum" }, { account: idara, name: "Idara" }, { account: ubong, name: "Ubong" }];
  const v = new VoiceStore(store, "ausd", me);
  // Mum: 10 together, some sent and some received. Idara: only 9. Ubong: 10, all received, never paid.
  for (let i = 0; i < PAYMENTS_WITH_PERSON; i++) v.sawWith(mum, `m${i}`);
  for (let i = 0; i < PAYMENTS_WITH_PERSON - 1; i++) v.sawWith(idara, `i${i}`);
  for (let i = 0; i < PAYMENTS_WITH_PERSON; i++) v.sawWith(ubong, `u${i}`);
  for (const c of contacts) v.setTrusted(c.account, true);
  const paid = [mum, idara];
  assert.deepEqual(payableByVoice(contacts, v.get(), paid).map((c) => c.name), ["Mum"], "Idara 9 of 10; Ubong never paid");
  v.setTrusted(mum, false);
  assert.deepEqual(payableByVoice(contacts, v.get(), paid), [], "not trusted any more");
  assert.equal(voiceCanPay(v.get(), idara, paid), false);
  v.sawWith(idara, "i9");
  assert.equal(voiceCanPay(v.get(), idara, paid), true, "the tenth payment with Idara");
});

test("each voice payment is at most $200", () => {
  assert.equal(VOICE_CAP, $(200));
  assert.ok(withinVoiceCap($(200)));
  assert.ok(!withinVoiceCap($(200.01)));
  assert.ok(!withinVoiceCap(0n));
});

test("payments are counted per person, each once, and the switch is per account", () => {
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
  const me = getAddress("0x4444444444444444444444444444444444444444");
  const mum = getAddress("0x1111111111111111111111111111111111111111");
  const v = new VoiceStore(store, "ausd", me);
  v.sawWith(mum, "tx0");
  v.sawWith(mum.toLowerCase() as typeof mum, "tx0");
  assert.equal(v.countWith(mum), 1, "the same payment counts once");
  for (let i = 1; i < PAYMENTS_WITH_PERSON + 5; i++) v.sawWith(mum, `tx${i}`);
  assert.equal(v.countWith(mum), PAYMENTS_WITH_PERSON, "kept at 10");
  assert.equal(v.countWith(getAddress("0x2222222222222222222222222222222222222222")), 0, "someone else starts at 0");
  assert.equal(v.active(), false);
  v.setOn(true);
  assert.equal(v.active(), true, "the switch itself has no wait: each person does");
  assert.equal(new VoiceStore(store, "ausd", getAddress("0x5555555555555555555555555555555555555555")).active(), false, "per account");
  kv.set([...kv.keys()][0]!, "{");
  assert.equal(v.countWith(mum), 0, "damaged storage starts over");
});
