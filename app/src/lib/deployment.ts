import { AUSD, DEPLOY_BLOCK, deploymentFrom, POTS_AUSD, POTS_TESTUSD, potsFor, TESTUSD, type Deployment } from "./config.ts";

/** The deployment this build runs on. Kept apart from config.ts because only Vite has import.meta.env. */
export const DEPLOYMENT: Deployment = deploymentFrom(import.meta.env.VITE_NIVPAY_POTS);
export const POTS = potsFor(DEPLOYMENT);
/** The dollar people send and receive on this build: AUSD, or TESTUSD on the test build. */
export const DOLLAR = DEPLOYMENT === "ausd" ? AUSD : TESTUSD;
/** The block this build's pots contract was deployed in: no pot is older. Both are checked against the receipts in config.test.ts. */
export const POTS_DEPLOY_BLOCK: bigint = (DEPLOYMENT === "ausd" ? DEPLOY_BLOCK[POTS_AUSD] : DEPLOY_BLOCK[POTS_TESTUSD])!;
