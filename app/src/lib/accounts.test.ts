import { test } from "node:test";
import assert from "node:assert/strict";
import { MeraError } from "@category-labs/mera";
import { AccountStore, shortAddress } from "./accounts.ts";
import { checkPasskeyHost } from "./hosts.ts";
import { passkeyErrorMessage, WrongPasskeyError } from "./errors.ts";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
}

const A = "0x1a9a136f1cf59899c6b8cfe84ac4df388620467d";
const B = "0x0710Ade1Cf20E4A85a775c3A01dfdAead0579B20";

test("only addresses and names are stored, checksummed", () => {
  const kv = memory();
  const store = new AccountStore(kv);
  store.upsert({ address: A as `0x${string}`, name: "Idara" });
  store.upsert({ address: B, name: "Ubong" });
  store.setActive(A as `0x${string}`);
  assert.deepEqual(store.list().map((a) => a.name), ["Idara", "Ubong"]);
  assert.equal(store.active()?.address, "0x1A9A136f1cf59899C6b8cfE84ac4df388620467d");
  const everything = [...kv.raw.values()].join(" ");
  assert.doesNotMatch(everything, /privateKey|mnemonic|seed|prf/i);
  const parsed = JSON.parse(kv.raw.get("nivpay.accounts.v1") ?? "[]") as object[];
  for (const entry of parsed) assert.deepEqual(Object.keys(entry).sort(), ["address", "name"]);
});

test("upsert keeps one entry per address and keeps a name when none is given", () => {
  const store = new AccountStore(memory());
  store.upsert({ address: B, name: "Ubong" });
  store.upsert({ address: B, name: "  " });
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0]?.name, "Ubong");
});

test("corrupt storage reads as no accounts rather than throwing", () => {
  const kv = memory();
  kv.setItem("nivpay.accounts.v1", "{not json");
  assert.deepEqual(new AccountStore(kv).list(), []);
  kv.setItem("nivpay.accounts.v1", JSON.stringify([{ address: "0xnope", name: "x" }, { address: B, name: "ok" }]));
  assert.deepEqual(new AccountStore(kv).list().map((a) => a.name), ["ok"]);
});

test("shortAddress", () => {
  assert.equal(shortAddress(B), "0x0710…9B20");
});

test("passkeys only on localhost and the production hostname", () => {
  assert.deepEqual(checkPasskeyHost("localhost", ""), { ok: true, rpId: "localhost" });
  assert.equal(checkPasskeyHost("127.0.0.1", "").ok, false);
  assert.equal(checkPasskeyHost("nivpay-git-branch.vercel.app", "").ok, false);
  assert.deepEqual(checkPasskeyHost("nivpay.example", "nivpay.example"), { ok: true, rpId: "nivpay.example" });
  const preview = checkPasskeyHost("nivpay-abc123.vercel.app", "nivpay.example");
  assert.equal(preview.ok, false);
  if (!preview.ok) assert.match(preview.message, /nivpay\.example/);
});

test("Mera errors become plain words", () => {
  assert.match(passkeyErrorMessage(new MeraError("PRF_UNAVAILABLE", "x")), /Google Password Manager/);
  assert.match(passkeyErrorMessage(new MeraError("PRF_UNAVAILABLE", "x")), /Samsung Pass/);
  assert.match(passkeyErrorMessage(new MeraError("PASSKEY_OPERATION_FAILED", "x")), /Nothing was saved/);
  assert.match(passkeyErrorMessage(new MeraError("CRYPTO_UNAVAILABLE", "x")), /Update Chrome/);
  assert.match(passkeyErrorMessage(new WrongPasskeyError()), /different NivPay account/);
  assert.match(passkeyErrorMessage(new Error("boom")), /Nothing was sent/);
});
