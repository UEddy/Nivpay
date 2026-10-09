import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DRAWN_PAYEES, MAX_DRAWN_PEOPLE, payeeSpots, personSpots, reverseRoute, VIEW } from "./potmap.ts";

test("three people and two payees sit exactly where the comps put them", () => {
  assert.deepEqual(
    personSpots(3).map((s) => s.route),
    ["M236 30 Q224 58 180 78", "M38 96 Q80 52 131 112", "M214 204 Q206 170 182 153"],
  );
  assert.deepEqual(
    payeeSpots(2).map((s) => s.route),
    ["M201 114 Q248 80 290 92", "M199 131 Q246 158 290 160"],
  );
});

test("other counts stay inside the map, labels included", () => {
  for (let n = 0; n <= 12; n++) {
    const people = personSpots(n);
    const payees = payeeSpots(n);
    assert.equal(people.length, Math.min(n, MAX_DRAWN_PEOPLE));
    assert.equal(payees.length, Math.min(n, MAX_DRAWN_PAYEES));
    for (const s of [...people, ...payees]) {
      assert.ok(s.x >= 11 && s.x <= VIEW.width - 11, `x ${s.x}`);
      assert.ok(s.y >= 11 && s.y <= VIEW.height - 11, `y ${s.y}`);
      assert.ok(s.label.y + 13 <= VIEW.height, `label at ${s.label.y} fits`);
    }
  }
});

test("payees never overlap one another", () => {
  for (let n = 1; n <= MAX_DRAWN_PAYEES; n++) {
    const ys = payeeSpots(n).map((s) => s.y);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i]! - ys[i - 1]! >= 60, `${n} payees: ${ys.join(", ")}`);
  }
});

test("a reversed route runs the same curve the other way", () => {
  assert.equal(reverseRoute("M38 96 Q80 52 131 112"), "M131 112 Q80 52 38 96");
  assert.throws(() => reverseRoute("M0 0 L1 1"));
});
