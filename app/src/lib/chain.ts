import { createPublicClient, http, TransactionNotFoundError, TransactionReceiptNotFoundError, type Hex } from "viem";
import { CHAIN, RPC_URL } from "./config.ts";
import { isBroadcastRefusal, readClient } from "./rpc.ts";
import { BroadcastRefused, type WriteChain } from "./writes.ts";

// Broadcasts go through their own client: one attempt per call, no automatic
// retry. Retrying a broadcast is the write tracker's job, and it only ever
// re-sends the same signed bytes.
const broadcastClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL, { retryCount: 0, timeout: 10_000 }),
  ccipRead: false,
});

export const liveWriteChain: WriteChain = {
  async sendRawTransaction(raw: Hex) {
    try {
      return await broadcastClient.sendRawTransaction({ serializedTransaction: raw });
    } catch (error) {
      throw isBroadcastRefusal(error) ? new BroadcastRefused(error) : error;
    }
  },
  async getReceipt(hash) {
    try {
      const r = await readClient.getTransactionReceipt({ hash });
      return { blockNumber: r.blockNumber, status: r.status };
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
  },
  async getFinalizedBlockNumber() {
    return (await readClient.getBlock({ blockTag: "finalized" })).number;
  },
  getNonce: (address, blockTag) => readClient.getTransactionCount({ address, blockTag }),
  async isInBlock(hash) {
    try {
      const tx = await readClient.getTransaction({ hash });
      return tx.blockNumber !== null;
    } catch (error) {
      if (error instanceof TransactionNotFoundError) return false;
      throw error;
    }
  },
};

/** Waits until a transaction someone else sent (a gas grant) is in a finalized block. */
export async function waitForFinalized(hash: Hex, timeoutMs = 60_000): Promise<"success" | "reverted"> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await liveWriteChain.getReceipt(hash).catch(() => null);
    if (receipt) {
      const finalized = await liveWriteChain.getFinalizedBlockNumber().catch(() => -1n);
      if (finalized >= receipt.blockNumber) return receipt.status;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("timed out waiting for finality");
}
