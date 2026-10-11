import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, hasEmail, hasPhoneNumber, pad } from "./sensitive.ts";

// Made-up examples only: no real address, number or name belongs in this file.
test("email addresses are caught, whole or cut short; a lone @ icon is not", () => {
  for (const t of ["someone@example.com", "first.last+tag@mail.example.org", "...meone@gmail.com", "ab@gmail"]) assert.ok(hasEmail(t), t);
  for (const t of ["(a 9 nivpay.vercel.app + @ ©", "@ Search", "Pay Eddy on NivPay."]) assert.equal(hasEmail(t), false, t);
});

test("phone-number-like runs are caught; money, times, IDs and links are not", () => {
  for (const t of ["+234 809 041 8099", "0809 041 8099", "(555) 010-0199", "07700 900123"]) assert.ok(hasPhoneNumber(t), t);
  for (const t of [
    "$19,100.00", "$10,000.00 test dollars", "#70106701 28 Block Confirmations", "Oct-11-2026 13:04:48",
    "0xa5057F32DB2a6f68F69ad1587014AbF101A20B61", "nivpay.vercel.app/#aecaa4s4ttlvwlemfgxl62qu52", "1:12", "Settled in 1.3s.",
    "11 12 13 14 15 16 17", "1 2 3 4 5 6 7 8 9 0",
  ]) assert.equal(hasPhoneNumber(t), false, t);
});

test("classify returns categories and boxes only, never the text", () => {
  const hits = classify([{ text: "someone@example.com", box: { x: 0.1, y: 0.2, w: 0.3, h: 0.02 } }], ["nobody-on-the-list"]);
  assert.deepEqual(hits, [{ category: "email address", box: { x: 0.1, y: 0.2, w: 0.3, h: 0.02 } }]);
  assert.equal(JSON.stringify(hits).includes("someone"), false);
});

test("a denylisted string is caught case-insensitively and reported only as 'denylist'", () => {
  const hits = classify([{ text: "Hello EXAMPLENAME here", box: { x: 0, y: 0, w: 1, h: 0.1 } }], ["examplename"]);
  assert.deepEqual(hits.map((h) => h.category), ["denylist"]);
});

test("padding grows a box by a fraction of its size on every side, clamped to the frame", () => {
  const b = pad({ x: 0.5, y: 0.5, w: 0.2, h: 0.1 }, 0.1);
  assert.ok(Math.abs(b.x - 0.48) < 1e-9 && Math.abs(b.w - 0.24) < 1e-9 && Math.abs(b.y - 0.49) < 1e-9 && Math.abs(b.h - 0.12) < 1e-9);
  assert.deepEqual(pad({ x: 0, y: 0, w: 1, h: 1 }, 0.1), { x: 0, y: 0, w: 1, h: 1 });
});
