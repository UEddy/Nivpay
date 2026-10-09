import { AUSD, deploymentFrom, potsFor, TESTUSD, type Deployment } from "./config.ts";

/** The deployment this build runs on. Kept apart from config.ts because only Vite has import.meta.env. */
export const DEPLOYMENT: Deployment = deploymentFrom(import.meta.env.VITE_NIVPAY_POTS);
export const POTS = potsFor(DEPLOYMENT);
/** The dollar people send and receive on this build: AUSD, or TESTUSD on the test build. */
export const DOLLAR = DEPLOYMENT === "ausd" ? AUSD : TESTUSD;
