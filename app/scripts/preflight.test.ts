import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeFunctionData, encodeFunctionResult, getAddress, toHex, type Address, type Hex } from "viem";
import { ERC20_READ_ABI, POTS_ABI, SETTLEMENT_PAIR_ABI } from "../src/lib/abi.ts";
import { AUSD, AUSD_FAUCET, CTK, SETTLEMENT_PAIR } from "../src/lib/config.ts";
import { endTimeFor } from "../src/lib/draft.ts";
import { FAUCET_ABI } from "../src/lib/faucet.ts";
import { toText32 } from "../src/lib/text32.ts";
import {
  ConfigError,
  failed,
  findTake,
  formatReport,
  KNOWN,
  makeClient,
  parseConfig,
  runTake,
  TAKES,
  usd,
  type Config,
  type Deps,
  type Report,
} from "./preflight.ts";

// A mocked JSON-RPC node: the real read transport and viem's real encoding,
// with a fake fetch underneath that answers from a small in-memory chain.

const ABI = [...POTS_ABI, ...ERC20_READ_ABI, ...FAUCET_ABI, ...SETTLEMENT_PAIR_ABI] as const;
const NOW = 1_791_700_000n; // 11 Oct 2026
const MAMA_END = endTimeFor("2026-12-31", "Europe/London")!;

const IDARA = getAddress("0x1111111111111111111111111111111111111111");
const UBONG = getAddress("0x2222222222222222222222222222222222222222");
const ANIEKAN = getAddress("0x3333333333333333333333333333333333333333");
const CATERER = getAddress("0x4444444444444444444444444444444444444444");
const HALL = getAddress("0x5555555555555555555555555555555555555555");

type Pot = {
  purpose: string;
  endTime: bigint;
  threshold: number;
  deciders: Address[];
  payees: { to: Address; label: string; cap: bigint; spent: bigint }[];
  closed: boolean;
  frozen: boolean;
  total: bigint;
  shares: Map<string, bigint>;
};
type Proposal = { potId: bigint; kind: number; status: number; amount: bigint; approvals: number; expiresAt: bigint };

type Chain = {
  ausd: Map<string, bigint>;
  mon: Map<string, bigint>;
  nonce: Map<string, number>;
  pots: Pot[];
  proposals: Proposal[];
  faucet: { drip: bigint; every: bigint; last: bigint; stock: bigint };
  pair: { paused: boolean; ctk: bigint };
};

const k = (a: string) => a.toLowerCase();

function showcase(): Pot {
  return {
    purpose: "Anniversary",
    endTime: 1_793_574_000n,
    threshold: 2,
    deciders: [KNOWN.phoneA, KNOWN.phoneB],
    payees: [{ to: KNOWN.third, label: "Carter", cap: usd("100"), spent: 0n }],
    closed: false,
    frozen: false,
    total: usd("400"),
    shares: new Map([[k(KNOWN.phoneA), usd("200")], [k(KNOWN.phoneB), usd("200")]]),
  };
}

/** The chain as SEEDING.md M4 leaves it: Mama's 60th after both payments, before the close. */
function seededForClose(): Chain {
  return {
    ausd: new Map([
      [k(IDARA), usd("9500")],
      [k(UBONG), usd("9600")],
      [k(ANIEKAN), usd("9900")],
      [k(CATERER), usd("600")],
      [k(HALL), usd("280")],
    ]),
    mon: new Map([[k(IDARA), 90_000_000_000_000_000n], [k(UBONG), 95_000_000_000_000_000n], [k(ANIEKAN), 60_000_000_000_000_000n]]),
    nonce: new Map([[k(IDARA), 4], [k(UBONG), 3], [k(ANIEKAN), 4]]),
    pots: [
      showcase(),
      {
        purpose: "Mama\u2019s 60th",
        endTime: MAMA_END,
        threshold: 2,
        deciders: [IDARA, UBONG, ANIEKAN],
        payees: [
          { to: CATERER, label: "Caterer", cap: usd("700"), spent: usd("600") },
          { to: HALL, label: "Event hall", cap: usd("300"), spent: usd("280") },
        ],
        closed: false,
        frozen: false,
        total: usd("115.60"),
        // funderInfo rounds down: a sub-cent remainder is how the contract leaves it.
        shares: new Map([[k(IDARA), 57_799_999n], [k(UBONG), usd("46.24")], [k(ANIEKAN), usd("11.56")]]),
      },
    ],
    proposals: [
      { potId: 0n, kind: 0, status: 0, amount: usd("100"), approvals: 1, expiresAt: NOW + 86_400n },
      { potId: 1n, kind: 0, status: 1, amount: usd("600"), approvals: 2, expiresAt: NOW + 86_400n },
      { potId: 1n, kind: 0, status: 1, amount: usd("280"), approvals: 2, expiresAt: NOW + 86_400n },
    ],
    faucet: { drip: usd("10000"), every: 60n, last: NOW - 600n, stock: usd("1000000") },
    pair: { paused: false, ctk: 1_000n * 10n ** 18n },
  };
}

const MAIN: Config = {
  main: { idara: IDARA, ubong: UBONG, aniekan: ANIEKAN, caterer: CATERER, eventHall: HALL, pot: 1 },
  bounty: { ubong: "0x6666666666666666666666666666666666666666" },
  testClose: { pot: 2 },
};

function call(chain: Chain, to: string, data: Hex): unknown {
  const { functionName, args = [] } = decodeFunctionData({ abi: ABI, data });
  const a = args as readonly unknown[];
  const pot = (id: unknown) => {
    const p = chain.pots[Number(id)];
    if (!p) throw new Error("NoSuchPot");
    return p;
  };
  if (k(to) === k(AUSD) && functionName === "balanceOf") {
    const who = k(a[0] as string);
    return who === k(AUSD_FAUCET) ? chain.faucet.stock : (chain.ausd.get(who) ?? 0n);
  }
  if (k(to) === k(CTK) && functionName === "balanceOf") return k(a[0] as string) === k(SETTLEMENT_PAIR) ? chain.pair.ctk : 0n;
  if (k(to) === k(AUSD_FAUCET)) {
    return { faucetDripAmount: chain.faucet.drip, maxDripFrequency: chain.faucet.every, lastDripTimestamp: chain.faucet.last }[functionName as string];
  }
  if (k(to) === k(SETTLEMENT_PAIR) && functionName === "isPaused") return chain.pair.paused;
  switch (functionName) {
    case "potCount":
      return BigInt(chain.pots.length);
    case "proposalCount":
      return BigInt(chain.proposals.length);
    case "getPot": {
      const p = pot(a[0]);
      return {
        purpose: toText32(p.purpose),
        endTime: p.endTime,
        threshold: p.threshold,
        approverCount: p.deciders.length,
        destinationCount: p.payees.length,
        closed: p.closed,
        frozen: p.frozen,
        totalAssets: p.total,
        totalShares: p.total * 1000n,
      };
    }
    case "getApprovers":
      return pot(a[0]).deciders;
    case "getDestinations":
      return pot(a[0]).payees.map((d) => ({ to: d.to, label: toText32(d.label), cap: d.cap, spent: d.spent }));
    case "funderInfo": {
      const r = pot(a[0]).shares.get(k(a[1] as string)) ?? 0n;
      return [r * 1000n, r];
    }
    case "proposalInfo": {
      const p = chain.proposals[Number(a[0])]!;
      return {
        potId: p.potId,
        kind: p.kind,
        status: p.status,
        destIndex: 0,
        destination: CATERER,
        amount: p.amount,
        fee: 0n,
        proposer: IDARA,
        createdAt: p.expiresAt - 604_800n,
        expiresAt: p.expiresAt,
        approvals: p.approvals,
        threshold: 2,
        approvedBy: [],
      };
    }
  }
  throw new Error(`mock has no ${functionName} on ${to}`);
}

type Mock = { deps: Deps; methods: string[]; maxInFlight: () => number; sleeps: number[] };

/** `limitFirst` answers the first n requests with the public RPC's rate limit, -32011. */
function mockRpc(chain: Chain, options: { limitFirst?: number; status?: Awaited<ReturnType<Deps["fetchStatus"]>> } = {}): Mock {
  const methods: string[] = [];
  const sleeps: number[] = [];
  let inFlight = 0;
  let most = 0;
  let limited = options.limitFirst ?? 0;
  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
    inFlight++;
    most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    try {
      const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
      methods.push(body.method);
      const reply = (x: object) => new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...x }), { status: 200, headers: { "content-type": "application/json" } });
      if (limited > 0) {
        limited--;
        return reply({ error: { code: -32011, message: "requests limited to 15/sec" } });
      }
      const [first] = body.params as [Record<string, string> | string];
      switch (body.method) {
        case "eth_chainId":
          return reply({ result: "0x279f" });
        case "eth_getBlockByNumber":
          return reply({ result: { number: "0x100", timestamp: toHex(NOW), hash: `0x${"ab".repeat(32)}`, transactions: [] } });
        case "eth_getBalance":
          return reply({ result: toHex(chain.mon.get(k(first as string)) ?? 0n) });
        case "eth_getTransactionCount":
          return reply({ result: toHex(chain.nonce.get(k(first as string)) ?? 0) });
        case "eth_call": {
          const { to, data } = first as { to: string; data: Hex };
          const { functionName } = decodeFunctionData({ abi: ABI, data });
          try {
            const result = call(chain, to, data);
            return reply({ result: encodeFunctionResult({ abi: ABI, functionName, result } as never) });
          } catch (error) {
            return reply({ error: { code: 3, message: `execution reverted: ${(error as Error).message}`, data: "0x" } });
          }
        }
      }
      return reply({ error: { code: -32601, message: `the mock has no ${body.method}` } });
    } finally {
      inFlight--;
    }
  };
  const client = makeClient("http://mock.rpc", { fetchFn, sleep: async (ms) => void sleeps.push(ms) });
  const status = options.status ?? { enabled: true, keyMatches: true, funderBalance: "3.1 MON" };
  return { deps: { client, fetchStatus: async () => status }, methods, maxInFlight: () => most, sleeps };
}

const take = (name: string) => findTake(name)!;
const row = (report: Report, what: RegExp) => report.rows.find((r) => what.test(r.what))!;

test("preflight: main-close passes on a chain seeded as SEEDING.md M4 says", async () => {
  const mock = mockRpc(seededForClose());
  const report = await runTake(take("main-close"), MAIN, mock.deps);
  assert.deepEqual(failed(report), []);
  assert.equal(row(report, /Mama's 60th .* holds/).actual, "$115.60");
  assert.equal(row(report, /share, Idara/).ok, true, "a sub-cent remainder still shows as $57.80");
  assert.equal(row(report, /Pot 0, .* requests waiting/).ok, null, "pot 0's own request is reported, never judged");
  assert.match(formatReport(report), /checks pass\. Ready for take M4\./);
});

test("preflight: a request still waiting, a closed pot and a payee paid twice fail, each naming its fix", async () => {
  const chain = seededForClose();
  chain.proposals.push({ potId: 1n, kind: 1, status: 0, amount: 0n, approvals: 1, expiresAt: NOW + 3_600n });
  chain.pots[1]!.closed = true;
  chain.pots[1]!.payees[0]!.spent = usd("700");
  const report = await runTake(take("main-close"), MAIN, mockRpc(chain).deps);
  const fails = failed(report).map((r) => r.what);
  assert.ok(fails.some((w) => /requests waiting/.test(w)));
  assert.ok(fails.some((w) => /closed$/.test(w)));
  assert.ok(fails.some((w) => /payee Caterer/.test(w)));
  assert.match(row(report, /Mama's 60th .*requests waiting/).actual, /close early, 1 yes/);
  assert.match(row(report, /Mama's 60th .* closed$/).fix!, /cannot be reopened.*Retakes/);
  const text = formatReport(report);
  assert.match(text, /checks failed\. To fix:/);
  assert.match(text, /FAIL /);
});

test("preflight: a closing date in another time zone, or already passed, fails", async () => {
  const chain = seededForClose();
  chain.pots[1]!.endTime = MAMA_END - 3_600n;
  let report = await runTake(take("main-close"), MAIN, mockRpc(chain).deps);
  assert.equal(row(report, /Mama's 60th .* closing date/).ok, false);
  assert.match(row(report, /Mama's 60th .* closing date/).fix!, /Thu 31 Dec 2026/);

  chain.pots[1]!.endTime = NOW - 1n;
  report = await runTake(take("main-close"), MAIN, mockRpc(chain).deps);
  assert.match(row(report, /Mama's 60th .* closing date/).actual, /already passed/);
});

test("preflight: a reused account fails main-make on its balance, its requests sent and the pot on its Home", async () => {
  const chain = seededForClose();
  chain.pots.pop();
  chain.ausd.set(k(UBONG), usd("10000"));
  chain.ausd.set(k(ANIEKAN), usd("10000"));
  chain.ausd.set(k(CATERER), 0n);
  chain.ausd.set(k(HALL), 0n);
  chain.nonce.set(k(UBONG), 1);
  chain.nonce.set(k(ANIEKAN), 1);
  // Idara is last take's: she has spent and sent, and pot 0 names her.
  chain.nonce.set(k(IDARA), 6);
  chain.pots[0]!.deciders.push(IDARA);
  const report = await runTake(take("main-make"), MAIN, mockRpc(chain).deps);
  const fails = failed(report).map((r) => r.what);
  assert.deepEqual(fails, ["Idara (ending 1111) AUSD", "Idara (ending 1111) requests sent", "Idara (ending 1111) is on no pot yet", "Pot 0, the showcase (pot 0) yeses needed", "Pot 0, the showcase (pot 0) deciders"]);
  assert.match(row(report, /Idara .* requests sent/).fix!, /fresh account/);
});

test("preflight: an extra request acknowledged in the config passes", async () => {
  const chain = seededForClose();
  chain.nonce.set(k(UBONG), 4);
  const config = { ...MAIN, extraSent: { [UBONG]: 1 } };
  const report = await runTake(take("main-close"), config, mockRpc(chain).deps);
  assert.deepEqual(failed(report), []);
  assert.equal(row(report, /Ubong .* requests sent/).expected, "4 (3 + 1 acknowledged)");
});

test("preflight: an account at the gas grant limit with too little MON fails", async () => {
  const chain = seededForClose();
  chain.nonce.set(k(ANIEKAN), 10);
  chain.mon.set(k(ANIEKAN), 10_000_000_000_000_000n);
  const report = await runTake(take("main-close"), { ...MAIN, extraSent: { [ANIEKAN]: 6 } }, mockRpc(chain).deps);
  assert.deepEqual(failed(report).map((r) => r.what), ["Aniekan (ending 3333) MON for gas"]);
});

test("preflight: the 2 minute cut fails while the faucet cools down, the pair is paused or the funder is low", async () => {
  const chain = seededForClose();
  chain.faucet.last = NOW - 20n;
  chain.pair.paused = true;
  const report = await runTake(take("bounty"), MAIN, mockRpc(chain, { status: { enabled: true, keyMatches: true, funderBalance: "1.05 MON" } }).deps);
  assert.deepEqual(failed(report).map((r) => r.what), ["Faucet cooldown", "Agora pair open", "Funder MON"]);
  assert.equal(row(report, /Faucet cooldown/).actual, "ready in 40s");
});

test("preflight: backs off on the public RPC's -32011 and sends one request at a time", async () => {
  const mock = mockRpc(seededForClose(), { limitFirst: 3 });
  const report = await runTake(take("main-close"), MAIN, mock.deps);
  assert.deepEqual(failed(report), []);
  assert.equal(mock.sleeps.length, 3, "one backoff per rate-limited answer");
  assert.equal(mock.maxInFlight(), 1, "never two requests at once");
});

test("preflight: only reads, and the client refuses to broadcast", async () => {
  const mock = mockRpc(seededForClose());
  await runTake(take("main-close"), MAIN, mock.deps);
  const reads = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getTransactionCount", "eth_call"]);
  assert.deepEqual(mock.methods.filter((m) => !reads.has(m)), []);
  await assert.rejects(mock.deps.client.request({ method: "eth_sendRawTransaction", params: ["0x00"] } as never), /must not go through the read client/);
  assert.ok(!mock.methods.includes("eth_sendRawTransaction"));
});

test("preflight: a config with a private key or a recovery phrase is refused", () => {
  assert.throws(() => parseConfig(JSON.stringify({ main: { idara: `0x${"1".repeat(64)}` } })), ConfigError);
  assert.throws(() => parseConfig(JSON.stringify({ funderPrivateKey: "x" })), ConfigError);
  assert.throws(() => parseConfig(JSON.stringify({ note: "abandon ".repeat(11) + "about" })), ConfigError);
  assert.doesNotThrow(() => parseConfig(readFileSync(new URL("./preflight.config.example.json", import.meta.url), "utf8")));
});

test("preflight: a config gap stops the run before any request", async () => {
  const mock = mockRpc(seededForClose());
  await assert.rejects(runTake(take("main-close"), { main: { ...MAIN.main, pot: null } }, mock.deps), /main\.pot is not filled in/);
  await assert.rejects(runTake(take("main-make"), parseConfig(readFileSync(new URL("./preflight.config.example.json", import.meta.url), "utf8")), mock.deps), /main\.idara is not filled in/);
  assert.deepEqual(mock.methods, []);
});

test("preflight: every take and every fix points at a section that exists in docs/SEEDING.md", () => {
  const seeding = readFileSync(new URL("../../docs/SEEDING.md", import.meta.url), "utf8");
  const headings = [...seeding.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1]!);
  for (const t of TAKES) {
    assert.ok(headings.some((h) => h.startsWith(`${t.section}.`)), `SEEDING.md has a heading for ${t.section}`);
    assert.match(seeding, new RegExp(`preflight-take\\.mjs ${t.name}\\b`), `SEEDING.md runs the preflight for ${t.name}`);
    const fixes = [...t.accounts.map((a) => a.fix), ...t.pots.map((p) => p.fix)];
    for (const fix of fixes) {
      for (const [, quoted] of fix.matchAll(/"([^"]+)"/g)) {
        assert.ok(headings.some((h) => h === quoted || h.endsWith(quoted!)), `"${quoted}" is a heading in SEEDING.md (from ${t.name})`);
      }
    }
  }
});

test("preflight: dollars are read from text without a float", () => {
  assert.equal(usd("115.60"), 115_600_000n);
  assert.equal(usd("9,557.8"), 9_557_800_000n);
  assert.equal(usd("0"), 0n);
  assert.throws(() => usd("1.234"));
});
