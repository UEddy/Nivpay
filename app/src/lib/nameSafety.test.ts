import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The account's name is a label on this phone: shown only as text, never sent to /api or written on chain. */
const SRC = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.(test|live-test)\.ts$/.test(f) ? [p] : [];
  });
const source = files(SRC).map((f) => [f, readFileSync(f, "utf8")] as const);

test("nothing in the app renders text as HTML", () => {
  for (const [f, text] of source) assert.doesNotMatch(text, /dangerouslySetInnerHTML|\.innerHTML\s*=|outerHTML|insertAdjacentHTML|document\.write/, f);
});

test("the gas grant request carries the address and nothing else", () => {
  const send = readFileSync(join(SRC, "lib", "send.ts"), "utf8");
  const bodies = [...send.matchAll(/body: JSON\.stringify\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(bodies, ["{ address }"]);
});

test("the code that builds and signs requests never reads the account store", () => {
  for (const name of ["send.ts", "writes.ts", "chain.ts", "permit.ts", "pour.ts", "payout.ts", "close.ts", "transfer.ts", "settle.ts", "passkey.ts"]) {
    const text = readFileSync(join(SRC, "lib", name), "utf8");
    assert.doesNotMatch(text, /accounts\.ts|StoredAccount|shownName/, name);
  }
});
