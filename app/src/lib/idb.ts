import type { Address } from "viem";
import type { PendingWrite, WriteStore } from "./writes.ts";

// Pending writes live in IndexedDB so a reload, a second tab or a crash
// resumes tracking the same signed transaction instead of making a new one.
// A signed transaction is not a secret: it is exactly what gets broadcast.

const DB = "nivpay";
const STORE = "pendingWrites";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "address" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
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
