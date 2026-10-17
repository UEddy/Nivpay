import { test } from "node:test";
import assert from "node:assert/strict";
import { ASK_FRESH_MS, askToListen, asksForVoice, onAsk, onVoiceBusy, takeAsk, voiceBusy, withoutVoiceAsk } from "./voiceAsk.ts";

test("?voice=1 asks for voice, nothing else does", () => {
  assert.equal(asksForVoice("?voice=1"), true);
  assert.equal(asksForVoice("?go=pot&pot=3&voice=1"), true);
  for (const s of ["", "?voice=0", "?voice=yes", "?voice", "?Voice=1", "?go=receive"]) assert.equal(asksForVoice(s), false, s);
});

test("the ask leaves the address, everything else stays", () => {
  assert.equal(withoutVoiceAsk("/", "?voice=1", ""), "/");
  assert.equal(withoutVoiceAsk("/", "?voice=1&go=receive", "#abc"), "/?go=receive#abc");
});

test("an ask is taken once, and only while fresh: an old one never starts the microphone", () => {
  askToListen(1_000);
  assert.equal(takeAsk(1_000 + ASK_FRESH_MS), true);
  assert.equal(takeAsk(1_000 + ASK_FRESH_MS), false, "once");
  askToListen(1_000);
  assert.equal(takeAsk(1_001 + ASK_FRESH_MS), false, "too old");
  assert.equal(takeAsk(5_000), false, "an old ask is gone, not kept for later");
});

test("a microphone button on screen hears the ask at once; one that leaves hears no more", () => {
  let heard = 0;
  const off = onAsk(() => heard++);
  askToListen();
  assert.equal(heard, 1);
  off();
  askToListen();
  assert.equal(heard, 1);
  takeAsk();
});

test("busy and done reach the wake word, which lets the microphone go and takes it back", () => {
  const seen: boolean[] = [];
  const off = onVoiceBusy((b) => seen.push(b));
  voiceBusy(true);
  voiceBusy(false);
  off();
  voiceBusy(true);
  assert.deepEqual(seen, [true, false]);
});
