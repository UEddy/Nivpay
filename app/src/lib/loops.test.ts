import { test } from "node:test";
import assert from "node:assert/strict";
import { loopsOn, MAX_LOOPS, type LoopWants } from "./loops.ts";

const KEYS = ["coinHolding", "outside", "asked", "peopleMarch", "badgeLive"] as const;
const every: LoopWants[] = Array.from({ length: 1 << KEYS.length }, (_, n) =>
  Object.fromEntries(KEYS.map((k, i) => [k, Boolean(n & (1 << i))])) as LoopWants,
);

test("no state ever runs more than two loops, counting one off the map", () => {
  for (const w of every) {
    const on = loopsOn(w);
    const kinds = new Set<string>();
    if (w.coinHolding) kinds.add("hold");
    if (w.outside) kinds.add("outside");
    if (on.payeeMarch || on.peopleMarch) kinds.add("march");
    if (on.payeePing || on.badgePing) kinds.add("ping");
    assert.ok(kinds.size <= MAX_LOOPS, JSON.stringify(w));
    assert.deepEqual([...kinds].sort(), [...on.loops].sort(), JSON.stringify(w));
  }
});

test("nothing loops that wasn't asked for", () => {
  for (const w of every) {
    const on = loopsOn(w);
    if (on.payeeMarch || on.payeePing) assert.ok(w.asked);
    if (on.peopleMarch) assert.ok(w.peopleMarch);
    if (on.badgePing) assert.ok(w.badgeLive && !w.asked);
  }
});

test("a payment asked takes the badge's place, as before", () => {
  const on = loopsOn({ coinHolding: false, outside: false, asked: true, peopleMarch: true, badgeLive: true });
  assert.deepEqual(on, { loops: ["march", "ping"], payeeMarch: true, peopleMarch: true, payeePing: true, badgePing: false });
});

test("your coin waiting at the rim always keeps its pulse, and stops the pings first", () => {
  for (const w of every.filter((w) => w.coinHolding)) assert.equal(loopsOn(w).loops[0], "hold");
  const on = loopsOn({ coinHolding: true, outside: false, asked: false, peopleMarch: true, badgeLive: true });
  assert.deepEqual(on.loops, ["hold", "march"]);
  assert.equal(on.badgePing, false);
});

test("a pulsing yes off the map leaves the asked payment's route marching, its ring still", () => {
  const on = loopsOn({ coinHolding: false, outside: true, asked: true, peopleMarch: false, badgeLive: true });
  assert.deepEqual(on, { loops: ["outside", "march"], payeeMarch: true, peopleMarch: false, payeePing: false, badgePing: false });
});
