import type { Address } from "viem";
import type { FeedState, FeedStore } from "./feed.ts";
import type { PendingWrite, WriteStore } from "./writes.ts";

// Pending writes live in IndexedDB so a reload, a second tab or a crash
// resumes tracking the same signed transaction instead of making a new one.
// A signed transaction is not a secret: it is exactly what gets broadcast.

const DB = "nivpay";
const STORE = "pendingWrites";
/** Each pot's event feed: its cursor and the finalized events read so far. BigInts survive structured clone. */
const FEEDS = "feeds";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Version 2 adds the feeds. Pending writes from version 1 are kept.
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      const names = request.result.objectStoreNames;
      if (!names.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "address" });
      if (!names.contains(FEEDS)) request.result.createObjectStore(FEEDS, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>, name: string = STORE): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(name, mode);
        const request = fn(tx.objectStore(name));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

type Stored = Omit<PendingWrite, "nonce" | "submittedAt"> & { nonce: number; submittedAt: number };

export const idbWriteStore: WriteStore = {
  get: (address: Address) => run<Stored | undefined>("readonly", (s) => s.get(address)),
  put: async (write) => {
    await run("readwrite", (s) => s.put(write satisfies Stored));
  },
  delete: async (address) => {
    await run("readwrite", (s) => s.delete(address));
  },
};

/**
 * How many requests from any account on this phone are still in flight. A
 * record exists from before the first broadcast until the request is final,
 * reverted or superseded, so zero means nothing of ours can still move.
 * If storage can't be read, the answer is unknown, and that is treated as
 * "maybe": the caller must not claim nothing moved.
 */
export async function pendingWriteCount(): Promise<number | undefined> {
  try {
    return await run<number>("readonly", (s) => s.count());
  } catch {
    return undefined;
  }
}

/** The feed store for one pot, keyed by its pots contract and id. */
export function idbFeedStore(key: string): FeedStore {
  return {
    load: async () => {
      const row = await run<(FeedState & { key: string }) | undefined>("readonly", (s) => s.get(key), FEEDS);
      return row ? { cursor: row.cursor, events: row.events } : undefined;
    },
    save: async (state) => {
      await run("readwrite", (s) => s.put({ key, ...state }), FEEDS);
    },
  };
}
