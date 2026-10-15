import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { initialsFor, photoUrl, ReportedPhotos, squareCrop } from "./photo.ts";

const ID = "0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1";

test("the largest centred square of any picture", () => {
  assert.deepEqual(squareCrop(4000, 3000), { sx: 500, sy: 0, size: 3000 });
  assert.deepEqual(squareCrop(1080, 1920), { sx: 0, sy: 420, size: 1080 });
  assert.deepEqual(squareCrop(256, 256), { sx: 0, sy: 0, size: 256 });
  assert.deepEqual(squareCrop(301, 100), { sx: 100, sy: 0, size: 100 });
});

test("initials for someone with no photo", () => {
  assert.equal(initialsFor("Idara", ID), "I");
  assert.equal(initialsFor("Idara Etim", ID), "IE");
  assert.equal(initialsFor("Mary Jane Okon", ID), "MO");
  assert.equal(initialsFor("  ìdàrà  ", ID), "Ì");
  assert.equal(initialsFor("@idara", ID), "I");
  assert.equal(initialsFor("account ending 7bC1", ID), "C1", "no name: the end of the account");
  assert.equal(initialsFor("compte se terminant par 7bC1", ID), "C1", "in any language");
  assert.equal(initialsFor("", ID), "C1");
  assert.equal(initialsFor("🎉", ID), "C1");
});

test("a photo is read from this site only, by its account", () => {
  assert.equal(photoUrl(ID.toLowerCase() as typeof ID), `/api/photo/${getAddress(ID)}`);
  assert.equal(photoUrl(ID, 3), `/api/photo/${getAddress(ID)}?v=3`);
});

test("a reported photo is remembered on this phone", () => {
  const m = new Map<string, string>();
  const r = new ReportedPhotos({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) });
  assert.equal(r.has(ID), false);
  r.add(ID);
  assert.equal(r.has(ID.toLowerCase()), true);
});
