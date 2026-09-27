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

/** Blocks the pots contracts were deployed in, from the same receipts. */
export const DEPLOY_BLOCK = {
  [POTS_AUSD]: 66096162n,
  [POTS_TESTUSD]: 66096818n,
} as const;

/** eth_getLogs on the public RPC allows toBlock - fromBlock <= 100 (measured). */
export const LOG_PAGE_BLOCKS = 101n;
