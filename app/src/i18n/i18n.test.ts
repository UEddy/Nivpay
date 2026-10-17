import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { copy, useDictionary } from "../copy.ts";
import { LANGS } from "../lib/locale.ts";
import { bannedInLang } from "./banned.ts";
import { en, type Dictionary } from "./en.ts";
import { SAMPLES } from "./samples.ts";

/**
 * Every language has the same keys as English, every message takes the same
 * values, no value given is dropped, and no language uses a banned word,
 * in English or in its own words.
 */
const DIR = import.meta.dirname;
const files = readdirSync(DIR).filter((f) => /^[a-z]{2}\.ts$/.test(f) && f !== "en.ts");
const langs: [string, Dictionary][] = await Promise.all(
  files.map(async (f) => {
    const code = f.slice(0, 2);
    const mod = (await import(`./${f}`)) as Record<string, Dictionary>;
    return [code, mod[code]!] as [string, Dictionary];
  }),
);

test("every language the app offers has a dictionary, and every dictionary is offered", () => {
  assert.deepEqual([...langs.map(([c]) => c), "en"].sort(), [...LANGS].sort());
});

const keys = Object.keys(en).sort();

/** Every value a message is given, as text. */
const given = (args: unknown[]): string[] => args.flatMap((a) => (Array.isArray(a) ? a.map(String) : [String(a)]));

function call(d: Dictionary, key: string): string {
  const v = d[key as keyof Dictionary];
  if (typeof v === "string") return v;
  const args = SAMPLES[key];
  assert.ok(args, `${key} has sample arguments in i18n/samples.ts`);
  return (v as (...a: unknown[]) => string)(...args);
}

for (const [lang, dict] of langs) {
  test(`${lang}: the same keys as English, no more and no fewer`, () => {
    assert.deepEqual(Object.keys(dict).sort(), keys);
  });

  test(`${lang}: every message takes the same values as the English one, and drops none of them`, () => {
    const problems: string[] = [];
    for (const key of keys) {
      const ours = en[key as keyof Dictionary];
      const theirs = dict[key as keyof Dictionary];
      if (typeof ours !== typeof theirs) {
        problems.push(`${key}: a ${typeof ours} in English, a ${typeof theirs} here`);
        continue;
      }
      if (typeof ours !== "function") continue;
      if (ours.length !== (theirs as typeof ours).length) problems.push(`${key}: takes ${(theirs as typeof ours).length} values, English takes ${ours.length}`);
      const english = call(en, key);
      const out = call(dict, key);
      for (const v of given(SAMPLES[key] ?? [])) {
        if (english.includes(v) && !out.includes(v)) problems.push(`${key}: drops ${JSON.stringify(v)}: ${out}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test(`${lang}: no banned word, in English or in ${lang}`, () => {
    const found: string[] = [];
    for (const key of keys) {
      const text = call(dict, key);
      const bad = bannedInLang(text, lang);
      if (bad.length) found.push(`${key}: ${bad.join(", ")}: ${text}`);
    }
    assert.deepEqual(found, []);
  });

  test(`${lang}: it is translated, not English left behind`, () => {
    // Names, codes and numbers read the same in every language.
    const same = new Set(["appName", "dollars", "rampDeskAccountNumber", "code", "personPutIn", "personTime", "askedLine", "withUsername", "usernameLine", "fractionPercent", "ofN", "morePeople", "limitOf", "requestRowMeta", "appVersion", "usernameAt", "pushTitle"]);
    const left = keys.filter((k) => !same.has(k) && call(dict, k) === call(en, k) && call(en, k).length > 3);
    assert.ok(left.length <= 4, `left in English: ${left.join(", ")}`);
  });

  test(`${lang}: a sentence that starts with an account ending starts with a capital`, () => {
    try {
      useDictionary(dict);
      const ending = dict.accountEnding("0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1");
      const said = copy.storyAdded(ending, "$5");
      assert.equal(said.charAt(0), said.charAt(0).toUpperCase(), said);
      assert.equal(copy.accountEnding("0x0000aaaa").charAt(0), dict.accountEnding("0x0000aaaa").charAt(0), "the name itself keeps its case");
    } finally {
      useDictionary(en);
    }
  });
}

test("English is back after the checks above", () => {
  assert.equal(copy.storyAdded("account ending 8C9D", "$1"), "Account ending 8C9D added $1");
});

test("a date shortened with a dot ends its sentence with one dot, not two", async () => {
  const { fr } = await import("./fr.ts");
  const { pt } = await import("./pt.ts");
  try {
    useDictionary(fr);
    assert.equal(copy.closedEarlyLine("17 oct.", "Ana", "Ben"), "Fermée le 17 oct. Ana l'a demandé, Ben a dit oui.");
    assert.equal(copy.closesAt("sam. 17 oct."), "Ferme le sam. 17 oct.");
    useDictionary(pt);
    assert.ok(!copy.closesAt("17 de out.").includes(".."), copy.closesAt("17 de out."));
    useDictionary(en);
    assert.equal(copy.closesAt("Sat 17 Oct"), "Closes Sat 17 Oct.");
    assert.equal(copy.voiceHeard("…"), en.voiceHeard("…"), "an ellipsis is left alone");
  } finally {
    useDictionary(en);
  }
});
