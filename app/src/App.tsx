import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { copy, ERROR_CODES, offlineMessage } from "./copy.ts";
import { AccountStore, type StoredAccount } from "./lib/accounts.ts";
import { ERC20_READ_ABI, TEST_DOLLAR_ABI } from "./lib/abi.ts";
import { liveWriteChain } from "./lib/chain.ts";
import { AUSD, TESTUSD } from "./lib/config.ts";
import { describeFailure, SendFailure } from "./lib/errors.ts";
import { idbWriteStore, pendingWriteCount } from "./lib/idb.ts";
import { formatAmount, parseAmount } from "./lib/money.ts";
import { hostCheck, signIn, signUp } from "./lib/passkey.ts";
import { readClient } from "./lib/rpc.ts";
import { retryStuckWrite, sendWrite, type Step } from "./lib/send.ts";
import { followToFinality, type Outcome, type PendingWrite } from "./lib/writes.ts";

type Notice = { tone: "ok" | "bad"; text: string; code?: number };

/** A result line. Failures end with a neutral code people can read out to support. */
function NoticeLine({ notice }: { notice: Notice }) {
  return (
    <div role="status">
      <p className={notice.tone === "ok" ? "success" : "error"}>{notice.text}</p>
      {notice.code !== undefined && <p className="reason">{copy.code(notice.code)}</p>}
    </div>
  );
}

const accounts = new AccountStore(localStorage);

/** Connection health comes from real read failures, not navigator.onLine. */
function useConnection() {
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

function TestModeBadge() {
  return <span className="badge">{copy.testMode}</span>;
}

export function App() {
  const [active, setActive] = useState<StoredAccount | undefined>(() => accounts.active());
  const [switching, setSwitching] = useState(false);
  const connection = useConnection();
  // Requests from this phone still in flight. Unknown until checked, and
  // unknown is never read as "nothing moved".
  const [inFlight, setInFlight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!connection.down) return;
    let live = true;
    const check = () => pendingWriteCount().then((n) => live && setInFlight(n));
    void check();
    const t = setInterval(check, 2_000);
    return () => {
      live = false;
      clearInterval(t);
      setInFlight(undefined);
    };
  }, [connection.down]);

  const choose = (address: Address, name: string) => {
    accounts.upsert({ address, name });
    accounts.setActive(address);
    setActive(accounts.active());
    setSwitching(false);
  };

  return (
    <>
      {connection.down && (
        <div className="banner" role="status">
          {offlineMessage(inFlight)}
        </div>
      )}
      {active && !switching ? (
        <Home account={active} connection={connection} onSwitch={() => setSwitching(true)} />
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
  const [error, setError] = useState<Notice | null>(null);

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
      setError({ tone: "bad", ...describeFailure(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <header className="top">
        <PotMark />
        <TestModeBadge />
      </header>
      <h1>{props.current ? copy.switchAccount : copy.appName}</h1>
      <p className="lede">{copy.tagline}</p>

      {!host.ok ? (
        <div className="card">
          <p className="lede">{host.message}</p>
          <p className="reason">{copy.code(ERROR_CODES.HOST_NOT_ALLOWED)}</p>
        </div>
      ) : (
        <>
          {props.known.length > 0 && (
            <section className="card">
              <p className="eyebrow">{copy.accountsOnThisPhone}</p>
              {props.known.map((a) => (
                <div className="row" key={a.address}>
                  <span className="value">{a.name}</span>
                  <span className="label">{copy.accountEnding(a.address)}</span>
                </div>
              ))}
              <button className="btn" disabled={busy !== null} onClick={() => run("in")}>
                {busy === "in" ? copy.waitingForPasskey : copy.useOneOfThese}
              </button>
              <p className="hint">{copy.pickAccountHint}</p>
            </section>
          )}

          <section className="card">
            <p className="eyebrow">{props.known.length ? copy.addAnotherAccount : copy.makeYourAccount}</p>
            <label className="field">
              <span>{copy.yourName}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="given-name"
                maxLength={40}
                placeholder={copy.namePlaceholder}
              />
            </label>
            <button className="btn primary" disabled={busy !== null || !name.trim()} onClick={() => run("up")}>
              {busy === "up" ? copy.waitingForPasskey : copy.createAccount}
            </button>
            <p className="hint">{copy.createAccountHint}</p>
          </section>

          {props.known.length === 0 && (
            <button className="btn" disabled={busy !== null} onClick={() => run("in")}>
              {busy === "in" ? copy.waitingForPasskey : copy.alreadyHaveAccount}
            </button>
          )}
        </>
      )}

      {error && <NoticeLine notice={error} />}
      {props.onCancel && (
        <button className="btn ghost" onClick={props.onCancel}>
          {copy.back}
        </button>
      )}
    </>
  );
}

/** Account details: the only place the Account ID appears, for support. */
function AccountSheet(props: { account: StoredAccount; onSwitch: () => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyId = () => {
    navigator.clipboard
      .writeText(props.account.address)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return (
    <div className="sheet-backdrop" role="presentation" onClick={props.onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={copy.accountDetails} onClick={(e) => e.stopPropagation()}>
        <p className="eyebrow">{copy.accountDetails}</p>
        <h2>{props.account.name}</h2>
        <div className="field">
          <span>{copy.accountId}</span>
          <code className="account-id">{props.account.address}</code>
        </div>
        <button className="btn" onClick={copyId}>
          {copied ? copy.copied : copy.copyAction}
        </button>
        <p className="hint">{copy.accountIdHint}</p>
        <button className="btn" onClick={props.onSwitch}>
          {copy.switchAccount}
        </button>
        <button className="btn ghost" onClick={props.onClose}>
          {copy.close}
        </button>
      </section>
    </div>
  );
}

type Holding = { decimals: number; balance: bigint };
type Balances = { testDollars: Holding; dollars: Holding; maxMint: bigint };

async function readBalances(address: Address): Promise<Balances> {
  const block = await readClient.getBlock({ blockTag: "finalized" });
  const at = { blockNumber: block.number } as const;
  const holding = async (asset: Address): Promise<Holding> => {
    const [decimals, balance] = await Promise.all([
      readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "decimals", ...at }),
      readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [address], ...at }),
    ]);
    return { decimals, balance };
  };
  const [testDollars, dollars, maxMint] = await Promise.all([
    holding(TESTUSD),
    holding(AUSD),
    readClient.readContract({ address: TESTUSD, abi: TEST_DOLLAR_ABI, functionName: "MAX_MINT", ...at }),
  ]);
  return { testDollars, dollars, maxMint };
}

const STEP_LABEL: Record<Step, string> = {
  preparing: copy.stepPreparing,
  "getting-ready": copy.stepGettingReady,
  confirm: copy.stepConfirm,
  sending: copy.stepSending,
};

function Home(props: {
  account: StoredAccount;
  connection: ReturnType<typeof useConnection>;
  onSwitch: () => void;
}) {
  const { account, connection } = props;
  const [balances, setBalances] = useState<Balances | null>(null);
  const [amountText, setAmountText] = useState("1,000");
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [result, setResult] = useState<Notice | null>(null);
  const [stuck, setStuck] = useState(false);
  const [details, setDetails] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(() => {
    connection
      .track(readBalances(account.address))
      .then((b) => alive.current && setBalances(b))
      .catch(() => {});
  }, [account.address, connection]);

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
      let outcome: Outcome;
      try {
        outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
      } catch (e) {
        // It was sent; only following it failed. The record is still saved
        // and tracking resumes on the next load.
        if (alive.current) {
          setStep(null);
          setResult({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
        }
        return;
      }
      if (!alive.current) return;
      setStep(null);
      if (outcome.kind === "final") {
        setStuck(false);
        setResult({ tone: "ok", text: copy.added(amountLabel, (outcome.settledMs / 1000).toFixed(1)) });
      } else if (outcome.kind === "stuck") {
        setStuck(true);
        setResult({ tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
      } else if (outcome.kind === "reverted") {
        setStuck(false);
        setResult({ tone: "bad", text: copy.didNotGoThrough, code: ERROR_CODES.REVERTED });
      } else {
        setStuck(false);
        setResult({ tone: "bad", text: copy.didNotGoThrough, code: ERROR_CODES.SUPERSEDED });
      }
      refresh();
    },
    [refresh],
  );

  // Resume a request that was in flight when the page was closed or reloaded.
  useEffect(() => {
    idbWriteStore.get(account.address).then((w) => {
      if (!w) return;
      if (w.replaceable) {
        setStuck(true);
        setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
      } else void land(w, "your");
    });
  }, [account.address, land]);

  const decimals = balances?.testDollars.decimals ?? 6;
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
      setResult({ tone: "bad", ...describeFailure(e) });
    }
  };

  return (
    <>
      <header className="top">
        <div>
          <h1>{account.name}</h1>
          <TestModeBadge />
        </div>
        <button className="btn ghost small" onClick={() => setDetails(true)}>
          {copy.accountDetails}
        </button>
      </header>

      <section className="card" aria-live="polite">
        <p className="eyebrow">{copy.yourBalance}</p>
        {!balances ? (
          <p className="lede">{copy.readingBalance}</p>
        ) : (
          <>
            <div className="row">
              <span className="label">
                {copy.dollars}
                <br />
                <small>{copy.dollarsLine}</small>
              </span>
              <span className="value amount">{formatAmount(balances.dollars.balance, balances.dollars.decimals, "cents")}</span>
            </div>
            <div className="row">
              <span className="label">
                {copy.testDollars}
                <br />
                <small>{copy.testDollarsLine}</small>
              </span>
              <span className="value amount">{formatAmount(balances.testDollars.balance, balances.testDollars.decimals, "cents")}</span>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <p className="eyebrow">{copy.addTestDollars}</p>
        <p className="hint">{copy.addTestDollarsHint}</p>
        <label className="field">
          <span>{copy.howMany}</span>
          <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </label>
        {tooMuch && balances && <p className="error">{copy.upToAtATime(formatAmount(balances.maxMint, decimals, "auto"))}</p>}
        <button className="btn primary" disabled={!valid || step !== null || !balances} onClick={() => mint(false)}>
          {step === "landing" ? copy.stepSending : step ? STEP_LABEL[step] : copy.addTestDollars}
        </button>
        {stuck && step === null && (
          <button className="btn" onClick={() => mint(true)}>
            {copy.tryAgain}
          </button>
        )}
        {result && <NoticeLine notice={result} />}
      </section>

      {details && (
        <AccountSheet
          account={account}
          onClose={() => setDetails(false)}
          onSwitch={() => {
            setDetails(false);
            props.onSwitch();
          }}
        />
      )}
    </>
  );
}
