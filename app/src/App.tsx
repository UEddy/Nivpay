import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { copy, ERROR_CODES, offlineMessage } from "./copy.ts";
import { AccountStore, type StoredAccount } from "./lib/accounts.ts";
import { ERC20_READ_ABI, TEST_DOLLAR_ABI } from "./lib/abi.ts";
import { liveWriteChain } from "./lib/chain.ts";
import { AUSD, AUSD_FAUCET, TESTUSD } from "./lib/config.ts";
import { DEPLOYMENT, POTS } from "./lib/deployment.ts";
import { DraftStore, newDraft } from "./lib/draft.ts";
import { AppError, describeFailure, SendFailure } from "./lib/errors.ts";
import { checkClaim, claimData, cooldownIn, readFaucetTerms, secondsUntil, type FaucetTerms } from "./lib/faucet.ts";
import { idbWriteStore, pendingWriteCount } from "./lib/idb.ts";
import { decodeLink, type Invite } from "./lib/invites.ts";
import { formatAmount, parseAmount } from "./lib/money.ts";
import { hostCheck, signIn, signUp } from "./lib/passkey.ts";
import { readClient } from "./lib/rpc.ts";
import { CREATE_LABEL } from "./lib/pots.ts";
import { retryStuckWrite, sendWrite, type Step } from "./lib/send.ts";
import { acceptReply } from "./lib/replies.ts";
import { followToFinality, type Outcome, type PendingWrite } from "./lib/writes.ts";
import { CreateScreen } from "./screens/Create.tsx";
import { JoinScreen } from "./screens/Join.tsx";
import { formatDay, NoticeLine, phoneTimeZone, type Notice } from "./screens/ui.tsx";

const accounts = new AccountStore(localStorage);
const drafts = new DraftStore(localStorage);

type Screen = { kind: "home" } | { kind: "create"; draftId: Hex } | { kind: "join"; invite: Invite };

/**
 * Swaps screens inside a view transition where the browser has one, so the
 * pot map can stay put while the rest changes. Elsewhere it swaps at once.
 */
function withTransition(change: () => void) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced && typeof document.startViewTransition === "function") {
    document.startViewTransition(() => flushSync(change));
  } else change();
}

/** Reads a NivPay link from the page's fragment once, then clears it so a reload doesn't act on it twice. */
function takeLinkFragment(): string | null {
  const fragment = location.hash.replace(/^#/, "");
  if (!fragment) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return fragment;
}

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
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [notice, setNotice] = useState<Notice | null>(null);
  // An invite opened before this phone had an account: joined once there is one.
  const [pendingInvite, setPendingInvite] = useState<Invite | null>(null);
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

  const go = useCallback((next: Screen, message: Notice | null = null) => {
    withTransition(() => {
      setNotice(message);
      setScreen(next);
    });
  }, []);

  /** Acts on a link opened from a chat: an invite, a reply to one of our drafts, or a pot. */
  const openLink = useCallback(
    async (fragment: string) => {
      let link;
      try {
        link = decodeLink(fragment);
      } catch {
        go({ kind: "home" }, { tone: "bad", text: copy.errLinkDamaged, code: ERROR_CODES.LINK_DAMAGED });
        return;
      }
      if (link.kind === "invite") {
        if (accounts.active()) go({ kind: "join", invite: link });
        else setPendingInvite(link);
        return;
      }
      if (link.kind === "reply") {
        try {
          const { draft, text } = await acceptReply(drafts, POTS, link);
          // The reply belongs to whichever account on this phone is making that pot.
          if (accounts.list().some((a) => a.address === draft.owner)) {
            accounts.setActive(draft.owner);
            setActive(accounts.active());
          }
          go({ kind: "create", draftId: draft.id }, { tone: "ok", text });
        } catch (e) {
          const failure = e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e);
          go({ kind: "home" }, { tone: "bad", ...failure });
        }
        return;
      }
      const ours = drafts.all().find((d) => d.made?.fragment === fragment);
      if (ours) go({ kind: "create", draftId: ours.id });
      else go({ kind: "home" }, { tone: "ok", text: copy.potLinkSoon });
    },
    [go],
  );

  useEffect(() => {
    const check = () => {
      const fragment = takeLinkFragment();
      if (fragment) void openLink(fragment);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [openLink]);

  const choose = (address: Address, name: string) => {
    accounts.upsert({ address, name });
    accounts.setActive(address);
    setActive(accounts.active());
    setSwitching(false);
    if (pendingInvite) {
      go({ kind: "join", invite: pendingInvite });
      setPendingInvite(null);
    }
  };

  const banner: ReactNode = connection.down && (
    <div className="banner" role="status">
      {offlineMessage(inFlight)}
    </div>
  );

  if (active && !switching && screen.kind === "create") {
    return (
      <CreateScreen
        key={screen.draftId}
        account={active}
        draftId={screen.draftId}
        drafts={drafts}
        banner={banner}
        notice={notice}
        onBack={() => go({ kind: "home" })}
      />
    );
  }
  if (active && !switching && screen.kind === "join") {
    return <JoinScreen account={active} invite={screen.invite} banner={banner} onClose={() => go({ kind: "home" })} />;
  }

  return (
    <div className="page">
      {banner}
      {active && !switching ? (
        <Home
          account={active}
          connection={connection}
          notice={notice}
          onSwitch={() => setSwitching(true)}
          onOpenDraft={(draftId) => go({ kind: "create", draftId })}
        />
      ) : (
        <Welcome
          known={accounts.list()}
          current={active}
          invitedBy={pendingInvite?.from}
          onReady={choose}
          onCancel={active ? () => setSwitching(false) : undefined}
        />
      )}
    </div>
  );
}

function Welcome(props: {
  known: StoredAccount[];
  current?: StoredAccount;
  invitedBy?: string;
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
      {props.invitedBy !== undefined && <div className="banner">{copy.joinNeedsAccount(props.invitedBy)}</div>}

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
/**
 * On the AUSD deployment, "Add test dollars" claims test AUSD from Agora's
 * faucet and only Dollars are shown. On TESTUSD it mints test dollars.
 */
type Balances =
  | { kind: "ausd"; dollars: Holding; faucet: FaucetTerms }
  | { kind: "testusd"; dollars: Holding; testDollars: Holding; maxMint: bigint };

/** Claims are told apart from mints by their label, which survives a reload. */
const CLAIM_LABEL = "claim";

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
  if (DEPLOYMENT === "ausd") {
    const [dollars, faucet] = await Promise.all([holding(AUSD), readFaucetTerms(block.number)]);
    return { kind: "ausd", dollars, faucet };
  }
  const [testDollars, dollars, maxMint] = await Promise.all([
    holding(TESTUSD),
    holding(AUSD),
    readClient.readContract({ address: TESTUSD, abi: TEST_DOLLAR_ABI, functionName: "MAX_MINT", ...at }),
  ]);
  return { kind: "testusd", testDollars, dollars, maxMint };
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
  notice: Notice | null;
  onSwitch: () => void;
  onOpenDraft: (draftId: Hex) => void;
}) {
  const { account, connection } = props;
  const [balances, setBalances] = useState<Balances | null>(null);
  const [amountText, setAmountText] = useState("1,000");
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [result, setResult] = useState<Notice | null>(null);
  const [stuck, setStuck] = useState(false);
  const [details, setDetails] = useState(false);
  // The faucet's shared cooldown: when, on this phone's clock, a claim is
  // allowed again. Nothing is claimed when it ends; the person taps again.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);

  useEffect(() => {
    if (cooldownUntil === null) return;
    setNow(Date.now());
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= cooldownUntil) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [cooldownUntil]);
  const cooldownLeft = cooldownUntil === null ? 0 : secondsUntil(cooldownUntil, now);

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
        setResult(
          write.label.startsWith(CLAIM_LABEL)
            ? { tone: "bad", text: copy.claimDidNotGoThrough, code: ERROR_CODES.CLAIM_REVERTED }
            : { tone: "bad", text: copy.didNotGoThrough, code: ERROR_CODES.REVERTED },
        );
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
      // Only dollar claims and mints are followed here; a pot's screen follows its own.
      if (!w || w.label.startsWith(CREATE_LABEL)) return;
      if (w.replaceable) {
        setStuck(true);
        setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
      } else void land(w, "your");
    });
  }, [account.address, land]);

  const decimals = balances?.kind === "testusd" ? balances.testDollars.decimals : (balances?.dollars.decimals ?? 6);
  const amount = balances?.kind === "ausd" ? balances.faucet.drip : parseAmount(amountText, decimals);
  const tooMuch = amount !== null && balances?.kind === "testusd" && amount > balances.maxMint;
  const valid = amount !== null && amount > 0n && !tooMuch;

  const add = async (retry: boolean) => {
    if (!valid || amount === null || !balances) return;
    setResult(null);
    setCooldownUntil(null);
    const label = formatAmount(amount, decimals, "auto");
    try {
      if (balances.kind === "ausd") {
        const { faucet } = balances;
        const call = {
          from: account.address,
          to: AUSD_FAUCET,
          data: claimData(account.address),
          label: `${CLAIM_LABEL} ${label} AUSD`,
          onStep: setStep,
        };
        if (retry) {
          await land(await retryStuckWrite(call), label);
          return;
        }
        // Ask the faucet first, so a cooldown or the ceiling costs no grant
        // and no passkey prompt.
        setStep("preparing");
        await checkClaim(account.address, faucet, decimals);
        const write = await sendWrite(call).catch(async (e: unknown) => {
          // Someone else may have claimed since the check: say so precisely.
          if (e instanceof SendFailure && !e.broadcast && e.stage === "preparing") {
            await checkClaim(account.address, faucet, decimals);
          }
          throw e;
        });
        await land(write, label);
        return;
      }
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
      const cooldown = cooldownIn(e);
      if (cooldown) setCooldownUntil(cooldown.until);
      else setResult({ tone: "bad", ...describeFailure(e) });
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

      {props.notice && <NoticeLine notice={props.notice} />}

      <section className="card balances" aria-live="polite">
        <p className="eyebrow">{copy.yourBalance}</p>
        {!balances ? (
          <p className="lede">{copy.readingBalance}</p>
        ) : (
          <>
            <div className="row balance">
              <span className="label">
                {copy.dollars}
                <br />
                <small>{copy.dollarsLine}</small>
              </span>
              <span className="balance-amount">{formatAmount(balances.dollars.balance, balances.dollars.decimals, "cents")}</span>
            </div>
            {balances.kind === "testusd" && (
              <div className="row balance">
                <span className="label">
                  {copy.testDollars}
                  <br />
                  <small>{copy.testDollarsLine}</small>
                </span>
                <span className="balance-amount">{formatAmount(balances.testDollars.balance, balances.testDollars.decimals, "cents")}</span>
              </div>
            )}
          </>
        )}
      </section>

      <YourPots account={account} onOpen={props.onOpenDraft} />

      <section className="card">
        <p className="eyebrow">{copy.addTestDollars}</p>
        <p className="hint">{copy.addTestDollarsHint}</p>
        {balances?.kind === "ausd" ? (
          <p className="hint">
            {copy.claimAmountHint(formatAmount(balances.faucet.drip, decimals, "auto"), formatAmount(balances.faucet.ceiling, decimals, "auto"))}
          </p>
        ) : (
          <label className="field">
            <span>{copy.howMany}</span>
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </label>
        )}
        {tooMuch && balances?.kind === "testusd" && (
          <p className="error">{copy.upToAtATime(formatAmount(balances.maxMint, decimals, "auto"))}</p>
        )}
        {cooldownUntil === null ? (
          <button className="btn primary" disabled={!valid || step !== null || !balances} onClick={() => add(false)}>
            {step === "landing" ? copy.stepSending : step ? STEP_LABEL[step] : copy.addTestDollars}
          </button>
        ) : (
          <>
            <button className="btn primary" disabled={cooldownLeft > 0 || step !== null} onClick={() => add(false)}>
              {copy.tryAgain}
            </button>
            <NoticeLine
              notice={
                cooldownLeft > 0
                  ? { tone: "bad", text: `${copy.errClaimCooldown(cooldownLeft)} ${copy.nothingWasSent}`, code: ERROR_CODES.CLAIM_COOLDOWN }
                  : { tone: "ok", text: copy.claimCooldownOver }
              }
            />
          </>
        )}
        {stuck && step === null && (
          <button className="btn" onClick={() => add(true)}>
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

/** The pots this account is making or has made on this phone. */
function YourPots(props: { account: StoredAccount; onOpen: (draftId: Hex) => void }) {
  const mine = drafts.forOwner(props.account.address);
  const start = () => {
    const draft = newDraft(props.account.address, phoneTimeZone(), Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
    drafts.put(draft);
    props.onOpen(draft.id);
  };
  return (
    <section className="card">
      <p className="eyebrow">{copy.yourPots}</p>
      {mine.length === 0 && <p className="hint">{copy.noPotsYet}</p>}
      {mine.map((d) => (
        <button type="button" className="home-pot" key={d.id} onClick={() => props.onOpen(d.id)}>
          <span className="grow">
            <span className="name">{d.name || copy.unnamedPot}</span>
            <span className="meta">{d.made ? copy.potRowMade(formatDay(d.closes)) : copy.potRowDraft(d.deciders.length + 1)}</span>
          </span>
          <span className={`tag${d.made ? " live" : ""}`}>{d.made ? copy.live : copy.draft}</span>
        </button>
      ))}
      <button type="button" className="btn primary" onClick={start}>
        {copy.makeAPot}
      </button>
    </section>
  );
}
