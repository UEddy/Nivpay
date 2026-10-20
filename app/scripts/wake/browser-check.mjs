// "Hey NivPay" end to end, in Chromium, with recorded sound as the microphone.
//
//   npm run build && npx vite preview        (serves vercel.json's headers, so the real CSP)
//   node scripts/wake/browser-check.mjs http://localhost:4173 <dir>
//
// <dir> holds 16 kHz WAV files (make_audio.py writes them from voices the
// model never trained on): wake.wav ("Hey NivPay" among quiet), similar.wav
// (words like it: "navy pay", "NivPay" alone, "hey Siri", "hey Niv"...),
// talk.wav (ordinary sentences) and close.wav (the closest phrases: "hey Liv,
// pay", "hey, need pay"...). Chromium plays each as its microphone, on a loop.
// Playwright is not a dependency of the app: set PLAYWRIGHT to its module if
// it is installed elsewhere. The phone's speech service is stood in for: it
// "hears" a set sentence, so what follows a wake runs as it would.
//
// It checks: listening makes the pot mark in the tab bar glow and holds the microphone; "Hey NivPay"
// chimes, buzzes, lets the microphone go, opens Send and hears one sentence,
// and the voice rules still decide what is filled in; similar words and talk
// never wake it (the closest phrases are counted, not failed: they sometimes do); the background and 5 idle minutes stop it and say so; a
// ?voice=1 link opens Send listening when the microphone is allowed, shows one
// big Tap to speak button when it isn't, and says voice is off when it is;
// Profile, Voice shows the switch and both guides; no CSP violation anywhere.

import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const base = process.argv[2] ?? "http://localhost:4173";
const dir = resolve(process.argv[3] ?? ".");
const ME = "0x725C9a4bB4C3de2f11ac0E7c9B1E8f0d3a2b7bc1";

// ONLY=1,5 runs just those parts.
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
const part = (n) => only.length === 0 || only.includes(String(n));

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failed++;
};

/** Runs before the app: an account, voice settings, and stand-ins that record what the app did. */
const setup = (voice) => `
  localStorage.setItem("nivpay.accounts.v1", JSON.stringify([{ address: "${ME}", name: "Tester" }]));
  localStorage.setItem("nivpay.active.v1", "${ME}");
  localStorage.setItem("nivpay.nameSkipped.v1", JSON.stringify(["${ME}"]));
  for (const d of ["ausd", "testusd"])
    localStorage.setItem("nivpay.voice.v2." + d + ".${ME}", JSON.stringify(${JSON.stringify({ trusted: [], withPerson: {}, explained: true, ...voice })}));
  // Chromium's recorded microphone starts its file again at every getUserMedia. A real room
  // carries on, so the device is opened once and the app gets a copy each time: the copy is
  // the app's microphone, on until the app stops it.
  window.__tracks = [];
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  let room = null;
  navigator.mediaDevices.getUserMedia = async (c) => { room ??= await gum(c); const s = room.clone(); window.__tracks.push(...s.getTracks()); return s; };
  window.__liveMics = () => window.__tracks.filter((t) => t.readyState === "live").length;
  window.__sr = { starts: 0, liveAtStart: [] };
  class StandIn {
    start() {
      window.__sr.starts++;
      window.__sr.liveAtStart.push(window.__liveMics());
      setTimeout(() => { this.onresult?.({ results: [[{ transcript: "send 20 dollars to Ana" }]] }); this.onend?.(); }, 1200);
    }
    stop() {}
    abort() { this.onerror?.({ error: "aborted" }); }
  }
  window.SpeechRecognition = StandIn;
  window.webkitSpeechRecognition = StandIn;
  window.__buzz = [];
  navigator.vibrate = (p) => (window.__buzz.push(p), true);
  window.__chimes = 0;
  const osc = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () { window.__chimes++; return osc.call(this); };
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
`;

async function browserWith(wav) {
  return chromium.launch({
    executablePath: process.env.CHROMIUM,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...(wav ? [`--use-file-for-fake-audio-capture=${dir}/${wav}`] : []), "--autoplay-policy=no-user-gesture-required"],
  });
}

async function page(browser, voice, { grant = true, clock = false } = {}) {
  const context = await browser.newContext({ locale: "en-US", permissions: grant ? ["microphone", "clipboard-read", "clipboard-write"] : [] });
  const p = await context.newPage();
  if (clock) await p.clock.install();
  await p.addInitScript(setup(voice));
  p.on("pageerror", (e) => console.log("  page error:", e.message));
  return p;
}

const bar = (p) => p.locator(".wake-bar");
// Listening shows as the tab bar's pot mark glowing, not a bar; screen readers still hear it said.
const listening = (p, timeout) => p.locator('html[data-wake="listening"] .wake-status', { hasText: "Listening for “Hey NivPay”" }).waitFor({ state: "attached", timeout });
const isListening = async (p) => (await p.locator('html[data-wake="listening"]').count()) === 1;
const glowing = (p) =>
  p.evaluate(() => {
    const mark = [...document.querySelectorAll(".tab-pot .pot-mark")].find((m) => m.getClientRects().length > 0);
    return !!mark && getComputedStyle(mark).filter.includes("drop-shadow") && !document.querySelector(".wake-bar");
  });
const noCsp = async (p, where) => check((await p.evaluate(() => window.__csp)).length === 0, `${where}: no CSP or Trusted Types violation (${JSON.stringify(await p.evaluate(() => window.__csp))})`);

// 1. "Hey NivPay", heard.
if (part(1)) {
  const browser = await browserWith("wake.wav");
  const p = await page(browser, { on: true, wake: true });
  await p.goto(base);
  await listening(p, 20_000);
  check(await glowing(p), "the pot mark in the tab bar glows, and no bar shows, while the microphone is on");
  check((await p.evaluate(() => window.__liveMics())) === 1, "the microphone is on while it listens");
  const t0 = Date.now();
  await p.waitForFunction(() => window.__sr.starts > 0, null, { timeout: 30_000 });
  console.log(`  woke ${((Date.now() - t0) / 1000).toFixed(1)} s after listening started`);
  const facts = await p.evaluate(() => ({ chimes: window.__chimes, buzz: window.__buzz, live: window.__sr.liveAtStart }));
  check(facts.chimes >= 2, `a chime (two notes) played: ${facts.chimes}`);
  check(facts.buzz.length >= 1, "a buzz where the phone can");
  check(facts.live[0] === 0, "the wake word let the microphone go before the speech service listened");
  check(await p.locator(".bar-title").first().isVisible(), "a screen with a bar opened");
  await p.locator("text=No contact trusted for voice is called “Ana”").waitFor({ timeout: 10_000 });
  check(true, "the sentence heard still goes through the voice rules: nobody is trusted, nothing is filled in");
  await listening(p, 15_000);
  check((await p.evaluate(() => window.__liveMics())) === 1, "after the sentence, it listens for the wake word again");
  await p.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await bar(p).locator("text=went to the background").waitFor({ timeout: 5_000 });
  check((await p.evaluate(() => window.__liveMics())) === 0 && !(await isListening(p)), "the background stops it, the microphone is off, the glow is gone, and the bar says why");
  await p.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  await bar(p).locator("button", { hasText: "Listen again" }).click();
  await listening(p, 10_000);
  check(await glowing(p), "Listen again starts it again, and the pot mark glows");
  await noCsp(p, "wake");
  await browser.close();
}

// 2, 3 and 7. Similar words, then ordinary talk: never a wake. The closest phrases: counted.
for (const [n, wav, what, seconds, strict] of [
  [2, "similar.wav", "words like “Hey NivPay”", 60, true],
  [3, "talk.wav", "ordinary talk", 90, true],
  [7, "close.wav", "the closest phrases (“hey Liv, pay”, “hey, need pay”…)", 65, false],
]) {
  if (!part(n)) continue;
  const browser = await browserWith(wav);
  const p = await page(browser, { on: true, wake: true });
  await p.goto(base);
  await listening(p, 20_000);
  // How busy listening keeps the page: Chrome's main thread time over the same span.
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Performance.enable");
  const busy = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value;
  const before = await busy();
  await p.waitForTimeout(seconds * 1000);
  console.log(`  the page's main thread was busy ${((100 * ((await busy()) - before)) / seconds).toFixed(1)}% of the time while listening`);
  const woke = await p.evaluate(() => window.__sr.starts);
  if (strict) check(woke === 0, `${seconds} s of ${what}: ${woke} false wakes`);
  else console.log(`INFO  ${seconds} s of ${what}, two loops of 16: ${woke} false wakes`);
  if (strict || woke === 0) check((await isListening(p)), `still listening after ${what}`);
  await browser.close();
}

// 4. Five minutes without use.
if (part(4)) {
  const browser = await browserWith("talk.wav");
  const p = await page(browser, { on: true, wake: true }, { clock: true });
  await p.goto(base);
  await listening(p, 20_000);
  await p.clock.fastForward("04:00");
  check((await isListening(p)), "still listening at 4 minutes");
  await p.clock.fastForward("01:05");
  await bar(p).locator("text=after 5 minutes without use").waitFor({ timeout: 5_000 });
  check((await p.evaluate(() => window.__liveMics())) === 0, "5 minutes without use stop it, and the bar says so");
  await browser.close();
}

// 5. ?voice=1.
if (part(5)) {
  const browser = await browserWith(null);
  let p = await page(browser, { on: true, wake: false });
  await p.goto(`${base}/?voice=1`);
  await p.waitForFunction(() => window.__sr.starts > 0, null, { timeout: 15_000 });
  check(!p.url().includes("voice=1"), "?voice=1 with the microphone allowed: Send opens listening, and the link leaves the address bar");
  check((await bar(p).count()) === 0, "with the wake word off, no wake bar");
  await noCsp(p, "?voice=1");

  p = await page(browser, { on: true, wake: false }, { grant: false });
  await p.goto(`${base}/?voice=1`);
  const big = p.locator("button.voice-big", { hasText: "Tap to speak" });
  await big.waitFor({ timeout: 15_000 });
  check((await p.evaluate(() => window.__sr.starts)) === 0, "?voice=1 when the browser must ask first: nothing listens yet");
  await big.click();
  await p.waitForFunction(() => window.__sr.starts > 0, null, { timeout: 5_000 });
  check(true, "one big Tap to speak button, and a tap listens");

  p = await page(browser, { on: false, wake: false });
  await p.goto(`${base}/?voice=1`);
  await p.locator("text=Voice is off.").waitFor({ timeout: 15_000 });
  check((await p.evaluate(() => window.__sr.starts)) === 0, "?voice=1 with voice off says so and listens to nothing");
  await browser.close();
}

// 6. Profile, Voice.
if (part(6)) {
  const browser = await browserWith("talk.wav");
  const p = await page(browser, { on: true, wake: false });
  await p.goto(base);
  await p.locator(".tab", { hasText: "Profile" }).click();
  await p.locator(".settings-row", { hasText: "Voice" }).click();
  const sw = p.locator("label.check-row", { hasText: "Listen for “Hey NivPay”" }).locator("input");
  check(!(await sw.isChecked()), "Listen for “Hey NivPay” is there, and off");
  check((await p.locator("summary", { hasText: "Hey Siri" }).count()) === 1 && (await p.locator("summary", { hasText: "Hey Google" }).count()) === 1, "both guides are there");
  await p.locator("summary", { hasText: "Hey Siri" }).click();
  await p.locator("details:has(summary:has-text('Hey Siri')) button", { hasText: "Copy link" }).click();
  check((await p.evaluate(() => navigator.clipboard.readText())) === `${base}/?voice=1`, "the Siri guide's Copy link copies the ?voice=1 link");
  await sw.check();
  await listening(p, 20_000);
  check(await glowing(p), "turning it on starts listening at once, with the pot mark glowing");
  await sw.uncheck();
  await p.waitForTimeout(500);
  check(!(await isListening(p)) && (await p.evaluate(() => window.__liveMics())) === 0, "turning it off stops the glow and turns the microphone off");
  await noCsp(p, "Profile, Voice");
  await browser.close();
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
