/**
 * The only source of every number, amount, name and hash a caption or a
 * callout may show. Captions name a fact as {path.to.it}; a caption's own
 * text may hold no digits at all (scripts/captions.ts), so nothing on screen
 * can be typed in by hand.
 *
 * Values are written exactly as they read on screen. facts.test.ts checks the
 * amounts and fees against the app's own fee and share arithmetic, and the
 * addresses and hashes against the README.
 *
 * null means not measured yet. A final render refuses while any fact a
 * caption uses is null, and video:check fails while any fact here is null.
 */

export const FACTS = {
  app: {
    url: "https://nivpay.vercel.app",
    host: "nivpay.vercel.app",
  },

  /** docs/SEEDING.md, The cast. */
  cast: {
    eddy: { name: "Eddy", city: "London", phone: "A, Galaxy S24" },
    maya: { name: "Maya", city: "Houston", phone: "B, Galaxy S10" },
    daniel: { name: "Daniel", city: "Uyo", phone: "B, Galaxy S10" },
    caterer: { name: "Caterer", limit: "$700" },
    eventHall: { name: "Event hall", limit: "$300" },
  },

  /** docs/DEMO.md sections 2 to 5, the 3 minute main cut. */
  pot: {
    name: "Mama's 60th",
    deciders: "3",
    yesNeeded: "2",
    rule: "2 of 3",
    closesOn: "Thu 31 Dec 2026",
    /** The end of that day in phone A's zone, Lagos. */
    closesUtc: "31 Dec 2026 23:00 UTC",
    pours: { eddy: "$500", maya: "$400", daniel: "$100" },
    total: "$1,000",
    caterer: { amount: "$600", fee: "$3.00", after: "$397.00" },
    eventHall: { amount: "$280", fee: "$1.40", after: "$115.60" },
    paidOut: "$880",
    fees: "$4.40",
    feeRate: "0.5%",
    feeCap: "$50",
    left: "$115.60",
    shares: { eddy: "$57.80", maya: "$46.24", daniel: "$11.56" },
    /** "You put in $500, half of the pot". */
    eddyFraction: "half",
  },

  /** docs/DEMO.md, The 2 minute bounty path. */
  bounty: {
    testDollars: "$10,000",
    balanceAfterClaim: "$10,000.00",
    send: "$25",
    received: "$25.00",
    otherCurrencySend: "$10",
    otherCurrency: "CTK",
  },

  /** Read off the footage once it is recorded. Never narrated before it shows. */
  measured: {
    /** "Settled in 0.Xs." after Add test dollars, on phone A. */
    claimSettle: null as string | null,
    /** "Sent $25 to Maya. Settled in 0.Xs." on phone A. */
    sendSettle: null as string | null,
    /** "They received 10.00 CTK. Settled in 0.Xs." on phone A. */
    otherCurrencySettle: null as string | null,
    /** The CTK amount and rate on the Check and send sheet: Agora sets them. */
    otherCurrencyReceived: null as string | null,
    otherCurrencyRate: null as string | null,
    /** The last four characters of the new Eddy account, as phone B shows them. */
    senderLastFour: null as string | null,
    /** "Settled in" on the yes that pays the Caterer, main cut. */
    catererSettle: null as string | null,
  },

  /** docs/APP-CONTRACT-MAP.md section 6, measured on testnet. */
  chain: {
    name: "Monad",
    blockTime: "about 300 ms",
    finalizedBehind: "about 0.6 s",
  },

  /** README, Contract addresses. */
  contracts: {
    potsAusd: "0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB",
    ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    faucet: "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
    settlementPair: "0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae",
    ctk: "0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D",
  },

  /** README, Monad integration. The explorer segment shows pot 0's, "Anniversary". */
  hashes: {
    claim: "0xcf032c4555429aa1dacf086276a7d880fa587ed3bfbc5457137697ed9bd6fcdf",
    createPot: "0x6d1d6bdc5a942458c994e2735a684fb5b0665d77a692c3763c33f2962495199c",
    fundWithPermit: "0x9276983cefc2ff505352412a2044841d81f6f032b3ba1ece5ff9f21d040c5cbe",
    /** The $25 send in the bounty take: from View receipt on phone A. */
    send: null as string | null,
    /** The exchange through Agora's pair in the bounty take. */
    swap: null as string | null,
  },
  explorer: {
    potName: "Anniversary",
    potMade: "9 Oct 2026",
    firstPour: "$200",
  },
} as const;

export type Facts = typeof FACTS;

/** A fact by its dotted path. undefined when there is no such fact; null when it is not measured yet. */
export function fact(path: string, facts: unknown = FACTS): string | null | undefined {
  let at: unknown = facts;
  for (const key of path.split(".")) {
    if (at === null || typeof at !== "object" || !(key in at)) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  if (at === null) return null;
  return typeof at === "string" ? at : undefined;
}

/** Every path whose value is still null. */
export function nullFacts(facts: unknown = FACTS, prefix = ""): string[] {
  if (facts === null) return [prefix];
  if (typeof facts !== "object") return [];
  return Object.entries(facts as Record<string, unknown>).flatMap(([k, v]) => nullFacts(v, prefix ? `${prefix}.${k}` : k));
}

/** Short form for a hash or an address on screen: first 6 and last 4. */
export const shortHex = (h: string) => `${h.slice(0, 6)}...${h.slice(-4)}`;
