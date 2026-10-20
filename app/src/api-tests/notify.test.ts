import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, getAddress, stringToHex, type Address, type Hex, type Log } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as server from "../../api/notify/index.ts";
import { forgetRecent, handleNotify, MAX_AGE_S, payloadFor, type NotifyChain, type PushStore, type Subscription } from "../../api/notify/index.ts";
import * as config from "../lib/config.ts";
import { POTS_ABI, POTS_V2_ABI } from "../lib/abi.ts";
import { requestDigest, requestProof, type PersonRequest } from "../lib/inbox.ts";
import { DEFAULT_SETTINGS } from "../lib/push.ts";

const SITE = "https://nivpay.example";
const NOW = 1_800_000_000_000;
const ENV = { BLOB_STORE_ID: "store_test", VAPID_PUBLIC_KEY: "BPub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "https://nivpay.example" };
const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const [PAYER, IDARA, UBONG, MAKER, STRANGER] = [A(0x11), A(0x22), A(0x33), A(0x44), A(0x55)];
const TX = `0x${"ab".repeat(32)}` as Hex;

const TRANSFER = [{ type: "event", name: "Transfer", inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false }] }] as const;
function log(address: Address, topics: Hex[], data: Hex): Log {
  return { address, topics: topics as [Hex, ...Hex[]], data, blockNumber: 100n, blockHash: TX, logIndex: 0, transactionHash: TX, transactionIndex: 0, removed: false };
}
const transfer = (token: Address, from: Address, to: Address, value: bigint) =>
  log(token, encodeEventTopics({ abi: TRANSFER, eventName: "Transfer", args: { from, to } }) as Hex[], encodeAbiParameters([{ type: "uint256" }], [value]));
const funded = (potId: bigint, funder: Address, assets: bigint) =>
  log(config.POTS_AUSD, encodeEventTopics({ abi: POTS_ABI, eventName: "Funded", args: { potId, funder } }) as Hex[], encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [assets, assets]));
const proposed = (proposalId: bigint, potId: bigint, proposer: Address, amount: bigint) =>
  log(
    config.POTS_AUSD,
    encodeEventTopics({ abi: POTS_ABI, eventName: "Proposed", args: { proposalId, potId, proposer } }) as Hex[],
    encodeAbiParameters([{ type: "uint8" }, { type: "uint16" }, { type: "uint256" }, { type: "uint64" }], [0, 0, amount, 9n]),
  );
const created = (potId: bigint, creator: Address, approvers: Address[], destinations: Address[]) =>
  log(
    config.POTS_AUSD,
    encodeEventTopics({ abi: POTS_ABI, eventName: "PotCreated", args: { potId, creator } }) as Hex[],
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address[]" }, { type: "uint8" }, { type: "address[]" }, { type: "bytes32[]" }, { type: "uint256[]" }, { type: "uint64" }],
      [stringToHex("Birthday", { size: 32 }), approvers, 2, destinations, destinations.map(() => stringToHex("x", { size: 32 })), destinations.map(() => 1n), 9n],
    ),
  );

function chain(logs: Log[], over: Partial<{ block: bigint; finalized: bigint; status: "success" | "reverted"; age: number }> = {}): NotifyChain {
  const block = over.block ?? 100n;
  return {
    receipt: async (tx) => (tx === TX ? { status: over.status ?? "success", blockNumber: block, from: PAYER, logs } : null),
    finalized: async () => ({ number: over.finalized ?? 200n, timestamp: 0n }),
    blockTime: async () => BigInt(NOW / 1000 - (over.age ?? 5)),
    members: async () => ({ deciders: [MAKER, IDARA, PAYER], payees: [UBONG] }),
    potName: async () => "Birthday",
    shares: async (_pots, _potId, account) => (account === IDARA || account === UBONG ? 5n : 0n),
  };
}

function subsFor(people: Partial<Subscription>[]) {
  const m = new Map<string, Uint8Array>();
  for (const [i, p] of people.entries()) {
    const sub: Subscription = { account: p.account!, endpoint: `https://push.example/${i}`, keys: { p256dh: "x", auth: "y" }, lang: "en", settings: DEFAULT_SETTINGS, muted: [], trusted: [], at: 1, ...p };
    m.set(`push/${sub.account}/${i}.json`, new TextEncoder().encode(JSON.stringify(sub)));
  }
  const store: PushStore = {
    put: async (path, b) => void m.set(path, b),
    remove: async (path) => void m.delete(path),
    list: async (prefix) => [...m.keys()].filter((k) => k.startsWith(prefix)),
    read: async (path) => m.get(path) ?? null,
  };
  return { m, store };
}

async function run(body: unknown, c: NotifyChain, store: PushStore, status = 201, env: server.PushEnv = ENV, autocash?: server.AutoCash) {
  const sent: { to: string; payload: Record<string, unknown> }[] = [];
  const res = await handleNotify(
    new Request(`${SITE}/api/notify`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify(body) }),
    env,
    c,
    () => store,
    async (sub, payload) => {
      sent.push({ to: sub.account, payload: JSON.parse(payload) as Record<string, unknown> });
      return status;
    },
    () => {},
    () => NOW,
    autocash,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, sent };
}

beforeEach(() => forgetRecent());

test("the server's copies of the addresses match the app's", () => {
  for (const k of ["POTS_AUSD", "POTS_TESTUSD", "TESTUSD", "AUSD", "AUSD_FAUCET", "CTK", "SETTLEMENT_PAIR", "RPC_URL"] as const) assert.equal(server[k], config[k], k);
  assert.deepEqual(server.POTS_V2, config.POTS_V2, "POTS_V2");
});

test("money sent: the person paid hears it came in, and the payer's other phones that it went through", async () => {
  const { store } = subsFor([{ account: IDARA }, { account: PAYER, settings: { ...DEFAULT_SETTINGS, kinds: { ...DEFAULT_SETTINGS.kinds, sent: true }, amounts: true } }]);
  const r = await run({ kind: "tx", deployment: "ausd", tx: TX }, chain([transfer(config.AUSD, PAYER, IDARA, 25_000_000n)]), store);
  assert.equal(r.status, 200);
  assert.deepEqual(r.sent, [
    { to: IDARA, payload: { k: "received", l: "en" } },
    { to: PAYER, payload: { k: "sent", l: "en", a: "25000000", d: 6, s: "$" } },
  ], "amounts only for the phone that chose to see them");
});

test("chipping in tells the pot's people but not the one who put it in; a pot payment request tells the other deciders", async () => {
  const { store } = subsFor([{ account: MAKER }, { account: IDARA }, { account: UBONG }, { account: PAYER }]);
  const r = await run({ kind: "tx", deployment: "ausd", tx: TX }, chain([transfer(config.AUSD, PAYER, config.POTS_AUSD, 50n), funded(7n, PAYER, 50n), proposed(3n, 7n, PAYER, 9n)]), store);
  const got = r.sent.map((s) => [s.to, s.payload.k, s.payload.p, s.payload.n, s.payload.r]);
  assert.deepEqual(got.sort(), [
    [IDARA, "askYes", "7", "Birthday", "3"],
    [IDARA, "chippedIn", "7", "Birthday", undefined],
    [MAKER, "askYes", "7", "Birthday", "3"],
    [MAKER, "chippedIn", "7", "Birthday", undefined],
    [UBONG, "chippedIn", "7", "Birthday", undefined],
  ].sort(), "no 'sent' for money into a pot, and nothing to the payer");
});

test("a pot that names you is told only if you keep its maker among your contacts, and only if you turned that on", async () => {
  const on = { ...DEFAULT_SETTINGS, kinds: { ...DEFAULT_SETTINGS.kinds, potNamesYou: true } };
  const { store } = subsFor([{ account: IDARA, settings: on, trusted: [MAKER] }, { account: UBONG, settings: on, trusted: [STRANGER] }, { account: PAYER, trusted: [MAKER] }]);
  const r = await run({ kind: "tx", deployment: "ausd", tx: TX }, chain([created(9n, MAKER, [MAKER, IDARA, PAYER], [UBONG])]), store);
  assert.deepEqual(r.sent, [{ to: IDARA, payload: { k: "potNamesYou", l: "en", p: "9", n: "Birthday" } }]);
});

test("unknown, unfinished, failed or old transactions are ignored, each is handled once, and other contracts' events say nothing", async () => {
  const { store } = subsFor([{ account: IDARA }]);
  const pay = [transfer(config.AUSD, PAYER, IDARA, 5n)];
  assert.equal((await run({ kind: "tx", deployment: "ausd", tx: `0x${"cd".repeat(32)}` }, chain(pay), store)).body.ignored, "unknown");
  assert.equal((await run({ kind: "tx", deployment: "ausd", tx: TX }, chain(pay, { finalized: 99n }), store)).body.ignored, "not final");
  assert.equal((await run({ kind: "tx", deployment: "ausd", tx: TX }, chain(pay, { status: "reverted" }), store)).body.ignored, "failed");
  assert.equal((await run({ kind: "tx", deployment: "ausd", tx: TX }, chain(pay, { age: MAX_AGE_S + 60 }), store)).body.ignored, "too old");
  assert.equal((await run({ kind: "tx", deployment: "ausd", tx: TX }, chain([transfer(STRANGER, PAYER, IDARA, 5n)]), store)).sent.length, 0, "a token that isn't ours");
  forgetRecent();
  assert.equal((await run({ kind: "tx", deployment: "ausd", tx: TX }, chain(pay), store)).sent.length, 1);
  assert.equal((await run({ kind: "tx", deployment: "ausd", tx: TX }, chain(pay), store)).sent.length, 0, "once");
});

test("a phone the push service says is gone is forgotten", async () => {
  const { m, store } = subsFor([{ account: IDARA }]);
  await run({ kind: "tx", deployment: "ausd", tx: TX }, chain([transfer(config.AUSD, PAYER, IDARA, 5n)]), store, 410);
  assert.equal(m.size, 0);
});

test("a request to a person: checked against the requester's proof, never with the amount, and not to someone who muted them", async () => {
  const asker = privateKeyToAccount(generatePrivateKey());
  const r: PersonRequest = { v: 1, deployment: "ausd", from: asker.address, to: IDARA, name: "Idara", amount: "5", at: NOW, nonce: "n" };
  const digest = await requestDigest(r);
  const signature = await asker.signMessage({ message: requestProof(r, digest, "nivpay.example") });
  const body = { kind: "request", from: asker.address, to: IDARA, time: NOW / 1000, signature, digest };
  const { store } = subsFor([{ account: IDARA, settings: { ...DEFAULT_SETTINGS, amounts: true } }]);
  assert.equal((await run({ ...body, to: UBONG }, chain([]), store)).status, 401, "a proof for one person is no good for another");
  assert.deepEqual((await run(body, chain([]), store)).sent, [{ to: IDARA, payload: { k: "request", l: "en" } }]);
  forgetRecent();
  const muted = subsFor([{ account: IDARA, muted: [asker.address] }]);
  assert.equal((await run(body, chain([]), muted.store)).sent.length, 0);
});

test("nothing happens until notifications are set up, and only from this site", async () => {
  const { store } = subsFor([{ account: IDARA }]);
  assert.deepEqual((await run({ kind: "tx", deployment: "ausd", tx: TX }, chain([]), store, 201, { BLOB_STORE_ID: "x" })).body, { enabled: false });
  const res = await handleNotify(new Request(`${SITE}/api/notify`, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }), ENV, chain([]), () => store, async () => 201);
  assert.equal(res.status, 403);
});

test("payloads carry no name and no link", () => {
  const sub = { account: IDARA, endpoint: "e", keys: { p256dh: "x", auth: "y" }, lang: "pt", settings: { ...DEFAULT_SETTINGS, amounts: true }, muted: [], trusted: [], at: 1 } as Subscription;
  assert.equal(payloadFor(sub, { account: IDARA, kind: "chippedIn", pot: "7", potName: "Birthday", amount: 5n, decimals: 6, symbol: "$" }), JSON.stringify({ k: "chippedIn", l: "pt", p: "7", n: "Birthday", a: "5", d: 6, s: "$" }));
});

test("a change agreed on a V2 pot tells those still holding money in it, checked on the chain, never the one whose yes agreed it", async () => {
  const V2 = A(0x9902);
  const d = { pots: config.POTS_AUSD, potsV2: V2, tokens: [{ address: config.AUSD, decimals: 6, symbol: "$" }] };
  const agreed = (changeId: bigint, potId: bigint, appliesAt: bigint, lapsesAt: bigint) =>
    log(V2, encodeEventTopics({ abi: POTS_V2_ABI, eventName: "ChangeApproved", args: { changeId, potId } }) as Hex[], encodeAbiParameters([{ type: "uint64" }, { type: "uint64" }], [appliesAt, lapsesAt]));
  // Widening: waits 72 hours, then 7 days to apply.
  const wide = await server.whoToTellOn(chain([]), d, [agreed(1n, 4n, 1_000n, 2_000n)], 100n, [IDARA, UBONG, STRANGER, PAYER], PAYER);
  assert.deepEqual(wide.map((t) => [t.account, t.kind, t.pot]), [
    [IDARA, "changeApproved", "v2:4"],
    [UBONG, "changeApproved", "v2:4"],
  ]);
  // Narrowing applied with its yes: nothing to warn about.
  assert.deepEqual(await server.whoToTellOn(chain([]), d, [agreed(2n, 4n, 1_000n, 1_000n)], 100n, [IDARA, UBONG]), []);
  // The same event from any other address is nobody's change.
  const elsewhere = log(STRANGER, agreed(1n, 4n, 1_000n, 2_000n).topics as Hex[], agreed(1n, 4n, 1_000n, 2_000n).data);
  assert.deepEqual(await server.whoToTellOn(chain([]), d, [elsewhere], 100n, [IDARA]), []);
});

test("a V2 pot's own events go as v2: and its number", async () => {
  const V2 = A(0x9902);
  const d = { pots: config.POTS_AUSD, potsV2: V2, tokens: [{ address: config.AUSD, decimals: 6, symbol: "$" }] };
  const onV2 = { ...funded(7n, PAYER, 50n), address: V2 };
  const tells = await server.whoToTellOn(chain([]), d, [onV2], 100n);
  assert.ok(tells.length > 0 && tells.every((t) => t.kind === "chippedIn" && t.pot === "v2:7"));
  // And with V2 off, the same log is nothing.
  assert.deepEqual(await server.whoToTellOn(chain([]), { ...d, potsV2: null }, [onV2], 100n), []);
});

test("auto cash out: money that arrived and was sent to the bank is one push saying so, with the bank and the statement", async () => {
  const MOVE = `0x${"cd".repeat(32)}`;
  const asked: { tx: string; accounts: string[] }[] = [];
  const autocash: server.AutoCash = async (tx, accounts) => {
    asked.push({ tx, accounts });
    return [{ account: IDARA, result: "moved", move: { tx: MOVE, dollars: "50000000", bankGets: "7672500", currency: "NGN" }, bank: { name: "First Bank", last4: "6789" } }];
  };
  const { store } = subsFor([{ account: IDARA, settings: { ...DEFAULT_SETTINGS, amounts: true } }]);
  const r = await run({ kind: "tx", deployment: "ausd", tx: TX }, chain([transfer(config.AUSD, PAYER, IDARA, 50_000_000n)]), store, 201, ENV, autocash);
  assert.deepEqual(asked, [{ tx: TX, accounts: [IDARA] }]);
  assert.deepEqual(r.sent, [{ to: IDARA, payload: { k: "autoCashOut", l: "en", a: "50000000", d: 6, s: "$", c: "NGN", b: "First Bank", e: "6789", t: MOVE, m: "7672500" } }]);
});

test("auto cash out: amounts off keep the bank and drop what it got; part of it is told as well as the arrival; money that stayed says why", () => {
  const MOVE = `0x${"cd".repeat(32)}` as Hex;
  const rx = { account: IDARA, kind: "received" as const, amount: 50_000_000n, decimals: 6, symbol: "$" };
  const moved = (dollars: string) => [{ account: IDARA, result: "moved", move: { tx: MOVE, dollars, bankGets: "7672500", currency: "NGN" }, bank: { name: "First Bank", last4: "6789" } }];
  const sub = { account: IDARA, endpoint: "e", keys: { p256dh: "x", auth: "y" }, lang: "en", settings: DEFAULT_SETTINGS, muted: [], trusted: [], at: 1 };
  const whole = server.withAutoCash([rx], moved("50000000"));
  assert.deepEqual(JSON.parse(payloadFor(sub, whole[0]!)!), { k: "autoCashOut", l: "en", c: "NGN", b: "First Bank", e: "6789", t: MOVE });
  const part = server.withAutoCash([rx], moved("30000000"));
  assert.deepEqual(part.map((t) => t.kind), ["received", "autoCashOut"]);
  assert.equal(JSON.parse(payloadFor(sub, part[1]!)!).v, 1);
  for (const [why, as] of [["cap", "cap"], ["allowance", "allowance"], ["paused", "desk"], ["busy", "desk"], ["desk", "desk"]] as const) {
    const held = server.withAutoCash([rx], [{ account: IDARA, result: "held", hold: { why, dollars: "50000000" } }]);
    assert.deepEqual(JSON.parse(payloadFor(sub, held[0]!)!), { k: "autoCashOut", l: "en", w: as });
  }
  // Off, kept, nothing to do, or no answer: the arrival is told as always.
  for (const result of ["off", "kept", "none", "unknown", "pending"]) assert.deepEqual(server.withAutoCash([rx], [{ account: IDARA, result }]), [rx]);
  // Already claimed: whoever claimed it has told the person, so this call says nothing more.
  assert.deepEqual(server.withAutoCash([rx], [{ account: IDARA, result: "already" }]), []);
  assert.deepEqual(server.withAutoCash([rx], []), [rx]);
  // Only dollars: CTK arriving is never cashed out.
  const ctk = { ...rx, symbol: "CTK", decimals: 18 };
  assert.deepEqual(server.withAutoCash([ctk], moved("50000000")), [ctk]);
});

test("auto cash out is asked only on the AUSD build and only for dollars in; if it can't answer, the arrival is told as always", async () => {
  let asked = 0;
  const failing: server.AutoCash = async () => {
    asked++;
    throw new Error("unreachable");
  };
  const { store } = subsFor([{ account: IDARA }]);
  const r = await run({ kind: "tx", deployment: "ausd", tx: TX }, chain([transfer(config.AUSD, PAYER, IDARA, 5_000_000n)]), store, 201, ENV, failing);
  assert.deepEqual(r.sent, [{ to: IDARA, payload: { k: "received", l: "en" } }]);
  forgetRecent();
  await run({ kind: "tx", deployment: "testusd", tx: TX }, chain([transfer(config.TESTUSD, PAYER, IDARA, 5_000_000n)]), subsFor([{ account: IDARA }]).store, 201, ENV, failing);
  assert.equal(asked, 1);
});

test("a read of the chain that fails answers 503 try again, marks nothing handled, and the retry is handled in full", async () => {
  const { store } = subsFor([{ account: IDARA }]);
  const logs = [transfer(config.AUSD, PAYER, IDARA, 5_000_000n)];
  for (const broken of ["finalized", "blockTime", "members"] as const) {
    forgetRecent();
    const flaky = chain(logs);
    let fail = true;
    const once = <T,>(f: () => Promise<T>) => () => (fail ? Promise.reject(new Error("The request took too long to respond.")) : f());
    const c: NotifyChain = { ...flaky, [broken]: (...args: unknown[]) => once(() => (flaky[broken] as (...a: unknown[]) => Promise<unknown>)(...args))() } as NotifyChain;
    // Members is read only for pot events: a chip-in makes it count.
    const body = { kind: "tx", deployment: "ausd", tx: TX };
    if (broken === "members") (c as { receipt: NotifyChain["receipt"] }).receipt = async () => ({ status: "success", blockNumber: 100n, from: PAYER, logs: [...logs, funded(1n, PAYER, 5_000_000n)] });
    const first = await run(body, c, store);
    assert.equal(first.status, 503, broken);
    assert.deepEqual(first.body, { error: "could not read the chain, try again" });
    assert.equal(first.sent.length, 0);
    fail = false;
    const second = await run(body, c, store);
    assert.equal(second.status, 200, `${broken}: the retry is handled`);
    assert.ok(second.sent.length >= 1);
    // Handled now: a third call pushes nothing new.
    const third = await run(body, c, store);
    assert.deepEqual([third.status, third.sent.length], [200, 0]);
  }
});
