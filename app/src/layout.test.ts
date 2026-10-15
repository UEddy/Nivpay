import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Fixes that live in markup and CSS, checked in the source the build uses.
const SRC = import.meta.dirname;
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `${selector} exists`);
  return css.slice(at, css.indexOf("}", at));
};

test("a draft's footer is not sticky, so it never covers the Closes row; a made pot's still is", () => {
  const css = read("pot.css");
  assert.match(rule(css, ".screen-foot.in-flow"), /position:\s*static/);
  assert.match(rule(css, ".screen-foot"), /position:\s*sticky/);
  assert.match(read("screens", "Create.tsx"), /className=\{`screen-foot enter\$\{made \? "" : " in-flow"\}`\}/);
});

test("the close date is shown the app's way under the phone's date field", () => {
  const create = read("screens", "Create.tsx");
  const field = create.indexOf('<input type="date"');
  const line = create.indexOf("copy.closesOn(formatDay(draft.closes))", field);
  assert.ok(field >= 0 && line > field && line - field < 600, "the line follows the date field in the Closes sheet");
});

test("a long press on a pot row never selects its text", () => {
  const home = rule(read("pot.css"), ".home-pot");
  assert.match(home, /\n\s*user-select:\s*none/);
  assert.match(home, /-webkit-user-select:\s*none/);
  assert.match(home, /-webkit-touch-callout:\s*none/);
});

test("amount fields use the neutral placeholder, never a sample amount", () => {
  for (const screen of ["Create.tsx", "Send.tsx", "Receive.tsx", "Ask.tsx"]) {
    for (const m of read("screens", screen).matchAll(/placeholder="([^"]*)"/g)) assert.doesNotMatch(m[1]!, /\d/, `${screen}: ${m[1]}`);
  }
});

test("every amount field reads the reader's way and says what it understood, before any confirm", () => {
  const files = ["App.tsx", ...["Ask.tsx", "ChipIn.tsx", "Create.tsx", "Money.tsx", "Receive.tsx", "Send.tsx"].map((f) => join("screens", f))];
  let fields = 0;
  for (const f of files) {
    const text = read(f);
    assert.doesNotMatch(text, /\bparseAmount\(/, `${f} reads an amount the old way`);
    assert.doesNotMatch(text, /replace\(\/\^\\$\//, `${f} turns a shown amount into field text by hand`);
    for (const m of text.matchAll(/inputMode="decimal"/g)) {
      fields++;
      const after = text.slice(m.index!, m.index! + 700);
      assert.match(after, /<AmountUnderstood /, `${f}: an amount field with no AmountUnderstood after it`);
    }
  }
  assert.ok(fields >= 8, `found the amount fields (${fields})`);
});

test("the tab bar: Home, the pot mark for Pots, Profile with a photo or a letter; it never covers a button", () => {
  const app = read("App.tsx");
  const bar = app.slice(app.indexOf("function TabBar("), app.indexOf("function ProfileFace("));
  assert.deepEqual([...bar.matchAll(/tabProps\("(\w+)"\)/g)].map((m) => m[1]), ["home", "pots", "profile"], "three tabs, in this order");
  assert.match(bar, /"aria-current": props\.tab === t \? \("page" as const\)/, "the current tab is announced");
  assert.match(bar, /<PotMark \/>/, "the middle tab is the pot mark");
  assert.match(app, /function ProfileFace[\s\S]*?Array\.from\(shownName\(props\.account\)\.trim\(\)\)\[0\]/, "no photo: the first letter of the name");
  assert.match(app, /className="tab-panel" hidden=\{props\.tab !== "pots"\}/, "Pots stays mounted, so pots are found and notifications made on any tab");
  const css = read("pot.css");
  assert.match(rule(css, ".tab-bar"), /position:\s*fixed/);
  assert.match(rule(css, ".page.with-tabs"), /padding-bottom:\s*calc\(96px/, "room under the content for the bar");
  assert.doesNotMatch(app.slice(app.indexOf("function Home("), app.indexOf("function TabBar(")), /\{copy\.accountDetails\}\n\s*<\/button>/, "Profile replaced the Account details button");
});
