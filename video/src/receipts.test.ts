import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fact, FACTS } from "./facts.ts";
import { receiptHashes, summarise, units, type Receipts } from "./receipts.ts";
import type { Timeline } from "./timeline.ts";

const timelines = ["agora-bounty", "technical-demo", "x-launch"].map((id) => JSON.parse(readFileSync(new URL(`../timelines/${id}.json`, import.meta.url), "utf8")) as Timeline);
const file = JSON.parse(readFileSync(new URL("./receipts.json", import.meta.url), "utf8")) as Receipts;

test("amounts are read from base units without a float", () => {
  assert.equal(units(25_000_000n, 6), "25.00");
  assert.equal(units(50n * 10n ** 18n, 18), "50.00");
  assert.equal(units(1_234_567_891n, 6), "1,234.56");
});

test("a receipt is summarised as status, block, finalized and each Transfer's token, amount and recipient's last four", () => {
  const transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const r = summarise(
    { status: "0x1", blockNumber: "0x10", logs: [{ address: FACTS.contracts.ausd.toLowerCase(), topics: [transfer, `0x${"0".repeat(24)}${"a".repeat(40)}`, `0x${"0".repeat(24)}${"b".repeat(36)}562c`], data: "0x17d7840" }] },
    20,
    FACTS.contracts,
  );
  assert.deepEqual(r, { status: "success", block: 16, finalized: true, transfers: [{ token: "AUSD", amount: "25.00", toLastFour: "562C" }] });
  assert.equal(summarise({ status: "0x1", blockNumber: "0x10", logs: [] }, 15, FACTS.contracts).finalized, false);
});

test("receipts.json holds every receipt the timelines show, read from the chain: the take's send is one Transfer of the take's amount to its recipient", () => {
  const hashes = receiptHashes(timelines, (p) => fact(p) ?? null);
  assert.ok(hashes.length > 0);
  for (const h of hashes) {
    const r = file.receipts[h];
    assert.ok(r, h);
    assert.equal(r.status, "success", h);
    assert.equal(r.finalized, true, h);
  }
  const send = file.receipts[FACTS.hashes.take.send!]!;
  assert.deepEqual(send.transfers, [{ token: "AUSD", amount: `${FACTS.bounty.send.slice(1)}.00`, toLastFour: FACTS.measured.recipientLastFour!.toUpperCase() }]);
  assert.deepEqual(file.receipts[FACTS.hashes.showcase.send]!.transfers.map((t) => `${t.amount} ${t.token}`), ["50.00 AUSD"]);
});
