import { useEffect, useState } from "react";
import type { Address } from "viem";
import { ERC20_READ_ABI, POTS_READ_ABI } from "./lib/abi.ts";
import { CHAIN_ID, POTS_AUSD, POTS_TESTUSD } from "./lib/config.ts";
import { formatAmount } from "./lib/money.ts";
import { readClient } from "./lib/rpc.ts";

type Instance = {
  label: string;
  pots: Address;
  symbol: string;
  pots_made: bigint;
  feeBps: bigint;
  feeCap: string;
};

type Status =
  | { kind: "loading" }
  | { kind: "ready"; block: bigint; instances: Instance[] }
  | { kind: "error"; message: string };

async function readInstance(label: string, pots: Address, blockNumber: bigint): Promise<Instance> {
  const at = { address: pots, abi: POTS_READ_ABI, blockNumber } as const;
  const [token, count, feeBps, feeCap] = await Promise.all([
    readClient.readContract({ ...at, functionName: "token" }),
    readClient.readContract({ ...at, functionName: "potCount" }),
    readClient.readContract({ ...at, functionName: "feeBps" }),
    readClient.readContract({ ...at, functionName: "feeCap" }),
  ]);
  const erc20 = { address: token, abi: ERC20_READ_ABI, blockNumber } as const;
  const [symbol, decimals] = await Promise.all([
    readClient.readContract({ ...erc20, functionName: "symbol" }),
    readClient.readContract({ ...erc20, functionName: "decimals" }),
  ]);
  return { label, pots, symbol, pots_made: count, feeBps, feeCap: formatAmount(feeCap, decimals, "auto") };
}

/** Phase 1 shell: proves fonts, tokens, CSP, the RPC and finalized reads work. */
export function App() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const chainId = await readClient.getChainId();
        if (chainId !== CHAIN_ID) throw new Error(`The network answered as chain ${chainId}, not Monad testnet.`);
        const block = await readClient.getBlock({ blockTag: "finalized" });
        const instances = await Promise.all([
          readInstance("AUSD pots", POTS_AUSD, block.number),
          readInstance("Test dollar pots", POTS_TESTUSD, block.number),
        ]);
        if (alive) setStatus({ kind: "ready", block: block.number, instances });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (alive) setStatus({ kind: "error", message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [online]);

  return (
    <>
      <svg className="pot-mark" viewBox="0 0 200 200" aria-hidden="true">
        <path
          d="M72 38 C72 50 60 54 50 63 C28 82 23 118 35 146 C47 173 76 186 100 186 C124 186 153 173 165 146 C177 118 172 82 150 63 C140 54 128 50 128 38 Z"
          fill="var(--pot-clay)"
          stroke="var(--ink)"
          strokeWidth="5.5"
          strokeLinejoin="round"
        />
        <rect x="62" y="26" width="76" height="14" rx="7" fill="var(--pot-lid)" stroke="var(--ink)" strokeWidth="5.5" />
      </svg>
      <h1>NivPay</h1>
      <p className="lede">A group purse for one purpose that no single person can pocket.</p>

      {!online && <div className="banner">You are offline. Nothing can move until you are back online.</div>}

      <section className="card" aria-live="polite">
        <p className="eyebrow">Monad testnet, finalized</p>
        {status.kind === "loading" && <p className="lede">Reading the chain.</p>}
        {status.kind === "error" && <p className="lede">Could not reach the network. {status.message}</p>}
        {status.kind === "ready" && (
          <>
            <div className="row">
              <span className="label">Finalized block</span>
              <span className="value">{status.block.toString()}</span>
            </div>
            {status.instances.map((i) => (
              <div className="row" key={i.pots}>
                <span className="label">{i.label}</span>
                <span className="value">
                  {i.symbol}, {i.pots_made.toString()} pots, fee {Number(i.feeBps) / 100}% up to {i.feeCap}
                </span>
              </div>
            ))}
          </>
        )}
      </section>
    </>
  );
}
