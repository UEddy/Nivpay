import type { Deployment } from "./config.ts";
import { decodeLink, type PotLink } from "./invites.ts";

/**
 * The pots this phone has opened or made, so Home can list them. Only the
 * pot's number, creation block and link fragment are kept: everything shown
 * is read again from the chain, and the names again from the signed link.
 * A pot matched to an answered invite (invited.ts) opens with an empty
 * fragment: no names, so people show as "account ending".
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

/**
 * What happens on an invitee's phone when they open a pot link: the pot is
 * added to this phone's list, so Home shows it from then on. Opening the same
 * pot again keeps the name it was shown under and when it was first added,
 * and takes the newer link.
 */
export function rememberPotLink(store: PotStore, link: PotLink, fragment: string, now: number): StoredPot {
  const pot: StoredPot = { deployment: link.deployment, potId: link.potId.toString(), block: link.block.toString(), fragment, name: "", addedAt: now };
  const known = store.get(link.deployment, pot.potId);
  store.put({ ...pot, name: known?.name ?? "" });
  return store.get(link.deployment, pot.potId) ?? pot;
}

/**
 * The link a pot opens with. A pot opened with no link (matched to an
 * answered invite) gets one with no names and no signature, which never
 * verifies, so the pot screen reads everything from the chain and shows
 * people by the end of their account. Null if a stored link is damaged.
 */
export function linkFor(pot: StoredPot): PotLink | null {
  if (!pot.fragment) {
    if (!/^\d+$/.test(pot.block)) return null;
    return { kind: "pot", version: 2, deployment: pot.deployment, potId: BigInt(pot.potId), block: BigInt(pot.block), people: [], shares: [], signature: "0x" };
  }
  try {
    const l = decodeLink(pot.fragment);
    return l.kind === "pot" ? l : null;
  } catch {
    return null;
  }
}
