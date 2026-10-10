import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { initialsOf, mapLines } from "./mapNames.ts";

const A = "0x5c8f2e3d4a1B6c7d8e9f0a1b2c3d4e5f6a7b8C9d" as Address;

test("with signed names the map shows the city, then who and what", () => {
  assert.deepEqual(mapLines({ account: A, city: "Uyo", me: false, name: "Aniekan" }, true, "Aniekan · asked", "asked"), { city: "Uyo", sub: "Aniekan · asked" });
});

test("without names the first line is short enough for the map, and never says You twice", () => {
  assert.deepEqual(mapLines({ account: A, city: "", me: false, name: "account ending 8C9d" }, false, "account ending 8C9d · asked", "asked"), { city: "Ending 8C9d", sub: "asked" });
  assert.deepEqual(mapLines({ account: A, city: "", me: true, name: "You" }, false, "You", ""), { city: "You", sub: "" });
  assert.ok("Ending 8C9d".length <= 12, "fits beside a city at the map's edge");
});

test("a decider's circle shows their initial, or two characters of their account", () => {
  assert.equal(initialsOf(A, "aniekan", true), "A");
  assert.equal(initialsOf(A, "account ending 8C9d", false), "9D");
});
