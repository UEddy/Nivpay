import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

/**
 * The first screen loads only what Home and Welcome need. Every other screen,
 * and the code that signs (passkeys, keys, signatures), loads when first
 * used, so the static imports of the app's first module are checked here.
 */
const APP = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const statics = [...APP.matchAll(/^import (?!type )[^;]*? from "([^"]+)";$/gm)].map((m) => m[1]!);
const dynamics = [...APP.matchAll(/import\("([^"]+)"\)/g)].map((m) => m[1]!);

const SIGNING = ["./lib/passkey.ts", "./lib/keys.ts", "./lib/send.ts", "./lib/replies.ts", "./lib/permit.ts", "./lib/pour.ts"];

test("App loads no screen but the shared parts up front", () => {
  const screens = statics.filter((s) => s.startsWith("./screens/"));
  assert.deepEqual(screens, ["./screens/ui.tsx"]);
});

test("App loads nothing that signs up front", () => {
  for (const s of SIGNING) assert.ok(!statics.includes(s), `${s} is imported up front`);
  assert.ok(!statics.some((s) => s.startsWith("@category-labs/mera") || s.startsWith("@scure/")));
});

test("every screen and the signing code App opens later exists where it is loaded from", () => {
  for (const s of ["Create", "ChipIn", "Join", "Request", "Timeline", "Close", "Send", "Receive"]) {
    assert.ok(dynamics.includes(`./screens/${s}.tsx`), s);
  }
  for (const s of ["./lib/passkey.ts", "./lib/send.ts", "./lib/replies.ts"]) assert.ok(dynamics.includes(s), s);
  for (const s of dynamics) assert.ok(existsSync(new URL(s, import.meta.url)), s);
});

test("the hostname check Welcome shows is the one passkeys use", () => {
  const passkey = readFileSync(new URL("./lib/passkey.ts", import.meta.url), "utf8");
  assert.match(passkey, /import \{ PRODUCTION_HOSTNAME \} from "\.\/passkeyHost\.ts";/);
  assert.match(passkey, /checkPasskeyHost\(location\.hostname, PRODUCTION_HOSTNAME\)/);
  assert.ok(statics.includes("./lib/passkeyHost.ts"));
});
