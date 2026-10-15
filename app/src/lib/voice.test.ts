import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { editDistance, matchName, parseVoice, payableByVoice, spokenKey, TRANSFERS_TO_UNLOCK, VOICE_CAP, VoiceStore, withinVoiceCap, wordsToNumber } from "./voice.ts";

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

test("voice pays only contacts marked trusted that this phone has paid before", () => {
  const a = getAddress("0x1111111111111111111111111111111111111111");
  const b = getAddress("0x2222222222222222222222222222222222222222");
  const c = getAddress("0x3333333333333333333333333333333333333333");
  const contacts = [{ account: a, name: "Mum" }, { account: b, name: "Idara" }, { account: c, name: "Ubong" }];
  assert.deepEqual(payableByVoice(contacts, [a, b], [a, c]).map((x) => x.name), ["Mum"], "Idara never paid, Ubong not trusted");
});

test("each voice payment is at most $200", () => {
  assert.equal(VOICE_CAP, $(200));
  assert.ok(withinVoiceCap($(200)));
  assert.ok(!withinVoiceCap($(200.01)));
  assert.ok(!withinVoiceCap(0n));
});

test("voice turns on only after 10 final transfers seen on this phone, each counted once", () => {
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
  const me = getAddress("0x4444444444444444444444444444444444444444");
  const v = new VoiceStore(store, "ausd", me);
  assert.equal(v.setOn(true), false, "not yet");
  for (let i = 0; i < TRANSFERS_TO_UNLOCK - 1; i++) v.saw(`tx${i}`);
  v.saw("tx0");
  assert.equal(v.count(), TRANSFERS_TO_UNLOCK - 1);
  assert.equal(v.setOn(true), false);
  v.saw("tx9");
  assert.equal(v.count(), TRANSFERS_TO_UNLOCK);
  assert.equal(v.active(), false, "unlocked is not on");
  assert.equal(v.setOn(true), true);
  assert.equal(v.active(), true);
  v.setTrusted(getAddress("0x1111111111111111111111111111111111111111"), true);
  assert.ok(v.isTrusted(getAddress("0x1111111111111111111111111111111111111111")));
  assert.equal(new VoiceStore(store, "ausd", getAddress("0x5555555555555555555555555555555555555555")).active(), false, "per account");
  assert.equal(v.setOn(false), true);
  assert.equal(v.active(), false);
  kv.set([...kv.keys()][0]!, "{");
  assert.equal(v.count(), 0, "damaged storage starts over, locked");
});
