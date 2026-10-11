import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { WebAuthnClient } from "@category-labs/mera";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { mnemonicToAccount } from "viem/accounts";
import type { Address } from "viem";
import { AccountStore } from "./accounts.ts";
import { CredentialStore } from "./credentials.ts";
import { WrongPasskeyError } from "./errors.ts";
import { HD_PATH } from "./keys.ts";
import { createAccount, openAccount, signAs } from "./passkeyCore.ts";

const RP = "nivpay.vercel.app";
/** Mera's default salt, which must reach the phone unchanged. */
const MERA_SALT = createHash("sha256").update("mera.prf.salt.v1").digest();

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

/**
 * A phone with some passkeys for NivPay. Like a real authenticator, a
 * passkey's PRF output depends only on the passkey, the site and the salt,
 * never on how it was asked for. `picks` is which passkey the person taps
 * when the phone shows its list.
 */
function phone(opts: { prfOnCreate?: boolean } = {}) {
  const passkeys: Uint8Array[] = [];
  const gets: WebAuthnClient.GetCredentialRequest[] = [];
  let picks = 0;
  const prf = (id: Uint8Array, rpId: string, salt: Uint8Array) =>
    createHash("sha256").update(id).update(rpId).update(salt).digest();
  const client: WebAuthnClient = {
    async createCredential(req) {
      const id = Uint8Array.from(createHash("sha256").update(`passkey ${passkeys.length}`).digest().subarray(0, 16));
      passkeys.push(id);
      return opts.prfOnCreate === false
        ? { credentialId: id, prfEnabled: true }
        : { credentialId: id, prfEnabled: true, prfOutput: prf(id, req.rp.id, req.prfSalt) };
    },
    async getCredential(req) {
      gets.push(req);
      const id = req.allowCredential
        ? passkeys.find((p) => b64url(p) === b64url(req.allowCredential!.credentialId))
        : passkeys[picks];
      if (!id) throw new Error("NotAllowedError");
      return { credentialId: id, prfOutput: prf(id, req.rpId, req.prfSalt) };
    },
  };
  return { client, gets, passkeys, pick: (i: number) => void (picks = i), prf };
}

/** The address keys.ts must give for a PRF output, by an independent derivation. */
function expectedAddress(prfOutput: Uint8Array): Address {
  return mnemonicToAccount(entropyToMnemonic(prfOutput, wordlist), { path: HD_PATH }).address;
}

test("the same passkey opens the same account with and without its credential ID", async () => {
  const p = phone();
  const made = await createAccount(RP, "Ada", p.client);
  const store = new CredentialStore(memory());

  const listed = await openAccount(RP, store, undefined, p.client);
  store.rememberCredential(made.address, made.credentialId);
  const targeted = await openAccount(RP, store, made.address, p.client);

  assert.equal(listed.address, made.address);
  assert.equal(targeted.address, made.address);
  assert.equal(made.address, expectedAddress(p.prf(p.passkeys[0]!, RP, MERA_SALT)));
  assert.equal(p.gets[0]!.allowCredential, undefined);
  assert.equal(b64url(p.gets[1]!.allowCredential!.credentialId), made.credentialId);
  for (const g of p.gets) {
    assert.equal(g.rpId, RP);
    assert.deepEqual(Buffer.from(g.prfSalt), MERA_SALT);
  }
});

test("signing up never asks with an open list, even when the phone gives no PRF output while making the passkey", async () => {
  for (const prfOnCreate of [true, false]) {
    const p = phone({ prfOnCreate });
    p.pick(5); // an open list would fail: there is no sixth passkey
    const made = await createAccount(RP, "Ada", p.client);
    for (const g of p.gets) assert.equal(b64url(g.allowCredential!.credentialId), made.credentialId);
    assert.equal(p.gets.length, prfOnCreate ? 0 : 1);
    assert.equal(made.address, expectedAddress(p.prf(p.passkeys[0]!, RP, MERA_SALT)));
  }
});

test("a known account with a kept ID asks only for its own passkey, and signs as it", async () => {
  const p = phone();
  const ada = await createAccount(RP, "Ada", p.client);
  const bo = await createAccount(RP, "Bo", p.client);
  const store = new CredentialStore(memory());
  store.rememberCredential(ada.address, ada.credentialId);
  store.rememberCredential(bo.address, bo.credentialId);
  p.pick(0); // were the list shown, the person would tap Ada's

  assert.equal((await openAccount(RP, store, bo.address, p.client)).address, bo.address);
  const signer = await signAs(RP, store, bo.address, async (account) => account.address, p.client);
  assert.equal(signer, bo.address);
  for (const g of p.gets) assert.equal(b64url(g.allowCredential!.credentialId), bo.credentialId);
});

test("a new phone with no accounts shows the phone's list, so any passkey brings its account back", async () => {
  const p = phone();
  await createAccount(RP, "Ada", p.client);
  const bo = await createAccount(RP, "Bo", p.client);
  const kv = memory();
  const store = new CredentialStore(kv);
  p.pick(1);

  const opened = await openAccount(RP, store, undefined, p.client);
  assert.equal(opened.address, bo.address);
  assert.equal(opened.credentialId, bo.credentialId);
  assert.equal(p.gets[0]!.allowCredential, undefined);
  assert.equal(kv.raw.size, 0, "nothing is stored until the screen keeps the account");
});

test("an account kept before IDs were: the list is shown once, the passkey must match, then its ID is kept", async () => {
  const p = phone();
  const ada = await createAccount(RP, "Ada", p.client);
  const bo = await createAccount(RP, "Bo", p.client);
  const kv = memory();
  // As an earlier version stored it: address and name only.
  kv.setItem("nivpay.accounts.v1", JSON.stringify([{ address: ada.address, name: "Ada" }, { address: bo.address, name: "Bo" }]));
  const accounts = new AccountStore(kv);
  const store = new CredentialStore(kv);

  // The wrong passkey picked: refused, nothing kept.
  p.pick(1);
  await assert.rejects(openAccount(RP, store, ada.address, p.client), WrongPasskeyError);
  assert.equal(store.credentialFor(ada.address), undefined);
  assert.equal(store.credentialFor(bo.address), undefined);

  // The right one: the same account, and its ID kept.
  p.pick(0);
  const opened = await openAccount(RP, store, ada.address, p.client);
  assert.equal(opened.address, ada.address);
  assert.equal(store.credentialFor(ada.address), ada.credentialId);
  assert.equal(p.gets.at(-1)!.allowCredential, undefined);

  // From then on only Ada's passkey is asked for.
  p.pick(1);
  await openAccount(RP, store, ada.address, p.client);
  assert.equal(b64url(p.gets.at(-1)!.allowCredential!.credentialId), ada.credentialId);

  // Signing migrates the same way, and nothing else changed.
  await signAs(RP, store, bo.address, async () => undefined, p.client);
  assert.equal(store.credentialFor(bo.address), bo.credentialId);
  assert.deepEqual(
    accounts.list().map((a) => a.name),
    ["Ada", "Bo"],
  );
  assert.equal(kv.raw.get("nivpay.accounts.v1"), JSON.stringify([{ address: ada.address, name: "Ada" }, { address: bo.address, name: "Bo" }]));
});

test("signing with the wrong passkey keeps nothing and signs nothing", async () => {
  const p = phone();
  const ada = await createAccount(RP, "Ada", p.client);
  await createAccount(RP, "Bo", p.client);
  const store = new CredentialStore(memory());
  p.pick(1);
  let signed = false;
  await assert.rejects(
    signAs(RP, store, ada.address, async () => void (signed = true), p.client),
    WrongPasskeyError,
  );
  assert.equal(signed, false);
  assert.equal(store.credentialFor(ada.address), undefined);
});

test("a kept credential ID is never replaced, and only IDs are stored, by address", () => {
  const kv = memory();
  const store = new CredentialStore(kv);
  const A = "0x1a9a136f1cf59899c6b8cfe84ac4df388620467d" as Address;
  store.rememberCredential(A, "first");
  store.rememberCredential(A, "second");
  store.rememberCredential("0x0710Ade1Cf20E4A85a775c3A01dfdAead0579B20", "not base64url!");
  assert.equal(store.credentialFor(A), "first");
  assert.equal(store.credentialFor("0x0710Ade1Cf20E4A85a775c3A01dfdAead0579B20"), undefined);
  assert.equal(kv.raw.get("nivpay.credentials.v1"), JSON.stringify({ "0x1A9A136f1cf59899C6b8cfE84ac4df388620467d": "first" }));
  kv.setItem("nivpay.credentials.v1", "{not json");
  assert.equal(store.credentialFor(A), undefined, "corrupt storage reads as none, so the phone's list is shown");
});
