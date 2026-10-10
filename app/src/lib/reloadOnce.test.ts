import { test } from "node:test";
import assert from "node:assert/strict";
import { reloadOnce, type ReloadDeps } from "./reloadOnce.ts";

function deps(online = true) {
  const kv = new Map<string, string>();
  let reloads = 0;
  let t = 1_000_000;
  const d: ReloadDeps = { storage: { getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => void kv.set(k, v) }, reload: () => void reloads++, now: () => t, online: () => online };
  return { d, reloads: () => reloads, advance: (ms: number) => void (t += ms) };
}

test("a part that loads is returned as it is, with no reload", async () => {
  const x = deps();
  assert.equal(await reloadOnce(async () => 7, x.d), 7);
  assert.equal(x.reloads(), 0);
});

test("a missing file after a deploy reloads the page once, and the second failure in a minute is thrown", async () => {
  const x = deps();
  const gone = () => Promise.reject(new TypeError("Failed to fetch dynamically imported module"));
  void reloadOnce(gone, x.d);
  await new Promise((r) => setImmediate(r));
  assert.equal(x.reloads(), 1);
  await assert.rejects(reloadOnce(gone, x.d), TypeError);
  assert.equal(x.reloads(), 1);
  x.advance(61_000);
  void reloadOnce(gone, x.d);
  await new Promise((r) => setImmediate(r));
  assert.equal(x.reloads(), 2);
});

test("offline, a part that can't load is an error, never a reload", async () => {
  const x = deps(false);
  await assert.rejects(reloadOnce(() => Promise.reject(new TypeError("offline")), x.d), TypeError);
  assert.equal(x.reloads(), 0);
});
