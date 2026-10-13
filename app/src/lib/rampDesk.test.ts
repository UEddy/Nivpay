import { test } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { ERROR_CODES } from "../copy.ts";
import { AppError } from "./errors.ts";
import { askStatement, askToBuy, cashOutLabel, deskFailure, fromCashOutLabel, readDesk } from "./rampDesk.ts";

const DESK = "0x7EAf7f3e330ac388A0e951e80957B7274597297c";
const ME = "0x1A9A136f1cf59899C6b8cfE84ac4df388620467d";
const TX = ("0x" + "11".repeat(32)) as Hex;

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test("a cash out's label carries the desk, the amount and the currency, and nothing else", () => {
  const label = cashOutLabel(DESK, 50_000_000n, "NGN");
  assert.equal(label, `cashout ${DESK} 50000000 NGN`);
  assert.deepEqual(fromCashOutLabel(label), { desk: DESK, amount: 50_000_000n, currency: "NGN" });
  for (const bad of ["send x 1", `cashout ${DESK} 1.5 NGN`, `cashout nope 1 NGN`, `cashout ${DESK} 1 naira`, `cashout ${DESK} 1 NGN extra`]) assert.equal(fromCashOutLabel(bad), null, bad);
});

test("the desk's refusals become codes people can read", () => {
  assert.equal(deskFailure(503, { error: "the test desk is paused" }, "buy").code, ERROR_CODES.RAMP_PAUSED);
  assert.equal(deskFailure(409, { error: "this account already holds $1,000 or more" }, "buy").code, ERROR_CODES.RAMP_REFUSED);
  assert.equal(deskFailure(400, { error: "over $100" }, "buy").code, ERROR_CODES.RAMP_REFUSED);
  assert.equal(deskFailure(502, { code: "SEND_FAILED" }, "buy").code, ERROR_CODES.RAMP_FAILED);
  assert.equal(deskFailure(502, { code: "RPC_FAILED" }, "cashout").code, ERROR_CODES.CASHOUT_STATEMENT);
  assert.equal(deskFailure(503, {}, "cashout").code, ERROR_CODES.RAMP_PAUSED);
});

test("an unreachable desk is code 63, and nothing is claimed", async () => {
  const offline = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(askToBuy(ME, "NGN", 1n, offline), (e: unknown) => e instanceof AppError && e.code === ERROR_CODES.RAMP_UNREACHABLE);
});

test("the desk info is read, and an off or broken desk is not enabled", async () => {
  assert.deepEqual(await readDesk(reply(200, { enabled: true, desk: DESK })), { enabled: true, desk: DESK });
  assert.equal((await readDesk(reply(200, { enabled: false, desk: DESK }))).enabled, false);
  assert.equal((await readDesk(reply(200, { enabled: true, desk: "nope" }))).enabled, false);
  assert.equal((await readDesk(reply(500, { enabled: true, desk: DESK }))).enabled, false);
});

test("a buy sends only the currency, the local amount and the account", async () => {
  let sent: unknown;
  const fetcher = async (_url: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ hash: TX, received: "49500000" }), { status: 200 });
  };
  assert.deepEqual(await askToBuy(ME, "NGN", 7_750_000n, fetcher), { hash: TX, received: 49_500_000n });
  assert.deepEqual(sent, { kind: "buy", address: ME, currency: "NGN", amount: "7750000" });
});

test("the statement is asked again while the desk's read lags, then read", async () => {
  let calls = 0;
  let sent: unknown;
  const fetcher = async (_url: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    calls++;
    if (calls < 3) return new Response(JSON.stringify({ error: "that transaction isn't final yet" }), { status: 409 });
    return new Response(JSON.stringify({ simulated: true, currency: "NGN", dollars: "50000000", fee: "500000", bankGets: "7672500", reference: "NVP-7K3QX9" }), { status: 200 });
  };
  const s = await askStatement(ME, "NGN", TX, fetcher, async () => {});
  assert.equal(calls, 3);
  assert.deepEqual(s, { currency: "NGN", dollars: 50_000_000n, fee: 500_000n, bankGets: 7_672_500n, reference: "NVP-7K3QX9" });
  assert.deepEqual(sent, { kind: "cashout", address: ME, currency: "NGN", tx: TX }, "no bank details");
  let tries = 0;
  const never = async () => (tries++, new Response(JSON.stringify({ error: "that transaction isn't final yet" }), { status: 409 }));
  await assert.rejects(askStatement(ME, "NGN", TX, never, async () => {}), (e: unknown) => e instanceof AppError && e.code === ERROR_CODES.CASHOUT_STATEMENT);
  assert.equal(tries, 6);
});
