import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { BUILD_PLACEHOLDER, injectBuild, shellBuild } from "../sw-build.ts";

/**
 * public/sw.js, run in a sandbox with a fake cache and network: what it
 * caches, what it never touches, and what it answers offline.
 */
const SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://nivpay.vercel.app";
const RPC = "https://testnet-rpc.monad.xyz/";

type Req = { url: string; method: string; mode: string };
type Res = { ok: boolean; type: string; body: string; clone(): Res };
const res = (body: string): Res => ({ ok: true, type: "basic", body, clone: () => res(body) });

function worker(source: string, online: () => boolean) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const stores = new Map<string, Map<string, Res>>();
  const fetched: string[] = [];
  const keyOf = (r: Req | string) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const s = stores.get(name)!;
      return {
        addAll: async (urls: string[]) => {
          for (const u of urls) s.set(keyOf(u), res(`cached ${u}`));
        },
        put: async (r: Req | string, v: Res) => void s.set(keyOf(r), v),
        match: async (r: Req | string) => s.get(keyOf(r)),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (k: string) => stores.delete(k),
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (handlers[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const fetch = async (r: Req) => {
    fetched.push(r.url);
    if (!online()) throw new TypeError("Failed to fetch");
    return res(`network ${r.url}`);
  };
  runInNewContext(source, { self, caches, fetch, URL, Response: { error: () => ({ ok: false, type: "error" }) }, Promise });

  const lifecycle = async (type: "install" | "activate") => {
    let wait: Promise<unknown> = Promise.resolve();
    handlers[type]!({ waitUntil: (p: Promise<unknown>) => void (wait = p) });
    await wait;
  };
  /** Dispatches a fetch. undefined: the worker let the browser handle it, untouched. */
  const request = async (url: string, init: Partial<Req> = {}): Promise<Res | undefined> => {
    let answer: Promise<Res> | undefined;
    handlers.fetch!({ request: { url, method: "GET", mode: "cors", ...init }, respondWith: (p: Promise<Res>) => void (answer = p) });
    return answer;
  };
  return { lifecycle, request, stores, fetched };
}

const BUILT = injectBuild(SOURCE, shellBuild(["assets/index-AAAA.js", "assets/Send-BBBB.js", "assets/index-CCCC.css", "assets/work-sans-DDDD.woff2"]));

test("the RPC, the gas grant service and anything not a GET are never intercepted or cached", async () => {
  const w = worker(BUILT, () => true);
  await w.lifecycle("install");
  for (const [url, init] of [
    [RPC, { method: "POST" }],
    [RPC, {}],
    [`${ORIGIN}/api/fund`, { method: "POST" }],
    [`${ORIGIN}/api/fund/status`, {}],
    [`${ORIGIN}/assets/index-AAAA.js`, { method: "POST" }],
  ] as const) {
    assert.equal(await w.request(url, init), undefined, `${init.method ?? "GET"} ${url}`);
  }
  const cached = [...w.stores.values()].flatMap((s) => [...s.keys()]);
  assert.ok(!cached.some((k) => k.includes("/api/") || k.startsWith(RPC)), cached.join(" "));
});

test("install keeps every built script and style, every screen's included, but no fonts", async () => {
  const w = worker(BUILT, () => true);
  await w.lifecycle("install");
  const [name, store] = [...w.stores.entries()][0]!;
  assert.match(name, /^shell-[0-9a-f]{12}$/);
  for (const f of ["/", "/assets/index-AAAA.js", "/assets/Send-BBBB.js", "/assets/index-CCCC.css", "/manifest.webmanifest"]) {
    assert.ok(store.has(new URL(f, ORIGIN).href), f);
  }
  assert.ok(![...store.keys()].some((k) => k.endsWith(".woff2")));
});

test("offline, a screen not opened yet still loads from the cache, and the page opens from the cached shell", async () => {
  let online = true;
  const w = worker(BUILT, () => online);
  await w.lifecycle("install");
  online = false;
  assert.equal((await w.request(`${ORIGIN}/assets/Send-BBBB.js`))!.body, "cached /assets/Send-BBBB.js");
  assert.equal((await w.request(`${ORIGIN}/`, { mode: "navigate" }))!.body, "cached /");
});

test("online, a page is always fetched fresh, and a new build drops the old build's cache", async () => {
  const w = worker(BUILT, () => true);
  await w.lifecycle("install");
  assert.equal((await w.request(`${ORIGIN}/`, { mode: "navigate" }))!.body, `network ${ORIGIN}/`);
  const next = worker(injectBuild(SOURCE, shellBuild(["assets/index-EEEE.js"])), () => true);
  for (const [k, v] of w.stores) next.stores.set(k, v);
  await next.lifecycle("install");
  await next.lifecycle("activate");
  assert.equal(next.stores.size, 1);
  assert.ok([...next.stores.values()][0]!.has(`${ORIGIN}/assets/index-EEEE.js`));
});

test("the build fills the placeholder exactly once, and its version follows its files", () => {
  assert.equal(SOURCE.split(BUILD_PLACEHOLDER).length, 2);
  assert.throws(() => injectBuild("const BUILD = null;", shellBuild([])));
  assert.notEqual(shellBuild(["assets/a-1.js"]).version, shellBuild(["assets/a-2.js"]).version);
  assert.deepEqual(shellBuild(["assets\\b.css", "assets/a.js", "icons/x.png", "assets/f.woff"]).assets, ["/assets/a.js", "/assets/b.css"]);
});
