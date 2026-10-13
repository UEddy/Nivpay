/**
 * Writes STORYBOARD.md from the three timeline files, so the storyboard and
 * what renders can never disagree. storyboard.test.ts fails when the file is
 * out of date.
 *
 *   node scripts/storyboard.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FRAME_HELD_TAG, holdsFrame, resolve, segmentFrames, SPED_UP_TAG, type Segment, type Timeline } from "../src/timeline.ts";
import { loadTimeline, TIMELINE_IDS } from "./guard.ts";

const root = join(import.meta.dirname, "..");

const KIND: Record<Segment["kind"], string> = { phone: "one phone", pair: "both phones side by side", explorer: "explorer", card: "card", receipt: "receipt card read from the chain" };

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

const ABOUT: Record<string, string> = {
  "agora-bounty": "For the Agora bounty judges. The three things they look for (passkey onboarding, an AUSD balance, a send and a receive settled at once) are each shown by a segment that ends before 90 s; the timeline check fails otherwise.",
  "technical-demo": "The product working on the B1 take, the settlement, receipts read from Monad testnet, and how a pot works in the README's own words, with a pot made in an earlier test run. Monad, AUSD and transaction hash may appear in captions; chain words only on the receipt cards.",
  "x-launch": "For X: square, consumer words only, no crypto words at all. A new account, a balance, a send and its arrival, then the end frame with the link.",
};

export function storyboard(timelines: Timeline[]): string {
  const out: string[] = [
    "# Storyboard",
    "",
    "Generated from `timelines/*.json` by `node scripts/storyboard.ts`; do not edit by hand. Times are planned:",
    "they come from the placeholders' lengths now, and from the real in and out points once footage is in.",
    "Captions show `[not measured yet]` where facts.ts has no value yet; a final render refuses until it does.",
    "Shots refer to [SHOTLIST.md](SHOTLIST.md).",
  ];
  for (const t of timelines) {
    let at = 0;
    const total = t.segments.reduce((n, s) => n + segmentFrames(s, null), 0) / t.fps;
    out.push(
      "",
      `## ${t.id}`,
      "",
      `${t.width}x${t.height}, ${t.fps} fps, ${total.toFixed(1)} s planned (target ${t.target[0]} to ${t.target[1]} s, cap ${t.capSeconds} s).`,
      ABOUT[t.id] ?? "",
      ...(t.legend ? ["", `Beside every phone shot: ${t.legend.map(resolve).join("; ")}.`] : []),
      "",
      "| Time | Shot | On screen | Caption | Callout |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const s of t.segments) {
      const secs = segmentFrames(s, null) / t.fps;
      const tags = [KIND[s.kind], s.speed && s.speed > 1 ? `${SPED_UP_TAG} x${s.speed}` : "", holdsFrame(s) ? FRAME_HELD_TAG : "", s.settle ? "never sped up" : "", s.zoom ? "pushed in" : "", s.proves?.length ? `proves ${s.proves.join(", ")}` : ""].filter(Boolean).join("; ");
      const labels = s.kind === "pair" ? ` Labels: ${resolve(s.labelA ?? "")} / ${resolve(s.labelB ?? "")}.` : "";
      const caption = s.kind === "card" ? [s.title, s.subtitle, ...(s.lines ?? [])].filter(Boolean).map((x) => resolve(x!)).join(" / ") + (s.url ? " / the link" : "") : resolve(s.caption ?? "");
      out.push(`| ${at.toFixed(1)} to ${(at + secs).toFixed(1)} s | ${s.shot} | ${cell(`${s.plan.replace(/\.$/, "")}. (${tags})${labels}`)} | ${cell(caption)} | ${cell(resolve(s.callout ?? ""))} |`);
      at += secs;
    }
  }
  return out.join("\n") + "\n";
}

const isMain = process.argv[1] && import.meta.filename === process.argv[1];
if (isMain) {
  writeFileSync(join(root, "STORYBOARD.md"), storyboard(TIMELINE_IDS.map(loadTimeline)));
  console.log("wrote STORYBOARD.md");
}
