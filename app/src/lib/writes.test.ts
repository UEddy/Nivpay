import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address, Hex } from "viem";
import {
  followSequence,
  followToFinality,
  nonceForNewWrite,
  nonceForReplacement,
  replace,
  submit,
  BroadcastRefused,
  WriteInFlightError,
  type PendingWrite,
  type Timing,
  type WriteChain,
  type WriteStore,
} from "./writes.ts";

const ME = "0x1A9A136f1cf59899C6b8cfE84ac4df388620467d" as Address;

function memoryStore(): WriteStore & { map: Map<string, PendingWrite> } {
  const map = new Map<string, PendingWrite>();
  return {
    map,
    get: async (a) => map.get(a),
    put: async (w) => void map.set(w.address, w),
    delete: async (a) => void map.delete(a),
  };
}

/** A scripted chain. Every raw broadcast is recorded. */
function fakeChain(opts: {
  failBroadcasts?: number;
  receiptAfterPolls?: number;
  receiptBlock?: bigint;
  status?: "success" | "reverted";
  finalized?: (poll: number) => bigint;
  finalizedNonce?: number;
  pendingNonce?: number;
  inBlock?: boolean;
}) {
  const broadcasts: Hex[] = [];
  let polls = 0;
  let failures = opts.failBroadcasts ?? 0;
  const chain: WriteChain = {
    async sendRawTransaction(raw) {
      broadcasts.push(raw);
      if (failures > 0) {
        failures--;
        throw new Error("network");
      }
      return "0x";
    },
    async getReceipt() {
      polls++;
      if (opts.receiptAfterPolls === undefined || polls <= opts.receiptAfterPolls) return null;
      return { blockNumber: opts.receiptBlock ?? 100n, status: opts.status ?? "success" };
    },
    async getFinalizedBlockNumber() {
      return opts.finalized ? opts.finalized(polls) : 1_000n;
    },
    async getNonce(_a, tag) {
      return tag === "finalized" ? (opts.finalizedNonce ?? 5) : (opts.pendingNonce ?? 5);
    },
    async isInBlock() {
      return opts.inBlock ?? false;
    },
  };
  return { chain, broadcasts };
}

function clock(stepMs = 400): Timing {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += ms), pollMs: stepMs, rebroadcastEveryMs: 2_000, stuckAfterMs: 20_000 };
}

function write(raw: Hex = "0xaa01", nonce = 5): PendingWrite {
  return { address: ME, nonce, raw, hash: `0x${"11".repeat(32)}`, label: "pour in", submittedAt: 0, replaceable: false };
}

test("the record is saved before the first broadcast, and retries re-send the identical bytes", async () => {
  const store = memoryStore();
  const { chain, broadcasts } = fakeChain({ failBroadcasts: 3, receiptAfterPolls: 20 });
  let savedBeforeBroadcast = false;
  const wrapped: WriteChain = {
    ...chain,
    sendRawTransaction: async (raw) => {
      if (broadcasts.length === 0) savedBeforeBroadcast = store.map.has(ME);
      return chain.sendRawTransaction(raw);
    },
  };
  const w = write();
  await submit(store, wrapped, w);
  const outcome = await followToFinality(store, wrapped, w, clock());
  assert.equal(outcome.kind, "final");
  assert.ok(savedBeforeBroadcast, "record must exist before the first broadcast");
  assert.ok(broadcasts.length >= 3, "retried after failures");
  assert.ok(broadcasts.every((b) => b === w.raw), "every retry is the same signed bytes");
  assert.equal(store.map.size, 0, "lock released once final");
});

test("a second write for the same account is refused while one is pending", async () => {
  const store = memoryStore();
  const { chain } = fakeChain({});
  await submit(store, chain, write());
  await assert.rejects(submit(store, chain, write("0xbb02", 6)), WriteInFlightError);
  await assert.rejects(nonceForNewWrite(store, chain, ME), WriteInFlightError);
});

test("success is reported only once the receipt's block is finalized", async () => {
  const store = memoryStore();
  // Receipt in block 100 from the 2nd poll; finalized reaches 100 only at poll 10.
  const { chain } = fakeChain({ receiptAfterPolls: 1, receiptBlock: 100n, finalized: (p) => (p >= 10 ? 100n : 99n) });
  const w = write();
  await submit(store, chain, w);
  let polls = 0;
  const counting: WriteChain = { ...chain, getReceipt: async (h) => (polls++, chain.getReceipt(h)) };
  const outcome = await followToFinality(store, counting, w, clock());
  assert.equal(outcome.kind, "final");
  assert.ok(polls >= 10, "kept waiting until finalized");
});

test("a reverted transaction releases the lock and says so", async () => {
  const store = memoryStore();
  const { chain } = fakeChain({ receiptAfterPolls: 0, status: "reverted" });
  const w = write();
  await submit(store, chain, w);
  assert.equal((await followToFinality(store, chain, w, clock())).kind, "reverted");
  assert.equal(store.map.size, 0);
});

test("stuck: nonce unused at finalized and not in a block, the lock is kept and marked replaceable", async () => {
  const store = memoryStore();
  const { chain } = fakeChain({ finalizedNonce: 5 });
  const w = write();
  await submit(store, chain, w);
  assert.equal((await followToFinality(store, chain, w, clock())).kind, "stuck");
  assert.equal(store.map.get(ME)?.replaceable, true);
  await assert.rejects(nonceForNewWrite(store, chain, ME), WriteInFlightError, "still locked");
});

test("a replacement must reuse the stuck nonce, and a different nonce is refused", async () => {
  const store = memoryStore();
  const { chain, broadcasts } = fakeChain({ finalizedNonce: 5 });
  const w = write("0xaa01", 5);
  await submit(store, chain, w);
  await followToFinality(store, chain, w, clock());
  assert.equal(await nonceForReplacement(store, chain, ME), 5);
  await assert.rejects(replace(store, chain, write("0xcc03", 6)), /reuse nonce 5/);
  await replace(store, chain, write("0xcc03", 5));
  assert.equal(store.map.get(ME)?.raw, "0xcc03");
  assert.equal(broadcasts.at(-1), "0xcc03");
});

test("no replacement while the old transaction is in a block, even an unfinalized one", async () => {
  const store = memoryStore();
  const { chain } = fakeChain({ finalizedNonce: 5 });
  const w = write();
  await submit(store, chain, w);
  await followToFinality(store, chain, w, clock());
  const nowInBlock: WriteChain = { ...chain, isInBlock: async () => true };
  await assert.rejects(nonceForReplacement(store, nowInBlock, ME), /may still go through/);
});

test("no replacement once the nonce is used at finalized", async () => {
  const store = memoryStore();
  const { chain } = fakeChain({ finalizedNonce: 5 });
  const w = write();
  await submit(store, chain, w);
  await followToFinality(store, chain, w, clock());
  const used: WriteChain = { ...chain, getNonce: async () => 6 };
  await assert.rejects(nonceForReplacement(store, used, ME), /may still go through/);
});

test("superseded: the nonce was used by something else at finalized, the lock is released", async () => {
  const store = memoryStore();
  const { chain } = fakeChain({ finalizedNonce: 6 });
  const w = write();
  await submit(store, chain, w);
  assert.equal((await followToFinality(store, chain, w, clock())).kind, "superseded");
  assert.equal(store.map.size, 0);
});

test("a new write takes the pending nonce, only when nothing is in flight", async () => {
  const store = memoryStore();
  const { chain } = fakeChain({ pendingNonce: 9 });
  assert.equal(await nonceForNewWrite(store, chain, ME), 9);
});

// ---------------------------------------------------------------------------
// Sequences: several requests behind one fingerprint
// ---------------------------------------------------------------------------

const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

/** A chain where each hash lands, reverts or never appears, and only after its own bytes were broadcast. */
function sequenceChain(fate: Record<string, "success" | "reverted" | "never">) {
  const broadcasts: Hex[] = [];
  const seenAt = new Map<Hex, number>();
  let tick = 0;
  const chain: WriteChain = {
    async sendRawTransaction(raw) {
      broadcasts.push(raw);
      if (!seenAt.has(raw)) seenAt.set(raw, tick);
      return "0x";
    },
    async getReceipt(hash) {
      tick++;
      const raw = `0x${hash.slice(-4)}` as Hex;
      const f = fate[raw];
      if (!seenAt.has(raw) || f === "never" || !f) return null;
      return { blockNumber: 100n + BigInt(seenAt.get(raw)!), status: f };
    },
    getFinalizedBlockNumber: async () => 10_000n,
    getNonce: async (_a, tag) => (tag === "finalized" ? 5 : 5),
    isInBlock: async () => false,
  };
  return { chain, broadcasts };
}

function sequence(): PendingWrite {
  const step = (n: number) => ({ nonce: 5 + n, raw: `0x${(0xa000 + n).toString(16)}` as Hex, hash: h(0xa000 + n), label: `step ${n}` });
  const first = step(0);
  return { address: ME, ...first, submittedAt: 0, replaceable: false, then: [step(1), step(2)] };
}

test("a sequence broadcasts each step only after the one before it is final", async () => {
  const store = memoryStore();
  const { chain, broadcasts } = sequenceChain({ "0xa000": "success", "0xa001": "success", "0xa002": "success" });
  const started: number[] = [];
  await submit(store, chain, sequence());
  const result = await followSequence(store, chain, sequence(), (s) => started.push(s), clock());
  assert.equal(result.outcome.kind, "final");
  assert.deepEqual([result.step, result.steps], [2, 3]);
  assert.deepEqual(started, [0, 1, 2]);
  assert.deepEqual([...new Set(broadcasts)], ["0xa000", "0xa001", "0xa002"], "in order, each once it was its turn");
  assert.equal(store.map.size, 0, "the lock is released at the end");
});

test("if a step reverts, the steps after it are never broadcast and the lock is released", async () => {
  const store = memoryStore();
  const { chain, broadcasts } = sequenceChain({ "0xa000": "success", "0xa001": "reverted", "0xa002": "success" });
  await submit(store, chain, sequence());
  const result = await followSequence(store, chain, sequence(), undefined, clock());
  assert.deepEqual([result.outcome.kind, result.step], ["reverted", 1]);
  assert.ok(!broadcasts.includes("0xa002"));
  assert.equal(store.map.size, 0);
});

test("if a step sticks, it stays replaceable on its nonce and the unsent rest is dropped", async () => {
  const store = memoryStore();
  const { chain, broadcasts } = sequenceChain({ "0xa000": "never" });
  await submit(store, chain, sequence());
  const result = await followSequence(store, chain, sequence(), undefined, clock());
  assert.deepEqual([result.outcome.kind, result.step], ["stuck", 0]);
  assert.deepEqual([...new Set(broadcasts)], ["0xa000"]);
  const kept = store.map.get(ME)!;
  assert.equal(kept.replaceable, true);
  assert.equal(kept.nonce, 5);
  assert.equal(kept.then, undefined);
});

test("a sequence on nonces that aren't consecutive is refused before the next step is sent", async () => {
  const store = memoryStore();
  const bad = { ...sequence(), then: [{ nonce: 9, raw: "0xa001" as Hex, hash: h(0xa001), label: "x" }] };
  const { chain, broadcasts } = sequenceChain({ "0xa000": "success", "0xa001": "success" });
  await submit(store, chain, bad);
  await assert.rejects(followSequence(store, chain, bad, undefined, clock()), /consecutive/);
  assert.ok(!broadcasts.includes("0xa001"));
});

test("a request the node turns down twice ends early as stuck and refused, and stays replaceable", async () => {
  const store = memoryStore();
  const { chain, broadcasts } = fakeChain({ finalizedNonce: 5 });
  chain.sendRawTransaction = async (raw) => {
    broadcasts.push(raw);
    throw new BroadcastRefused(new Error("insufficient balance"));
  };
  const w = write();
  await submit(store, chain, w);
  const t = clock();
  const outcome = await followToFinality(store, chain, w, t);
  assert.deepEqual(outcome, { kind: "stuck", refused: true });
  assert.ok(t.now() < 20_000, "before the stuck timeout");
  assert.equal(store.map.get(ME)?.replaceable, true);
});

test("a refusal is not given up on while the nonce may still be used, and a dropped request is not called refused", async () => {
  const store = memoryStore();
  const { chain } = fakeChain({ finalizedNonce: 5, inBlock: true });
  let n = 0;
  chain.sendRawTransaction = async () => {
    n++;
    throw new BroadcastRefused(new Error("refused"));
  };
  chain.isInBlock = async () => n < 4;
  const w = write();
  await submit(store, chain, w);
  assert.deepEqual(await followToFinality(store, chain, w, clock()), { kind: "stuck", refused: true });
  assert.ok(n >= 4, "kept going while it was in a block");

  const quiet = fakeChain({ finalizedNonce: 5, failBroadcasts: 100 });
  const s2 = memoryStore();
  await submit(s2, quiet.chain, w);
  assert.deepEqual(await followToFinality(s2, quiet.chain, w, clock()), { kind: "stuck", refused: false }, "no answer is not a refusal");
});
