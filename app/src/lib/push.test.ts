import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bannedIn } from "../i18n/banned.ts";
import { en } from "../i18n/en.ts";
import { es } from "../i18n/es.ts";
import { fr } from "../i18n/fr.ts";
import { pt } from "../i18n/pt.ts";
import { injectTexts, TEXTS_PLACEHOLDER } from "../../sw-build.ts";
import { cleanSettings, DEFAULT_SETTINGS, goFor, goUrl, parseGo, PUSH_KINDS, pushTexts, type PushPayload } from "./push.ts";

const SW = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
// The service worker's own functions, run here exactly as written.
const part = SW.slice(SW.indexOf("// BEGIN push"), SW.indexOf("// END push"));
const sw = new Function(`${part}; return { notificationFor, urlFor, formatPushAmount };`)() as {
  notificationFor: (texts: unknown, p: PushPayload) => { title: string; body: string };
  urlFor: (p: PushPayload) => string;
};
const TEXTS = pushTexts({ en, es, fr, pt });

test("a tap goes where the app opens it: the service worker and the app agree for every kind", () => {
  const cases: PushPayload[] = [
    ...PUSH_KINDS.map((k) => ({ k, l: "en", p: "7", r: "3" })),
    // A pot on NivPayPotsV2.
    ...PUSH_KINDS.map((k) => ({ k, l: "en", p: "v2:7", r: "3" })),
    { k: "chippedIn", l: "en", p: "v3:7" },
    { k: "chippedIn", l: "en" },
    { k: "askYes", l: "en", p: "7" },
    { k: "chippedIn", l: "en", p: "7; evil" },
  ];
  for (const p of cases) {
    const url = sw.urlFor(p);
    const expected = /^(v2:)?\d+$/.test(p.p ?? "") ? goFor(p) : { kind: "notes" as const };
    assert.deepEqual(parseGo(new URL(url, "https://x").search), expected, `${p.k} ${p.p}`);
    assert.equal(url, goUrl(expected));
  }
  assert.equal(parseGo("?go=pot&pot=abc"), null);
  assert.equal(parseGo("?go=elsewhere"), null);
  assert.equal(parseGo(""), null);
});

test("settings: every kind present, defaults kept, nothing else taken", () => {
  assert.deepEqual(cleanSettings(undefined), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.amounts, false, "amounts on the lock screen are off unless chosen");
  assert.deepEqual(cleanSettings({ kinds: { sent: true, other: true }, amounts: 1 }), { kinds: { ...DEFAULT_SETTINGS.kinds, sent: true }, amounts: false });
});

test("what a notification says comes from the dictionaries, in the phone's language, with no banned word and an amount only when allowed", () => {
  assert.deepEqual(Object.keys(TEXTS).sort(), ["en", "es", "fr", "pt"]);
  for (const [lang, t] of Object.entries(TEXTS)) {
    for (const [k, v] of Object.entries(t)) assert.deepEqual(bannedIn(v.replace("{amount}", "$5").replace("{pot}", "Birthday")), [], `${lang} ${k}`);
    for (const k of PUSH_KINDS) {
      const without = sw.notificationFor(TEXTS, { k, l: lang, p: "1", n: "Birthday" }).body;
      assert.ok(without && !without.includes("{"), `${lang} ${k}: ${without}`);
      assert.ok(!/\d/.test(without), `${lang} ${k} without an amount shows no number: ${without}`);
    }
  }
  assert.equal(sw.notificationFor(TEXTS, { k: "received", l: "en" }).body, "You received money.");
  assert.equal(sw.notificationFor(TEXTS, { k: "received", l: "en", a: "100000000", d: 6, s: "$" }).body, "You received $100.00.");
  assert.equal(sw.notificationFor(TEXTS, { k: "chippedIn", l: "fr", n: "Anniversaire" }).body, "Quelqu'un a mis de l'argent dans Anniversaire.");
  assert.equal(sw.notificationFor(TEXTS, { k: "request", l: "es", a: "5" }).body, es.pushRequest, "a request never shows an amount");
  assert.equal(sw.notificationFor(TEXTS, { k: "received", l: "xx" }).body, "You received money.", "an unknown language falls back to English");
  assert.equal(sw.notificationFor(null, { k: "received", l: "en" }).title, "NivPay", "a development build still shows something");
});

test("the build puts the texts into the service worker exactly once", () => {
  assert.equal(SW.split(TEXTS_PLACEHOLDER).length, 2);
  const built = injectTexts(SW, TEXTS);
  assert.ok(built.includes('"received":"You received {amount}."'));
  assert.throws(() => injectTexts("no placeholder", TEXTS));
});

test("auto cash out: the whole sentence with amounts on, the bank always, and a tap opens the statement", () => {
  const t = `0x${"ab".repeat(32)}`;
  const moved = { k: "autoCashOut" as const, l: "en", c: "NGN", b: "First Bank", e: "6789", t };
  assert.equal(sw.notificationFor(TEXTS, { ...moved, a: "50000000", d: 6, s: "$", m: "7672500" }).body, "$50.00 arrived and was sent to your bank: ₦76,725.00, First Bank ending 6789. Test mode.");
  assert.equal(sw.notificationFor(TEXTS, moved).body, "Money arrived and was sent to your bank, First Bank ending 6789. Test mode.");
  assert.equal(sw.notificationFor(TEXTS, { ...moved, v: 1, a: "30000000", d: 6, s: "$", m: "4603500" }).body, "$30.00 of it was sent to your bank: ₦46,035.00, First Bank ending 6789. Test mode.");
  assert.equal(sw.notificationFor(TEXTS, { k: "autoCashOut", l: "en", w: "cap", a: "50000000", d: 6, s: "$" }).body, "$50.00 arrived and stayed in your account: today's most for auto cash out was reached.");
  assert.equal(sw.notificationFor(TEXTS, { k: "autoCashOut", l: "en", w: "allowance" }).body, "Money arrived and stayed in your account: auto cash out needs one more fingerprint to carry on.");
  assert.match(sw.notificationFor(TEXTS, { ...moved, l: "fr", a: "50000000", d: 6, s: "$", m: "7672500" }).body, /^50,00\s\$US sont arrivés et ont été envoyés à votre banque\s: 76\s725,00\s₦, First Bank se terminant par 6789\. Mode test\.$/u);
  for (const lang of ["en", "es", "fr", "pt"]) {
    for (const p of [moved, { ...moved, v: 1 as const }, ...(["cap", "allowance", "desk"] as const).map((w) => ({ k: "autoCashOut" as const, l: lang, w }))]) {
      const body = sw.notificationFor(TEXTS, { ...p, l: lang }).body;
      assert.ok(body && !body.includes("{") && bannedIn(body).length === 0, `${lang}: ${body}`);
    }
  }
  assert.equal(sw.urlFor(moved), `/?go=statement&tx=${t}&c=NGN`);
  assert.deepEqual(parseGo(`?go=statement&tx=${t}&c=NGN`), { kind: "statement", tx: t, currency: "NGN" });
  assert.equal(goUrl(goFor(moved)), sw.urlFor(moved));
  assert.equal(sw.urlFor({ k: "autoCashOut", l: "en", w: "cap" }), "/?go=notes");
  assert.equal(parseGo("?go=statement&tx=0x12&c=NGN"), null);
  assert.equal(parseGo(`?go=statement&tx=${t}&c=ngn`), null);
});
