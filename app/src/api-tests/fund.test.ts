import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address, Hex } from "viem";
import {
  FLOOR,
  FundConfigError,
  GRANT,
  handleFund,
  normalizeFunderKey,
  safeDetail,
  THRESHOLD,
  type FundChain,
  type FundEnv,
} from "../../api/fund/index.ts";
import { funderKeyMatches, handleStatus } from "../../api/fund/status.ts";

const SITE = "https://nivpay.example";
const FUNDER = "0x7EAf7f3e330ac388A0e951e80957B7274597297c";
const USER = "0x1A9A136f1cf59899C6b8cfE84ac4df388620467d";
const KEY_MARKER = "0x" + "ab".repeat(32);

function env(extra: Partial<FundEnv> = {}): FundEnv {
  return { FUNDING_ENABLED: "true", FUNDER_ADDRESS: FUNDER, FUNDER_PRIVATE_KEY: KEY_MARKER, ...extra };
}

function req(body: unknown, origin: string | null = SITE, method = "POST"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request(`${SITE}/api/fund`, { method, headers, body: method === "POST" ? JSON.stringify(body) : undefined });
}

type Script = {
  chainId?: number;
  code?: boolean;
  userBalance?: bigint;
  funderBalance?: bigint;
  sent?: number;
  conflictsFirst?: number;
};

function chain(s: Script = {}) {
  const sentWith: number[] = [];
  let nextNonce = 40;
  let conflicts = s.conflictsFirst ?? 0;
  const c: FundChain = {
    chainId: async () => s.chainId ?? 10143,
    hasCode: async () => s.code ?? false,
    balance: async (a) => (a === FUNDER ? (s.funderBalance ?? 50n * 10n ** 18n) : (s.userBalance ?? 0n)),
    sentCount: async () => s.sent ?? 0,
    fees: async () => ({ maxFeePerGas: 107_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n }),
    funderNonce: async () => nextNonce,
    sendGrant: async (_to: Address, nonce: number) => {
      if (conflicts > 0) {
        conflicts--;
        throw new Error("nonce too low");
      }
      if (sentWith.includes(nonce)) throw new Error("nonce too low");
      sentWith.push(nonce);
      nextNonce = nonce + 1;
      return `0x${nonce.toString(16).padStart(64, "0")}` as Hex;
    },
  };
  return { c, sentWith };
}

function capture() {
  const lines: Record<string, string>[] = [];
  return { lines, log: (e: Record<string, string>) => void lines.push(e) };
}

test("kill switch: paused without reading the key or touching the chain", async () => {
  const guarded = {
    FUNDING_ENABLED: "false",
    FUNDER_ADDRESS: FUNDER,
    get FUNDER_PRIVATE_KEY(): string {
      throw new Error("the key was read");
    },
  } as FundEnv;
  let chainMade = false;
  const res = await handleFund(req({ address: USER }), guarded, () => {
    chainMade = true;
    return chain().c;
  });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "funding is paused" });
  assert.equal(chainMade, false);
});

test("the key is never read on any refusal", async () => {
  const guardedEnv = () =>
    ({
      FUNDING_ENABLED: "true",
      FUNDER_ADDRESS: FUNDER,
      get FUNDER_PRIVATE_KEY(): string {
        throw new Error("the key was read");
      },
    }) as FundEnv;
  const cases: [Script, number][] = [
    [{ chainId: 1 }, 503],
    [{ code: true }, 409],
    [{ userBalance: THRESHOLD }, 409],
    [{ sent: 10 }, 409],
    [{ funderBalance: FLOOR }, 503],
  ];
  for (const [script, status] of cases) {
    const res = await handleFund(req({ address: USER }), guardedEnv(), () => chain(script).c, () => {});
    assert.equal(res.status, status, JSON.stringify(script, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  }
});

test("only POST", async () => {
  assert.equal((await handleFund(req(null, SITE, "GET"), env(), () => chain().c)).status, 405);
});

test("same origin only, with an optional allow list for local testing", async () => {
  assert.equal((await handleFund(req({ address: USER }, null), env(), () => chain().c)).status, 403);
  assert.equal((await handleFund(req({ address: USER }, "https://evil.example"), env(), () => chain().c)).status, 403);
  const local = env({ ALLOWED_ORIGINS: "http://localhost:5173" });
  assert.equal((await handleFund(req({ address: USER }, "http://localhost:5173"), local, () => chain().c, () => {})).status, 200);
});

test("bad input is refused and not logged", async () => {
  const { lines, log } = capture();
  for (const bad of [{}, { address: "hello" }, { address: 42 }, { address: "0x0000000000000000000000000000000000000000" }]) {
    assert.equal((await handleFund(req(bad), env(), () => chain().c, log)).status, 400);
  }
  assert.ok(lines.every((l) => !JSON.stringify(l).includes("hello")));
  const notJson = new Request(`${SITE}/api/fund`, { method: "POST", headers: { origin: SITE }, body: "{" });
  assert.equal((await handleFund(notJson, env(), () => chain().c)).status, 400);
});

test("eligibility: chain, no code, under the threshold, fewer than 10 sent, funder above its floor", async () => {
  const run = (s: Script) => handleFund(req({ address: USER }), env(), () => chain(s).c, () => {});
  assert.equal((await run({ chainId: 1 })).status, 503);
  assert.equal((await run({ code: true })).status, 409);
  assert.equal((await run({ userBalance: THRESHOLD })).status, 409);
  assert.equal((await run({ userBalance: THRESHOLD - 1n })).status, 200);
  assert.equal((await run({ sent: 10 })).status, 409);
  assert.equal((await run({ sent: 9 })).status, 200);
  // Exactly at the floor after the grant and its gas is allowed; one wei less is not.
  const gasCost = 21_000n * 107_000_000_000n;
  assert.equal((await run({ funderBalance: FLOOR + GRANT + gasCost })).status, 200);
  assert.equal((await run({ funderBalance: FLOOR + GRANT + gasCost - 1n })).status, 503);
});

test("a grant returns the hash and logs address, amount and hash only", async () => {
  const { lines, log } = capture();
  const res = await handleFund(req({ address: USER.toLowerCase(), extra: "ignored" }), env(), () => chain().c, log);
  assert.equal(res.status, 200);
  const { hash } = (await res.json()) as { hash: string };
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  const grant = lines.find((l) => l.event === "grant");
  assert.deepEqual(grant, { event: "grant", address: USER, amountWei: GRANT.toString(), hash });
});

test("the key never appears in any response or log", async () => {
  const { lines, log } = capture();
  const outputs: string[] = [];
  for (const s of [{}, { code: true }, { chainId: 1 }, { conflictsFirst: 9 }] as Script[]) {
    const res = await handleFund(req({ address: USER }), env(), () => chain(s).c, log);
    outputs.push(await res.text());
  }
  const all = outputs.join(" ") + JSON.stringify(lines);
  assert.ok(!all.includes(KEY_MARKER.slice(2)), "key leaked");
});

test("two requests at once: no nonce clash, a conflict is retried with a fresh nonce", async () => {
  const { c, sentWith } = chain({ conflictsFirst: 1 });
  const other = "0x0710Ade1Cf20E4A85a775c3A01dfdAead0579B20";
  const [a, b] = await Promise.all([
    handleFund(req({ address: USER }), env(), () => c, () => {}),
    handleFund(req({ address: other }), env(), () => c, () => {}),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(new Set(sentWith).size, 2, "two distinct nonces");
});

test("the same address twice at once gets one grant on this instance", async () => {
  const { c, sentWith } = chain();
  const [a, b] = await Promise.all([
    handleFund(req({ address: USER }), env(), () => c, () => {}),
    handleFund(req({ address: USER }), env(), () => c, () => {}),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(sentWith.length, 1);
});

// Anvil's default account #0. A published test key, never a real funder.
const PUBLIC_TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PUBLIC_TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

test("status returns enabled, keyMatches and the funder balance, nothing else", async () => {
  const res = await handleStatus(
    { FUNDING_ENABLED: "true", FUNDER_ADDRESS: PUBLIC_TEST_ADDRESS, FUNDER_PRIVATE_KEY: PUBLIC_TEST_KEY },
    async () => 12_345n * 10n ** 15n,
  );
  const body = await res.json();
  assert.deepEqual(body, { enabled: true, keyMatches: true, funderBalance: "12.345 MON" });
  assert.ok(!JSON.stringify(body).includes(PUBLIC_TEST_KEY.slice(2)), "the key is never in the answer");
  const off = await handleStatus({ FUNDING_ENABLED: "false" }, async () => 0n);
  assert.deepEqual(await off.json(), { enabled: false, keyMatches: false, funderBalance: null });
});

test("keyMatches is false for a key that is missing, malformed or belongs to another address", () => {
  const ok = { FUNDER_ADDRESS: PUBLIC_TEST_ADDRESS, FUNDER_PRIVATE_KEY: PUBLIC_TEST_KEY };
  assert.equal(funderKeyMatches(ok), true);
  assert.equal(funderKeyMatches({ ...ok, FUNDER_PRIVATE_KEY: `  ${PUBLIC_TEST_KEY.slice(2)}\n` }), true, "as pasted");
  assert.equal(funderKeyMatches({ ...ok, FUNDER_PRIVATE_KEY: undefined }), false);
  assert.equal(funderKeyMatches({ ...ok, FUNDER_PRIVATE_KEY: "0x1234" }), false);
  assert.equal(funderKeyMatches({ ...ok, FUNDER_ADDRESS: FUNDER }), false, "mismatch");
  assert.equal(funderKeyMatches({ ...ok, FUNDER_ADDRESS: "not an address" }), false);
});

test("status and /api/fund agree on which keys parse", () => {
  const hex = PUBLIC_TEST_KEY.slice(2);
  for (const raw of [PUBLIC_TEST_KEY, ` ${PUBLIC_TEST_KEY}\n`, hex, `\t${hex} `, "", "0x12", `0x${hex}00`, `"${PUBLIC_TEST_KEY}"`, `0X${hex}`]) {
    let grantPathAccepts = true;
    try {
      normalizeFunderKey(raw);
    } catch {
      grantPathAccepts = false;
    }
    assert.equal(funderKeyMatches({ FUNDER_ADDRESS: PUBLIC_TEST_ADDRESS, FUNDER_PRIVATE_KEY: raw }), grantPathAccepts, JSON.stringify(raw));
  }
});

test("the funder key is accepted as pasted: spaces, a newline, with or without 0x", () => {
  const hex = "ab".repeat(32);
  for (const raw of [`0x${hex}`, ` 0x${hex}\n`, hex, `\t${hex} `]) {
    assert.equal(normalizeFunderKey(raw), `0x${hex}`);
  }
  for (const bad of [undefined, "", "0x1234", `0x${hex}00`, `0x${"zz".repeat(32)}`, `"0x${hex}"`]) {
    assert.throws(() => normalizeFunderKey(bad), (e: unknown) => e instanceof FundConfigError && e.code === "FUNDER_KEY_MALFORMED");
  }
});

test("a malformed key error never contains the key", () => {
  const secretish = `0x${"cd".repeat(31)}`;
  try {
    normalizeFunderKey(secretish);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(!String((e as Error).message).includes("cdcd"));
    assert.ok(!String((e as Error).stack).includes("cdcd"));
  }
});

test("a failed send answers 502 with a code, and logs the code without the key", async () => {
  const { lines, log } = capture();
  const configBroken: FundChain = {
    ...chain().c,
    sendGrant: async () => {
      throw new FundConfigError("FUNDER_KEY_MALFORMED");
    },
  };
  const res = await handleFund(req({ address: USER }), env(), () => configBroken, log);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "could not send the grant, try again in a minute", code: "FUNDER_KEY_MALFORMED" });
  assert.deepEqual(lines.at(-1), { event: "failed", address: USER, code: "FUNDER_KEY_MALFORMED", detail: "" });

  const rpcDown: FundChain = {
    ...chain().c,
    sendGrant: async () => {
      throw new Error(`send failed, raw 0x${"ef".repeat(120)}`);
    },
  };
  const res2 = await handleFund(req({ address: USER }), env(), () => rpcDown, log);
  assert.equal(((await res2.json()) as { code: string }).code, "SEND_FAILED");
  const last = lines.at(-1) ?? {};
  assert.equal(last.code, "SEND_FAILED");
  assert.ok(!String(last.detail).includes("efef"), "long hex stripped from the detail");
  assert.ok(!JSON.stringify(lines).includes(KEY_MARKER.slice(2)));

  const readsDown: FundChain = { ...chain().c, hasCode: async () => { throw new Error("timeout"); } };
  const res3 = await handleFund(req({ address: USER }), env(), () => readsDown, log);
  assert.equal(((await res3.json()) as { code: string }).code, "RPC_FAILED");
});

test("safeDetail keeps one short line", () => {
  assert.equal(safeDetail({ shortMessage: "Nonce too low.\nDetails: x" }), "Nonce too low.");
  assert.ok(safeDetail(new Error("x".repeat(500))).length <= 120);
});
