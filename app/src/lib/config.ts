import { getAddress, type Address } from "viem";
import { monadTestnet } from "viem/chains";

/** The only chain this app talks to. Nothing here may point at a mainnet. */
export const CHAIN = monadTestnet;
export const CHAIN_ID = 10143;
export const RPC_URL = "https://testnet-rpc.monad.xyz";

if (CHAIN.id !== CHAIN_ID) {
  throw new Error(`viem's monadTestnet has chain id ${CHAIN.id}, expected ${CHAIN_ID}`);
}

/**
 * The deployed contracts, from the committed broadcast receipts under
 * broadcast/<script>/10143/. Token names, symbols, decimals, fee settings and
 * limits are never listed here: they are read from the chain.
 */
export const POTS_AUSD: Address = getAddress("0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB");
export const POTS_TESTUSD: Address = getAddress("0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA");
export const TESTUSD: Address = getAddress("0x9FD60818e0DFee982d677cd72FbC3601Cc2eB6f7");
export const AUSD: Address = getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");

/**
 * Agora's AUSD faucet, a UUPS proxy (README, "Getting test AUSD"). Anyone may
 * call requestFunds(to). Its terms are read from the chain, never listed here.
 */
export const AUSD_FAUCET: Address = getAddress("0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C");

/**
 * Agora's Instant Settlement on Monad testnet (docs.agora.finance), used to
 * send in another currency on the AUSD deployment: a fixed price pair of CTK
 * (token0, 18 decimals) and AUSD (token1). Not ours; upgradeable, and run by
 * an Agora admin who can pause it, set its price within bounds and its fee
 * (README, "What the contract can and cannot do"). Its price, fee, reserves
 * and pause are read fresh before every send.
 */
export const SETTLEMENT_PAIR: Address = getAddress("0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae");
/** Grants the pair's sender permission. On testnet anyone may grant it to themselves; read in docs/BOUNTIES.md. */
export const SETTLEMENT_WHITELISTER: Address = getAddress("0x7c10F56d6f04a51376393a1C3670e966863F6BD5");
/** CTK, Agora's test currency on the other side of the pair. */
export const CTK: Address = getAddress("0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D");

/**
 * Which pots deployment the app runs on. AUSD unless VITE_NIVPAY_POTS is
 * "testusd" at build time, read in deployment.ts since only Vite has
 * import.meta.env. Either way it is the testnet: CHAIN is checked above. On
 * AUSD "Add test dollars" claims from AUSD_FAUCET; on TESTUSD it mints the
 * worthless test token.
 */
export type Deployment = "ausd" | "testusd";

export function deploymentFrom(setting: string | undefined): Deployment {
  return setting?.trim().toLowerCase() === "testusd" ? "testusd" : "ausd";
}

export function potsFor(deployment: Deployment): Address {
  return deployment === "ausd" ? POTS_AUSD : POTS_TESTUSD;
}

/** Blocks the pots contracts were deployed in, from the same receipts. */
export const DEPLOY_BLOCK = {
  [POTS_AUSD]: 66096162n,
  [POTS_TESTUSD]: 66096818n,
} as const;

/**
 * NivPayPotsV2, pots whose deciders can change payees, limits and the
 * closing date, with a 72 hour exit window before any change that widens
 * spending (README, "Pots that can change"). One per token, next to the
 * NivPayPots above, which stays exactly as it is.
 *
 * Null until deployed: every V2 feature is hidden and new pots are made on
 * NivPayPots, as before. Once set, new pots are made on V2; pots already made
 * on NivPayPots keep working there, exactly as now. Set both addresses and
 * their blocks from the receipts under broadcast/DeployPotsV2.s.sol/10143/.
 */
export const POTS_V2 = null as Record<Deployment, Address> | null;
/** The blocks the two NivPayPotsV2 were deployed in. Null with POTS_V2. */
export const POTS_V2_DEPLOY_BLOCK = null as Record<Deployment, bigint> | null;

/** Every pots contract there is, so money from any of them shows as from a pot. */
export const ALL_POTS: Address[] = [POTS_AUSD, POTS_TESTUSD, ...(POTS_V2 ? [POTS_V2.ausd, POTS_V2.testusd] : [])];

/**
 * NivPayNames, the username registry (README, "Usernames for accounts"), one
 * for both deployments. Deployed in transaction 0x9bf29091dbe3167dfd72f6602a1f4d4d32f06039b6d001f7c1199f74df4d949e
 * (broadcast/DeployNames.s.sol/10143/). Set to null and every username
 * feature is hidden and the app works as it did without them.
 */
export const NAMES: Address | null = "0x798f4a11c16C96561fE7834365420505542e280D";
/** The block NivPayNames was deployed in, from its receipt. Null with NAMES. */
export const NAMES_DEPLOY_BLOCK: bigint | null = 71283172n;

/** eth_getLogs on the public RPC allows toBlock - fromBlock <= 100 (measured). */
export const LOG_PAGE_BLOCKS = 101n;
