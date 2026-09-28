import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { AccountStore, shortAddress, type StoredAccount } from "./lib/accounts.ts";
import { ERC20_READ_ABI, TEST_DOLLAR_ABI } from "./lib/abi.ts";
import { liveWriteChain } from "./lib/chain.ts";
import { AUSD, TESTUSD } from "./lib/config.ts";
import { passkeyErrorMessage } from "./lib/errors.ts";
import { idbWriteStore } from "./lib/idb.ts";
import { formatAmount, parseAmount } from "./lib/money.ts";
import { hostCheck, signIn, signUp } from "./lib/passkey.ts";
import { readClient } from "./lib/rpc.ts";
import { retryStuckWrite, sendWrite, type Step } from "./lib/send.ts";
import { followToFinality, WriteInFlightError, type Outcome, type PendingWrite } from "./lib/writes.ts";

const accounts = new AccountStore(localStorage);

/** Network health comes from real RPC failures, not navigator.onLine. */
function useNetwork() {
  const [down, setDown] = useState(false);
  const track = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    try {
      const v = await p;
      setDown(false);
      return v;
    } catch (e) {
      setDown(true);
      throw e;
    }
  }, []);
  return { down, track };
}

function PotMark() {
  return (
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
  );
}

export function App() {
  const [active, setActive] = useState<StoredAccount | undefined>(() => accounts.active());
  const [switching, setSwitching] = useState(false);
  const network = useNetwork();

  const choose = (address: Address, name: string) => {
    accounts.upsert({ address, name });
    accounts.setActive(address);
    setActive(accounts.active());
    setSwitching(false);
  };

  return (
    <>
      {network.down && (
        <div className="banner" role="status">
          Can't reach the network right now. Nothing has moved. Trying again.
        </div>
      )}
      {active && !switching ? (
        <Home account={active} network={network} onSwitch={() => setSwitching(true)} />
      ) : (
        <Welcome
          known={accounts.list()}
          current={active}
          onReady={choose}
          onCancel={active ? () => setSwitching(false) : undefined}
        />
      )}
    </>
  );
}

function Welcome(props: {
  known: StoredAccount[];
  current?: StoredAccount;
  onReady: (address: Address, name: string) => void;
  onCancel?: () => void;
}) {
  const host = useMemo(() => hostCheck(), []);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"up" | "in" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "up" | "in") => {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "up") props.onReady(await signUp(name.trim()), name.trim());
      else {
        const address = await signIn();
        props.onReady(address, props.known.find((a) => a.address === address)?.name ?? "");
      }
    } catch (e) {
      setError(e instanceof Error && e.name === "HostNotAllowedError" ? e.message : passkeyErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PotMark />
      <h1>{props.current ? "Switch account" : "NivPay"}</h1>
      <p className="lede">A group purse for one purpose that no single person can pocket.</p>

      {!host.ok ? (
        <div className="card">
          <p className="lede">{host.message}</p>
        </div>
      ) : (
        <>
          {props.known.length > 0 && (
            <section className="card">
              <p className="eyebrow">Accounts on this phone</p>
              {props.known.map((a) => (
                <div className="row" key={a.address}>
                  <span className="value">{a.name}</span>
                  <span className="label">{shortAddress(a.address)}</span>
                </div>
              ))}
              <button className="btn" disabled={busy !== null} onClick={() => run("in")}>
                {busy === "in" ? "Waiting for your passkey…" : "Use one of these"}
              </button>
              <p className="hint">Your phone asks which passkey. Pick the account you want.</p>
            </section>
          )}

          <section className="card">
            <p className="eyebrow">{props.known.length ? "Add another account" : "Make your account"}</p>
            <label className="field">
              <span>Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="given-name"
                maxLength={40}
                placeholder="Idara"
              />
            </label>
            <button className="btn primary" disabled={busy !== null || !name.trim()} onClick={() => run("up")}>
              {busy === "up" ? "Waiting for your passkey…" : "Create your account"}
            </button>
            <p className="hint">Your account is a passkey on this phone. There is no password and nothing to write down.</p>
          </section>

          {props.known.length === 0 && (
            <button className="btn" disabled={busy !== null} onClick={() => run("in")}>
              {busy === "in" ? "Waiting for your passkey…" : "I already have an account"}
            </button>
          )}
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {props.onCancel && (
        <button className="btn ghost" onClick={props.onCancel}>
          Back
        </button>
      )}
    </>
  );
}

type Token = { symbol: string; decimals: number; balance: bigint };
type Balances = { testusd: Token; ausd: Token; maxMint: bigint };

async function readBalances(address: Address): Promise<Balances> {
  const block = await readClient.getBlock({ blockTag: "finalized" });
  const at = { blockNumber: block.number } as const;
  const token = async (addr: Address): Promise<Token> => {
    const [symbol, decimals, balance] = await Promise.all([
      readClient.readContract({ address: addr, abi: ERC20_READ_ABI, functionName: "symbol", ...at }),
      readClient.readContract({ address: addr, abi: ERC20_READ_ABI, functionName: "decimals", ...at }),
      readClient.readContract({ address: addr, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [address], ...at }),
    ]);
    return { symbol, decimals, balance };
  };
  const [testusd, ausd, maxMint] = await Promise.all([
    token(TESTUSD),
    token(AUSD),
    readClient.readContract({ address: TESTUSD, abi: TEST_DOLLAR_ABI, functionName: "MAX_MINT", ...at }),
  ]);
  return { testusd, ausd, maxMint };
}

const STEP_LABEL: Record<Step, string> = {
  preparing: "Getting ready…",
  "getting-ready": "Getting your account ready…",
  confirm: "Confirm with your fingerprint",
  sending: "Adding test dollars…",
};

function Home(props: {
  account: StoredAccount;
  network: ReturnType<typeof useNetwork>;
  onSwitch: () => void;
}) {
  const { account, network } = props;
  const [balances, setBalances] = useState<Balances | null>(null);
  const [amountText, setAmountText] = useState("1,000");
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [stuck, setStuck] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(() => {
    network
      .track(readBalances(account.address))
      .then((b) => alive.current && setBalances(b))
      .catch(() => {});
  }, [account.address, network]);

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(refresh, 5_000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [refresh]);

  const land = useCallback(
    async (write: PendingWrite, amountLabel: string) => {
      setStep("landing");
      const outcome: Outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
      if (!alive.current) return;
      setStep(null);
      if (outcome.kind === "final") {
        setStuck(false);
        setResult({ tone: "ok", text: `Added ${amountLabel} test dollars. Settled in ${(outcome.settledMs / 1000).toFixed(1)}s.` });
      } else if (outcome.kind === "stuck") {
        setStuck(true);
        setResult({ tone: "bad", text: "This is taking longer than it should. Nothing has moved yet." });
      } else {
        setStuck(false);
        setResult({ tone: "bad", text: "That didn't go through. Nothing moved." });
      }
      refresh();
    },
    [refresh],
  );

  // Resume a write that was in flight when the page was closed or reloaded.
  useEffect(() => {
    idbWriteStore.get(account.address).then((w) => {
      if (!w) return;
      if (w.replaceable) {
        setStuck(true);
        setResult({ tone: "bad", text: "An earlier attempt is taking longer than it should. Nothing has moved yet." });
      } else void land(w, "your");
    });
  }, [account.address, land]);

  const decimals = balances?.testusd.decimals ?? 6;
  const amount = parseAmount(amountText, decimals);
  const tooMuch = amount !== null && balances !== null && amount > balances.maxMint;
  const valid = amount !== null && amount > 0n && !tooMuch;

  const mint = async (retry: boolean) => {
    if (!valid || amount === null) return;
    setResult(null);
    const label = formatAmount(amount, decimals, "auto");
    try {
      const call = {
        from: account.address,
        to: TESTUSD,
        data: encodeFunctionData({ abi: TEST_DOLLAR_ABI, functionName: "mint", args: [account.address, amount] }),
        label: `mint ${label} TESTUSD`,
        onStep: setStep,
      };
      const write = retry ? await retryStuckWrite(call) : await sendWrite(call);
      await land(write, label);
    } catch (e) {
      setStep(null);
      const text =
        e instanceof WriteInFlightError || (e instanceof Error && e.name === "NotEnoughGasError")
          ? e.message
          : e instanceof Error && /may still go through|no stuck payment/.test(e.message)
            ? e.message
            : passkeyErrorMessage(e);
      setResult({ tone: "bad", text });
    }
  };

  return (
    <>
      <header className="top">
        <div>
          <h1>{account.name}</h1>
          <p className="hint">{shortAddress(account.address)}</p>
        </div>
        <button className="btn ghost small" onClick={props.onSwitch}>
          Switch account
        </button>
      </header>

      <section className="card" aria-live="polite">
        <p className="eyebrow">Your balance</p>
        {!balances ? (
          <p className="lede">Reading your balance…</p>
        ) : (
          <>
            <div className="row">
              <span className="label">
                Test dollars
                <br />
                <small>Test dollars, not real money.</small>
              </span>
              <span className="value amount">{formatAmount(balances.testusd.balance, balances.testusd.decimals, "cents")}</span>
            </div>
            <div className="row">
              <span className="label">
                {balances.ausd.symbol}
                <br />
                <small>Held as AUSD digital dollars.</small>
              </span>
              <span className="value amount">{formatAmount(balances.ausd.balance, balances.ausd.decimals, "cents")}</span>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <p className="eyebrow">Get test dollars</p>
        <p className="hint">
          For trying NivPay out. These are test dollars, not real money, and they only work on the test network.
        </p>
        <label className="field">
          <span>How many</span>
          <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </label>
        {tooMuch && balances && (
          <p className="error">Up to {formatAmount(balances.maxMint, decimals, "auto")} at a time.</p>
        )}
        <button className="btn primary" disabled={!valid || step !== null || !balances} onClick={() => mint(false)}>
          {step === "landing" ? "Adding test dollars…" : step ? STEP_LABEL[step] : "Get test dollars"}
        </button>
        {stuck && step === null && (
          <button className="btn" onClick={() => mint(true)}>
            Try again
          </button>
        )}
        {result && (
          <p className={result.tone === "ok" ? "success" : "error"} role="status">
            {result.text}
          </p>
        )}
      </section>
    </>
  );
}
