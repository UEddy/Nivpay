import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { availability, isWellFormed, NEVER, normalizeUsername, RESERVED, usernameProblem } from "./usernames.ts";

/** The vectors NivPayNames' own tests read (test/NamesCore.t.sol), so the phone and the contract agree. */
const vectors = JSON.parse(readFileSync(new URL("../../../test/vectors/usernames.json", import.meta.url), "utf8")) as {
  allowed: string[];
  notAllowed: string[];
  reserved: string[];
  normalize: [string, string][];
};
const sol = readFileSync(new URL("../../../src/NivPayNames.sol", import.meta.url), "utf8");

test("every allowed name in the shared vectors is allowed here", () => {
  assert.ok(vectors.allowed.length > 10);
  for (const n of vectors.allowed) assert.equal(usernameProblem(n), null, n);
});

test("every not allowed name in the shared vectors breaks a character rule here", () => {
  assert.ok(vectors.notAllowed.length > 10);
  for (const n of vectors.notAllowed) {
    assert.notEqual(usernameProblem(n), null, JSON.stringify(n));
    assert.equal(isWellFormed(n), false, JSON.stringify(n));
  }
});

test("every reserved name in the shared vectors is well formed and reserved here", () => {
  for (const n of vectors.reserved) {
    assert.equal(isWellFormed(n), true, n);
    assert.equal(usernameProblem(n), "reserved", n);
  }
});

test("what people type becomes the name they mean", () => {
  for (const [typed, name] of vectors.normalize) assert.equal(normalizeUsername(typed), name, JSON.stringify(typed));
});

test("the reserved list and the limits are the contract's, word for word", () => {
  for (const r of RESERVED) assert.match(sol, new RegExp(`keccak256\\("${r}"\\)`), r);
  assert.equal([...sol.matchAll(/h == keccak256\("[a-z]+"\)/g)].length, RESERVED.length, "no reserved name only the contract knows");
  assert.match(sol, /MIN_LENGTH = 3;/);
  assert.match(sol, /MAX_LENGTH = 20;/);
  assert.match(sol, /HOLD_PERIOD = 90 days;/);
  assert.match(sol, /_contains\(name, "nivpay"\)/);
});

test("each rule gives its own reason", () => {
  const cases: [string, ReturnType<typeof usernameProblem>][] = [
    ["ab", "short"],
    ["a".repeat(21), "long"],
    ["1ab", "start"],
    ["ab-c", "characters"],
    ["a__b", "underscores"],
    ["ab_", "end"],
    ["help", "reserved"],
    ["ilovenivpay", "reserved"],
    ["idara", null],
  ];
  for (const [name, why] of cases) assert.equal(usernameProblem(name), why, name);
});

const ME = "0x1A9A136f1cf59899C6b8cfE84ac4df388620467d";
const OTHER = "0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1";

test("what the screen says about a name, from one finalized read", () => {
  const free = { holder: null, availableAt: 0n, releasedBy: null };
  assert.deepEqual(availability("idara", ME, free), { kind: "available" });
  assert.deepEqual(availability("Idara", ME, free), { kind: "notAllowed", problem: "start" });
  assert.deepEqual(availability("idara", ME, { holder: OTHER, availableAt: NEVER, releasedBy: null }), { kind: "taken" });
  assert.deepEqual(availability("idara", ME, { holder: ME.toLowerCase(), availableAt: NEVER, releasedBy: null }), { kind: "yours" });
  assert.deepEqual(availability("idara", ME, { holder: null, availableAt: 1_800_000_000n, releasedBy: OTHER }), { kind: "held", until: 1_800_000_000n });
  assert.deepEqual(availability("idara", ME, { holder: null, availableAt: 1_800_000_000n, releasedBy: ME }), { kind: "takeBack", until: 1_800_000_000n });
});
