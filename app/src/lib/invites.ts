import { getAddress, isAddressEqual, recoverTypedDataAddress, type Address, type Hex, type LocalAccount } from "viem";
import { CHAIN_ID, type Deployment } from "./config.ts";
import type { Person } from "./draft.ts";
import { LinkReader, LinkWriter } from "./links.ts";

/**
 * The three links NivPay sends through chats (invite case B in
 * docs/APP-CONTRACT-MAP.md section 9):
 *
 *  - invite: the creator asks someone to decide, or to be paid. Unsigned; it
 *    only says which draft and which role. Nothing is trusted from it.
 *  - reply: the invitee's answer, signed with their account over the draft
 *    id, role, slot, account, name, city and time zone. The creator's app
 *    adds them only if the signature recovers to that account.
 *  - pot: the made pot, its creation block, and the people's labels, signed
 *    by the creator in the same passkey step as the pot itself, over the
 *    transaction that made it. A viewer accepts the labels only if the signer
 *    is the creator named in that transaction's PotCreated event.
 *
 * All of them are packed binary in lowercase base32 (links.ts), so no 0x and
 * no banned word can appear in a link.
 */

export const LINK_VERSION = 1;
const KIND = { invite: 1, reply: 2, pot: 3 } as const;
export const ROLE = { decider: 0, payee: 1 } as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

/** A decider's invite has no slot: any number of people may answer it. */
export const NO_SLOT: Hex = "0x0000000000000000";

export type Invite = {
  kind: "invite";
  draftId: Hex;
  role: Role;
  slot: Hex;
  from: string;
  potName: string;
  /** For a payee: the name the pot will pay them under. */
  payeeName: string;
};

export type Reply = {
  kind: "reply";
  draftId: Hex;
  role: Role;
  slot: Hex;
  person: Person;
  signature: Hex;
};

export type PotLink = {
  kind: "pot";
  deployment: Deployment;
  potId: bigint;
  block: bigint;
  people: Person[];
  signature: Hex;
};

export type Link = Invite | Reply | PotLink;

/** Text limits in links, so a crafted link can't carry a novel. */
const MAX_TEXT = 64;

function checkedText(r: LinkReader): string {
  const t = r.text();
  if (t.length > MAX_TEXT) throw new Error("link is damaged");
  return t;
}

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return zone.length > 0;
  } catch {
    return false;
  }
}

function writePerson(w: LinkWriter, p: Person): void {
  w.account(p.account).text(p.name).text(p.city).text(p.timeZone);
}

function readPerson(r: LinkReader): Person {
  const person = { account: getAddress(r.account()), name: checkedText(r), city: checkedText(r), timeZone: checkedText(r) };
  if (!isTimeZone(person.timeZone)) throw new Error("link is damaged");
  return person;
}

function fixedHex(r: LinkReader, bytes: number): Hex {
  const h = r.hex();
  if (h.length !== 2 + bytes * 2) throw new Error("link is damaged");
  return h;
}

export function encodeLink(link: Link): string {
  const w = new LinkWriter().uint(LINK_VERSION).uint(KIND[link.kind]);
  switch (link.kind) {
    case "invite":
      w.hex(link.draftId).uint(link.role).hex(link.slot).text(link.from).text(link.potName).text(link.payeeName);
      break;
    case "reply":
      w.hex(link.draftId).uint(link.role).hex(link.slot);
      writePerson(w, link.person);
      w.hex(link.signature);
      break;
    case "pot":
      w.uint(link.deployment === "ausd" ? 0 : 1).uint(link.potId).uint(link.block).uint(link.people.length);
      for (const p of link.people) writePerson(w, p);
      w.hex(link.signature);
      break;
  }
  return w.toFragment();
}

/** Reads any NivPay link. Throws "link is damaged" on anything malformed or left over. */
export function decodeLink(fragment: string): Link {
  const r = new LinkReader(fragment);
  if (r.uint() !== BigInt(LINK_VERSION)) throw new Error("link is damaged");
  const kind = Number(r.uint());
  const role = (): Role => {
    const v = Number(r.uint());
    if (v !== ROLE.decider && v !== ROLE.payee) throw new Error("link is damaged");
    return v;
  };
  let link: Link;
  if (kind === KIND.invite) {
    link = {
      kind: "invite",
      draftId: fixedHex(r, 16),
      role: role(),
      slot: fixedHex(r, 8),
      from: checkedText(r),
      potName: checkedText(r),
      payeeName: checkedText(r),
    };
  } else if (kind === KIND.reply) {
    link = {
      kind: "reply",
      draftId: fixedHex(r, 16),
      role: role(),
      slot: fixedHex(r, 8),
      person: readPerson(r),
      signature: fixedHex(r, 65),
    };
  } else if (kind === KIND.pot) {
    const d = Number(r.uint());
    if (d !== 0 && d !== 1) throw new Error("link is damaged");
    const potId = r.uint();
    const block = r.uint();
    const count = Number(r.uint());
    if (count < 1 || count > 20) throw new Error("link is damaged");
    const people = Array.from({ length: count }, () => readPerson(r));
    link = { kind: "pot", deployment: d === 0 ? "ausd" : "testusd", potId, block, people, signature: fixedHex(r, 65) };
  } else {
    throw new Error("link is damaged");
  }
  r.end();
  return link;
}

export function linkUrl(origin: string, link: Link): string {
  return `${origin}/#${encodeLink(link)}`;
}

// ---------------------------------------------------------------------------
// Signatures (EIP-712, bound to this chain and this pots contract)
// ---------------------------------------------------------------------------

const domain = (pots: Address) => ({ name: "NivPay", version: "1", chainId: CHAIN_ID, verifyingContract: pots }) as const;

const JOIN_TYPES = {
  Join: [
    { name: "draftId", type: "bytes16" },
    { name: "role", type: "uint8" },
    { name: "slot", type: "bytes8" },
    { name: "account", type: "address" },
    { name: "name", type: "string" },
    { name: "city", type: "string" },
    { name: "timeZone", type: "string" },
  ],
} as const;

const LABELS_TYPES = {
  Labels: [
    { name: "createdIn", type: "bytes32" },
    { name: "people", type: "Person[]" },
  ],
  Person: [
    { name: "account", type: "address" },
    { name: "name", type: "string" },
    { name: "city", type: "string" },
    { name: "timeZone", type: "string" },
  ],
} as const;

function joinData(pots: Address, draftId: Hex, role: Role, slot: Hex, person: Person) {
  return {
    domain: domain(pots),
    types: JOIN_TYPES,
    primaryType: "Join",
    message: { draftId, role, slot, ...person },
  } as const;
}

function labelsData(pots: Address, createdIn: Hex, people: Person[]) {
  return { domain: domain(pots), types: LABELS_TYPES, primaryType: "Labels", message: { createdIn, people } } as const;
}

export async function signReply(account: LocalAccount, pots: Address, invite: Invite, person: Person): Promise<Reply> {
  if (!isAddressEqual(account.address, person.account)) throw new Error("reply must be signed by its own account");
  const signature = await account.signTypedData(joinData(pots, invite.draftId, invite.role, invite.slot, person));
  return { kind: "reply", draftId: invite.draftId, role: invite.role, slot: invite.slot, person, signature };
}

/** True only if the reply was signed by the account it names, for this chain and pots contract. */
export async function verifyReply(pots: Address, reply: Reply): Promise<boolean> {
  try {
    const signer = await recoverTypedDataAddress({
      ...joinData(pots, reply.draftId, reply.role, reply.slot, reply.person),
      signature: reply.signature,
    });
    return isAddressEqual(signer, reply.person.account);
  } catch {
    return false;
  }
}

/** Signs the labels over the hash of the transaction that makes the pot. */
export function signLabels(account: LocalAccount, pots: Address, createdIn: Hex, people: Person[]): Promise<Hex> {
  return account.signTypedData(labelsData(pots, createdIn, people));
}

/**
 * True only if the labels were signed by `creator` over `createdIn`. The
 * caller takes both from the PotCreated log for link.potId in link.block:
 * the creator from its indexed topic, createdIn from its transaction hash.
 */
export async function verifyLabels(pots: Address, link: PotLink, createdIn: Hex, creator: Address): Promise<boolean> {
  try {
    const signer = await recoverTypedDataAddress({ ...labelsData(pots, createdIn, link.people), signature: link.signature });
    return isAddressEqual(signer, creator);
  } catch {
    return false;
  }
}
