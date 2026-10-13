/**
 * What a receipt card shows, read from the chain by scripts/read-receipts.ts
 * into receipts.json. Every number on the card comes from that file, never
 * typed in.
 */
import type { Timeline } from "./timeline.ts";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type RawReceipt = { status: string; blockNumber: string; logs: { address: string; topics: string[]; data: string }[] };

export type Transfer = { token: string; amount: string; toLastFour: string };
export type Receipt = { status: "success" | "reverted"; block: number; finalized: boolean; transfers: Transfer[] };
export type Receipts = { source: string; readAt: string; finalizedHead: number; receipts: Record<string, Receipt> };

/** Token symbols and decimals for the contracts the app uses. */
const TOKENS: Record<string, { symbol: string; decimals: number }> = { ausd: { symbol: "AUSD", decimals: 6 }, ctk: { symbol: "CTK", decimals: 18 } };

/** An integer amount of base units as a decimal with two places, rounded down, without a float. */
export function units(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const cents = ((value % scale) * 100n) / scale;
  return `${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

export function summarise(raw: RawReceipt, finalizedHead: number, contracts: Record<string, string>): Receipt {
  const block = Number(BigInt(raw.blockNumber));
  const byAddress = new Map(Object.entries(contracts).filter(([k]) => k in TOKENS).map(([k, a]) => [a.toLowerCase(), TOKENS[k]!]));
  const transfers = raw.logs
    .filter((l) => l.topics[0] === TRANSFER && l.topics.length === 3)
    .map((l) => {
      const token = byAddress.get(l.address.toLowerCase());
      if (!token) throw new Error(`a Transfer from an unknown token ${l.address}`);
      return { token: token.symbol, amount: units(BigInt(l.data), token.decimals), toLastFour: l.topics[2]!.slice(-4).toUpperCase() };
    });
  return { status: raw.status === "0x1" ? "success" : "reverted", block, finalized: block <= finalizedHead, transfers };
}

/** The hashes every receipt card in these timelines names, in order, once each. */
export function receiptHashes(timelines: Timeline[], fact: (path: string) => string | null): string[] {
  const out: string[] = [];
  for (const t of timelines) {
    for (const s of t.segments) {
      if (s.kind !== "receipt" || !s.receipt) continue;
      const h = fact(s.receipt);
      if (!h) throw new Error(`${t.id} ${s.id}: ${s.receipt} has no hash`);
      if (!out.includes(h)) out.push(h);
    }
  }
  return out;
}
