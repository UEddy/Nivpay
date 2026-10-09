import { getAddress, isAddressEqual, recoverTypedDataAddress, type Address, type Hex, type LocalAccount } from "viem";
import { CHAIN_ID, type Deployment } from "./config.ts";
import type { Person, Share } from "./draft.ts";
import { LinkReader, LinkWriter } from "./links.ts";

/**
 * The links NivPay sends through chats (invite case B in
 * docs/APP-CONTRACT-MAP.md section 9):
 *
 *  - invite: the creator asks someone to decide, or to be paid. Unsigned; it
 *    says which draft and which role, and from version 2 the creator's
 *    account and, if one was set, the invitee's suggested share. Nothing in
 *    it is trusted: the account only ever narrows which pot an answered
 *    invite can be matched to, and the match is checked against the
 *    PotCreated event (invited.ts).
 *  - reply: the invitee's answer, signed with their account over the draft
 *    id, role, slot, account, name, city and time zone. The creator's app
 *    adds them only if the signature recovers to that account.
 *  - pot: the made pot, its creation block, the people's labels and their
 *    suggested shares, signed by the creator in the same passkey step as the
 *    pot itself, over the transaction that made it. A viewer accepts them
 *    only if the signer is the creator named in that transaction's
 *    PotCreated event. Pot links are version 2; version 1 pot links, made
 *    before suggested shares, still open and verify against their own types.
 *
 *  - pay: a request to be paid, from one person to another (Send).
 *  - ask: a payment request from a pot, sent by whoever asked to the other
 *    deciders. It names the pot, its creation block and the request, and
 *    nothing else: the payee, amount, fee and every yes are read from the
 *    chain, and the names from the pot link already on that phone, if any.
 *
 * All of them are packed binary in lowercase base32 (links.ts), so no 0x and
 * no banned word can appear in a link.
 */

export const LINK_VERSION = 1;
/** Pot links carry suggested shares from version 2. */
export const POT_LINK_VERSION = 2;
/** Invites carry the creator's account and a suggested share from version 2. */
export const INVITE_VERSION = 2;
const KIND = { invite: 1, reply: 2, pot: 3, pay: 4, ask: 5 } as const;
export const ROLE = { decider: 0, payee: 1 } as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

/** Decider invites made before they were named have no slot: any number of people may answer one. */
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
  /** The account making the pot. Null on version 1 invites, made before it was carried. */
  inviter: Address | null;
  /** The invitee's suggested share in base units, unsigned. 0 means none. */
  share: bigint;
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
  /** 1: names only. 2: names and suggested shares. Each is signed with its own types. */
  version: 1 | 2;
  deployment: Deployment;
  potId: bigint;
  block: bigint;
  people: Person[];
  shares: Share[];
  signature: Hex;
};

/**
 * A request to be paid: who to pay, the name they go by, and optionally how
 * much. Unsigned, like an Account ID typed in: the sender's confirm sheet
 * shows the account's last 4 characters before anything is signed.
 */
export type PayLink = {
  kind: "pay";
  deployment: Deployment;
  account: Address;
  name: string;
  /** Base units; 0 means the sender chooses. */
  amount: bigint;
};

/** A payment request from a pot, for the other deciders to say yes to. Unsigned: it only points at what the chain holds. */
export type AskLink = {
  kind: "ask";
  deployment: Deployment;
  potId: bigint;
  /** The block the pot was made in, so its PotCreated event is one read. */
  block: bigint;
  proposalId: bigint;
};

export type Link = Invite | Reply | PotLink | PayLink | AskLink;

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
  const version = link.kind === "pot" ? link.version : link.kind === "invite" && link.inviter ? INVITE_VERSION : LINK_VERSION;
  const w = new LinkWriter().uint(version).uint(KIND[link.kind]);
  switch (link.kind) {
    case "invite":
      w.hex(link.draftId).uint(link.role).hex(link.slot).text(link.from).text(link.potName).text(link.payeeName);
      if (link.inviter) w.account(link.inviter).uint(link.share);
      else if (link.share) throw new Error("version 1 invites carry no share");
      break;
    case "reply":
      w.hex(link.draftId).uint(link.role).hex(link.slot);
      writePerson(w, link.person);
      w.hex(link.signature);
      break;
    case "pot":
      w.uint(link.deployment === "ausd" ? 0 : 1).uint(link.potId).uint(link.block).uint(link.people.length);
      for (const p of link.people) writePerson(w, p);
      if (link.version === 2) {
        w.uint(link.shares.length);
        for (const s of link.shares) w.account(s.account).uint(s.amount);
      } else if (link.shares.length) throw new Error("version 1 pot links carry no shares");
      w.hex(link.signature);
      break;
    case "pay":
      w.uint(link.deployment === "ausd" ? 0 : 1).account(link.account).text(link.name).uint(link.amount);
      break;
    case "ask":
      w.uint(link.deployment === "ausd" ? 0 : 1).uint(link.potId).uint(link.block).uint(link.proposalId);
      break;
  }
  return w.toFragment();
}

/** Reads any NivPay link. Throws "link is damaged" on anything malformed or left over. */
export function decodeLink(fragment: string): Link {
  const r = new LinkReader(fragment);
  const version = Number(r.uint());
  const kind = Number(r.uint());
  // Version 2 exists only for pot links and invites; replies and requests to be paid are version 1.
  const v2 = version === POT_LINK_VERSION && (kind === KIND.pot || kind === KIND.invite);
  if (!(version === LINK_VERSION || v2)) throw new Error("link is damaged");
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
      inviter: null,
      share: 0n,
    };
    if (version === INVITE_VERSION) {
      link.inviter = getAddress(r.account());
      link.share = r.uint();
    }
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
    const shares: Share[] = [];
    if (version === POT_LINK_VERSION) {
      const n = Number(r.uint());
      if (n > 40) throw new Error("link is damaged");
      for (let i = 0; i < n; i++) shares.push({ account: getAddress(r.account()), amount: r.uint() });
    }
    link = {
      kind: "pot",
      version: version === POT_LINK_VERSION ? 2 : 1,
      deployment: d === 0 ? "ausd" : "testusd",
      potId,
      block,
      people,
      shares,
      signature: fixedHex(r, 65),
    };
  } else if (kind === KIND.pay) {
    const d = Number(r.uint());
    if (d !== 0 && d !== 1) throw new Error("link is damaged");
    link = { kind: "pay", deployment: d === 0 ? "ausd" : "testusd", account: getAddress(r.account()), name: checkedText(r), amount: r.uint() };
  } else if (kind === KIND.ask) {
    const d = Number(r.uint());
    if (d !== 0 && d !== 1) throw new Error("link is damaged");
    link = { kind: "ask", deployment: d === 0 ? "ausd" : "testusd", potId: r.uint(), block: r.uint(), proposalId: r.uint() };
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

const PERSON_TYPE = [
  { name: "account", type: "address" },
  { name: "name", type: "string" },
  { name: "city", type: "string" },
  { name: "timeZone", type: "string" },
] as const;

/** Version 1 labels: names only. Kept so pots made before shares still verify. */
const LABELS_V1_TYPES = {
  Labels: [
    { name: "createdIn", type: "bytes32" },
    { name: "people", type: "Person[]" },
  ],
  Person: PERSON_TYPE,
} as const;

const LABELS_TYPES = {
  Labels: [
    { name: "createdIn", type: "bytes32" },
    { name: "people", type: "Person[]" },
    { name: "shares", type: "Share[]" },
  ],
  Person: PERSON_TYPE,
  Share: [
    { name: "account", type: "address" },
    { name: "amount", type: "uint256" },
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

function labelsData(pots: Address, createdIn: Hex, people: Person[], shares: Share[]) {
  return { domain: domain(pots), types: LABELS_TYPES, primaryType: "Labels", message: { createdIn, people, shares } } as const;
}

function labelsV1Data(pots: Address, createdIn: Hex, people: Person[]) {
  return { domain: domain(pots), types: LABELS_V1_TYPES, primaryType: "Labels", message: { createdIn, people } } as const;
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

/** Signs the labels and suggested shares over the hash of the transaction that makes the pot. */
export function signLabels(account: LocalAccount, pots: Address, createdIn: Hex, people: Person[], shares: Share[]): Promise<Hex> {
  return account.signTypedData(labelsData(pots, createdIn, people, shares));
}

/**
 * True only if the labels were signed by `creator` over `createdIn`. The
 * caller takes both from the PotCreated log for link.potId in link.block:
 * the creator from its indexed topic, createdIn from its transaction hash.
 */
export async function verifyLabels(pots: Address, link: PotLink, createdIn: Hex, creator: Address): Promise<boolean> {
  try {
    const signature = link.signature;
    const signer =
      link.version === 2
        ? await recoverTypedDataAddress({ ...labelsData(pots, createdIn, link.people, link.shares), signature })
        : await recoverTypedDataAddress({ ...labelsV1Data(pots, createdIn, link.people), signature });
    return isAddressEqual(signer, creator);
  } catch {
    return false;
  }
}
