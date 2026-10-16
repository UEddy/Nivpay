import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { isUsernameStandIn, nameAtStart, PendingNames, readSavedName, saveName } from "./displayName.ts";
import { proofMessage, sha256Hex } from "./proof.ts";

const me = privateKeyToAccount(generatePrivateKey());

test("the kept name wins at sign-in; a username in place of a name is dropped; with none anywhere, ask once", () => {
  assert.deepEqual(nameAtStart("", "Eddy", false), { name: "Eddy", ask: false }, "a new phone gets the kept name");
  assert.deepEqual(nameAtStart("Ed", "Eddy", false), { name: "Eddy", ask: false }, "changed on another phone");
  assert.deepEqual(nameAtStart("@eddy", "Eddy", false), { name: "Eddy", ask: false });
  assert.deepEqual(nameAtStart("Eddy", null, false), { name: "Eddy", ask: false }, "kept here only, from before");
  assert.deepEqual(nameAtStart("Eddy", undefined, false), { name: "Eddy", ask: false }, "the server can't be reached");
  assert.deepEqual(nameAtStart("", null, false), { name: "", ask: true });
  assert.deepEqual(nameAtStart("", undefined, false), { name: "", ask: true });
  assert.deepEqual(nameAtStart("", null, true), { name: "", ask: false }, "Skip on this phone is kept");
  assert.deepEqual(nameAtStart("@eddy", null, false), { name: "", ask: true }, "never the username in the header");
  assert.deepEqual(nameAtStart("@eddy", undefined, true), { name: "", ask: true }, "the stand-in was never a choice to skip");
});

test("a username stand-in is @ and a username; names that only look a bit like one stay names", () => {
  for (const s of ["@eddy", "@ed_2", "@abcdefghijklmnopqrst"]) assert.ok(isUsernameStandIn(s), s);
  for (const s of ["Eddy", "@Eddy", "@ed dy", "@e", "eddy@", "@1eddy", "@abcdefghijklmnopqrstu", ""]) assert.ok(!isUsernameStandIn(s), s);
});

test("saving signs the account, the name's hash and the time, and posts the clean name", async () => {
  let sent: Record<string, unknown> = {};
  const post = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  await saveName(me.address, "  Eddy ‮ Ed  ", (m) => me.signMessage({ message: m }), 1_800_000_000_000, "nivpay.example", post);
  assert.equal(sent.name, "Eddy Ed");
  assert.equal(sent.action, "set");
  assert.equal(sent.time, 1_800_000_000);
  const message = proofMessage({ subject: "name", action: "set", account: me.address, data: `sha256:${await sha256Hex(new TextEncoder().encode("Eddy Ed"))}`, time: 1_800_000_000, site: "nivpay.example" });
  assert.equal(await recoverMessageAddress({ message, signature: sent.signature as `0x${string}` }), me.address);
});

test("saving says so when it is refused, and never sends an empty name", async () => {
  const refuse = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(saveName(me.address, "Eddy", (m) => me.signMessage({ message: m }), Date.now(), "x", refuse), /name refused: 429/);
  let called = false;
  const never = (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch;
  await assert.rejects(saveName(me.address, " ​ ", (m) => me.signMessage({ message: m }), Date.now(), "x", never), /empty/);
  assert.equal(called, false);
});

test("reading: a name, none, or undefined when it can't be read; what comes back is cleaned", async () => {
  const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assert.equal(await readSavedName(me.address, answer(200, { name: "Eddy" })), "Eddy");
  assert.equal(await readSavedName(me.address, answer(200, { name: "Ed​dy" })), "Eddy");
  assert.equal(await readSavedName(me.address, answer(200, { name: null })), null);
  assert.equal(await readSavedName(me.address, answer(502, { error: "x" })), undefined);
  assert.equal(await readSavedName(me.address, answer(200, { name: 5 })), undefined);
  const offline = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  assert.equal(await readSavedName(me.address, offline), undefined);
});

test("a name not yet kept for the other phones is remembered until it is", () => {
  const m = new Map<string, string>();
  const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  const p = new PendingNames(kv);
  assert.equal(p.has(me.address), false);
  p.set(me.address, true);
  p.set(me.address, true);
  assert.equal(p.has(me.address.toLowerCase()), true);
  assert.equal(JSON.parse(m.get("nivpay.namepending.v1")!).length, 1);
  p.set(me.address, false);
  assert.equal(p.has(me.address), false);
  m.set("nivpay.namepending.v1", "{broken");
  assert.equal(new PendingNames(kv).has(me.address), false);
});
