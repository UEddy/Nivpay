import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGE_CHOICES, limitUsedShare, profileGroups, type ProfileFacts } from "./profile.ts";

const ALL: ProfileFacts = { namesOn: true, photosOn: true, hiddenPots: 2, hasReceipt: true, notificationsOn: true, voiceOffered: true, canInstall: true };

test("every row, grouped and in order, when everything is set up", () => {
  assert.deepEqual(profileGroups(ALL), [
    { group: "account", rows: ["name", "username", "photo"] },
    { group: "money", rows: ["limit", "hidden", "receipt"] },
    { group: "security", rows: ["devices"] },
    { group: "preferences", rows: ["language", "notifications", "voice"] },
    { group: "help", rows: ["help", "install"] },
  ]);
});

test("a feature not set up, or with nothing in it, has no row; a group with no rows goes", () => {
  const none = profileGroups({ namesOn: false, photosOn: false, hiddenPots: 0, hasReceipt: false, notificationsOn: false, voiceOffered: false, canInstall: false });
  assert.deepEqual(none, [
    { group: "account", rows: ["name"] },
    { group: "money", rows: ["limit"] },
    { group: "security", rows: ["devices"] },
    { group: "preferences", rows: ["language"] },
    { group: "help", rows: ["help"] },
  ]);
  const flat = profileGroups(ALL).flatMap((g) => g.rows);
  assert.ok(!profileGroups({ ...ALL, hiddenPots: 0 }).flatMap((g) => g.rows).includes("hidden"), "no hidden pots: no row");
  assert.ok(!profileGroups({ ...ALL, canInstall: false }).flatMap((g) => g.rows).includes("install"), "installed already: no row");
  assert.equal(new Set(flat).size, flat.length, "each row once");
});

test("the daily limit's bar: the share used, kept between 0 and 100", () => {
  assert.equal(limitUsedShare(0n, 1_000_000_000n), 0);
  assert.equal(limitUsedShare(250_000_000n, 1_000_000_000n), 25);
  assert.equal(limitUsedShare(1_234_567n, 1_000_000_000n), 0.1);
  assert.equal(limitUsedShare(2_000_000_000n, 1_000_000_000n), 100, "over the limit still fills the bar, no further");
  assert.equal(limitUsedShare(5n, 0n), 100);
});

test("languages: the phone's own first, then each one", () => {
  assert.deepEqual(LANGUAGE_CHOICES, [null, "en", "fr", "es", "pt"]);
});
