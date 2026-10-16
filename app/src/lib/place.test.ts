import { test } from "node:test";
import assert from "node:assert/strict";
import { keepPlace, readPlace } from "./place.ts";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

test("a reload finds the same screen and tab, bigints and all", () => {
  const kv = memory();
  const place = { tab: "pots", screen: { kind: "request", pot: { potId: "7", block: "12" }, proposalId: 3n }, amount: 0n };
  keepPlace(kv, "0xAbC", place);
  assert.deepEqual(readPlace(kv, "0xabc"), place);
});

test("another account, nothing kept, or something unreadable: Home", () => {
  const kv = memory();
  assert.equal(readPlace(kv, "0xabc"), null);
  keepPlace(kv, "0xabc", { tab: "home" });
  assert.equal(readPlace(kv, "0xdef"), null);
  assert.equal(readPlace(kv, undefined), null);
  kv.m.set("nivpay.place.v1", "{not json");
  assert.equal(readPlace(kv, "0xabc"), null);
});

test("storage that refuses is no failure", () => {
  const refuses = {
    getItem: () => {
      throw new Error("refused");
    },
    setItem: () => {
      throw new Error("refused");
    },
  };
  keepPlace(refuses, "0xabc", { tab: "home" });
  assert.equal(readPlace(refuses, "0xabc"), null);
});
