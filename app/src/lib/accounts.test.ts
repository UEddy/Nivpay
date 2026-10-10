import { test } from "node:test";
import assert from "node:assert/strict";
import { MeraError } from "@category-labs/mera";
import { AccountStore, cleanName, defaultAccountName, NAME_MAX, shownName } from "./accounts.ts";
import { checkPasskeyHost } from "./hosts.ts";
import { describeFailure, WrongPasskeyError } from "./errors.ts";

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

test("an account with no name is shown by its last four characters, never a 0x form, and the fallback is never kept as a name", () => {
  assert.equal(defaultAccountName(B), "Account 9B20");
  const store = new AccountStore(memory());
  store.upsert({ address: B, name: "" });
  assert.equal(store.list()[0]?.name, "");
  assert.equal(shownName(store.list()[0]!), "Account 9B20");
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

test("Mera errors become plain words with a code, and never claim anything about sending", () => {
  for (const code of ["PRF_UNAVAILABLE", "PASSKEY_OPERATION_FAILED", "CRYPTO_UNAVAILABLE", "SESSION_ENDED"] as const) {
    const d = describeFailure(new MeraError(code, "x"));
    assert.doesNotMatch(d.text, /sent/i, code);
    assert.ok(d.code >= 30 && d.code < 40, code);
  }
  assert.match(describeFailure(new MeraError("PRF_UNAVAILABLE", "x")).text, /Google Password Manager/);
  assert.match(describeFailure(new MeraError("PRF_UNAVAILABLE", "x")).text, /Samsung Pass/);
  assert.match(describeFailure(new WrongPasskeyError()).text, /different NivPay account/);
});

test("a fallback saved as a name by an earlier version reads as no name, so the person is asked once", () => {
  const kv = memory();
  kv.setItem("nivpay.accounts.v1", JSON.stringify([{ address: B, name: "Account 9B20" }]));
  const store = new AccountStore(kv);
  assert.equal(store.list()[0]?.name, "");
  assert.equal(store.needsName(B), true);
});

test("asked once: Skip is remembered for that account on this phone, and a name ends the asking", () => {
  const store = new AccountStore(memory());
  store.upsert({ address: A as `0x${string}`, name: "" });
  store.upsert({ address: B, name: "" });
  store.skipName(A as `0x${string}`);
  assert.equal(store.needsName(A as `0x${string}`), false);
  assert.equal(store.needsName(B), true);
  assert.equal(store.rename(B, "  Ubong  "), true);
  assert.equal(store.needsName(B), false);
  assert.equal(store.list().find((a) => a.address === B)?.name, "Ubong");
});

test("a name can be changed but not blanked, and only for an account this phone knows", () => {
  const store = new AccountStore(memory());
  store.upsert({ address: B, name: "Ubong" });
  assert.equal(store.rename(B, "\u200b \u202e "), false);
  assert.equal(store.list()[0]?.name, "Ubong");
  assert.equal(store.rename(A as `0x${string}`, "Idara"), false);
  assert.equal(store.list().length, 1);
});

test("a name is plain text: controls, direction overrides and zero-width characters go, spaces are tidied, length is capped", () => {
  assert.equal(cleanName("  Idara   Udo \n"), "Idara Udo");
  // U+202E would show "Idara" as "aradI"-looking text; U+200B and U+FEFF make two names look the same.
  assert.equal(cleanName("Id\u202eara\u200b\ufeff"), "Idara");
  assert.equal(cleanName("Ubong\u0000\u0007\u001b[31m"), "Ubong[31m");
  assert.equal(cleanName("<img src=x onerror=alert(1)>"), "<img src=x onerror=alert(1)>", "kept as text; React shows it as text");
  assert.equal(Array.from(cleanName("\u00e9".repeat(100))).length, NAME_MAX);
  assert.equal(cleanName("e\u0301"), "\u00e9", "normalised, so the same name is stored the same way");
  assert.equal(cleanName("\u2066\u2069\u200d"), "");
});

test("whatever is typed, only an address and a cleaned name are kept", () => {
  const kv = memory();
  const store = new AccountStore(kv);
  store.upsert({ address: B, name: "Aniekan\u202e<script>" });
  store.skipName(B);
  const parsed = JSON.parse(kv.raw.get("nivpay.accounts.v1") ?? "[]") as Record<string, string>[];
  assert.deepEqual(parsed, [{ address: B, name: "Aniekan<script>" }]);
  assert.deepEqual(JSON.parse(kv.raw.get("nivpay.nameSkipped.v1") ?? "[]"), [B]);
});
