import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import type { StoredAccount } from "../lib/accounts.ts";
import { ERC20_READ_ABI } from "../lib/abi.ts";
import { beforePasskey } from "../lib/cancel.ts";
import { liveWriteChain, waitForFinalized } from "../lib/chain.ts";
import { DOLLAR } from "../lib/deployment.ts";
import { AppError, describeFailure, SendFailure } from "../lib/errors.ts";
import { idbWriteStore } from "../lib/idb.ts";
import { amountForField, amountIn, formatAmount } from "../lib/money.ts";
import { CURRENCIES, currencyFor, defaultCurrency, DOLLAR_DECIMALS, formatLocal, parseLocal, quoteAdd, quoteCashOut, referenceFrom, type Currency, type Limit, type Route } from "../lib/ramp.ts";
import { askStatement, askToBuy, cashOutLabel, fromCashOutLabel, readDesk, type DeskInfo, type Statement } from "../lib/rampDesk.ts";
import { receiptUrl, rememberReceipt } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { retryStuckWrite, sendWrite, type Step } from "../lib/send.ts";
import { transferData, transferRefused } from "../lib/transfer.ts";
import { followToFinality, type PendingWrite } from "../lib/writes.ts";
import { AmountUnderstood, Icon, type Notice, NoticeLine, phoneTimeZone, Sheet, STOPPED, useCancellable } from "./ui.tsx";

export type MoneyMode = "add" | "out";

const ROUTE_TEXT: Record<Route, string> = {
  ramp: copy.rampRouteRamp,
  local: copy.rampRouteLocal,
  aggregator: copy.rampRouteAggregator,
};

const LIMIT_TEXT: Record<Exclude<Limit, null>, string> = {
  "too-small": copy.rampUnderMin,
  "too-large": copy.rampOverMax,
};

const STEP_TEXT: Record<Step | "landing" | "statement", string> = {
  preparing: copy.stepPreparing,
  "getting-ready": copy.stepGettingReady,
  confirm: copy.stepConfirm,
  sending: copy.stepSendingPayment,
  landing: copy.stepSettling,
  statement: copy.stepSettling,
};

const usd = (v: bigint) => formatAmount(v, DOLLAR_DECIMALS, "cents");

function startingCurrency(): string {
  const languages = typeof navigator === "undefined" ? [] : navigator.languages;
  return defaultCurrency(phoneTimeZone(), languages);
}

function CurrencyPicker(props: { value: string; disabled: boolean; onChange: (code: string) => void }) {
  return (
    <label className="field">
      <span>{copy.rampCurrency}</span>
      <select value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)}>
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {`${copy.currencyName(c.code)} (${c.code})`}
          </option>
        ))}
      </select>
    </label>
  );
}

function Row(props: { label: string; value: string; sub?: string }) {
  return (
    <div className="list-row">
      <div className="grow">
        <span className="meta">{props.label}</span>
        <span className="name">{props.value}</span>
        {props.sub && <span className="meta">{props.sub}</span>}
      </div>
    </div>
  );
}

function TestModeLine() {
  return <p className="ramp-test">{copy.rampTestMode}</p>;
}

/**
 * Add money from a bank, or cash out to one, in the person's own currency.
 * In test mode a labelled simulation with the test desk (api/ramp): no bank,
 * no real currency, only test dollars. Adding needs no fingerprint, because
 * nothing leaves the account. Cashing out is the person's own transfer of
 * dollars to the desk, one fingerprint, shown as done only at Finalized.
 */
export function MoneyScreen(props: { account: StoredAccount; mode: MoneyMode; banner: ReactNode; onClose: () => void }) {
  const me = props.account.address;
  const mode = props.mode;
  const [desk, setDesk] = useState<DeskInfo | null>(null);
  const [deskFailed, setDeskFailed] = useState(false);
  const [code, setCode] = useState(startingCurrency);
  const currency: Currency = currencyFor(code) ?? CURRENCIES[0]!;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void readDesk()
      .then((d) => alive.current && setDesk(d))
      .catch(() => alive.current && setDeskFailed(true));
  }, []);

  return (
    <div className="screen">
      <div className="bar">
        <button type="button" className="icon-btn" aria-label={copy.close} onClick={props.onClose}>
          <Icon name="close" size={22} />
        </button>
        <div className="bar-title">{mode === "add" ? copy.addMoney : copy.cashOut}</div>
        <div className="bar-spacer" />
      </div>
      {props.banner}
      {mode === "add" ? (
        <AddMoney me={me} desk={desk} deskFailed={deskFailed} currency={currency} onCurrency={setCode} onClose={props.onClose} />
      ) : (
        <CashOut me={me} desk={desk} deskFailed={deskFailed} currency={currency} onCurrency={setCode} onClose={props.onClose} />
      )}
    </div>
  );
}

function DeskState(props: { desk: DeskInfo | null; failed: boolean }) {
  if (props.failed) return <NoticeLine notice={{ tone: "bad", text: copy.errRampUnreachable, code: ERROR_CODES.RAMP_UNREACHABLE }} />;
  if (!props.desk) return <p className="hint">{copy.rampReadingDesk}</p>;
  if (!props.desk.enabled) return <NoticeLine notice={{ tone: "bad", text: copy.rampDeskPaused, code: ERROR_CODES.RAMP_PAUSED }} />;
  return null;
}

type Props = {
  me: Address;
  desk: DeskInfo | null;
  deskFailed: boolean;
  currency: Currency;
  onCurrency: (code: string) => void;
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Add money
// ---------------------------------------------------------------------------

function AddMoney(props: Props) {
  const { currency } = props;
  const [text, setText] = useState("");
  const [paying, setPaying] = useState<{ localMinor: bigint; reference: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Notice | null>(null);
  const [done, setDone] = useState<{ received: bigint; settledMs: number; hash: Hex } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const localMinor = parseLocal(currency, text);
  const quote = localMinor === null ? null : quoteAdd(currency, localMinor);
  const ready = Boolean(props.desk?.enabled && quote && quote.localMinor > 0n && quote.limit === null);

  const proceed = () => {
    if (!quote || !ready) return;
    setResult(null);
    setPaying({ localMinor: quote.localMinor, reference: referenceFrom(crypto.getRandomValues(new Uint8Array(6))) });
  };

  /** Asks the desk, then waits for its dollars to be final. The time is measured from this tap. */
  const sentIt = async () => {
    if (!paying) return;
    setBusy(true);
    setResult(null);
    const started = performance.now();
    try {
      const bought = await askToBuy(props.me, currency.code, paying.localMinor);
      let status: "success" | "reverted";
      try {
        status = await waitForFinalized(bought.hash);
      } catch {
        throw new AppError(copy.errRampSlow, ERROR_CODES.RAMP_FAILED);
      }
      if (status !== "success") throw new AppError(copy.errRampFailed, ERROR_CODES.RAMP_FAILED);
      if (alive.current) setDone({ received: bought.received, settledMs: performance.now() - started, hash: bought.hash });
    } catch (e) {
      if (alive.current) setResult({ tone: "bad", ...(e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e)) });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  if (done) {
    return (
      <>
        <div className="screen-body">
          <div className="card enter sent-card" role="status">
            <p className="eyebrow">{copy.rampSimulated}</p>
            <h1>{copy.rampAdded(usd(done.received))}</h1>
            <p className="lede">{copy.settledIn((done.settledMs / 1000).toFixed(1))}</p>
            <p className="hint">{copy.rampAddedNote}</p>
            <TestModeLine />
            <a className="receipt-link" href={receiptUrl(done.hash)} target="_blank" rel="noopener noreferrer">
              {copy.viewReceipt}
            </a>
          </div>
        </div>
        <div className="screen-foot">
          <button type="button" className="pill-btn" onClick={props.onClose}>
            {copy.done}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="screen-body">
        <TestModeLine />
        <DeskState desk={props.desk} failed={props.deskFailed} />
        {!paying ? (
          <div className="card enter" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <CurrencyPicker value={currency.code} disabled={false} onChange={props.onCurrency} />
            <label className="field">
              <span>{copy.rampYouPay}</span>
              <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder={copy.amountPlaceholder} />
            </label>
            <AmountUnderstood text={text} decimals={currency.digits} maxFraction={currency.digits} show={(v) => formatLocal(currency, v)} />
            {quote && quote.localMinor > 0n && (
              <div className="list">
                <Row label={copy.rampYouPay} value={formatLocal(currency, quote.localMinor)} sub={copy.rampRate(formatLocal(currency, currency.testMinorPerDollar))} />
                <Row label={copy.rampFee} value={usd(quote.fee)} />
                <Row label={copy.rampYouGet} value={usd(quote.received)} />
              </div>
            )}
            {quote && quote.localMinor > 0n && quote.limit && <p className="error">{LIMIT_TEXT[quote.limit]}</p>}
            <p className="hint">{ROUTE_TEXT[currency.route]}</p>
          </div>
        ) : (
          <div className="card enter bank-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p className="eyebrow">{copy.payByBankTitle}</p>
            <p className="ramp-warning">{copy.payByBankSimulation}</p>
            <p className="hint">{copy.payByBankLede}</p>
            <div className="list">
              <Row label={copy.bankPayee} value={copy.rampDeskName} sub={copy.rampDeskBank} />
              <Row label={copy.bankAccountNumber} value={copy.rampDeskAccountNumber} />
              <Row label={copy.confirmAmount} value={formatLocal(currency, paying.localMinor)} />
              <Row label={copy.rampReference} value={paying.reference} />
              <Row label={copy.rampYouGet} value={usd(quoteAdd(currency, paying.localMinor).received)} />
            </div>
          </div>
        )}
        {result && <NoticeLine notice={result} />}
      </div>
      <div className="screen-foot">
        {!paying ? (
          <button type="button" className="pill-btn" disabled={!ready} onClick={proceed}>
            {copy.rampContinue}
          </button>
        ) : (
          <>
            <button type="button" className={`pill-btn${busy ? " busy" : ""}`} disabled={busy || !props.desk?.enabled} aria-busy={busy} onClick={sentIt}>
              {busy ? copy.rampAdding : copy.iveSentIt}
            </button>
            {!busy && (
              <button type="button" className="btn ghost" onClick={() => setPaying(null)}>
                {copy.back}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cash out
// ---------------------------------------------------------------------------

type CashDone = { statement: Statement; settledMs: number; hash: Hex };

function CashOut(props: Props) {
  const { me, currency } = props;
  const deskAccount = props.desk?.enabled ? props.desk.desk : null;
  const [amountText, setAmountText] = useState("");
  // Bank details: kept in this screen only, never stored, never sent.
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [holding, setHolding] = useState<{ balance: bigint; decimals: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState<Step | "landing" | "statement" | null>(null);
  const [stuck, setStuck] = useState(false);
  const [result, setResult] = useState<Notice | null>(null);
  const [finalTx, setFinalTx] = useState<{ hash: Hex; settledMs: number; currency: string } | null>(null);
  const [done, setDone] = useState<CashDone | null>(null);
  const alive = useRef(true);
  const running = useCancellable();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const readHolding = useCallback(async () => {
    const block = await readClient.getBlock({ blockTag: "finalized" });
    const at = { blockNumber: block.number } as const;
    const [decimals, balance] = await Promise.all([
      readClient.readContract({ address: DOLLAR, abi: ERC20_READ_ABI, functionName: "decimals", ...at }),
      readClient.readContract({ address: DOLLAR, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [me], ...at }),
    ]);
    if (alive.current) setHolding({ balance, decimals });
  }, [me]);
  useEffect(() => {
    void readHolding().catch(() => {});
  }, [readHolding]);

  /** The desk's statement, for a cash out already final. Safe to ask again. */
  const statementFor = useCallback(
    async (hash: Hex, settledMs: number, code: string) => {
      setStep("statement");
      setFinalTx({ hash, settledMs, currency: code });
      try {
        const statement = await askStatement(me, code, hash);
        if (!alive.current) return;
        setResult(null);
        setDone({ statement, settledMs, hash });
      } catch (e) {
        if (alive.current) setResult({ tone: "bad", ...(e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e)) });
      } finally {
        if (alive.current) setStep(null);
      }
    },
    [me],
  );

  const land = useCallback(
    async (write: PendingWrite, code: string) => {
      setStep("landing");
      try {
        const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
        if (!alive.current) return;
        setStep(null);
        if (outcome.kind === "final") {
          rememberReceipt(write.address, write.hash);
          setStuck(false);
          void readHolding().catch(() => {});
          await statementFor(write.hash, outcome.settledMs, code);
        } else if (outcome.kind === "stuck") {
          setStuck(true);
          setResult({ tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
        } else {
          setStuck(false);
          setResult({ tone: "bad", text: copy.cashOutDidNotGoThrough, code: outcome.kind === "reverted" ? ERROR_CODES.REVERTED : ERROR_CODES.SUPERSEDED });
        }
      } catch (e) {
        if (!alive.current) return;
        setStep(null);
        setResult({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
      }
    },
    [readHolding, statementFor],
  );

  // Resume a cash out that was in flight when the page was closed or reloaded.
  const { onCurrency } = props;
  useEffect(() => {
    void idbWriteStore.get(me).then((w) => {
      const resumed = w ? fromCashOutLabel(w.label) : null;
      if (!w || !resumed || !alive.current) return;
      onCurrency(resumed.currency);
      setAmountText(amountForField(resumed.amount, DOLLAR_DECIMALS));
      if (w.replaceable) {
        setStuck(true);
        setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
      } else void land(w, resumed.currency);
    });
  }, [me, land, onCurrency]);

  const decimals = holding?.decimals ?? DOLLAR_DECIMALS;
  const amount = amountIn(amountText, decimals);
  const quote = useMemo(() => (amount === null ? null : quoteCashOut(currency, amount)), [amount, currency]);
  const detailsOk = bankName.trim() !== "" && accountName.trim() !== "" && /\d{4}/.test(accountNumber);
  const last4 = accountNumber.replace(/\D/g, "").slice(-4);
  const busy = step !== null;

  /** Every check that needs no fingerprint, then the confirm sheet. */
  const review = async () => {
    if (!holding || !deskAccount || amount === null || !quote) return;
    setResult(null);
    if (!detailsOk) {
      setResult({ tone: "bad", text: copy.bankDetailsMissing });
      return;
    }
    if (quote.limit) {
      setResult({ tone: "bad", text: LIMIT_TEXT[quote.limit] });
      return;
    }
    if (amount > holding.balance) {
      setResult({ tone: "bad", text: copy.errSendMoreThanBalance(usd(holding.balance)), code: ERROR_CODES.SEND_MORE_THAN_BALANCE });
      return;
    }
    setStep("preparing");
    const run = running.start();
    try {
      if (await transferRefused(readClient, DOLLAR, me, deskAccount, amount)) throw new AppError(copy.errSendRefused, ERROR_CODES.SEND_REFUSED);
      if (alive.current && !run.signal.aborted) setConfirming(true);
    } catch (e) {
      if (alive.current && !run.signal.aborted) setResult({ tone: "bad", ...(e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e)) });
    } finally {
      if (alive.current && !run.signal.aborted) setStep(null);
    }
  };

  const send = async (retry: boolean) => {
    if (!deskAccount || amount === null) return;
    setConfirming(false);
    setResult(null);
    const run = running.start();
    const call = {
      from: me,
      to: DOLLAR,
      data: transferData(deskAccount, amount),
      label: cashOutLabel(deskAccount, amount, currency.code),
      signal: run.signal,
      onStep: run.track((s: Step) => setStep(s)),
    };
    try {
      const write = retry ? await retryStuckWrite(call) : await sendWrite(call);
      await land(write, currency.code);
    } catch (e) {
      if (run.signal.aborted) return;
      setStep(null);
      setResult({ tone: "bad", ...describeFailure(e) });
    }
  };

  const closeOrStop = () => {
    if (beforePasskey(step) && running.cancel()) {
      setStep(null);
      setResult(STOPPED);
    } else props.onClose();
  };

  if (done) {
    const shown = currencyFor(done.statement.currency) ?? currency;
    return (
      <>
        <div className="screen-body">
          <div className="card enter sent-card" role="status">
            <p className="eyebrow">{copy.rampSimulated}</p>
            <h1>{copy.cashOutOnItsWay(formatLocal(shown, done.statement.bankGets))}</h1>
            <div className="list">
              <Row label={copy.rampReference} value={done.statement.reference} />
              <Row label={copy.confirmAmount} value={usd(done.statement.dollars)} sub={`${copy.rampFee}: ${usd(done.statement.fee)}`} />
              {detailsOk && <Row label={copy.confirmTo} value={accountName} sub={copy.bankLine(bankName, last4)} />}
            </div>
            <p className="lede">{copy.settledIn((done.settledMs / 1000).toFixed(1))}</p>
            <p className="hint">{copy.cashOutStatementNote}</p>
            <TestModeLine />
            <a className="receipt-link" href={receiptUrl(done.hash)} target="_blank" rel="noopener noreferrer">
              {copy.viewReceipt}
            </a>
          </div>
        </div>
        <div className="screen-foot">
          <button type="button" className="pill-btn" onClick={props.onClose}>
            {copy.done}
          </button>
        </div>
      </>
    );
  }

  const locked = busy || stuck || finalTx !== null;
  return (
    <>
      <div className="screen-body">
        <TestModeLine />
        <DeskState desk={props.desk} failed={props.deskFailed} />
        <div className="card enter" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field">
            <span>{copy.cashOutHowMuch}</span>
            <input inputMode="decimal" value={amountText} disabled={locked} onChange={(e) => setAmountText(e.target.value)} placeholder={copy.amountPlaceholder} />
          </label>
          <AmountUnderstood text={amountText} decimals={decimals} />
          {holding && <p className="hint">{copy.yourBalanceIs(usd(holding.balance))}</p>}
          <CurrencyPicker value={currency.code} disabled={locked} onChange={props.onCurrency} />
          {quote && quote.dollars > 0n && (
            <div className="list">
              <Row label={copy.rampFee} value={usd(quote.fee)} />
              <Row label={copy.bankGets} value={formatLocal(currency, quote.bankGets)} sub={copy.rampRate(formatLocal(currency, currency.testMinorPerDollar))} />
            </div>
          )}
          {quote && quote.dollars > 0n && quote.limit && <p className="error">{LIMIT_TEXT[quote.limit]}</p>}
          <p className="hint">{ROUTE_TEXT[currency.route]}</p>
        </div>
        <div className="card enter" style={{ display: "flex", flexDirection: "column", gap: 12, animationDelay: "80ms" }}>
          <label className="field">
            <span>{copy.bankName}</span>
            <input value={bankName} disabled={locked} onChange={(e) => setBankName(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            <span>{copy.bankAccountName}</span>
            <input value={accountName} disabled={locked} onChange={(e) => setAccountName(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            <span>{copy.bankAccountNumber}</span>
            <input inputMode="numeric" value={accountNumber} disabled={locked} onChange={(e) => setAccountNumber(e.target.value)} autoComplete="off" />
          </label>
          <p className="hint">{copy.bankDetailsHint}</p>
        </div>
        {result && <NoticeLine notice={result} />}
      </div>
      <div className="screen-foot">
        {finalTx && step === null ? (
          <button type="button" className="pill-btn" onClick={() => statementFor(finalTx.hash, finalTx.settledMs, finalTx.currency)}>
            {copy.tryAgain}
          </button>
        ) : stuck && step === null ? (
          <button type="button" className="pill-btn" onClick={() => send(true)}>
            {copy.tryAgain}
          </button>
        ) : (
          <button
            type="button"
            className={`pill-btn${busy ? " busy" : ""}`}
            disabled={busy || !deskAccount || !holding || amount === null || amount <= 0n}
            aria-busy={busy}
            onClick={review}
          >
            {step ? STEP_TEXT[step] : copy.reviewSend}
          </button>
        )}
        {beforePasskey(step) && (
          <button type="button" className="btn ghost" onClick={closeOrStop}>
            {copy.back}
          </button>
        )}
      </div>
      {confirming && amount !== null && quote && (
        <Sheet title={copy.cashOutTitle} onClose={() => setConfirming(false)}>
          <div className="list">
            <Row label={copy.confirmTo} value={accountName} sub={copy.bankLine(bankName, last4)} />
            <Row label={copy.confirmAmount} value={usd(amount)} />
            <Row label={copy.rampFee} value={usd(quote.fee)} />
            <Row label={copy.bankGets} value={formatLocal(currency, quote.bankGets)} sub={copy.rampRate(formatLocal(currency, currency.testMinorPerDollar))} />
          </div>
          <TestModeLine />
          <p className="hint">{copy.cashOutStatementNote}</p>
          <button type="button" className="pill-btn" onClick={() => send(false)}>
            {copy.cashOutAction(usd(amount))}
          </button>
          <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
            {copy.back}
          </button>
        </Sheet>
      )}
    </>
  );
}
