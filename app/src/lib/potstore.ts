import type { Deployment } from "./config.ts";

/**
 * The pots this phone has opened or made, so Home can list them. Only the
 * pot's number, creation block and link fragment are kept: everything shown
 * is read again from the chain, and the names again from the signed link.
 */
export type StoredPot = { deployment: Deployment; potId: string; block: string; fragment: string; name: string; addedAt: number };

type KeyValue = Pick<Storage, "getItem" | "setItem">;
const POTS_KEY = "nivpay.pots.v1";

export class PotStore {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  all(deployment: Deployment): StoredPot[] {
    try {
      const raw = JSON.parse(this.kv.getItem(POTS_KEY) ?? "[]") as unknown;
      if (!Array.isArray(raw)) return [];
      return (raw as StoredPot[])
        .filter((p) => p && p.deployment === deployment && typeof p.fragment === "string" && /^\d+$/.test(p.potId))
        .sort((a, b) => b.addedAt - a.addedAt);
    } catch {
      return [];
    }
  }

  get(deployment: Deployment, potId: string): StoredPot | undefined {
    return this.all(deployment).find((p) => p.potId === potId);
  }

  /** Adds the pot, or refreshes its link and name. */
  put(pot: StoredPot): void {
    let all: StoredPot[] = [];
    try {
      const raw = JSON.parse(this.kv.getItem(POTS_KEY) ?? "[]") as unknown;
      if (Array.isArray(raw)) all = raw as StoredPot[];
    } catch {
      all = [];
    }
    const old = all.find((p) => p.deployment === pot.deployment && p.potId === pot.potId);
    const others = all.filter((p) => p !== old);
    this.kv.setItem(POTS_KEY, JSON.stringify([...others, { ...pot, addedAt: old?.addedAt ?? pot.addedAt }]));
  }
}
