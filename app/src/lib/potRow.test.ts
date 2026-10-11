import { test } from "node:test";
import assert from "node:assert/strict";
import { copy } from "../copy.ts";
import type { FoundPot } from "./discover.ts";
import { openedPotMeta } from "./potRow.ts";

const pot = (roles: FoundPot["roles"]): FoundPot => ({ potId: "4", roles, name: "Birthday", totalAssets: "200000000", endTime: "0", closed: false });

test("a pot made on this phone by a decider says so on Home, not 'Open to chip in' (footage 1000335865 at 86 s)", () => {
  assert.equal(openedPotMeta(pot(["decides", "putIn"]), "$200"), "You decide on payments and you've put money in. Holds $200.");
});

test("a pot whose link was opened by someone with no role in it keeps the general line", () => {
  assert.equal(openedPotMeta(undefined, "…"), copy.potRowJoined);
  assert.equal(openedPotMeta(pot([]), "$0"), copy.potRowJoined);
});
