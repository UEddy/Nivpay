import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const API = new URL("../../api/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** What Vercel makes a function of: every .ts or .js under api/, but not .d.ts, nor anything whose name or folder starts with _ or a dot. */
function functions(dir = API, at = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith("_") || e.name.startsWith(".")) return [];
    if (e.isDirectory()) return functions(join(dir, e.name), `${at}${e.name}/`);
    return /\.(ts|js)$/.test(e.name) && !e.name.endsWith(".d.ts") ? [`${at}${e.name}`] : [];
  });
}

test("no more than 12 functions, the Hobby plan's limit for a deployment: a 13th makes Vercel refuse the whole deploy", () => {
  const all = functions();
  assert.ok(all.length <= 12, `${all.length} functions: ${all.join(", ")}`);
  assert.ok(all.includes("autocash/index.ts") && all.includes("fund/index.ts"));
  assert.ok(!all.some((f) => f.startsWith("fund/") && f !== "fund/index.ts"), "fund/status is answered by fund/index.ts");
});

test("/api/fund/status keeps its URL: vercel.json rewrites it to /api/fund, whose GET answers it", async () => {
  const config = JSON.parse(readFileSync(join(API, "..", "vercel.json"), "utf8")) as { rewrites: { source: string; destination: string }[] };
  assert.deepEqual(config.rewrites[0], { source: "/api/fund/status", destination: "/api/fund" });
  const fund = await import("../../api/fund/index.ts");
  assert.equal(typeof fund.GET, "function");
  assert.match(readFileSync(join(API, "fund", "index.ts"), "utf8"), /export function GET\(\)[\s\S]*?\n {2}return handleStatus\(process\.env as StatusEnv/);
});
