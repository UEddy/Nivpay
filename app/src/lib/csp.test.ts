import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { serviceWorkerUrl, SW_POLICY, SW_URL, type TrustedTypesLike } from "./trusted.ts";

type Headers = { headers: { source: string; headers: { key: string; value: string }[] }[] };
const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as Headers;
const all = vercel.headers.find((h) => h.source === "/(.*)")!.headers;
const header = (k: string) => all.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value ?? "";
const csp = Object.fromEntries(
  header("Content-Security-Policy")
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([name, ...values]) => [name!, values]),
);

test("scripts come only from the app itself: no inline script, no eval, nothing from elsewhere", () => {
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'none'"]);
  for (const [name, values] of Object.entries(csp)) {
    for (const v of values as string[]) assert.ok(!/unsafe-inline|unsafe-eval|unsafe-hashes|\*|data:|blob:|http:/.test(v), `${name} ${v}`);
  }
});

test("the page talks only to itself, its /api, and the Monad testnet RPC; fonts, styles and the worker are its own", () => {
  assert.deepEqual(csp["connect-src"], ["'self'", "https://testnet-rpc.monad.xyz"]);
  assert.deepEqual(csp["font-src"], ["'self'"]);
  assert.deepEqual(csp["style-src"], ["'self'"]);
  assert.deepEqual(csp["worker-src"], ["'self'"]);
  assert.deepEqual(csp["manifest-src"], ["'self'"]);
});

test("it can't be framed or post a form anywhere, and passkeys stay allowed", () => {
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.deepEqual(csp["form-action"], ["'none'"]);
  assert.equal(header("X-Frame-Options"), "DENY");
  const perms = header("Permissions-Policy");
  assert.match(perms, /publickey-credentials-create=\(self\)/);
  assert.match(perms, /publickey-credentials-get=\(self\)/);
});

test("Trusted Types are required, with one policy, the one the app uses for its service worker", () => {
  assert.deepEqual(csp["require-trusted-types-for"], ["'script'"]);
  assert.deepEqual(csp["trusted-types"], [SW_POLICY]);
  const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
  assert.match(main, /serviceWorkerUrl\(tt\)/);
  assert.ok(!/register\("\/sw\.js"/.test(main), "the worker is never registered from a plain string");
});

test("the service worker policy gives out its own address and refuses any other", () => {
  let rules: { createScriptURL: (url: string) => string } | undefined;
  const tt: TrustedTypesLike = {
    createPolicy: (name, r) => {
      assert.equal(name, SW_POLICY);
      rules = r;
      return { createScriptURL: (u) => ({ toString: () => r.createScriptURL(u) }) };
    },
  };
  assert.equal(String(serviceWorkerUrl(tt)), SW_URL);
  for (const bad of ["/evil.js", "https://example.com/sw.js", "javascript:alert(1)", "/sw.js?x"]) assert.throws(() => rules!.createScriptURL(bad), TypeError);
  assert.equal(serviceWorkerUrl(undefined), SW_URL, "a browser without Trusted Types gets the plain address");
});

test("HTTPS only, nothing sniffed, no referrer", () => {
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("Referrer-Policy"), "no-referrer");
  assert.equal(header("Cross-Origin-Opener-Policy"), "same-origin");
});
