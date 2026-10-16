import { test } from "node:test";
import assert from "node:assert/strict";
import { closeDetail, detailIn, openDetail, type HistoryLike } from "./backNav.ts";

/** A browser history in miniature: entries and where we are, with popstate. */
function fakeHistory() {
  const entries: unknown[] = [null];
  let at = 0;
  const pops: unknown[] = [];
  const h: HistoryLike & { length: () => number; onPop: (s: unknown) => void } = {
    get state() {
      return entries[at];
    },
    pushState(data: unknown) {
      entries.splice(at + 1);
      entries.push(data);
      at += 1;
    },
    back() {
      if (at === 0) return;
      at -= 1;
      pops.push(entries[at]);
      h.onPop(entries[at]);
    },
    length: () => entries.length,
    onPop: () => {},
  };
  return { h, pops, at: () => at };
}

test("a detail screen adds one entry; the phone's back returns to Profile, not out of the app", () => {
  const { h, at } = fakeHistory();
  let view = "main";
  h.onPop = (s) => (view = detailIn(s) ?? "main");
  openDetail(h, "devices");
  view = "devices";
  assert.equal(at(), 1);
  h.back(); // Android's back gesture.
  assert.equal(view, "main");
  assert.equal(at(), 0, "still on the app's own page");
});

test("the arrow pops that same entry, so arrow and gesture agree; with no entry it just shows Profile", () => {
  const { h, at } = fakeHistory();
  let view = "main";
  h.onPop = (s) => (view = detailIn(s) ?? "main");
  for (const v of ["devices", "limit", "language", "username", "photo", "notifications", "voice", "hidden", "name"]) {
    openDetail(h, v);
    view = v;
    assert.equal(closeDetail(h), "popped", v);
    assert.equal(view, "main", v);
    assert.equal(at(), 0, `${v}: no entries left behind`);
  }
  assert.equal(closeDetail(h), "shown");
  assert.equal(at(), 0, "never goes back past the app's page");
});

test("opening the same screen twice adds one entry, and other state on the entry is kept", () => {
  const { h } = fakeHistory();
  h.pushState({ other: 1 }, "");
  openDetail(h, "devices");
  openDetail(h, "devices");
  assert.deepEqual(h.state, { other: 1, nivpayProfile: "devices" });
  assert.equal(detailIn(null), null);
  assert.equal(detailIn({ nivpayProfile: 5 }), null);
});
