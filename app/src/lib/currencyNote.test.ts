import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { otherCurrencyNote } from "./currencyNote.ts";

const source = (name: string) => readFileSync(new URL(`../screens/${name}.tsx`, import.meta.url), "utf8");

test("the CTK line names it a test currency from Agora (copy.test.ts checks it for banned words)", () => {
  const line = otherCurrencyNote(["CTK"]);
  assert.equal(line, "CTK is a test currency from Agora. In test mode it stands in for a local currency, at a fixed rate Agora sets.");
});

test("the line shows only once a currency other than dollars is on screen", () => {
  assert.equal(otherCurrencyNote([]), null);
  assert.equal(otherCurrencyNote([null, undefined, "$"]), null);
  assert.match(otherCurrencyNote(["$", undefined, "CTK"])!, /^CTK is a test currency/);
});

/**
 * Wherever CTK is first shown, the line is there: the sender's currency
 * choice (as soon as the choice is on screen, before CTK is picked), and the
 * recipient's Payments in. The confirm sheet, the button and the receipt
 * come after the currency choice on the same screen.
 */
test("the explanation is next to CTK wherever a person first sees it", () => {
  const send = source("Send");
  const choice = send.slice(send.indexOf('className="currency-choice"'), send.indexOf("</div>\n                )}", send.indexOf('className="currency-choice"')));
  assert.ok(choice.includes("otherCurrencyNote([otherSymbol])"), "Send: the line sits in the currency choice");
  assert.ok(!/currency === "other" && .*otherCurrencyNote/.test(choice), "Send: the line doesn't wait for CTK to be picked");
  const receive = source("Receive");
  assert.ok(receive.includes("otherCurrencyNote(payments.map("), "Receive: the line shows with a payment in another currency");
});
