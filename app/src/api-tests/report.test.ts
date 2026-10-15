import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import * as server from "../../api/report/index.ts";
import { forgetRecentReports, handleReport, MAX_BODY_BYTES, REPORTS_PER_MINUTE } from "../../api/report/index.ts";
import * as phone from "../lib/report.ts";

const SITE = "https://nivpay.example";

function req(body: unknown, origin: string | null = SITE, method = "POST", raw?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request(`${SITE}/api/report`, { method, headers, body: method === "POST" ? (raw ?? JSON.stringify(body)) : undefined });
}

const good = { deployment: "ausd", potId: "42", reason: "scam" };

function run(request: Request, env: server.ReportEnv = {}, now = () => 1_000) {
  const lines: Record<string, string>[] = [];
  return handleReport(request, env, (e) => lines.push(e), now).then(async (res) => ({ status: res.status, body: (await res.json()) as Record<string, unknown>, lines }));
}

beforeEach(() => forgetRecentReports());

test("the server's reasons are the phone's, in order", () => {
  assert.deepEqual(server.REASONS, phone.REASONS);
});

test("a good report is logged as one line with only the pot and the reason, and nothing is stored", async () => {
  for (const reason of phone.REASONS) {
    const r = await run(req({ ...good, reason, account: "0x1A9A136f1cf59899C6b8cfE84ac4df388620467d", name: "Idara" }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.lines, [{ event: "report", deployment: "ausd", potId: "42", reason }], "extra fields are never logged");
  }
});

test("only POST, from the same origin or one listed for testing", async () => {
  assert.equal((await run(req(good, SITE, "GET"))).status, 405);
  assert.equal((await run(req(good, null))).status, 403);
  assert.equal((await run(req(good, "https://evil.example"))).status, 403);
  assert.equal((await run(req(good, "http://localhost:5173"), { ALLOWED_ORIGINS: "http://localhost:5173" })).status, 200);
});

test("a reason outside the list, a bad pot number or deployment, or a broken body is refused and not logged", async () => {
  for (const body of [
    { ...good, reason: "other" },
    { ...good, reason: "Scam" },
    { ...good, potId: "-1" },
    { ...good, potId: 42 },
    { ...good, potId: "1".repeat(21) },
    { ...good, deployment: "mainnet" },
    {},
    null,
  ]) {
    const r = await run(req(body));
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.lines, []);
  }
  assert.equal((await run(req(null, SITE, "POST", "{nope"))).status, 400);
});

test("a body over the cap is refused unread", async () => {
  const r = await run(req(null, SITE, "POST", JSON.stringify({ ...good, pad: "x".repeat(MAX_BODY_BYTES) })));
  assert.equal(r.status, 413);
  assert.deepEqual(r.lines, []);
});

test("an instance takes a limited number of reports a minute, then more after it", async () => {
  for (let i = 0; i < REPORTS_PER_MINUTE; i++) assert.equal((await run(req(good), {}, () => 1_000 + i)).status, 200);
  const over = await run(req(good), {}, () => 2_000);
  assert.equal(over.status, 429);
  assert.deepEqual(over.lines, []);
  assert.equal((await run(req(good), {}, () => 62_000)).status, 200);
});

test("the phone sends only the deployment, the pot and the reason, and throws when refused", async () => {
  let sent: { url: string; init: RequestInit } | null = null;
  const post = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  await phone.sendReport({ deployment: "ausd", potId: "42", reason: "spam", ...({ account: "x" } as object) } as phone.ReportBody, post);
  assert.equal(sent!.url, "/api/report");
  assert.deepEqual(JSON.parse(String(sent!.init.body)), { deployment: "ausd", potId: "42", reason: "spam" });
  await assert.rejects(phone.sendReport({ deployment: "ausd", potId: "42", reason: "spam" }, (async () => new Response("{}", { status: 429 })) as typeof fetch));
});

test("a photo can be reported by its account, and it is logged as a photo; never a pot and a photo at once", async () => {
  const account = "0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1";
  const r = await run(req({ deployment: "ausd", photo: account, reason: "impersonation" }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.lines, [{ event: "report", deployment: "ausd", photo: account.toLowerCase(), reason: "impersonation" }]);
  assert.equal((await run(req({ deployment: "ausd", photo: account, potId: "1", reason: "spam" }))).status, 400);
  assert.equal((await run(req({ deployment: "ausd", photo: "nope", reason: "spam" }))).status, 400);
});
