import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { parseEther, type Address, type Hex } from "viem";
import {
  FLOOR,
  BLOCKS_PER_HOUR,
  forgetRecentGrants,
  FundConfigError,
  GRANT,
  GRANTS_PER_HOUR,
  MAX_BODY_BYTES,
  RECENT_MS,
  handleFund,
  MAX_SENT_TXS,
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
  /** The funder's nonce about an hour ago; by default its starting nonce, so no grant counts against the hourly cap. */
  nonceHourAgo?: number;
  historyFails?: boolean;
};

/** A grant's signed bytes and hash, from its nonce alone, as the scripted chain makes them. */
const rawOf = (nonce: number) => `0x${nonce.toString(16).padStart(8, "0")}` as Hex;
const hashOf = (nonce: number) => `0x${nonce.toString(16).padStart(64, "0")}` as Hex;
const nonceOf = (raw: Hex) => parseInt(raw.slice(2), 16);
const noPause = async () => {};

function chain(s: Script = {}) {
  const sentWith: number[] = [];
  /** Grants the scripted chain holds, by hash: mined once broadcast, unless a test says otherwise. */
  const seen = new Map<string, "mined" | "pending">();
  let nextNonce = 40;
  let conflicts = s.conflictsFirst ?? 0;
  const c: FundChain = {
    chainId: async () => s.chainId ?? 10143,
    hasCode: async () => s.code ?? false,
    balance: async (a) => (a === FUNDER ? (s.funderBalance ?? 50n * 10n ** 18n) : (s.userBalance ?? 0n)),
    sentCount: async () => s.sent ?? 0,
    fees: async () => ({ maxFeePerGas: 107_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n }),
    funderNonce: async () => nextNonce,
    latestBlock: async () => 70_000_000n,
    funderNonceAt: async (block) => {
      assert.equal(block, 70_000_000n - BLOCKS_PER_HOUR);
      if (s.historyFails) throw new Error("missing trie node");
      return s.nonceHourAgo ?? 40;
    },
    signGrant: async (_to: Address, nonce: number) => ({ raw: rawOf(nonce), hash: hashOf(nonce) }),
    broadcast: async (raw: Hex) => {
      const nonce = nonceOf(raw);
      if (conflicts > 0) {
        conflicts--;
        throw new Error("nonce too low");
      }
      if (sentWith.includes(nonce)) throw new Error("nonce too low");
      sentWith.push(nonce);
      seen.set(hashOf(nonce), "mined");
      nextNonce = nonce + 1;
    },
    grantSeen: async (hash: Hex) => seen.get(hash) ?? null,
  };
  return { c, sentWith, seen };
}

beforeEach(() => forgetRecentGrants());

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
    [{ sent: 30 }, 409],
    [{ funderBalance: FLOOR }, 503],
  ];
  for (const [script, status] of cases) {
    const res = await handleFund(req({ address: USER }), guardedEnv(), () => chain(script).c, () => {});
    assert.equal(res.status, status, JSON.stringify(script, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  }
});

test("the threshold covers the largest single action, so no account is stuck between the two", () => {
  // The first payment in another currency: three requests, about 0.059 MON at
  // their max fee. An account at or above the threshold can always pay for it.
  assert.equal(THRESHOLD, parseEther("0.075"));
  assert.ok(THRESHOLD > parseEther("0.059"));
  assert.equal(GRANT, parseEther("0.1"));
  assert.equal(MAX_SENT_TXS, 30);
  assert.equal(FLOOR, parseEther("1"));
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

test("eligibility: chain, no code, under the threshold, fewer than 30 sent, funder above its floor", async () => {
  // Each run is a separate question about the same address, not a second grant moments after the first.
  const run = (s: Script) => (forgetRecentGrants(), handleFund(req({ address: USER }), env(), () => chain(s).c, () => {}));
  assert.equal((await run({ chainId: 1 })).status, 503);
  assert.equal((await run({ code: true })).status, 409);
  assert.equal((await run({ userBalance: THRESHOLD })).status, 409);
  assert.equal((await run({ userBalance: THRESHOLD - 1n })).status, 200);
  assert.equal((await run({ sent: 30 })).status, 409);
  assert.equal((await run({ sent: 29 })).status, 200);
  assert.equal((await run({ sent: 10 })).status, 200, "the old cap of 10 no longer stops an account");
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
    signGrant: async () => {
      throw new FundConfigError("FUNDER_KEY_MALFORMED");
    },
  };
  const res = await handleFund(req({ address: USER }), env(), () => configBroken, log);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "could not send the grant, try again in a minute", code: "FUNDER_KEY_MALFORMED" });
  assert.deepEqual(lines.at(-1), { event: "failed", address: USER, code: "FUNDER_KEY_MALFORMED", detail: "" });

  const rpcDown: FundChain = {
    ...chain().c,
    broadcast: async () => {
      throw new Error(`send failed, raw 0x${"ef".repeat(120)}`);
    },
  };
  const res2 = await handleFund(req({ address: USER }), env(), () => rpcDown, log, Date.now, noPause);
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

test("a body over 1 KB is refused unread, before the chain is touched", async () => {
  let touched = false;
  const big = new Request(`${SITE}/api/fund`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE },
    body: JSON.stringify({ address: USER, pad: "x".repeat(MAX_BODY_BYTES) }),
  });
  const res = await handleFund(big, env(), () => ((touched = true), chain().c));
  assert.equal(res.status, 413);
  assert.equal(touched, false);
});

test("an address granted a moment ago is refused on this instance until its grant has had time to land", async () => {
  let t = 1_000_000;
  const { c, sentWith } = chain();
  const ask = () => handleFund(req({ address: USER }), env(), () => c, () => {}, () => t);
  assert.equal((await ask()).status, 200);
  const again = await ask();
  assert.equal(again.status, 409);
  assert.match(((await again.json()) as { error: string }).error, /just sent/);
  t += RECENT_MS + 1;
  assert.equal((await ask()).status, 200);
  assert.equal(sentWith.length, 2);
});

test("at most GRANTS_PER_HOUR grants an hour in all, counted from the funder's own nonce", async () => {
  // The funder's nonce is 40; an hour ago it was 40 - GRANTS_PER_HOUR: the cap is reached.
  const full = await handleFund(req({ address: USER }), env(), () => chain({ nonceHourAgo: 40 - GRANTS_PER_HOUR }).c);
  assert.equal(full.status, 503);
  assert.match(((await full.json()) as { error: string }).error, /busy/);
  const room = await handleFund(req({ address: USER }), env(), () => chain({ nonceHourAgo: 40 - GRANTS_PER_HOUR + 1 }).c);
  assert.equal(room.status, 200);
});

test("if the funder's past nonce can't be read, nothing is granted", async () => {
  const { c, sentWith } = chain({ historyFails: true });
  const res = await handleFund(req({ address: USER }), env(), () => c, () => {});
  assert.equal(res.status, 502);
  assert.equal(((await res.json()) as { code: string }).code, "RPC_FAILED");
  assert.equal(sentWith.length, 0);
});

test("an attacker with endless fresh addresses gets GRANTS_PER_HOUR an hour, not the whole funder", async () => {
  // One hour, one instance, 200 fresh addresses asked one after another.
  const sentWith: number[] = [];
  const startNonce = 40;
  let nonce = startNonce;
  const c: FundChain = {
    ...chain().c,
    funderNonce: async () => nonce,
    funderNonceAt: async () => startNonce,
    signGrant: async (_to, n) => ({ raw: rawOf(n), hash: hashOf(n) }),
    broadcast: async (raw) => {
      sentWith.push(nonceOf(raw));
      nonce = nonceOf(raw) + 1;
    },
  };
  let granted = 0;
  for (let i = 0; i < 200; i++) {
    const address = `0x${(i + 1).toString(16).padStart(40, "0")}`;
    const res = await handleFund(req({ address }), env(), () => c, () => {});
    if (res.status === 200) granted++;
  }
  assert.equal(granted, GRANTS_PER_HOUR);
  assert.equal(sentWith.length, GRANTS_PER_HOUR);
});

test("what one address and what everyone together can take: 30 grants (3 MON) an address, still 2 MON an hour in all", () => {
  // A grant needs fewer than MAX_SENT_TXS sent, and spending a grant away takes
  // at least one transaction, so one address gets at most MAX_SENT_TXS grants.
  // Was 10 grants, 1 MON.
  assert.equal(BigInt(MAX_SENT_TXS) * GRANT, parseEther("3"));
  // The hourly cap counts every grant to every address, so it alone bounds an
  // attacker with many fresh addresses: unchanged by the per-address cap.
  assert.equal(GRANTS_PER_HOUR, 20);
  assert.equal(BigInt(GRANTS_PER_HOUR) * GRANT, parseEther("2"));
  assert.equal(RECENT_MS, 120_000);
  assert.equal(MAX_BODY_BYTES, 1_024);
  assert.equal(FLOOR, parseEther("1"));
});

// ---------------------------------------------------------------------------
// A broadcast that times out or errors: the grant is looked for by its hash
// before answering, and SEND_FAILED only when it truly didn't go out.
// ---------------------------------------------------------------------------

/** A chain whose broadcast of a grant throws, but the grant goes out anyway (or doesn't), as scripted. */
function flaky(outcome: "mined" | "pending" | "lost", opts: { afterLooks?: number } = {}) {
  const base = chain();
  const broadcasts: Hex[] = [];
  let looks = 0;
  const c: FundChain = {
    ...base.c,
    broadcast: async (raw) => {
      broadcasts.push(raw);
      // The first send of these bytes times out, though the node may have taken them.
      if (broadcasts.length === 1) {
        if (outcome !== "lost") base.seen.set(hashOf(nonceOf(raw)), outcome);
        throw new Error("The request took too long to respond.");
      }
      // Sent again: the same bytes. Lost ones are refused for good; ones it holds are "already known".
      if (outcome === "lost") throw new Error("The request took too long to respond.");
      throw new Error("already known");
    },
    grantSeen: async (hash) => {
      looks++;
      // A grant that went out may only be seen after a look or two.
      if (opts.afterLooks && looks <= opts.afterLooks) return null;
      return base.seen.get(hash) ?? null;
    },
  };
  return { c, broadcasts, looks: () => looks };
}

test("a broadcast that timed out but was mined answers the grant, not SEND_FAILED, and sends nothing new", async () => {
  const { lines, log } = capture();
  const f = flaky("mined", { afterLooks: 1 });
  const res = await handleFund(req({ address: USER }), env(), () => f.c, log, Date.now, noPause);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { hash: hashOf(40) });
  assert.equal(f.broadcasts.length, 1, "found by its hash: not sent again");
  assert.equal(lines.at(-1)?.event, "grant");
  assert.equal(lines.at(-1)?.after, "the broadcast errored, then found mined");
});

test("a broadcast that timed out and is pending answers the grant as pending, which the app waits for", async () => {
  const f = flaky("pending");
  const res = await handleFund(req({ address: USER }), env(), () => f.c, () => {}, Date.now, noPause);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { hash: hashOf(40), pending: true });
  assert.equal(f.broadcasts.length, 1);
});

test("a grant the node holds but no read sees yet: the same bytes sent again are already known, so it is pending", async () => {
  const f = flaky("pending", { afterLooks: 99 });
  const res = await handleFund(req({ address: USER }), env(), () => f.c, () => {}, Date.now, noPause);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { hash: hashOf(40), pending: true });
  assert.deepEqual(f.broadcasts, [rawOf(40), rawOf(40)], "only ever the same signed grant");
});

test("a grant that truly didn't go out answers SEND_FAILED, after looking, and never signs a second grant", async () => {
  const { lines, log } = capture();
  let signed = 0;
  const f = flaky("lost");
  const c: FundChain = { ...f.c, signGrant: async (to, nonce, fees) => (signed++, f.c.signGrant(to, nonce, fees)) };
  const res = await handleFund(req({ address: USER }), env(), () => c, log, Date.now, noPause);
  assert.equal(res.status, 502);
  assert.equal(((await res.json()) as { code: string }).code, "SEND_FAILED");
  assert.equal(signed, 1, "one request, one signed grant");
  assert.deepEqual(f.broadcasts, [rawOf(40), rawOf(40)], "sent again only as the same bytes");
  assert.ok(f.looks() >= 3, "looked for it before saying it failed");
  assert.equal(lines.at(-1)?.event, "failed");
});

test("a nonce conflict on this request's own grant is that grant, not a reason to send another", async () => {
  const base = chain();
  let sends = 0;
  const c: FundChain = {
    ...base.c,
    broadcast: async (raw) => {
      sends++;
      // It went out, but the answer that came back was a conflict on its own nonce.
      base.seen.set(hashOf(nonceOf(raw)), "pending");
      throw new Error("nonce too low");
    },
  };
  const res = await handleFund(req({ address: USER }), env(), () => c, () => {}, Date.now, noPause);
  assert.deepEqual(await res.json(), { hash: hashOf(40), pending: true });
  assert.equal(sends, 1);
});

test("every cap still holds with the new send: the hourly cap, the floor, the threshold and the recent grant", async () => {
  const f = flaky("mined");
  assert.equal((await handleFund(req({ address: USER }), env(), () => ({ ...f.c, funderNonceAt: async () => 40 - GRANTS_PER_HOUR }), () => {}, Date.now, noPause)).status, 503);
  assert.equal((await handleFund(req({ address: USER }), env(), () => chain({ funderBalance: 10n ** 18n }).c, () => {}, Date.now, noPause)).status, 503);
  assert.equal((await handleFund(req({ address: USER }), env(), () => chain({ userBalance: 10n ** 18n }).c, () => {}, Date.now, noPause)).status, 409);
  forgetRecentGrants();
  const ok = flaky("pending");
  assert.equal((await handleFund(req({ address: USER }), env(), () => ok.c, () => {}, Date.now, noPause)).status, 200);
  // A pending grant counts as granted: the same address is refused while it lands.
  assert.equal((await handleFund(req({ address: USER }), env(), () => chain().c, () => {}, Date.now, noPause)).status, 409);
});
