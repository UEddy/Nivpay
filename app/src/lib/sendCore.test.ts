import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Cancellable, CancelledError } from "./cancel.ts";
import { sendSequence, sendWrite, type Fees, type SendDeps, type Step } from "./sendCore.ts";
import type { PendingWrite } from "./writes.ts";

// A throwaway key, only ever used here.
const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const FROM = signer.address;
const TO = "0x0710Ade1Cf20E4A85a775c3A01dfdAead0579B20" as Address;

function gate<T>() {
  let open!: (v: T) => void;
  const promise = new Promise<T>((r) => (open = r));
  return { promise, open };
}

/** Every read waits until the test lets it answer. `log` is what the flow did, in order. */
function harness() {
  const log: string[] = [];
  const reads = { nonce: gate<number>(), fees: gate<Fees>(), estimate: gate<bigint>(), grant: gate<void>() };
  const saved: PendingWrite[] = [];
  const deps: SendDeps = {
    store: {
      get: async () => undefined,
      put: async (w) => void saved.push(w),
      delete: async () => {},
    },
    chain: {
      getNonce: () => (log.push("nonce"), reads.nonce.promise),
      sendRawTransaction: async () => void log.push("broadcast"),
      getReceipt: async () => null,
      getFinalizedBlockNumber: async () => 0n,
      isInBlock: async () => false,
    },
    fees: () => (log.push("fees"), reads.fees.promise),
    estimate: () => (log.push("estimate"), reads.estimate.promise),
    ensureGas: () => (log.push("gas grant"), reads.grant.promise),
    withSigner: async (expected, sign) => {
      log.push("passkey");
      assert.equal(expected, FROM);
      return sign(signer);
    },
    estimateGas: async () => 50_000n,
    getBalance: async () => 10n ** 18n,
  };
  const answers: Record<string, () => void> = {
    nonce: () => reads.nonce.open(7),
    fees: () => reads.fees.open({ maxFeePerGas: 100n, maxPriorityFeePerGas: 1n }),
    estimate: () => reads.estimate.open(21_000n),
    "gas grant": () => reads.grant.open(),
  };
  const answerAll = () => Object.values(answers).forEach((a) => a());
  /** Answers every read that comes before `phase`, so the flow gets as far as waiting on it. */
  const answerBefore = (phase: string) => PHASES.slice(0, PHASES.indexOf(phase)).forEach((p) => answers[p]!());
  return { deps, log, saved, answerAll, answerBefore };
}

const PHASES = ["nonce", "fees", "estimate", "gas grant"];

/** Lets pending promise callbacks run until `seen` is in the log. */
async function until(log: string[], seen: string) {
  for (let i = 0; i < 1000 && !log.includes(seen); i++) await new Promise((r) => setImmediate(r));
  assert.ok(log.includes(seen), `reached ${seen}`);
}

const call = (signal: AbortSignal, steps: Step[]) => ({ from: FROM, to: TO, data: "0x1234" as Hex, label: "test", signal, onStep: (s: Step) => void steps.push(s) });

test("with no X, the flow reaches the passkey and sends", async () => {
  const h = harness();
  const steps: Step[] = [];
  const pending = sendWrite(h.deps, call(new AbortController().signal, steps));
  h.answerAll();
  const write = await pending;
  assert.equal(write.nonce, 7);
  assert.deepEqual(h.log.slice(0, 2).sort(), ["fees", "nonce"], "asked together");
  assert.deepEqual(h.log.slice(2), ["estimate", "gas grant", "passkey", "broadcast"]);
  assert.deepEqual(steps, ["preparing", "getting-ready", "confirm", "sending"]);
});

for (const at of PHASES) {
  test(`X while waiting on ${at}: the passkey is never asked for, even when the reads answer later, and nothing is sent`, async () => {
    const h = harness();
    const steps: Step[] = [];
    const x = new AbortController();
    const pending = sendWrite(h.deps, call(x.signal, steps));
    h.answerBefore(at);
    await until(h.log, at);
    x.abort();
    h.answerAll();
    await assert.rejects(pending, CancelledError);
    assert.ok(!h.log.includes("passkey"), "no passkey prompt");
    assert.ok(!h.log.includes("broadcast"), "nothing broadcast");
    assert.equal(h.saved.length, 0, "nothing saved as in flight");
    assert.ok(!steps.includes("confirm"), "the screen never showed the passkey step");
  });
}

test("a sequence stopped before the passkey never asks for it either", async () => {
  for (const at of PHASES) {
    const h = harness();
    const x = new AbortController();
    const pending = sendSequence(h.deps, FROM, [{ to: TO, data: "0x12", label: "a" }, { to: TO, data: "0x34", label: "b", gas: 60_000n }], undefined, false, x.signal);
    h.answerBefore(at);
    await until(h.log, at);
    x.abort();
    h.answerAll();
    await assert.rejects(pending, CancelledError);
    assert.ok(!h.log.includes("passkey") && !h.log.includes("broadcast"), at);
  }
});

test("X after the passkey step has begun changes nothing: the signed request is still sent", async () => {
  const h = harness();
  const x = new AbortController();
  const deps: SendDeps = {
    ...h.deps,
    withSigner: async (expected, sign) => {
      x.abort();
      return h.deps.withSigner(expected, sign);
    },
  };
  const pending = sendWrite(deps, call(x.signal, []));
  h.answerAll();
  await pending;
  assert.ok(h.log.includes("broadcast"));
});

test("Cancellable: X stops an action before the passkey, never after, and a closed screen stops it", () => {
  const running = new Cancellable();
  const first = running.start();
  const steps: string[] = [];
  const onStep = first.track((s: string) => void steps.push(s));
  onStep("preparing");
  assert.equal(running.cancel(), true);
  assert.equal(first.signal.aborted, true);
  assert.equal(running.cancel(), false, "nothing left to stop");

  const second = running.start();
  second.track(() => {})("confirm");
  assert.equal(running.cancel(), false, "at the passkey it can no longer be called stopped");
  assert.equal(second.signal.aborted, false);

  const third = running.start();
  running.dispose();
  assert.equal(third.signal.aborted, true);
});

test("Pour in, Send, Ask, Say yes, Close and Take share pass their X to the send flow", () => {
  const read = (f: string) => readFileSync(join(import.meta.dirname, "..", "screens", f), "utf8");
  const screens: Record<string, number> = { "ChipIn.tsx": 1, "Send.tsx": 2, "Ask.tsx": 1, "Request.tsx": 1, "Close.tsx": 1 };
  for (const [file, sends] of Object.entries(screens)) {
    const text = read(file);
    assert.match(text, /useCancellable\(\)/, file);
    assert.equal(text.match(/signal: run\.signal|run\.signal\)/g)?.length, sends, `${file}: every send carries the signal`);
    assert.match(text, /beforePasskey\(/, `${file}: X stops it before the passkey`);
    assert.match(text, /STOPPED/, `${file}: and says nothing was sent`);
  }
});

test("the nonce, the fees and the permit terms are asked for at the same time, not one after another", async () => {
  const h = harness();
  let terms = false;
  const pending = sendWrite(h.deps, {
    ...call(new AbortController().signal, []),
    presign: {
      gasHint: 90_000n,
      ready: async () => {
        h.log.push("permit terms");
        terms = true;
      },
      build: async () => (assert.ok(terms, "built from the terms read before"), "0xabcd" as Hex),
    },
  });
  await until(h.log, "nonce");
  assert.deepEqual([...h.log].sort(), ["fees", "nonce", "permit terms"], "all three asked before any answered");
  h.answerAll();
  await pending;
  assert.ok(!h.log.includes("estimate"), "a pour-in's gas comes from its hint, then the real data");
});
