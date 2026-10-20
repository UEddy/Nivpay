import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getAddress, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as server from "../../api/autocash/index.ts";
import { forgetRecent, handleAutoCash, MAX_BODY_BYTES, MAX_MOVES_PER_HOUR, normalizeDeskKey, type Arrival, type AutoCashChain, type AutoCashEnv, type AutoCashStore } from "../../api/autocash/index.ts";
import * as rules from "../lib/autocash.ts";
import * as ramp from "../lib/ramp.ts";
import { proofMessage } from "../lib/proof.ts";
import { requestText } from "../lib/autocashLive.ts";

const SITE = "https://nivpay.example";
const DESK = getAddress("0x7EAf7f3e330ac388A0e951e80957B7274597297c");
const SENDER = getAddress("0x1A9A136f1cf59899C6b8cfE84ac4df388620467d");
const KEY_MARKER = "0x" + "ab".repeat(32);
const person = privateKeyToAccount(generatePrivateKey());
const ME = person.address;
const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;
const txOf = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const T0 = Date.UTC(2026, 9, 20, 9, 40);
const FIRST = { name: "First Bank", last4: "6789" };
const settings = (extra: Record<string, unknown> = {}) => ({ currency: "NGN", bank: FIRST, keep: null, cap: usd(500).toString(), ...extra });

// ---------------------------------------------------------------------------
// The server's copies are the phone's, exactly
// ---------------------------------------------------------------------------

test("the server's rules are the phone's, for many inputs", () => {
  for (const k of ["DAY_MS", "WAIT_MS", "DEFAULT_CAP", "MIN_MOVE", "MAX_CAP", "BANK_NAME_MAX"] as const) assert.equal(server[k], rules[k], k);
  for (const name of ["First Bank", "  GT  Bank ", "x", "Bank 12345", "<b>"]) assert.equal(server.cleanBankName(name), rules.cleanBankName(name), name);
  const codes = ramp.CURRENCIES.map((c) => c.code);
  for (const r of [settings(), settings({ cap: "1" }), settings({ keep: "5" }), settings({ bank: { name: "First Bank", last4: "12345" } }), { ...settings(), extra: 1 }, null]) {
    assert.deepEqual(server.cleanRequest(r, codes), rules.cleanRequest(r, codes));
  }
  let s: rules.AutoCashSettings | null = null;
  let t = T0;
  for (const req of [settings(), settings({ bank: { name: "GTBank", last4: "1234" } }), settings({ cap: usd(800).toString() }), settings({ cap: usd(100).toString(), keep: usd(50).toString() })]) {
    const a = rules.change(s, req as rules.AutoCashRequest, t);
    assert.deepEqual(server.change(s, req as rules.AutoCashRequest, t), a);
    assert.deepEqual(server.settle(a, t + rules.WAIT_MS), rules.settle(a, t + rules.WAIT_MS));
    assert.deepEqual(server.cleanSettings(JSON.parse(JSON.stringify(a)), codes), rules.cleanSettings(JSON.parse(JSON.stringify(a)), codes));
    s = a;
    t += 1000;
  }
  for (let i = 0; i < 500; i++) {
    const r = () => BigInt(Math.floor(Math.random() * 600_000_000));
    const x = { arrived: r(), balance: r(), keep: Math.random() < 0.5 ? null : r(), capLeft: r(), allowance: r() };
    assert.deepEqual(server.amountToMove(x), rules.amountToMove(x));
  }
});

test("the server's quotes, references and proof are the phone's", () => {
  assert.deepEqual(
    server.CURRENCIES.map((c) => [c.code, c.symbol, c.digits, c.testMinorPerDollar]),
    ramp.CURRENCIES.map((c) => [c.code, c.symbol, c.digits, c.testMinorPerDollar]),
  );
  for (const c of ramp.CURRENCIES) {
    for (const d of [0n, 1n, usd(1), usd(49.5), usd(50), usd(500), 77_777_777n]) {
      const p = ramp.quoteCashOut(c, d);
      assert.deepEqual(server.quoteCashOut(server.CURRENCIES.find((x) => x.code === c.code)!, d), { dollars: p.dollars, fee: p.fee, bankGets: p.bankGets });
    }
  }
  for (const tx of [txOf(1), "0x" + "ff".repeat(32)]) assert.equal(server.referenceForTx(tx), ramp.referenceForTx(tx));
  const fields = { subject: "autocash" as const, action: "on", account: ME, data: "sha256:00", time: 1, site: "nivpay.vercel.app" };
  assert.equal(server.proofMessage(fields), proofMessage(fields));
  const req = rules.cleanRequest(settings(), ramp.CURRENCIES.map((c) => c.code))!;
  assert.equal(server.requestText(req), requestText(req));
  // The example from the brief: $50 to NGN is ₦76,725.00.
  assert.equal(ramp.formatLocal(ramp.currencyFor("NGN")!, server.quoteCashOut(server.CURRENCIES[0]!, usd(50)).bankGets), "₦76,725.00");
});

// ---------------------------------------------------------------------------
// The handler, against a scripted chain and a store in memory
// ---------------------------------------------------------------------------

function env(extra: Partial<AutoCashEnv> = {}): AutoCashEnv {
  return { RAMP_ENABLED: "true", RAMP_DESK_ADDRESS: DESK, RAMP_DESK_PRIVATE_KEY: KEY_MARKER, BLOB_READ_WRITE_TOKEN: "token", ...extra };
}

class MemoryStore implements AutoCashStore {
  files = new Map<string, Uint8Array>();
  async read(path: string) {
    return this.files.get(path) ?? null;
  }
  async write(path: string, bytes: Uint8Array, create: boolean) {
    if (create && this.files.has(path)) return false;
    this.files.set(path, bytes);
    return true;
  }
  async list(prefix: string) {
    return [...this.files.keys()].filter((k) => k.startsWith(prefix));
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  text() {
    return [...this.files.entries()].map(([k, v]) => k + " " + new TextDecoder().decode(v)).join("\n");
  }
}

type Script = { arrivals: Map<string, Arrival | "pending" | null>; balance: bigint; allowance: bigint; deskGas: bigint; nonceHourAgo: number; failPull?: boolean };

class ScriptedChain implements AutoCashChain {
  pulls: { owner: Address; amount: bigint }[] = [];
  nonce = 10;
  s: Script;
  constructor(s: Script) {
    this.s = s;
  }
  chainId = async () => 10143;
  arrival = async (tx: Hex) => (this.s.arrivals.has(tx.toLowerCase()) ? this.s.arrivals.get(tx.toLowerCase())! : null);
  dollars = async () => this.s.balance;
  allowance = async () => this.s.allowance;
  gasBalance = async () => this.s.deskGas;
  deskNonce = async () => this.nonce;
  latestBlock = async () => 50_000n;
  deskNonceAt = async () => this.s.nonceHourAgo;
  fees = async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });
  pull = async (owner: Address, amount: bigint) => {
    if (this.s.failPull) throw new Error("timed out waiting for the receipt");
    this.pulls.push({ owner, amount });
    this.s.balance -= amount;
    this.s.allowance -= amount;
    return txOf(0xd00 + this.nonce++);
  };
}

let store: MemoryStore;
let chain: ScriptedChain;
let logs: Record<string, string>[];
let clock: number;
const arrivalOf = (dollars: number, extra: Partial<Arrival> = {}): Arrival => ({ sender: SENDER, time: BigInt(Math.floor(clock / 1000) + 5), ok: true, transfers: [{ from: SENDER, to: ME, value: usd(dollars) }], ...extra });

beforeEach(() => {
  forgetRecent();
  clock = T0;
  store = new MemoryStore();
  chain = new ScriptedChain({ arrivals: new Map(), balance: 0n, allowance: usd(500), deskGas: parseEther("1"), nonceHourAgo: 10 });
  logs = [];
});

const call = (body: unknown, opts: { env?: AutoCashEnv; origin?: string | null; raw?: string } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.origin !== null) headers.origin = opts.origin ?? SITE;
  const request = new Request(`${SITE}/api/autocash`, { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) });
  return handleAutoCash(request, opts.env ?? env(), () => chain, () => store, (e) => logs.push(e), () => clock);
};
const getInfo = async (account: Address = ME, e = env()) => (await handleAutoCash(new Request(`${SITE}/api/autocash?account=${account}`), e, () => chain, () => store, () => {}, () => clock)).json();

async function turnOn(extra: Record<string, unknown> = {}) {
  const s = settings(extra);
  const time = Math.floor(clock / 1000);
  const data = `sha256:${createHash("sha256").update(requestText(s as rules.AutoCashRequest)).digest("hex")}`;
  const signature = await person.signMessage({ message: proofMessage({ subject: "autocash", action: "on", account: ME, data, time, site: "nivpay.example" }) });
  return call({ kind: "set", account: ME, settings: s, time, signature });
}

/** Money arriving, as /api/notify passes it on. */
async function arrive(dollars: number, n: number, extra: Partial<Arrival> = {}) {
  clock += 60_000;
  chain.s.balance += usd(dollars);
  chain.s.arrivals.set(txOf(n), arrivalOf(dollars, extra));
  return (await (await call({ kind: "arrived", tx: txOf(n), accounts: [ME] })).json()).outcomes[0];
}

test("turning it on keeps the bank's name and last 4 digits only, signed by the account's passkey", async () => {
  const res = await turnOn();
  assert.equal(res.status, 200);
  assert.equal((await res.json()).on, true);
  const saved = JSON.parse(new TextDecoder().decode(store.files.get(`autocash/${ME}/settings.json`)!));
  assert.deepEqual(saved.bank, FIRST);
  // GET says it is on, and nothing about the bank.
  const info = await getInfo();
  assert.equal(info.on, true);
  assert.ok(!JSON.stringify(info).includes("First Bank") && !JSON.stringify(info).includes("6789"));
});

test("settings with a full account number, anything extra, or someone else's proof are refused, and nothing is kept", async () => {
  const time = Math.floor(clock / 1000);
  for (const bad of [settings({ bank: { name: "First Bank", last4: "0123456789" } }), { ...settings(), accountNumber: "0123456789" }, settings({ bank: { name: "First Bank 0123456789", last4: "6789" } })]) {
    const res = await call({ kind: "set", account: ME, settings: bad, time, signature: "0x" + "11".repeat(65) });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  const other = privateKeyToAccount(generatePrivateKey());
  const s = settings();
  const data = `sha256:${createHash("sha256").update(requestText(s as rules.AutoCashRequest)).digest("hex")}`;
  const forged = await other.signMessage({ message: proofMessage({ subject: "autocash", action: "on", account: ME, data, time, site: "nivpay.example" }) });
  assert.equal((await call({ kind: "set", account: ME, settings: s, time, signature: forged })).status, 401);
  // A proof for other settings doesn't turn on these.
  const mine = await person.signMessage({ message: proofMessage({ subject: "autocash", action: "on", account: ME, data, time, site: "nivpay.example" }) });
  assert.equal((await call({ kind: "set", account: ME, settings: settings({ cap: usd(900).toString() }), time, signature: mine })).status, 401);
  assert.equal((await call({ kind: "set", account: ME, settings: s, time: time - 301, signature: mine })).status, 401);
  assert.equal(store.files.size, 0);
  assert.ok(!logs.some((l) => JSON.stringify(l).includes("0123456789")));
});

test("same origin only, a size cap, and well formed requests", async () => {
  assert.equal((await call({ kind: "off", account: ME }, { origin: null })).status, 403);
  assert.equal((await call({ kind: "off", account: ME }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await call(null, { raw: "x".repeat(MAX_BODY_BYTES + 1) })).status, 413);
  assert.equal((await call(null, { raw: "{" })).status, 400);
  assert.equal((await call({ kind: "steal", account: ME })).status, 400);
  assert.equal((await call({ kind: "arrived", tx: "0x12", accounts: [ME] })).status, 400);
});

test("a real arrival: the desk moves what arrived, once, and the statement is Cash out's", async () => {
  await turnOn();
  const out = await arrive(50, 1);
  assert.equal(out.result, "moved");
  assert.deepEqual(chain.pulls, [{ owner: ME, amount: usd(50) }]);
  assert.deepEqual(out.bank, FIRST);
  assert.equal(out.move.dollars, usd(50).toString());
  assert.equal(out.move.bankGets, "7672500");
  assert.equal(out.move.reference, ramp.referenceForTx(out.move.tx));
  assert.equal(out.move.arrivedTx, txOf(1));
  // Already processed: told again, nothing moves twice, on this instance or any other.
  forgetRecent();
  assert.equal((await (await call({ kind: "arrived", tx: txOf(1), accounts: [ME] })).json()).outcomes[0].result, "already");
  assert.equal((await (await call({ kind: "check", account: ME, txs: [txOf(1)] })).json()).outcomes[0].result, "already");
  assert.equal(chain.pulls.length, 1);
  const info = await getInfo();
  assert.equal(info.movedToday, usd(50).toString());
  assert.deepEqual([info.moves[0].tx, info.moves[0].currency], [out.move.tx.toLowerCase(), "NGN"]);
  // The logs never carry the bank.
  assert.ok(!JSON.stringify(logs).includes("First Bank") && !JSON.stringify(logs).includes("6789"));
});

test("a made up transaction, one not final, a failed one, or one with nothing for this account moves nothing", async () => {
  await turnOn();
  assert.equal((await (await call({ kind: "check", account: ME, txs: [txOf(99)] })).json()).outcomes[0].result, "unknown");
  chain.s.arrivals.set(txOf(2), "pending");
  assert.equal((await (await call({ kind: "check", account: ME, txs: [txOf(2)] })).json()).outcomes[0].result, "pending");
  assert.equal((await arrive(20, 3, { ok: false })).result, "none");
  assert.equal((await arrive(20, 4, { transfers: [{ from: SENDER, to: DESK, value: usd(20) }] })).result, "none");
  assert.equal(chain.pulls.length, 0);
});

test("money the account moved itself, from the desk or the faucet, or from before it was turned on, never moves", async () => {
  await turnOn();
  assert.equal((await arrive(20, 5, { sender: ME })).result, "none");
  assert.equal((await arrive(20, 6, { transfers: [{ from: DESK, to: ME, value: usd(20) }] })).result, "none");
  assert.equal((await arrive(20, 7, { transfers: [{ from: server.AUSD_FAUCET, to: ME, value: usd(20) }] })).result, "none");
  assert.equal((await arrive(20, 8, { time: BigInt(Math.floor(T0 / 1000) - 60) })).result, "none");
  assert.equal(chain.pulls.length, 0);
});

test("over the cap: what is left today moves, then nothing, and the person is told the rest stays", async () => {
  await turnOn({ cap: usd(100).toString() });
  chain.s.allowance = usd(1000);
  assert.equal((await arrive(70, 10)).move.dollars, usd(70).toString());
  const partial = await arrive(50, 11);
  assert.equal(partial.result, "moved");
  assert.equal(partial.move.dollars, usd(30).toString());
  const none = await arrive(40, 12);
  assert.deepEqual([none.result, none.hold.why, none.hold.dollars], ["held", "cap", usd(40).toString()]);
  assert.equal(chain.pulls.reduce((s, p) => s + p.amount, 0n), usd(100));
  // A day later the cap is free again.
  clock += rules.DAY_MS;
  assert.equal((await arrive(25, 13)).move.dollars, usd(25).toString());
});

test("the balance to keep: money already there stays, only what is above it moves", async () => {
  chain.s.balance = usd(80);
  await turnOn({ keep: usd(100).toString() });
  // $80 + $50 = $130: $30 above $100 moves.
  assert.equal((await arrive(50, 20)).move.dollars, usd(30).toString());
  // Spent down to $80: all of the next $10 is kept, and nothing is said.
  chain.s.balance -= usd(20);
  assert.equal((await arrive(10, 21)).result, "kept");
  assert.equal(chain.s.balance, usd(90));
  // Back above $100: only what is above it moves.
  assert.equal((await arrive(15, 22)).move.dollars, usd(5).toString());
});

test("the allowance: never more than signed, and the person is told when it runs out", async () => {
  await turnOn();
  chain.s.allowance = usd(15);
  assert.equal((await arrive(20, 30)).move.dollars, usd(15).toString());
  const out = await arrive(20, 31);
  assert.deepEqual([out.result, out.hold.why], ["held", "allowance"]);
});

test("switched off: off at once, with no proof, and nothing moves after", async () => {
  await turnOn();
  assert.equal((await (await call({ kind: "off", account: ME })).json()).on, false);
  assert.equal((await arrive(20, 40)).result, "off");
  assert.equal(chain.pulls.length, 0);
  assert.equal((await getInfo()).on, false);
});

test("the kill switch: money stays, the person is told, the key is never read and nothing is claimed", async () => {
  await turnOn();
  clock += 60_000;
  chain.s.arrivals.set(txOf(50), arrivalOf(20));
  const res = await call({ kind: "arrived", tx: txOf(50), accounts: [ME] }, { env: env({ RAMP_ENABLED: "false", RAMP_DESK_PRIVATE_KEY: "not a key" }) });
  const out = (await res.json()).outcomes[0];
  assert.deepEqual([out.result, out.hold.why], ["held", "paused"]);
  assert.equal(chain.pulls.length, 0);
  assert.ok(![...store.files.keys()].some((k) => k.includes("/arrivals/")));
});

test("the desk short of what it runs on, or busy: money stays and the person is told", async () => {
  await turnOn();
  chain.s.deskGas = 0n;
  assert.deepEqual((await arrive(20, 60)).hold.why, "desk");
  chain.s.deskGas = parseEther("1");
  chain.nonce = 10 + server.DESK_TXS_PER_HOUR;
  assert.deepEqual((await arrive(20, 61)).hold.why, "busy");
  assert.equal(chain.pulls.length, 0);
});

test("at most a few moves an hour for one account", async () => {
  await turnOn({ cap: usd(1000).toString() });
  chain.s.allowance = usd(1000);
  for (let i = 0; i < MAX_MOVES_PER_HOUR; i++) assert.equal((await arrive(5, 70 + i)).result, "moved");
  assert.deepEqual((await arrive(5, 80)).hold.why, "busy");
});

test("a move lost after it was sent is never tried again, and nothing is said that could be wrong", async () => {
  await turnOn();
  chain.s.failPull = true;
  assert.equal((await arrive(20, 90)).result, "unknown");
  chain.s.failPull = false;
  forgetRecent();
  assert.equal((await (await call({ kind: "check", account: ME, txs: [txOf(90)] })).json()).outcomes[0].result, "already");
  assert.equal(chain.pulls.length, 0);
});

test("a new bank waits 24 hours; GET says one waits, and cancel drops it", async () => {
  await turnOn();
  clock += 1000;
  const time = Math.floor(clock / 1000);
  const s = settings({ bank: { name: "GTBank", last4: "1234" } });
  const data = `sha256:${createHash("sha256").update(requestText(s as rules.AutoCashRequest)).digest("hex")}`;
  const signature = await person.signMessage({ message: proofMessage({ subject: "autocash", action: "on", account: ME, data, time, site: "nivpay.example" }) });
  const res = await (await call({ kind: "set", account: ME, settings: s, time, signature })).json();
  assert.deepEqual(res.pending, { startsAt: clock + rules.WAIT_MS, bank: true });
  assert.equal((await arrive(20, 100)).bank.name, "First Bank");
  const cancel = await person.signMessage({ message: proofMessage({ subject: "autocash", action: "cancel", account: ME, data: "none", time, site: "nivpay.example" }) });
  assert.equal((await (await call({ kind: "cancel", account: ME, time, signature: cancel })).json()).pending, null);
});

test("the desk key is accepted as pasted, and never repeated in an error", () => {
  assert.equal(normalizeDeskKey(" " + "ab".repeat(32) + "\n"), "0x" + "ab".repeat(32));
  assert.throws(() => normalizeDeskKey("0x1234"), (e: Error) => !e.message.includes("1234"));
});
