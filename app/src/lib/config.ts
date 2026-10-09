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

/** eth_getLogs on the public RPC allows toBlock - fromBlock <= 100 (measured). */
export const LOG_PAGE_BLOCKS = 101n;
