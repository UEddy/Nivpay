import { deploymentFrom, potsFor, type Deployment } from "./config.ts";

/** The deployment this build runs on. Kept apart from config.ts because only Vite has import.meta.env. */
export const DEPLOYMENT: Deployment = deploymentFrom(import.meta.env.VITE_NIVPAY_POTS);
export const POTS = potsFor(DEPLOYMENT);
