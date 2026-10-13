import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTimeline, TIMELINE_IDS } from "./guard.ts";
import { storyboard } from "./storyboard.ts";

test("STORYBOARD.md is what the timelines say (run node scripts/storyboard.ts after changing one)", () => {
  const onDisk = readFileSync(new URL("../STORYBOARD.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(onDisk, storyboard(TIMELINE_IDS.map(loadTimeline)));
});

test("every shot a timeline uses is in SHOTLIST.md", () => {
  const shotlist = readFileSync(new URL("../SHOTLIST.md", import.meta.url), "utf8");
  for (const id of TIMELINE_IDS) {
    for (const s of loadTimeline(id).segments) {
      // Cards and receipt cards are drawn, not recorded.
      if (s.kind === "card" || s.kind === "receipt") continue;
      assert.match(shotlist, new RegExp(`^### ${s.shot}\\. `, "m"), `${id} ${s.id} uses ${s.shot}`);
    }
  }
});
