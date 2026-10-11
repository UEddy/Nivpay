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
