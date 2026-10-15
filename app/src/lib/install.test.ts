import { test } from "node:test";
import assert from "node:assert/strict";
import { BANNER_MS, DAY_MS, inAppBrowser, InstallStore, installWay, PausableTimer, shouldShowBanner } from "./install.ts";

const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const FIREFOX_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";
const IPHONE_INSTAGRAM = `${IPHONE} Instagram 300.0`;

const on = (userAgent: string, extra: Partial<Parameters<typeof installWay>[0]> = {}) =>
  installWay({ standalone: false, hasPrompt: false, userAgent, maxTouchPoints: 0, ...extra });

test("Chrome and others that send the install event get the Install button", () => {
  assert.equal(on(ANDROID_CHROME, { hasPrompt: true }), "prompt");
});

test("iPhone and iPad, which send no event, get Share then Add to Home Screen", () => {
  assert.equal(on(IPHONE, { maxTouchPoints: 5 }), "ios");
  assert.equal(on(IPAD_AS_MAC, { maxTouchPoints: 5 }), "ios");
});

test("nothing where installing isn't possible, or it is installed already", () => {
  assert.equal(on(ANDROID_CHROME), null, "Chrome hasn't offered it");
  assert.equal(on(FIREFOX_DESKTOP), null);
  assert.equal(on(IPAD_AS_MAC), null, "a real Mac");
  assert.equal(on(IPHONE_INSTAGRAM, { maxTouchPoints: 5 }), null, "an app's own browser");
  assert.equal(on(IPHONE, { maxTouchPoints: 5, standalone: true }), null);
  assert.equal(on(ANDROID_CHROME, { hasPrompt: true, standalone: true }), null);
  assert.equal(inAppBrowser(`${ANDROID_CHROME} [FBAN/FB4A;FBAV/400.0]`), true);
});

test("at most once a day, and never again once installed", () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldShowBanner("prompt", { lastShown: null, installed: false }, now), true);
  assert.equal(shouldShowBanner("prompt", { lastShown: now - DAY_MS + 1, installed: false }, now), false);
  assert.equal(shouldShowBanner("ios", { lastShown: now - DAY_MS, installed: false }, now), true);
  assert.equal(shouldShowBanner("prompt", { lastShown: null, installed: true }, now), false);
  assert.equal(shouldShowBanner(null, { lastShown: null, installed: false }, now), false);
});

test("what the phone remembers about the banner survives damage", () => {
  const m = new Map<string, string>();
  const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  const store = new InstallStore(kv);
  assert.deepEqual(store.get(), { lastShown: null, installed: false });
  store.shown(5);
  store.installed();
  assert.deepEqual(store.get(), { lastShown: 5, installed: true });
  m.set("nivpay.install.v1", "{oops");
  assert.deepEqual(store.get(), { lastShown: null, installed: false });
});

test("the 10 seconds pause while it is touched or focused, and carry on after", () => {
  const t = new PausableTimer(BANNER_MS);
  assert.equal(t.remaining(0), BANNER_MS, "not started");
  t.start(1_000);
  assert.equal(t.remaining(4_000), 7_000);
  t.hold("pointer", 4_000);
  t.hold("focus", 5_000);
  assert.equal(t.remaining(60_000), Infinity, "held: never runs out");
  t.release("pointer", 60_000);
  assert.equal(t.remaining(70_000), Infinity, "still focused");
  t.release("focus", 70_000);
  assert.equal(t.remaining(70_000), 7_000, "picks up where it stopped");
  assert.equal(t.remaining(77_000), 0);
});
