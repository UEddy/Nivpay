import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Address, Hex } from "viem";
import { BroadcastRefused, followToFinality, onSendAnswer, replace, submit, type PendingWrite, type SendAnswer, type Timing, type WriteChain, type WriteStore } from "./writes.ts";
import { logSend, recentSends, sendKind, SENDS_KEPT } from "./sendLog.ts";

// Recording each broadcast's answer (writes.ts onSendAnswer) must change nothing about sending: the same calls
// to the chain in the same order, the same store operations, the same outcome, with or without a recorder, and
// even with one that throws.

const ME = "0x1A9A136f1cf59899C6b8cfE84ac4df388620467d" as Address;
const HASH = `0x${"11".repeat(32)}` as Hex;

afterEach(() => onSendAnswer(null));

type Script = { answers: ("ok" | "refuse" | "drop")[]; receiptAfterPolls?: number; finalizedNonce?: number };

/** One run, traced: every chain call and store operation in order, and the outcome. */
async function run(script: Script, mode: "none" | "record" | "throw") {
  const trace: string[] = [];
  const recorded: SendAnswer[] = [];
  if (mode === "record") onSendAnswer((a) => recorded.push(a));
  if (mode === "throw")
    onSendAnswer(() => {
      throw new Error("recorder broke");
    });
  else if (mode === "none") onSendAnswer(null);
  const map = new Map<string, PendingWrite>();
  const store: WriteStore = {
    get: async (a) => (trace.push(`get ${a}`), map.get(a)),
    put: async (w) => void (trace.push(`put ${w.nonce} ${w.replaceable} ${JSON.stringify(Object.keys(w).sort())}`), map.set(w.address, w)),
    delete: async (a) => void (trace.push(`delete ${a}`), map.delete(a)),
  };
  let sends = 0;
  let polls = 0;
  const chain: WriteChain = {
    async sendRawTransaction(raw) {
      const a = script.answers[Math.min(sends, script.answers.length - 1)];
      sends++;
      trace.push(`send ${raw} ${a}`);
      if (a === "refuse") throw new BroadcastRefused(Object.assign(new Error("insufficient balance for transfer\nRequest body: {...}"), { shortMessage: "insufficient balance for transfer" }));
      if (a === "drop") throw new Error("fetch failed");
      return HASH;
    },
    async getReceipt() {
      polls++;
      trace.push(`receipt ${polls}`);
      return script.receiptAfterPolls !== undefined && polls > script.receiptAfterPolls ? { blockNumber: 100n, status: "success" as const } : null;
    },
    getFinalizedBlockNumber: async () => (trace.push("finalized"), 1_000n),
    getNonce: async (_a, tag) => (trace.push(`nonce ${tag}`), tag === "finalized" ? (script.finalizedNonce ?? 5) : 5),
    isInBlock: async () => (trace.push("inBlock"), false),
  };
  let t = 0;
  const timing: Timing = { now: () => t, sleep: async (ms) => void (t += ms), pollMs: 400, rebroadcastEveryMs: 2_000, stuckAfterMs: 20_000 };
  const w: PendingWrite = { address: ME, nonce: 5, raw: "0xaa01", hash: HASH, label: "send 1", submittedAt: 0, replaceable: false };
  await submit(store, chain, w);
  const outcome = await followToFinality(store, chain, w, timing);
  return { trace, outcome, stored: map.get(ME) ?? null, recorded };
}

const SCRIPTS: Record<string, Script> = {
  "taken, then final": { answers: ["ok"], receiptAfterPolls: 3 },
  "dropped a few times, then final": { answers: ["drop", "drop", "ok"], receiptAfterPolls: 25 },
  "turned down twice: stuck and refused": { answers: ["refuse"] },
  "never answered: stuck by time": { answers: ["drop"] },
  "taken but never included: stuck by time": { answers: ["ok"] },
  "superseded: the nonce went elsewhere": { answers: ["ok"], finalizedNonce: 6 },
};

for (const [name, script] of Object.entries(SCRIPTS)) {
  test(`unchanged with a recorder, and with a broken one: ${name}`, async () => {
    const plain = await run(script, "none");
    const recorded = await run(script, "record");
    const broken = await run(script, "throw");
    for (const other of [recorded, broken]) {
      assert.deepEqual(other.trace, plain.trace, "the same chain calls and store operations, in the same order");
      assert.deepEqual(other.outcome, plain.outcome);
      assert.deepEqual(other.stored, plain.stored, "the pending write is stored exactly as before: nothing added to it");
    }
    const broadcasts = plain.trace.filter((l) => l.startsWith("send ")).length;
    assert.equal(recorded.recorded.length, broadcasts, "one answer per broadcast");
    for (const a of recorded.recorded) {
      assert.equal(a.hash, HASH);
      assert.equal(a.address, ME);
      assert.ok(!JSON.stringify(a).includes("0xaa01"), "the raw transaction isn't in the record");
    }
  });
}

test("each answer says what came back, in short: accepted, refused with the reason's first line, or no answer", async () => {
  const { recorded } = await run({ answers: ["drop", "refuse", "ok"], receiptAfterPolls: 20 }, "record");
  assert.deepEqual(recorded.slice(0, 3).map((a) => a.result), ["no answer: fetch failed", "refused: insufficient balance for transfer", "accepted"]);
  assert.ok(recorded.every((a, i) => i === 0 || a.at >= recorded[i - 1]!.at), "in time order");
});

test("a replacement's broadcast is recorded too, and replace behaves as before", async () => {
  const got: SendAnswer[] = [];
  onSendAnswer((a) => got.push(a));
  const map = new Map<string, PendingWrite>();
  const store: WriteStore = { get: async (a) => map.get(a), put: async (w) => void map.set(w.address, w), delete: async (a) => void map.delete(a) };
  map.set(ME, { address: ME, nonce: 5, raw: "0xaa01", hash: HASH, label: "send 1", submittedAt: 0, replaceable: true });
  const chain = { sendRawTransaction: async () => HASH } as unknown as WriteChain;
  const next: PendingWrite = { address: ME, nonce: 5, raw: "0xbb02", hash: `0x${"22".repeat(32)}`, label: "send 1", submittedAt: 1, replaceable: false };
  await replace(store, chain, next);
  assert.deepEqual(map.get(ME), { ...next, replaceable: false });
  assert.deepEqual(got.map((a) => [a.hash, a.result]), [[next.hash, "accepted"]]);
});

test("the log keeps the last few per account, for Get help", () => {
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
  const other = "0x2222222222222222222222222222222222222222" as Address;
  for (let i = 0; i < SENDS_KEPT + 3; i++) logSend(store, { address: ME, hash: HASH, at: i, result: i % 2 ? "accepted" : "refused: nope" });
  logSend(store, { address: other, hash: HASH, at: 99, result: "no answer: x" });
  const mine = recentSends(store, ME);
  assert.equal(mine.length, SENDS_KEPT);
  assert.deepEqual(mine.map((s) => s.at), [3, 4, 5, 6, 7], "the oldest went first");
  assert.equal(recentSends(store, other).length, 1);
  assert.deepEqual(["accepted", "refused: nope", "no answer: x"].map(sendKind), ["accepted", "refused", "unanswered"]);
  kv.set("nivpay.sendlog.v1", "{");
  assert.deepEqual(recentSends(store, ME), [], "damaged storage reads as nothing");
});

test("the username screen says 56 when the node turned the claim down twice, and 51 when it was never included", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../screens/Username.tsx", import.meta.url), "utf8");
  const stuck = src.slice(src.indexOf('outcome.kind === "stuck"'), src.indexOf("} else {", src.indexOf('outcome.kind === "stuck"')));
  assert.match(stuck, /outcome\.refused \? \{[^}]*code: ERROR_CODES\.REFUSED \}/);
  assert.match(stuck, /: \{[^}]*code: ERROR_CODES\.STUCK \}/);
});
