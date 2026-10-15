import { getAddress, type Address } from "viem";

/**
 * Who controls a pot, read from what the chain says about it: who decides,
 * how many yeses pay, who can be paid and up to what. The pot's maker comes
 * from its PotCreated event, which the pot screen checks every link against
 * (potview.ts openPot), so it is known whenever the pot is open; elsewhere it
 * may not be, and then makerIsPayee is null, not false.
 *
 * These are warnings for the person reading, never a reason to stop a
 * payment: a pot where one person decides alone is a fine way to collect for
 * your own party, and a scam looks the same. NivPay can only say what the
 * rules allow.
 */

export type PotRules = {
  deciders: Address[];
  /** How many yeses pay. */
  threshold: number;
  payees: { to: Address; cap: bigint }[];
  /** The account that made the pot, if known. */
  maker: Address | null;
};

export type PotRisks = {
  /** A single yes is enough to pay. */
  oneCanPay: boolean;
  /** Deciders who can also be paid, each once, in the order they decide. */
  deciderPayees: Address[];
  /** The maker can be paid. Null when the maker isn't known. */
  makerIsPayee: boolean | null;
  /** The deciders who can be paid have enough yeses between them to reach the rule on their own. */
  payeesCanPayThemselves: boolean;
};

export function potRisks(rules: PotRules): PotRisks {
  const payees = new Set(rules.payees.map((p) => getAddress(p.to)));
  const deciders = [...new Set(rules.deciders.map((d) => getAddress(d)))];
  const deciderPayees = deciders.filter((d) => payees.has(d));
  // A threshold below one can't be made, but nothing here relies on that.
  const needed = Math.max(1, rules.threshold);
  return {
    oneCanPay: needed <= 1,
    deciderPayees,
    makerIsPayee: rules.maker === null ? null : payees.has(getAddress(rules.maker)),
    payeesCanPayThemselves: deciderPayees.length > 0 && deciderPayees.length >= needed,
  };
}
