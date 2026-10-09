import { test } from "node:test";
import assert from "node:assert/strict";
import { RECEIPT_EXPLORER, ReceiptStore, receiptUrl } from "./receipts.ts";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
}

const A = "0x1a9a136f1cf59899c6b8cfe84ac4df388620467d";
const B = "0x0710Ade1Cf20E4A85a775c3A01dfdAead0579B20";
const H1 = `0x${"ab".repeat(32)}` as const;
const H2 = `0x${"cd".repeat(32)}` as const;

test("a receipt opens the transaction on the explorer the contracts are verified on", () => {
  assert.equal(RECEIPT_EXPLORER, "https://testnet.monadvision.com");
  assert.equal(receiptUrl(H1), `https://testnet.monadvision.com/tx/${H1}`);
});

test("each account keeps only its latest receipt, whatever the address casing", () => {
  const store = new ReceiptStore(memory());
  assert.equal(store.latest(B), undefined);
  store.remember(A as `0x${string}`, H1);
  store.remember(A.toUpperCase().replace("0X", "0x") as `0x${string}`, H2);
  assert.equal(store.latest(A as `0x${string}`), H2);
  assert.equal(store.latest(B), undefined);
});

test("only a hash and the account are stored", () => {
  const kv = memory();
  new ReceiptStore(kv).remember(B, H1);
  assert.deepEqual([...kv.raw.values()], [H1]);
  assert.deepEqual([...kv.raw.keys()], [`nivpay.receipt.v1.${B}`]);
});

test("anything stored that is not a transaction hash is ignored", () => {
  const kv = memory();
  kv.setItem(`nivpay.receipt.v1.${B}`, "not a hash");
  assert.equal(new ReceiptStore(kv).latest(B), undefined);
  kv.setItem(`nivpay.receipt.v1.${B}`, "0x1234");
  assert.equal(new ReceiptStore(kv).latest(B), undefined);
});
