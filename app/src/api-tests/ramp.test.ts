import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { parseEther, type Address, type Hex } from "viem";
import * as server from "../../api/ramp/index.ts";
import {
  DESK_GAS_FLOOR,
  DESK_LOW,
  DESK_TXS_PER_HOUR,
  BLOCKS_PER_HOUR,
  forgetRecentBuys,
  handleRamp,
  HOLD_LIMIT,
  MAX_BODY_BYTES,
  normalizeDeskKey,
  RampConfigError,
  RECENT_MS,
  type Moved,
  type RampChain,
  type RampEnv,
} from "../../api/ramp/index.ts";
import * as phone from "../lib/ramp.ts";

const SITE = "https://nivpay.example";
const DESK = "0x7EAf7f3e330ac388A0e951e80957B7274597297c" as Address;
const USER = "0x1A9A136f1cf59899C6b8cfE84ac4df388620467d" as Address;
const OTHER = "0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1" as Address;
const KEY_MARKER = "0x" + "ab".repeat(32);
const TX = ("0x" + "11".repeat(26) + "0512011d1d07") as Hex;
const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;

// ---------------------------------------------------------------------------
// The server's copy of the quotes is the phone's, exactly
// ---------------------------------------------------------------------------

test("the server's currency table is the phone's, row for row", () => {
  assert.deepEqual(server.CURRENCIES, phone.CURRENCIES);
  assert.equal(server.MIN_DOLLARS, phone.MIN_DOLLARS);
  assert.equal(server.MAX_DOLLARS, phone.MAX_DOLLARS);
  assert.equal(server.FEE_BPS, phone.FEE_BPS);
});

test("the server quotes exactly what the phone quotes, for every currency and many amounts", () => {
  const amounts = [0n, 1n, 99n, 100n, 101n, 155n, 7_750_000n, 15_600_000n, 123_457n, 10n ** 9n];
  const dollars = [0n, 1n, 9_999n, usd(1), usd(12.34), usd(49.5), usd(50), usd(100), usd(100) + 1n, 77_777_777n];
  for (const c of phone.CURRENCIES) {
    for (const a of amounts) assert.deepEqual(server.quoteAdd(c, a), phone.quoteAdd(c, a), `add ${c.code} ${a}`);
    for (const d of dollars) assert.deepEqual(server.quoteCashOut(c, d), phone.quoteCashOut(c, d), `cash out ${c.code} ${d}`);
  }
  for (const d of dollars) assert.equal(server.limitFor(d), phone.limitFor(d));
  for (const tx of [TX, "0x" + "ff".repeat(32), "0x" + "00".repeat(32)]) assert.equal(server.referenceForTx(tx), phone.referenceForTx(tx));
});

// ---------------------------------------------------------------------------
// The handler, against a scripted chain
// ---------------------------------------------------------------------------

function env(extra: Partial<RampEnv> = {}): RampEnv {
  return { RAMP_ENABLED: "true", RAMP_DESK_ADDRESS: DESK, RAMP_DESK_PRIVATE_KEY: KEY_MARKER, ...extra };
}

function req(body: unknown, origin: string | null = SITE, method = "POST", raw?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request(`${SITE}/api/ramp`, { method, headers, body: method === "POST" ? (raw ?? JSON.stringify(body)) : undefined });
}

const buy = (extra: Record<string, unknown> = {}) => ({ kind: "buy", address: USER, currency: "NGN", amount: "7750000", ...extra });
const cashout = (extra: Record<string, unknown> = {}) => ({ kind: "cashout", address: USER, currency: "NGN", tx: TX, ...extra });

type Script = {
  chainId?: number;
  code?: boolean;
  userDollars?: bigint;
  deskDollars?: bigint;
  deskGas?: bigint;
  faucetPays?: boolean;
  nonceHourAgo?: number;
  conflictsFirst?: number;
  moved?: Moved[] | "pending" | "reverted";
};

function chain(s: Script = {}) {
  const sends: { kind: "dollars" | "refill"; nonce: number; to?: Address; amount?: bigint }[] = [];
  let nextNonce = 40;
  let conflicts = s.conflictsFirst ?? 0;
  const c: RampChain = {
    chainId: async () => s.chainId ?? 10143,
    hasCode: async () => s.code ?? false,
    dollars: async (a) => (a === DESK ? (s.deskDollars ?? usd(5_000)) : (s.userDollars ?? 0n)),
    gasBalance: async () => s.deskGas ?? parseEther("10"),
    fees: async () => ({ maxFeePerGas: 107_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n }),
    deskNonce: async () => nextNonce,
    latestBlock: async () => 70_000_000n,
    deskNonceAt: async (_d, block) => {
      assert.equal(block, 70_000_000n - BLOCKS_PER_HOUR);
      return s.nonceHourAgo ?? 40;
    },
    faucetWouldPay: async () => s.faucetPays ?? true,
    sendDollars: async (to, amount, nonce) => {
      if (conflicts > 0) {
        conflicts--;
        throw new Error("nonce too low");
      }
      sends.push({ kind: "dollars", nonce, to, amount });
      nextNonce = nonce + 1;
      return `0x${nonce.toString(16).padStart(64, "0")}` as Hex;
    },
    refill: async (nonce) => {
      sends.push({ kind: "refill", nonce });
      nextNonce = nonce + 1;
      return `0x${"f".repeat(60)}${nonce.toString(16).padStart(4, "0")}` as Hex;
    },
    finalizedTransfers: async () => s.moved ?? [{ from: USER, to: DESK, value: usd(50) }],
  };
  return { c, sends };
}

function capture() {
  const lines: Record<string, string>[] = [];
  return { lines, log: (e: Record<string, string>) => void lines.push(e) };
}

beforeEach(() => forgetRecentBuys());

test("GET says whether the desk is on and where it is, and nothing secret", async () => {
  const res = await handleRamp(req(null, SITE, "GET"), env(), () => chain().c);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { enabled: true, desk: DESK });
  assert.doesNotMatch(JSON.stringify(body), /ab{4}/i);
  assert.deepEqual(await (await handleRamp(req(null, SITE, "GET"), env({ RAMP_ENABLED: "no" }), () => chain().c)).json(), { enabled: false, desk: DESK });
});

test("kill switch: paused without reading the key or touching the chain", async () => {
  const guarded = {
    RAMP_ENABLED: "false",
    RAMP_DESK_ADDRESS: DESK,
    get RAMP_DESK_PRIVATE_KEY(): string {
      throw new Error("the key was read");
    },
  } as RampEnv;
  let made = false;
  for (const body of [buy(), cashout()]) {
    const res = await handleRamp(req(body), guarded, () => {
      made = true;
      return chain().c;
    });
    assert.equal(res.status, 503);
  }
  assert.equal(made, false);
});

test("same origin only, a size cap, and well formed requests", async () => {
  assert.equal((await handleRamp(req(buy(), null), env(), () => chain().c)).status, 403);
  assert.equal((await handleRamp(req(buy(), "https://evil.example"), env(), () => chain().c)).status, 403);
  assert.equal((await handleRamp(req(buy(), "http://localhost:5173"), env({ ALLOWED_ORIGINS: "http://localhost:5173" }), () => chain().c)).status, 200);
  forgetRecentBuys();
  assert.equal((await handleRamp(req(null, SITE, "POST", "x".repeat(MAX_BODY_BYTES + 1)), env(), () => chain().c)).status, 413);
  assert.equal((await handleRamp(req(null, SITE, "POST", "{not json"), env(), () => chain().c)).status, 400);
  assert.equal((await handleRamp(req(null, SITE, "PUT"), env(), () => chain().c)).status, 405);
  const bad: [Record<string, unknown>, number][] = [
    [buy({ kind: "swap" }), 400],
    [buy({ address: "0x1234" }), 400],
    [buy({ address: "0x0000000000000000000000000000000000000000" }), 400],
    [buy({ currency: "XYZ" }), 400],
    [buy({ amount: 7750000 }), 400],
    [buy({ amount: "-1" }), 400],
    [buy({ amount: "1.5" }), 400],
    [buy({ amount: "15400" }), 400], // ₦154, under $1
    [buy({ amount: "15600000" }), 400], // ₦156,000, over $100
    [cashout({ tx: "0x1234" }), 400],
  ];
  for (const [body, status] of bad) assert.equal((await handleRamp(req(body), env(), () => chain().c, () => {})).status, status, JSON.stringify(body));
  assert.equal((await handleRamp(req(buy()), env({ RAMP_DESK_ADDRESS: "nope" }), () => chain().c, () => {})).status, 503);
});

test("a buy sends exactly the server's own quote, whatever the phone says it should get", async () => {
  const { c, sends } = chain();
  const { lines, log } = capture();
  const res = await handleRamp(req(buy({ received: "99000000", gross: "100000000" })), env(), () => c, log);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, string>;
  assert.equal(body.received, usd(49.5).toString());
  assert.equal(body.fee, usd(0.5).toString());
  assert.equal(body.gross, usd(50).toString());
  assert.equal(body.simulated, true as unknown as string);
  assert.deepEqual(sends, [{ kind: "dollars", nonce: 40, to: USER, amount: usd(49.5) }]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.event, "buy");
  assert.equal(lines[0]!.amount, usd(49.5).toString());
  for (const line of lines) assert.doesNotMatch(JSON.stringify(line), /abab/);
});

test("a buy is refused for contracts, accounts holding $1,000 or more, and when the desk is busy or out of processing funds", async () => {
  const guarded = () =>
    ({
      RAMP_ENABLED: "true",
      RAMP_DESK_ADDRESS: DESK,
      get RAMP_DESK_PRIVATE_KEY(): string {
        throw new Error("the key was read");
      },
    }) as RampEnv;
  const cases: [Script, number][] = [
    [{ chainId: 1 }, 503],
    [{ code: true }, 409],
    [{ userDollars: HOLD_LIMIT }, 409],
    [{ nonceHourAgo: 40 - DESK_TXS_PER_HOUR }, 503],
    [{ deskGas: DESK_GAS_FLOOR - 1n }, 503],
    [{ deskDollars: usd(10), faucetPays: false }, 503],
  ];
  for (const [script, status] of cases) {
    const { c, sends } = chain(script);
    const res = await handleRamp(req(buy()), guarded(), () => c, () => {});
    assert.equal(res.status, status, JSON.stringify(script, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    assert.deepEqual(sends, []);
  }
  // Just under the hold limit is fine.
  const { c } = chain({ userDollars: HOLD_LIMIT - 1n });
  assert.equal((await handleRamp(req(buy()), env(), () => c, () => {})).status, 200);
});

test("a desk short of dollars claims from Agora's faucet first, then sends on the next nonce", async () => {
  const { c, sends } = chain({ deskDollars: usd(10) });
  const { lines, log } = capture();
  const res = await handleRamp(req(buy()), env(), () => c, log);
  assert.equal(res.status, 200);
  assert.deepEqual(sends.map((s) => [s.kind, s.nonce]), [["refill", 40], ["dollars", 41]]);
  assert.ok(lines.some((l) => l.event === "refill"));
});

test("a desk running low restocks after the send, and only if the faucet would pay", async () => {
  const low = chain({ deskDollars: DESK_LOW + usd(10) });
  assert.equal((await handleRamp(req(buy()), env(), () => low.c, () => {})).status, 200);
  assert.deepEqual(low.sends.map((s) => [s.kind, s.nonce]), [["dollars", 40], ["refill", 41]]);
  forgetRecentBuys();
  const cooling = chain({ deskDollars: DESK_LOW + usd(10), faucetPays: false });
  assert.equal((await handleRamp(req(buy()), env(), () => cooling.c, () => {})).status, 200);
  assert.deepEqual(cooling.sends.map((s) => s.kind), ["dollars"]);
  forgetRecentBuys();
  const plenty = chain();
  assert.equal((await handleRamp(req(buy()), env(), () => plenty.c, () => {})).status, 200);
  assert.deepEqual(plenty.sends.map((s) => s.kind), ["dollars"]);
});

test("a nonce conflict is retried with a fresh nonce", async () => {
  const { c, sends } = chain({ conflictsFirst: 2 });
  assert.equal((await handleRamp(req(buy()), env(), () => c, () => {})).status, 200);
  assert.equal(sends.length, 1);
});

test("one request per account at a time, and a recent buyer waits", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { c } = chain();
  const slow: RampChain = { ...c, chainId: async () => (await gate, 10143) };
  const first = handleRamp(req(buy()), env(), () => slow, () => {});
  const second = await handleRamp(req(buy()), env(), () => c, () => {});
  assert.equal(second.status, 409);
  release();
  assert.equal((await first).status, 200);
  let t = 1_000;
  const clock = () => t;
  forgetRecentBuys();
  assert.equal((await handleRamp(req(buy()), env(), () => chain().c, () => {}, clock)).status, 200);
  assert.equal((await handleRamp(req(buy()), env(), () => chain().c, () => {}, clock)).status, 409);
  t += RECENT_MS + 1;
  assert.equal((await handleRamp(req(buy()), env(), () => chain().c, () => {}, clock)).status, 200);
});

test("a cash out reads the finalized transfer and gives the bank's amount with a reference, the same every time", async () => {
  const guarded = {
    RAMP_ENABLED: "true",
    RAMP_DESK_ADDRESS: DESK,
    get RAMP_DESK_PRIVATE_KEY(): string {
      throw new Error("the key was read");
    },
  } as RampEnv;
  const answers: unknown[] = [];
  for (let i = 0; i < 2; i++) {
    const { c, sends } = chain();
    const res = await handleRamp(req(cashout()), guarded, () => c, () => {});
    assert.equal(res.status, 200);
    answers.push(await res.json());
    assert.deepEqual(sends, [], "a cash out sends nothing");
  }
  assert.deepEqual(answers[0], answers[1]);
  assert.deepEqual(answers[0], {
    simulated: true,
    currency: "NGN",
    dollars: usd(50).toString(),
    fee: usd(0.5).toString(),
    bankGets: "7672500",
    reference: phone.referenceForTx(TX),
  });
});

test("a cash out counts only AUSD from this account to the desk, and only once final and successful", async () => {
  const cases: [Script["moved"], number][] = [
    ["pending", 409],
    ["reverted", 409],
    [[], 409],
    [[{ from: OTHER, to: DESK, value: usd(50) }], 409],
    [[{ from: USER, to: OTHER, value: usd(50) }], 409],
  ];
  for (const [moved, status] of cases) {
    assert.equal((await handleRamp(req(cashout()), env(), () => chain({ moved }).c, () => {})).status, status, JSON.stringify(moved, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  }
  const two = chain({ moved: [{ from: USER, to: DESK, value: usd(20) }, { from: OTHER, to: DESK, value: usd(5) }, { from: USER, to: DESK, value: usd(30) }] });
  const res = await handleRamp(req(cashout()), env(), () => two.c, () => {});
  assert.equal(((await res.json()) as { dollars: string }).dollars, usd(50).toString());
});

test("a failed read or send is reported with a short code, never the raw error or the key", async () => {
  const { lines, log } = capture();
  const broken: RampChain = { ...chain().c, chainId: async () => { throw new Error(`boom ${KEY_MARKER}`); } };
  const res = await handleRamp(req(buy()), env(), () => broken, log);
  assert.equal(res.status, 502);
  assert.equal(((await res.json()) as { code: string }).code, "RPC_FAILED");
  const sendFails: RampChain = { ...chain().c, sendDollars: async () => { throw new Error("execution reverted"); } };
  const res2 = await handleRamp(req(buy()), env(), () => sendFails, log);
  assert.equal(((await res2.json()) as { code: string }).code, "SEND_FAILED");
  const misconfigured: RampChain = { ...chain().c, sendDollars: async () => { throw new RampConfigError("DESK_KEY_MISMATCH"); } };
  const res3 = await handleRamp(req(buy()), env(), () => misconfigured, log);
  assert.equal(((await res3.json()) as { code: string }).code, "DESK_KEY_MISMATCH");
  for (const line of lines) assert.doesNotMatch(JSON.stringify(line), /abababab/);
});

test("the desk key is accepted as pasted, and never repeated in an error", () => {
  const hex = "ab".repeat(32);
  assert.equal(normalizeDeskKey(` 0x${hex}\n`), `0x${hex}`);
  assert.equal(normalizeDeskKey(hex), `0x${hex}`);
  try {
    normalizeDeskKey(`0x${hex}zz`);
    assert.fail("accepted");
  } catch (e) {
    assert.ok(e instanceof RampConfigError);
    assert.doesNotMatch(String(e), /abab/);
  }
});
