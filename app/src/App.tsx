import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { copy, ERROR_CODES, offlineMessage } from "./copy.ts";
import { AccountStore, type StoredAccount } from "./lib/accounts.ts";
import { ERC20_READ_ABI, TEST_DOLLAR_ABI } from "./lib/abi.ts";
import { liveWriteChain } from "./lib/chain.ts";
import { AUSD, AUSD_FAUCET, TESTUSD } from "./lib/config.ts";
import { DEPLOYMENT, POTS, POTS_DEPLOY_BLOCK } from "./lib/deployment.ts";
import { DraftStore, newDraft, potRecipients, type Draft } from "./lib/draft.ts";
import { findPots, ScanStore, type FoundPot, type Role, type ScanState } from "./lib/discover.ts";
import { creatorReader, potsReader } from "./lib/discoverLive.ts";
import { AppError, describeFailure, SendFailure } from "./lib/errors.ts";
import { checkClaim, claimData, cooldownIn, readFaucetTerms, secondsUntil, type FaucetTerms } from "./lib/faucet.ts";
import { idbWriteStore, pendingWriteCount } from "./lib/idb.ts";
import { InvitedStore, matchInvites, type AnsweredInvite } from "./lib/invited.ts";
import { decodeLink, type Invite, type PayLink, type PotLink } from "./lib/invites.ts";
import { formatAmount, parseAmount } from "./lib/money.ts";
import { hostCheck, signIn, signUp } from "./lib/passkey.ts";
import { readClient } from "./lib/rpc.ts";
import { PotStore, rememberPotLink, type StoredPot } from "./lib/potstore.ts";
import { retryStuckWrite, sendWrite, type Step } from "./lib/send.ts";
import { acceptReply } from "./lib/replies.ts";
import { latestReceipt, receiptUrl, rememberReceipt } from "./lib/receipts.ts";
import { CURRENCY_LABEL } from "./lib/settle.ts";
import { SEND_LABEL } from "./lib/transfer.ts";
import { followToFinality, type Outcome, type PendingWrite } from "./lib/writes.ts";
import { ChipInScreen } from "./screens/ChipIn.tsx";
import { CreateScreen } from "./screens/Create.tsx";
import { JoinScreen } from "./screens/Join.tsx";
import { ReceiveScreen } from "./screens/Receive.tsx";
import { SendScreen } from "./screens/Send.tsx";
import { formatDay, NoticeLine, phoneTimeZone, type Notice } from "./screens/ui.tsx";

const accounts = new AccountStore(localStorage);
const drafts = new DraftStore(localStorage);
const pots = new PotStore(localStorage);
const invited = new InvitedStore(localStorage);

type Screen =
  | { kind: "home" }
  | { kind: "create"; draftId: Hex }
  | { kind: "join"; invite: Invite }
  | { kind: "pot"; pot: StoredPot }
  | { kind: "send"; request: PayLink | null }
  | { kind: "receive" };

function storedFromLink(link: PotLink, fragment: string): StoredPot {
  return rememberPotLink(pots, link, fragment, Date.now());
}

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
  // An invite or pot opened before this phone had an account: opened once there is one.
  const [pendingInvite, setPendingInvite] = useState<Invite | null>(null);
  const [pendingPot, setPendingPot] = useState<StoredPot | null>(null);
  const [pendingPay, setPendingPay] = useState<PayLink | null>(null);
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
      if (link.kind === "pay") {
        if (accounts.active()) go({ kind: "send", request: link });
        else setPendingPay(link);
        return;
      }
      const pot = storedFromLink(link, fragment);
      if (accounts.active()) go({ kind: "pot", pot });
      else setPendingPot(pot);
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
    } else if (pendingPot) {
      go({ kind: "pot", pot: pendingPot });
      setPendingPot(null);
    } else if (pendingPay) {
      go({ kind: "send", request: pendingPay });
      setPendingPay(null);
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
        onOpenPot={(pot) => go({ kind: "pot", pot })}
      />
    );
  }
  if (active && !switching && screen.kind === "pot") {
    return (
      <ChipInScreen
        key={screen.pot.potId + active.address}
        account={active}
        pot={screen.pot}
        banner={banner}
        // A pot opened with no link is not kept: Home shows it from the invite it was matched to.
        onName={(name) => screen.pot.fragment && pots.put({ ...screen.pot, name })}
        onClose={() => go({ kind: "home" })}
      />
    );
  }
  if (active && !switching && screen.kind === "send") {
    return <SendScreen key={active.address} account={active} request={screen.request} banner={banner} onClose={() => go({ kind: "home" })} />;
  }
  if (active && !switching && screen.kind === "receive") {
    return <ReceiveScreen key={active.address} account={active} banner={banner} onClose={() => go({ kind: "home" })} />;
  }
  if (active && !switching && screen.kind === "join") {
    return (
      <JoinScreen account={active} invite={screen.invite} banner={banner} onAnswered={(row) => invited.put(row)} onClose={() => go({ kind: "home" })} />
    );
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
          onOpenPot={(pot) => go({ kind: "pot", pot })}
          onSend={() => go({ kind: "send", request: null })}
          onReceive={() => go({ kind: "receive" })}
        />
      ) : (
        <Welcome
          known={accounts.list()}
          current={active}
          note={pendingInvite ? copy.joinNeedsAccount(pendingInvite.from) : pendingPot ? copy.potNeedsAccount : undefined}
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
  /** Why the account is needed, when a link brought someone here. */
  note?: string;
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
      {props.note && <div className="banner">{props.note}</div>}

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
  const receipt = latestReceipt(props.account.address);
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
        {receipt && (
          <p className="hint">
            <a className="receipt-link" href={receiptUrl(receipt)} target="_blank" rel="noopener noreferrer">
              {copy.viewReceipt}
            </a>
            <br />
            {copy.viewReceiptHint}
          </p>
        )}
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
const MINT_LABEL = "mint";

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
  onOpenPot: (pot: StoredPot) => void;
  onSend: () => void;
  onReceive: () => void;
}) {
  const { account, connection } = props;
  const [balances, setBalances] = useState<Balances | null>(null);
  // A payment from this account still being confirmed: the Send screen follows it.
  const [sendInFlight, setSendInFlight] = useState(false);
  useEffect(() => {
    void idbWriteStore
      .get(account.address)
      .then((w) => setSendInFlight(Boolean(w && (w.label.startsWith(`${SEND_LABEL} `) || w.label.startsWith(`${CURRENCY_LABEL} `)))))
      .catch(() => setSendInFlight(false));
  }, [account.address]);
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
        rememberReceipt(write.address, write.hash);
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
      // Only dollar claims and mints are followed here; a pot's screens follow their own.
      if (!w || !(w.label.startsWith(CLAIM_LABEL) || w.label.startsWith(MINT_LABEL))) return;
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
        label: `${MINT_LABEL} ${label} TESTUSD`,
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
            <div className="money-actions">
              <button type="button" className="btn primary" onClick={props.onSend}>
                {copy.sendDollars}
              </button>
              <button type="button" className="btn" onClick={props.onReceive}>
                {copy.receive}
              </button>
            </div>
            {sendInFlight && (
              <button type="button" className="btn ghost small" onClick={props.onSend}>
                {copy.sendStillConfirming}
              </button>
            )}
          </>
        )}
      </section>

      <YourPots account={account} connection={props.connection} onOpen={props.onOpenDraft} onOpenPot={props.onOpenPot} />

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

const FIND_POTS_EVERY_MS = 10_000;
const livePots = potsReader(readClient, POTS);
const liveCreators = creatorReader(readClient, POTS);

/**
 * Pots this account is named on, found from the chain (lib/discover.ts), so
 * a pot appears on every phone of everyone in it even if its link never
 * arrived. Read when Home opens, which is also when the app opens, when the
 * app comes back to the front, and every few seconds while Home stays open. What was found is remembered, so it shows
 * at once next time. After each read, answered invites still waiting are
 * matched against what was found (lib/invited.ts).
 */
function useFoundPots(account: Address, connection: ReturnType<typeof useConnection>) {
  const store = useMemo(() => new ScanStore(localStorage, DEPLOYMENT, account), [account]);
  const [scan, setScan] = useState<ScanState>(() => store.load());
  const [failed, setFailed] = useState(false);
  const [answeredInvites, setAnswered] = useState<AnsweredInvite[]>(() => invited.forAccount(DEPLOYMENT, account, Date.now()));
  const { track } = connection;
  useEffect(() => {
    let live = true;
    let state = store.load();
    setScan(state);
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const next = await track(findPots(livePots, state, account));
        if (!live) return;
        state = next;
        store.save(next);
        setScan(next);
        setFailed(false);
        const rows = invited.forAccount(DEPLOYMENT, account, Date.now());
        setAnswered(rows);
        const matched = await track(matchInvites(rows, next.found, liveCreators, POTS_DEPLOY_BLOCK));
        if (!live) return;
        for (const row of matched) invited.put(row);
        setAnswered(invited.forAccount(DEPLOYMENT, account, Date.now()));
      } catch {
        if (live) setFailed(true);
      } finally {
        running = false;
      }
    };
    void poll();
    const t = setInterval(poll, FIND_POTS_EVERY_MS);
    // A phone brings the app back from the background without reopening Home.
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [account, store, track]);
  return { scan, failed, answered: answeredInvites };
}

const ROLE_TEXT: Record<Role, string> = {
  decides: copy.foundRoleDecides,
  paid: copy.foundRolePaid,
  putIn: copy.foundRolePutIn,
};

/** A pot found from the chain whose link hasn't been opened on this phone: live numbers, no names yet. */
function FoundPotRow(props: { pot: FoundPot; decimals: number | null }) {
  const [open, setOpen] = useState(false);
  const { pot } = props;
  const holds = props.decimals === null ? "…" : formatAmount(BigInt(pot.totalAssets), props.decimals, "auto");
  return (
    <>
      <button type="button" className="home-pot" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="grow">
          <span className="name">{pot.name || copy.unnamedPot}</span>
          <span className="meta">{copy.addedToAPot}</span>
          <span className="meta">{copy.foundMeta(pot.roles.map((r) => ROLE_TEXT[r]), holds)}</span>
        </span>
        <span className={`tag${pot.closed ? "" : " live"}`}>{pot.closed ? copy.closedTag : copy.live}</span>
      </button>
      {open && <p className="hint found-note">{copy.foundNeedsLink}</p>}
    </>
  );
}

/** An invite this account answered whose pot hasn't been made yet. */
function WaitingRow(props: { row: AnsweredInvite; decimals: number | null }) {
  const { row } = props;
  const share = BigInt(row.share);
  return (
    <div className="home-pot">
      <span className="grow">
        <span className="name">{row.potName || copy.unnamedPot}</span>
        <span className="meta">{copy.invitedWaiting(row.potName || copy.unnamedPot, row.from)}</span>
        {share > 0n && props.decimals !== null && <span className="meta">{copy.invitedShare(formatAmount(share, props.decimals, "auto"))}</span>}
      </span>
      <span className="tag">{copy.invitedTag}</span>
    </div>
  );
}

/**
 * A pot matched to an invite this account answered: its name and live numbers
 * from the chain, the inviter's name from the invite, and everyone else by
 * the end of their account until a pot link with names is opened. Opens with
 * no link.
 */
function MatchedRow(props: { row: AnsweredInvite; pot: FoundPot | undefined; decimals: number | null; me: Address; onOpen: () => void }) {
  const { row, pot } = props;
  const match = row.match!;
  const holds = !pot || props.decimals === null ? "…" : formatAmount(BigInt(pot.totalAssets), props.decimals, "auto");
  const others = [...new Set([...match.deciders, ...match.payees].map((a) => a.toLowerCase()))]
    .filter((a) => a !== props.me.toLowerCase())
    .map((a) => copy.accountEnding(a));
  return (
    <button type="button" className="home-pot" onClick={props.onOpen}>
      <span className="grow">
        <span className="name">{pot?.name || row.potName || copy.unnamedPot}</span>
        <span className="meta">{copy.invitedBy(row.from)}</span>
        {pot && <span className="meta">{copy.foundMeta(pot.roles.map((r) => ROLE_TEXT[r]), holds)}</span>}
        {others.length > 0 && <span className="meta">{copy.alsoInIt(others)}</span>}
      </span>
      <span className={`tag${pot?.closed ? "" : " live"}`}>{pot?.closed ? copy.closedTag : copy.live}</span>
    </button>
  );
}

/** Pots this account is making, pots made or opened on this phone, invites it answered, and pots it is named on. */
function YourPots(props: {
  account: StoredAccount;
  connection: ReturnType<typeof useConnection>;
  onOpen: (draftId: Hex) => void;
  onOpenPot: (pot: StoredPot) => void;
}) {
  const { scan, failed, answered } = useFoundPots(props.account.address, props.connection);
  const mine = drafts.forOwner(props.account.address).filter((d) => !d.made?.fragment);
  // Pots made before the pot list existed are added to it once.
  for (const d of drafts.forOwner(props.account.address)) {
    if (d.made?.fragment && !pots.get(DEPLOYMENT, d.made.potId)) {
      pots.put({ deployment: DEPLOYMENT, potId: d.made.potId, block: d.made.block, fragment: d.made.fragment, name: d.name, addedAt: d.createdAt });
    }
  }
  const opened = pots.all(DEPLOYMENT);
  // Pots whose link is open on this phone show with their names; the rest of what was found shows here.
  const linked = new Set(opened.map((p) => p.potId));
  const waiting = answered.filter((r) => !r.match);
  const matched = answered.filter((r) => r.match && !linked.has(r.match.potId));
  const matchedIds = new Set(matched.map((r) => r.match!.potId));
  const found = scan.found.filter((p) => !linked.has(p.potId) && !matchedIds.has(p.potId));
  // A pot this account made but hasn't sent to everyone yet opens on its send step.
  const toSend = new Map<string, { draft: Draft; left: number }>();
  for (const d of drafts.forOwner(props.account.address)) {
    const left = d.made?.fragment ? potRecipients(d).filter((r) => !r.sent).length : 0;
    if (d.made && left > 0) toSend.set(d.made.potId, { draft: d, left });
  }
  const start = () => {
    const draft = newDraft(props.account.address, phoneTimeZone(), Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
    drafts.put(draft);
    props.onOpen(draft.id);
  };
  return (
    <section className="card">
      <p className="eyebrow">{copy.yourPots}</p>
      {mine.length + opened.length + found.length + answered.length === 0 && <p className="hint">{copy.noPotsYet}</p>}
      {matched.map((r) => (
        <MatchedRow
          key={`matched-${r.match!.potId}`}
          row={r}
          pot={scan.found.find((p) => p.potId === r.match!.potId)}
          decimals={scan.decimals}
          me={props.account.address}
          onOpen={() => props.onOpenPot({ deployment: DEPLOYMENT, potId: r.match!.potId, block: r.match!.block, fragment: "", name: "", addedAt: r.answeredAt })}
        />
      ))}
      {waiting.map((r) => (
        <WaitingRow key={`invited-${r.draftId}-${r.role}-${r.slot}`} row={r} decimals={scan.decimals} />
      ))}
      {found.map((p) => (
        <FoundPotRow key={`found-${p.potId}`} pot={p} decimals={scan.decimals} />
      ))}
      {opened.map((p) => (
        <button
          type="button"
          className="home-pot"
          key={`pot-${p.potId}`}
          onClick={() => {
            const unsent = toSend.get(p.potId);
            if (unsent) props.onOpen(unsent.draft.id);
            else props.onOpenPot(p);
          }}
        >
          <span className="grow">
            <span className="name">{p.name || copy.unnamedPot}</span>
            <span className="meta">{toSend.has(p.potId) ? copy.potRowSendToMore(toSend.get(p.potId)!.left) : copy.potRowJoined}</span>
          </span>
          <span className="tag live">{copy.live}</span>
        </button>
      ))}
      {mine.map((d) => (
        <button type="button" className="home-pot" key={d.id} onClick={() => props.onOpen(d.id)}>
          <span className="grow">
            <span className="name">{d.name || copy.unnamedPot}</span>
            <span className="meta">{d.made ? copy.potRowMade(formatDay(d.closes)) : copy.potRowDraft(d.deciders.length + 1)}</span>
          </span>
          <span className={`tag${d.made ? " live" : ""}`}>{d.made ? copy.live : copy.draft}</span>
        </button>
      ))}
      {failed && <NoticeLine notice={{ tone: "bad", text: copy.errFindPots, code: ERROR_CODES.FIND_POTS_FAILED }} />}
      <button type="button" className="btn primary" onClick={start}>
        {copy.makeAPot}
      </button>
    </section>
  );
}
