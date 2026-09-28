// GET /api/fund/status: whether funding is on and the funder's balance.
// Nothing else. It never reads the funder key: FUNDER_ADDRESS is public.

import { createPublicClient, formatEther, getAddress, http, isAddress } from "viem";
import { monadTestnet } from "viem/chains";

const RPC_URL = "https://testnet-rpc.monad.xyz";

export type StatusEnv = { FUNDING_ENABLED?: string; FUNDER_ADDRESS?: string };

export async function handleStatus(
  env: StatusEnv,
  balanceOf: (address: `0x${string}`) => Promise<bigint>,
): Promise<Response> {
  const enabled = env.FUNDING_ENABLED === "true";
  let funderBalance: string | null = null;
  if (env.FUNDER_ADDRESS && isAddress(env.FUNDER_ADDRESS)) {
    try {
      funderBalance = `${formatEther(await balanceOf(getAddress(env.FUNDER_ADDRESS)))} MON`;
    } catch {
      funderBalance = null;
    }
  }
  return new Response(JSON.stringify({ enabled, funderBalance }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function GET(): Promise<Response> {
  const client = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL, { timeout: 10_000, retryCount: 1 }) });
  return handleStatus(process.env as StatusEnv, (address) => client.getBalance({ address }));
}
