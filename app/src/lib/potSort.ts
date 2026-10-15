import { getAddress, isAddress, isAddressEqual, type Address } from "viem";
import { cleanName } from "./accounts.ts";
import type { FoundPot } from "./discover.ts";

/**
 * Anyone can make a pot that names your account, and discovery (discover.ts)
 * finds it, so a stranger could put a pot on your Home just by naming you.
 * This sorts what discovery found into pots that are yours and pots that are
 * new to you. A pot is yours if any of these is true:
 *
 *  - this phone made it
 *  - its link was opened on this phone (potstore.ts)
 *  - you answered its invite (invited.ts)
 *  - you put money in
 *  - its maker is one of this phone's accounts, or a saved contact
 *  - you chose Keep
 *
 * Everything else is new to you. Hide, on a new pot or on any pot's own
 * screen, takes a pot off Home whatever else is true of it, until Show again
 * in Account details, or until its link is opened here (App.tsx unhides it
 * then). New pots get no badge
 * and no announcement, and their requests for a yes are not shown on Home.
 * Nothing here changes what a pot can do: it only decides where Home lists it.
 */

export type SortFacts = {
  madeHere: ReadonlySet<string>;
  opened: ReadonlySet<string>;
  answered: ReadonlySet<string>;
  kept: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  /** This phone's accounts and the active account's contacts. */
  trusted: readonly Address[];
  /** Each pot's maker, where known, by pot number. */
  makers: Readonly<Record<string, Address>>;
};

export type Sorted<T> = { yours: T[]; fresh: T[]; hidden: T[] };

export function isYours(pot: Pick<FoundPot, "potId" | "roles">, facts: SortFacts): boolean {
  const id = pot.potId;
  if (facts.madeHere.has(id) || facts.opened.has(id) || facts.answered.has(id) || facts.kept.has(id)) return true;
  if (pot.roles.includes("putIn")) return true;
  const maker = facts.makers[id];
  return maker !== undefined && facts.trusted.some((a) => isAddressEqual(a, maker));
}

export function sortFound<T extends Pick<FoundPot, "potId" | "roles">>(found: T[], facts: SortFacts): Sorted<T> {
  const out: Sorted<T> = { yours: [], fresh: [], hidden: [] };
  for (const p of found) {
    if (facts.hidden.has(p.potId)) out.hidden.push(p);
    else if (isYours(p, facts)) out.yours.push(p);
    else out.fresh.push(p);
  }
  return out;
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;

export type HiddenPot = { potId: string; name: string; hiddenAt: number };
type Choices = { kept: string[]; hidden: HiddenPot[] };

const isPotId = (v: unknown): v is string => typeof v === "string" && /^\d{1,20}$/.test(v);

/** Keep and Hide, per deployment and per account. A pot is in one list or neither. */
export class PotChoiceStore {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string, account: Address) {
    if (!isAddress(account)) throw new Error("not an account");
    this.kv = kv;
    this.key = `nivpay.potchoices.v1.${deployment}.${getAddress(account)}`;
  }

  private read(): Choices {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "null") as Partial<Choices> | null;
      const kept = Array.isArray(raw?.kept) ? raw.kept.filter(isPotId) : [];
      const hidden = Array.isArray(raw?.hidden)
        ? raw.hidden.flatMap((h) => (h && isPotId(h.potId) && typeof h.hiddenAt === "number" ? [{ potId: h.potId, name: cleanName(String(h.name ?? "")), hiddenAt: h.hiddenAt }] : []))
        : [];
      return { kept, hidden };
    } catch {
      return { kept: [], hidden: [] };
    }
  }

  private write(c: Choices): void {
    this.kv.setItem(this.key, JSON.stringify(c));
  }

  kept(): Set<string> {
    return new Set(this.read().kept);
  }

  /** Newest first. */
  hidden(): HiddenPot[] {
    return this.read().hidden.sort((a, b) => b.hiddenAt - a.hiddenAt);
  }

  keep(potId: string): void {
    const c = this.read();
    this.write({ kept: [...new Set([...c.kept, potId])], hidden: c.hidden.filter((h) => h.potId !== potId) });
  }

  hide(potId: string, name: string, now: number): void {
    const c = this.read();
    this.write({ kept: c.kept.filter((k) => k !== potId), hidden: [...c.hidden.filter((h) => h.potId !== potId), { potId, name: cleanName(name), hiddenAt: now }] });
  }

  /** Undoes Hide: the pot is new to you again. */
  unhide(potId: string): void {
    const c = this.read();
    this.write({ kept: c.kept, hidden: c.hidden.filter((h) => h.potId !== potId) });
  }
}

/**
 * Each pot's maker, from its PotCreated event, per deployment. Public, and
 * never changes once the pot is made, so it is read once.
 */
export class PotMakers {
  private readonly kv: KeyValue;
  private readonly key: string;

  constructor(kv: KeyValue, deployment: string) {
    this.kv = kv;
    this.key = `nivpay.potmakers.v1.${deployment}`;
  }

  all(): Record<string, Address> {
    try {
      const raw = JSON.parse(this.kv.getItem(this.key) ?? "{}") as unknown;
      if (!raw || typeof raw !== "object") return {};
      return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).flatMap(([k, v]) => (isPotId(k) && typeof v === "string" && isAddress(v) ? [[k, getAddress(v)]] : [])),
      );
    } catch {
      return {};
    }
  }

  put(potId: string, maker: Address): void {
    this.kv.setItem(this.key, JSON.stringify({ ...this.all(), [potId]: getAddress(maker) }));
  }
}

/** Reads a pot's maker from its PotCreated event in its creation block. Null if the event isn't there. */
export interface MakerReader {
  makerAt(potId: bigint, block: bigint): Promise<Address | null>;
}

/** Learns the maker of each pot whose creation block is known, at most `limit` per call. */
export async function learnPotMakers(store: PotMakers, blocks: Readonly<Record<string, string>>, potIds: string[], reader: MakerReader, limit = 4): Promise<void> {
  const known = store.all();
  const todo = potIds.filter((id) => !known[id] && blocks[id]).slice(0, limit);
  for (const id of todo) {
    const maker = await reader.makerAt(BigInt(id), BigInt(blocks[id]!));
    if (maker) store.put(id, maker);
  }
}
