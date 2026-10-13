/**
 * Reads, read only, the receipt of every hash a timeline's receipt card or a film names,
 * from Monad testnet's public RPC, and writes what the card shows to
 * src/receipts.json: status, block, whether that block is finalized, each
 * ERC-20 Transfer with its token, amount and the last four characters of its
 * recipient. Nothing is signed or sent.
 *
 *   node scripts/read-receipts.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fact, FACTS } from "../src/facts.ts";
import { receiptHashes, summarise, type RawReceipt } from "../src/receipts.ts";
import { loadTimeline, TIMELINE_IDS } from "./guard.ts";

const RPC_URL = "https://testnet-rpc.monad.xyz";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error || body.result === undefined) throw new Error(`${method}: ${body.error?.message ?? "no result"}`);
  return body.result;
}

/** The receipts the films show (src/films/). */
const FILM_RECEIPTS = ["hashes.take.send", "hashes.take.swap", "hashes.showcase.send", "hashes.showcase.swap"];
const hashes = [...new Set([...receiptHashes(TIMELINE_IDS.map(loadTimeline), (p) => fact(p) ?? null), ...FILM_RECEIPTS.map((p) => fact(p)).filter((h): h is string => !!h)])];
const finalized = await rpc<{ number: string }>("eth_getBlockByNumber", ["finalized", false]);
const out: Record<string, ReturnType<typeof summarise>> = {};
for (const hash of hashes) {
  const raw = await rpc<RawReceipt | null>("eth_getTransactionReceipt", [hash]);
  if (!raw) throw new Error(`no receipt for ${hash}`);
  out[hash] = summarise(raw, Number(BigInt(finalized.number)), FACTS.contracts);
}
const file = join(import.meta.dirname, "..", "src", "receipts.json");
writeFileSync(file, JSON.stringify({ source: "Monad testnet, eth_getTransactionReceipt", readAt: new Date().toISOString(), finalizedHead: Number(BigInt(finalized.number)), receipts: out }, null, 2) + "\n");
console.log(`wrote ${Object.keys(out).length} receipts to src/receipts.json`);
