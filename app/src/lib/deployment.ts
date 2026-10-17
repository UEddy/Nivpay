import type { Address } from "viem";
import { AUSD, DEPLOY_BLOCK, deploymentFrom, POTS_AUSD, POTS_TESTUSD, POTS_V2, POTS_V2_DEPLOY_BLOCK, potsFor, TESTUSD, type Deployment } from "./config.ts";

/** The deployment this build runs on. Kept apart from config.ts because only Vite has import.meta.env. */
export const DEPLOYMENT: Deployment = deploymentFrom(import.meta.env.VITE_NIVPAY_POTS);
export const POTS = potsFor(DEPLOYMENT);
/** The dollar people send and receive on this build: AUSD, or TESTUSD on the test build. */
export const DOLLAR = DEPLOYMENT === "ausd" ? AUSD : TESTUSD;
/** The block this build's pots contract was deployed in: no pot is older. Both are checked against the receipts in config.test.ts. */
export const POTS_DEPLOY_BLOCK: bigint = (DEPLOYMENT === "ausd" ? DEPLOY_BLOCK[POTS_AUSD] : DEPLOY_BLOCK[POTS_TESTUSD])!;

/** This build's NivPayPotsV2, or null while POTS_V2 is: then nothing about V2 shows. */
export const POTS_V2_HERE: Address | null = POTS_V2 ? POTS_V2[DEPLOYMENT] : null;
/** The block it was deployed in. Null with POTS_V2_HERE. */
export const POTS_V2_DEPLOY_BLOCK_HERE: bigint | null = POTS_V2_DEPLOY_BLOCK ? POTS_V2_DEPLOY_BLOCK[DEPLOYMENT] : null;
/** New pots are made on V2 once it is set. */
export const NEW_POTS_ON_V2 = POTS_V2_HERE !== null;

/** The pots contract a pot lives on. A V2 pot on a build without V2 is refused where it is opened (openPot). */
export function potsAt(onV2: boolean | undefined): Address {
  if (!onV2) return POTS;
  if (!POTS_V2_HERE) throw new Error("this build has no NivPayPotsV2");
  return POTS_V2_HERE;
}

/**
 * The same, for a screen's writes and the pending writes it looks for, which
 * only run once openPot has opened the pot: a V2 pot never opens on a build
 * without V2, so the fallback here is never written to.
 */
export const potsOf = (onV2: boolean | undefined): Address => (onV2 && POTS_V2_HERE ? POTS_V2_HERE : POTS);
