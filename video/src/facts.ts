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
    /** Proved by the swap 0x9d95...93b1 (block 70,177,155): 50 AUSD in, 50 CTK out, SwapFees 0 and 0. Agora can change it: check the take's sheet shows the same. */
    otherCurrencyRate: "$1 = 1.00 CTK" as string | null,
    /** The last four characters of the 2 minute Maya account, as phone A's Send screen shows them before the fingerprint: "Sending to account ending ####". */
    recipientLastFour: null as string | null,
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

  /** README, Monad integration. Every one is also a row there; facts.test.ts checks the two agree. */
  hashes: {
    /** Pot 0, "Anniversary", the showcase reviewers can open at any time. Not shown in the videos. */
    showcase: {
      claim: "0xcf032c4555429aa1dacf086276a7d880fa587ed3bfbc5457137697ed9bd6fcdf",
      createPot: "0x6d1d6bdc5a942458c994e2735a684fb5b0665d77a692c3763c33f2962495199c",
      fundWithPermit: "0x9276983cefc2ff505352412a2044841d81f6f032b3ba1ece5ff9f21d040c5cbe",
      /** $50 AUSD from the Phone A account (ending 7bC1) to the third test account (ending 0B61), block 70,176,817, finalized; read back 11 Oct 2026. */
      send: "0xd23cf8e21f928468d7f1d826f6d2cd8d351faf1b3e698d823b37808007641ade",
      /** $50 AUSD in, 50 CTK out through Agora's pair, same two accounts, block 70,177,155, finalized; read back 11 Oct 2026. */
      swap: "0x9d95911b7e9b2811bf4063054cb13e573e229260398705d7464844456a1f93b1",
    },
    /** From the recorded takes: copied from the app's own Receipt links right after each take (SHOTLIST.md). */
    take: {
      /** Mama's 60th being made (M03): the story's first row, Receipt. */
      createPot: null as string | null,
      /** Eddy's $500 into Mama's 60th (M04): its story row, Receipt. */
      fundWithPermit: null as string | null,
      /** The $25 send in the bounty take: View receipt on phone A (B06). Shown with "$25" in a caption, so only that take's hash. */
      send: null as string | null,
      /** The exchange through Agora's pair in the bounty take (B08). */
      swap: null as string | null,
    },
  },
} as const;

/** README, Monad integration: the row that holds each take hash with a README row. */
export const README_ROWS: Record<"createPot" | "fundWithPermit", string> = {
  createPot: "CreatePot, Mama's 60th in the demo video",
  fundWithPermit: "FundWithPermit, Eddy's $500 into Mama's 60th in the demo video",
};

/** README, Monad integration: the rows that hold showcase hashes. */
export const SHOWCASE_ROWS: Partial<Record<keyof Facts["hashes"]["showcase"], string>> = {
  createPot: "CreatePot, pot 0",
  fundWithPermit: "FundWithPermit, the first deposit in pot 0",
  claim: "Add test dollars, a faucet claim",
  send: "Send dollars, a plain AUSD payment to another person",
  swap: "Send in another currency, the exchange through Agora's pair",
};

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
