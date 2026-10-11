import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import type { ClipEntry, Redactions } from "./redactions.ts";
import { FINGERPRINT_CAPTION } from "./redactions.ts";
import { NOT_MEASURED, problems, resolve, segmentFrames, textProblems, totalFrames, type Segment, type Timeline } from "./timeline.ts";

const card = (id: string, seconds: number, over: Partial<Segment> = {}): Segment => ({ id, shot: "card", kind: "card", plan: "a card", seconds, title: "NivPay", ...over });
const phone = (id: string, seconds: number, over: Partial<Segment> = {}): Segment => ({ id, shot: id, kind: "phone", plan: "a phone", take: { clip: null, in: 0, out: seconds }, ...over });
const tl = (segments: Segment[], over: Partial<Timeline> = {}): Timeline => ({
  id: "t", width: 1920, height: 1080, fps: 30, minSeconds: 0, capSeconds: 120, target: [0, 120], words: "technical", segments, ...over,
});

test("a caption may not hold an en or em dash, a typed digit or an unknown fact", () => {
  assert.deepEqual(textProblems("Pour in {pot.pours.eddy}", "technical", false), []);
  assert.match(textProblems("Pay \u2014 now", "technical", false).join(), /dash/);
  assert.match(textProblems("Pay \u2013 now", "technical", false).join(), /dash/);
  assert.match(textProblems("Settled in 0.4s", "technical", false).join(), /digit typed in/);
  assert.match(textProblems("Pays {pot.nope}", "technical", false).join(), /not in facts\.ts/);
  assert.equal(resolve("Fee {pot.caterer.fee}"), "Fee $3.00");
  assert.equal(resolve("Settled in {measured.sendSettle}"), `Settled in ${NOT_MEASURED}`);
  assert.equal(resolve("{hashes.showcase.createPot|short}"), "0x6d1d...199c");
});

test("crypto words never; Monad, AUSD and transaction hash in technical captions only; chain words on the explorer only", () => {
  for (const w of ["crypto", "Blockchain", "wallet", "gas", "tokens", "Web3", "stablecoin"]) {
    assert.match(textProblems(`Your ${w} here`, "technical", true).join(), /not allowed/, w);
  }
  assert.deepEqual(textProblems("Held as AUSD on Monad, with its transaction hash", "technical", false), []);
  assert.match(textProblems("Held as AUSD", "consumer", false).join(), /"ausd"/);
  assert.match(textProblems("Runs on {chain.name}", "consumer", false).join(), /"monad"/);
  assert.match(textProblems("The pot contract", "technical", false).join(), /"contract"/);
  assert.deepEqual(textProblems("The pot contract, and blocks land {chain.blockTime} apart", "technical", true), []);
  assert.match(textProblems("Its transaction", "technical", false).join(), /"transaction"/);
  // Parts of other words don't count.
  assert.deepEqual(textProblems("Regas, Gaston, tokenless? No: Agastache", "consumer", false).filter((p) => /gas/.test(p)), []);
});

test("placeholders and facts not measured yet refuse a final render but allow a draft", () => {
  const p = problems(tl([phone("B01", 5, { caption: "Settled in {measured.sendSettle}" })]), null);
  assert.deepEqual(p.hard, []);
  assert.equal(p.final.length, 2);
  assert.match(p.final.join(), /placeholder for shot B01/);
  assert.match(p.final.join(), /\{measured\.sendSettle\} is not measured yet/);
});

test("the Settled in moment is never sped up, and anything sped up is shortened by its speed", () => {
  assert.match(problems(tl([phone("A", 10, { speed: 2, settle: true })]), null).hard.join(), /never sped up/);
  assert.equal(segmentFrames(phone("A", 10, { speed: 4 }), null), 75);
});

test("over the cap or under the minimum refuses every render; outside the target only warns", () => {
  assert.match(problems(tl([card("c", 121)]), null).hard.join(), /over the 120 s cap/);
  assert.match(problems(tl([card("c", 20)], { minSeconds: 30 }), null).hard.join(), /under the 30 s minimum/);
  const p = problems(tl([card("c", 100)], { target: [105, 115] }), null);
  assert.deepEqual(p.hard, []);
  assert.match(p.warnings.join(), /outside the 105 to 115 s target/);
});

test("each proof must be shown by a segment that ends by the deadline", () => {
  const late = tl([card("c", 80), phone("S", 15, { proves: ["settled"] })], { provesBy: { seconds: 90, proofs: ["settled", "passkey"] } });
  const hard = problems(late, null).hard.join();
  assert.match(hard, /"settled" is shown by 95\.0 s, after 90 s/);
  assert.match(hard, /nothing shows "passkey"/);
});

test("a pair runs both phones the same length, and both real or both placeholders", () => {
  const pair = (b: number, clipB: string | null): Segment => ({ id: "P", shot: "P", kind: "pair", plan: "two phones", take: { clip: null, in: 0, out: 5 }, takeB: { clip: clipB, in: 0, out: b } });
  assert.deepEqual(problems(tl([pair(5, null)]), null).hard, []);
  assert.match(problems(tl([pair(6, null)]), null).hard.join(), /same length/);
  assert.match(problems(tl([pair(5, "x")]), null).hard.join(), /both phones are real or both placeholders/);
});

test("a real clip's length is its redacted length: a cut becomes a hold of at most 2.5 s", () => {
  const entry: ClipEntry = {
    file: "x.mp4", phone: "A", width: 1080, height: 2340, durationSeconds: 60, statusBar: 0.04, reviewed: true, regions: [],
    cuts: [], holds: [{ start: 10, end: 11, caption: FINGERPRINT_CAPTION }],
  };
  const map: Redactions = { version: 1, clips: { x: entry } };
  const seg = phone("A", 0, { take: { clip: "x", in: 5, out: 15 } });
  assert.equal(segmentFrames(seg, map), 300);
  assert.match(problems(tl([phone("B", 0, { take: { clip: "y", in: 0, out: 1 } })]), map).hard.join(), /not in redactions\.json/);
  assert.match(problems(tl([phone("B", 0, { take: { clip: "x", in: 0, out: 61 } })]), map).hard.join(), /past the end/);
});

test("the three committed timelines pass every rule a draft needs, within their caps", () => {
  const dir = new URL("../timelines/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(files, ["agora-bounty.json", "technical-demo.json", "x-launch.json"]);
  for (const f of files) {
    const t = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Timeline;
    const p = problems(t, null);
    assert.deepEqual(p.hard, [], f);
    assert.deepEqual(p.warnings, [], f);
    const s = totalFrames(t, null) / 30;
    assert.ok(s >= t.target[0] && s <= t.target[1], `${f}: ${s} s`);
  }
});
