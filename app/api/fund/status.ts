// GET /api/fund/status: whether funding is on, the funder's balance, and
// whether the funder key parses and belongs to FUNDER_ADDRESS. Nothing else.
//
// keyMatches is only ever true or false. The key is read to derive its
// address and compare it, and nothing about it (not its length, not why it
// failed) is returned or logged. It exists because "enabled" and a healthy
// balance said nothing about whether grants could actually be signed.

import { createPublicClient, formatEther, getAddress, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const RPC_URL = "https://testnet-rpc.monad.xyz";

export type StatusEnv = { FUNDING_ENABLED?: string; FUNDER_ADDRESS?: string; FUNDER_PRIVATE_KEY?: string };

/**
 * True only when the key parses the same way /api/fund parses it (surrounding
 * whitespace allowed, 0x optional) and derives FUNDER_ADDRESS. A test keeps
 * this in step with normalizeFunderKey in ./index.ts.
 */
export function funderKeyMatches(env: StatusEnv): boolean {
  try {
    if (!env.FUNDER_ADDRESS || !isAddress(env.FUNDER_ADDRESS)) return false;
    const key = (env.FUNDER_PRIVATE_KEY ?? "").trim();
    const withPrefix = /^[0-9a-fA-F]{64}$/.test(key) ? `0x${key}` : key;
    if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) return false;
    return privateKeyToAccount(withPrefix as Hex).address === getAddress(env.FUNDER_ADDRESS);
  } catch {
    return false;
  }
}

export async function handleStatus(
  env: StatusEnv,
  balanceOf: (address: `0x${string}`) => Promise<bigint>,
): Promise<Response> {
  const enabled = env.FUNDING_ENABLED === "true";
  const keyMatches = funderKeyMatches(env);
  let funderBalance: string | null = null;
  if (env.FUNDER_ADDRESS && isAddress(env.FUNDER_ADDRESS)) {
    try {
      funderBalance = `${formatEther(await balanceOf(getAddress(env.FUNDER_ADDRESS)))} MON`;
    } catch {
      funderBalance = null;
    }
  }
  return new Response(JSON.stringify({ enabled, keyMatches, funderBalance }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function GET(): Promise<Response> {
  const client = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL, { timeout: 10_000, retryCount: 1 }) });
  return handleStatus(process.env as StatusEnv, (address) => client.getBalance({ address }));
}
