import { test } from "node:test";
import assert from "node:assert/strict";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { mnemonicToAccount } from "viem/accounts";
import { HD_PATH, sessionAddress, sessionFromPrfOutput } from "./keys.ts";

// A fixed stand-in for a PRF output. Not a real account's.
function fakePrf(): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
}

test("the derived address matches an independent BIP-39/BIP-32 derivation at m/44'/60'/0'/0/0", () => {
  const expected = mnemonicToAccount(entropyToMnemonic(fakePrf(), wordlist), { path: HD_PATH }).address;
  const session = sessionFromPrfOutput(fakePrf());
  try {
    assert.equal(sessionAddress(session), expected);
  } finally {
    session.end();
  }
});

test("FROZEN: this PRF output always derives this exact address", () => {
  // nivpay.vercel.app is the permanent home and real accounts exist. If this
  // test fails, the derivation changed and every existing passkey would open
  // a different, empty account. Do not update the expected value: revert the
  // change instead.
  const session = sessionFromPrfOutput(fakePrf());
  try {
    assert.equal(sessionAddress(session), "0x9eBA8D5Dc196826B262d3882cbFA5B87E93Ef2A8");
  } finally {
    session.end();
  }
});

test("the PRF output passed in is zeroed once the session exists", () => {
  const prf = fakePrf();
  const session = sessionFromPrfOutput(prf);
  session.end();
  assert.ok(prf.every((b) => b === 0));
});

test("the PRF output is zeroed even when derivation fails", () => {
  const tooShort = new Uint8Array(15).fill(9); // not valid BIP-39 entropy
  assert.throws(() => sessionFromPrfOutput(tooShort));
  assert.ok(tooShort.every((b) => b === 0));
});

test("an ended session refuses to sign", async () => {
  const session = sessionFromPrfOutput(fakePrf());
  session.end();
  await assert.rejects(session.signDigest(new Uint8Array(32)), /SESSION_ENDED|ended/i);
});
