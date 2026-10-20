import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { cleanBankName, DEFAULT_CAP, lastFour, MAX_CAP, MIN_MOVE, type AutoCashRequest, type Bank } from "../lib/autocash.ts";
import { ALLOWANCE_ABI, allowanceData, allowanceLabel, autoCashOff, AutoCashLocalStore, cancelAutoCashChange, readAutoCash, saveAutoCash, type AutoCashInfo } from "../lib/autocashLive.ts";
import { liveWriteChain } from "../lib/chain.ts";
import { DEPLOYMENT, DOLLAR } from "../lib/deployment.ts";
import { AppError, describeFailure } from "../lib/errors.ts";
import { idbWriteStore } from "../lib/idb.ts";
import { LIMIT_DECIMALS, LimitStore, limitNow } from "../lib/limits.ts";
import { dateLocale } from "../lib/locale.ts";
import { amountForField, amountIn, formatAmount } from "../lib/money.ts";
import { currencyFor, defaultCurrency } from "../lib/ramp.ts";
import { readClient } from "../lib/rpc.ts";
import { reloadOnce } from "../lib/reloadOnce.ts";
import { sendWrite, type Step } from "../lib/send.ts";
import { followToFinality } from "../lib/writes.ts";
import { CurrencyPicker, Row, TestModeLine } from "./Money.tsx";
import { AmountUnderstood, HowThisWorks, NoticeLine, phoneTimeZone, type Notice } from "./ui.tsx";

const passkeys = () => reloadOnce(() => import("../lib/passkey.ts"));
const whenFormat = new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const usd = (v: bigint) => formatAmount(v, LIMIT_DECIMALS, "auto");
const STEP_TEXT: Record<Step, string> = {
  preparing: copy.stepPreparing,
  "getting-ready": copy.stepGettingReady,
  confirm: copy.stepConfirm,
  sending: copy.stepSendingPayment,
};

/** Off, as far as this screen has got: the server first, at once, then the allowance back to zero. */
type Off = "taking" | "done" | "needs";

/**
 * Auto cash out, in Profile, Money (README, "Auto cash out"; lib/autocash.ts):
 * turning it on, what it is doing, changing it, and turning it off. A
 * labelled simulation with the test desk, like Cash out. Turning it on takes
 * two fingerprints: one signs the choices for the server, one the dollar's
 * allowance that lets the desk move up to the most a day. Off is at once on
 * the server, then one fingerprint sets the allowance back to zero; the
 * screen says Off from the first moment.
 */
export function AutoCashSection(props: { account: Address }) {
  const me = props.account;
  const local = useRef(new AutoCashLocalStore(localStorage, DEPLOYMENT, me)).current;
  const [info, setInfo] = useState<AutoCashInfo | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [readFailed, setReadFailed] = useState<Notice | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [off, setOff] = useState<Off | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const i = await readAutoCash(me);
      let a: bigint | null = null;
      if (i.desk) {
        const block = await readClient.getBlock({ blockTag: "finalized" });
        a = await readClient.readContract({ address: DOLLAR, abi: ALLOWANCE_ABI, functionName: "allowance", args: [me, i.desk], blockNumber: block.number });
      }
      // A new bank that was waiting and is no longer: it applied, unless it was cancelled here (which clears it).
      const mine = local.get();
      if (mine?.next && !i.pending?.bank) local.set({ bank: mine.next, currency: i.currency ?? mine.currency });
      if (!alive.current) return;
      setInfo(i);
      setAllowance(a);
      setReadFailed(null);
    } catch (e) {
      if (alive.current) setReadFailed({ tone: "bad", ...(e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e)) });
    }
  }, [me, local]);
  useEffect(() => {
    void load();
  }, [load]);

  const sign = async (message: string) => (await passkeys()).withSigner(me, (a) => a.signMessage({ message }));

  /** The dollar's allowance for the desk, set to `amount` through sendWrite, and followed to Finalized. */
  const allow = async (desk: Address, amount: bigint) => {
    const write = await sendWrite({ from: me, to: DOLLAR, data: allowanceData(desk, amount), label: allowanceLabel(desk, amount), onStep: (s: Step) => alive.current && setBusy(STEP_TEXT[s]) });
    if (alive.current) setBusy(copy.stepSettling);
    const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
    if (outcome.kind === "stuck") throw new AppError(copy.stuck, ERROR_CODES.STUCK);
    if (outcome.kind !== "final") throw new AppError(copy.sendDidNotGoThrough, outcome.kind === "reverted" ? ERROR_CODES.REVERTED : ERROR_CODES.SUPERSEDED);
  };
  const failure = (e: unknown): Notice => ({ tone: "bad", ...(e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e)) });

  const save = async (req: AutoCashRequest) => {
    if (!info?.desk) return;
    setNotice(null);
    setOff(null);
    setBusy(copy.autoCashSaving);
    try {
      const pending = await saveAutoCash(me, req, sign);
      const before = local.get();
      // The bank in force stays until a new one has waited its 24 hours.
      local.set({ bank: pending?.bank && before ? before.bank : req.bank, currency: req.currency, ...(pending?.bank ? { next: req.bank } : {}) });
      // Up to the most a day, and the higher one waiting, so the desk can carry on once it applies.
      const target = [BigInt(req.cap), BigInt(pending?.cap ?? "0")].reduce((a, b) => (a > b ? a : b));
      if (allowance === null || allowance < target) await allow(info.desk, target);
      if (alive.current) setEditing(false);
    } catch (e) {
      if (alive.current) setNotice(failure(e));
    } finally {
      if (alive.current) setBusy(null);
      void load();
    }
  };

  const turnOff = async () => {
    if (!info) return;
    setNotice(null);
    setOff("taking");
    try {
      await autoCashOff(me);
    } catch (e) {
      setOff(null);
      return setNotice(failure(e));
    }
    setInfo({ ...info, on: false, pending: null });
    await takeBack();
  };
  /** The allowance back to zero: one fingerprint. If it doesn't happen, it is still off, and the screen offers it again. */
  const takeBack = async () => {
    if (!info?.desk) return setOff("done");
    if (allowance === 0n) return setOff("done");
    setOff("taking");
    try {
      await allow(info.desk, 0n);
      if (alive.current) setOff("done");
    } catch {
      if (alive.current) setOff("needs");
    } finally {
      if (alive.current) setBusy(null);
      void load();
    }
  };

  const cancelChange = async () => {
    setNotice(null);
    setBusy(copy.autoCashSaving);
    try {
      await cancelAutoCashChange(me, sign);
      const mine = local.get();
      if (mine) local.set({ bank: mine.bank, currency: mine.currency });
    } catch (e) {
      if (alive.current) setNotice(failure(e));
    } finally {
      if (alive.current) setBusy(null);
      void load();
    }
  };

  if (readFailed && !info) return <NoticeLine notice={readFailed} />;
  if (!info) return <p className="hint">{copy.rampReadingDesk}</p>;

  const mine = local.get();
  const bankText = mine ? copy.bankEnding(mine.bank.name, mine.bank.last4) : copy.autoCashYourBank;
  const cap = info.cap ? BigInt(info.cap) : DEFAULT_CAP;
  const capLeft = cap > info.movedToday ? cap - info.movedToday : 0n;
  const on = info.on && off === null;

  return (
    <section className="settings-screen autocash">
      <TestModeLine />
      {!info.enabled && <NoticeLine notice={{ tone: "bad", text: copy.autoCashDeskOff, code: ERROR_CODES.RAMP_PAUSED }} />}
      {off !== null && (
        <p className="success" role="status">
          {off === "taking" ? copy.autoCashTakingBack : off === "done" ? copy.autoCashOffDone : copy.autoCashOffNeedsFingerprint}
        </p>
      )}
      {off === "needs" && (
        <button type="button" className="btn" disabled={busy !== null} onClick={() => void takeBack()}>
          {copy.autoCashTakeBack}
        </button>
      )}
      {on && !editing ? (
        <>
          <p className="lede">{copy.autoCashOnTo(bankText, info.currency ?? "")}</p>
          <div className="list">
            <Row label={copy.autoCashWhat} value={info.keep === null || info.keep === undefined ? copy.autoCashEverything : copy.autoCashKeeping(usd(BigInt(info.keep)))} />
            <Row label={copy.autoCashCap} value={usd(cap)} sub={copy.autoCashMovedToday(usd(info.movedToday), usd(cap))} />
          </div>
          {info.pending?.bank && <p className="hint">{copy.autoCashNewBankFrom(whenFormat.format(new Date(info.pending.startsAt)))}</p>}
          {info.pending?.cap && <p className="hint">{copy.autoCashNewCapFrom(usd(BigInt(info.pending.cap)), whenFormat.format(new Date(info.pending.startsAt)))}</p>}
          {info.pending && (
            <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void cancelChange()}>
              {copy.autoCashCancel}
            </button>
          )}
          {allowance !== null && allowance < capLeft && (
            <>
              <p className="hint">{copy.autoCashAllowanceLow(usd(allowance))}</p>
              <button type="button" className="btn" disabled={busy !== null || !info.desk} onClick={() => info.desk && void allow(info.desk, cap).then(load, (e) => setNotice(failure(e))).finally(() => setBusy(null))}>
                {copy.autoCashAllowAgain}
              </button>
            </>
          )}
          {busy && <p className="hint" role="status">{busy}</p>}
          {notice && <NoticeLine notice={notice} />}
          <button type="button" className="btn" disabled={busy !== null} onClick={() => (setNotice(null), setEditing(true))}>
            {copy.autoCashChange}
          </button>
          <button type="button" className="btn ghost danger" disabled={busy !== null} onClick={() => void turnOff()}>
            {copy.autoCashTurnOff}
          </button>
        </>
      ) : (
        <>
          {!on && off === null && <p className="lede">{copy.autoCashIntro}</p>}
          {(off === null || off === "done" || editing) && (
            <AutoCashForm
              account={me}
              changing={on}
              initial={{ currency: info.currency ?? mine?.currency, keep: info.keep ?? null, cap: info.cap, bank: mine?.bank ?? null }}
              busy={busy}
              notice={notice}
              enabled={info.enabled}
              onSave={(req) => void save(req)}
              onBack={on ? () => setEditing(false) : undefined}
            />
          )}
        </>
      )}
      <HowThisWorks>
        <p className="hint">{copy.autoCashWaitRule}</p>
        <p className="hint">{copy.autoCashBankKept}</p>
        <p className="hint">{copy.autoCashMainnet}</p>
      </HowThisWorks>
    </section>
  );
}

/** The choices: currency, bank, what to cash out and the most a day, checked before anything is signed. */
function AutoCashForm(props: {
  account: Address;
  changing: boolean;
  initial: { currency?: string; keep: string | null; cap?: string; bank: Bank | null };
  busy: string | null;
  notice: Notice | null;
  enabled: boolean;
  onSave: (req: AutoCashRequest) => void;
  onBack?: () => void;
}) {
  const [code, setCode] = useState(() => (props.initial.currency && currencyFor(props.initial.currency) ? props.initial.currency : defaultCurrency(phoneTimeZone(), typeof navigator === "undefined" ? [] : navigator.languages)));
  const [bankName, setBankName] = useState(props.initial.bank?.name ?? "");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [keepOn, setKeepOn] = useState(props.initial.keep !== null);
  const [keepText, setKeepText] = useState(props.initial.keep !== null ? amountForField(BigInt(props.initial.keep), LIMIT_DECIMALS) : "");
  const [capText, setCapText] = useState(amountForField(props.initial.cap ? BigInt(props.initial.cap) : DEFAULT_CAP, LIMIT_DECIMALS));
  const [tried, setTried] = useState(false);

  let dailyLimit = 1_000_000_000n;
  try {
    dailyLimit = limitNow(new LimitStore(localStorage, DEPLOYMENT, props.account).get(), Date.now());
  } catch {
    // Storage refused: the default daily limit.
  }
  const cap = amountIn(capText, LIMIT_DECIMALS);
  const keep = keepOn ? amountIn(keepText, LIMIT_DECIMALS) : null;
  const name = cleanBankName(bankName);
  // Changing it: an empty account number keeps the bank in force, if this phone knows it.
  const keepBank = props.changing && props.initial.bank !== null && accountNumber.trim() === "" && bankName.trim() === props.initial.bank.name;
  const last4 = keepBank ? props.initial.bank!.last4 : lastFour(accountNumber);
  const capProblem = cap === null || cap < MIN_MOVE || cap > MAX_CAP ? copy.autoCashCapRange : cap > dailyLimit ? copy.autoCashCapOverLimit(usd(dailyLimit)) : null;
  const ok = name !== null && last4 !== null && capProblem === null && (!keepOn || keep !== null);

  const submit = () => {
    setTried(true);
    if (!ok || !name || !last4 || cap === null) return;
    props.onSave({ currency: code, bank: { name, last4 }, keep: keep === null ? null : keep.toString(), cap: cap.toString() });
  };

  return (
    <form
      className="name-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <CurrencyPicker value={code} disabled={props.busy !== null} onChange={setCode} />
      <label className="field">
        <span>{copy.bankName}</span>
        <input value={bankName} disabled={props.busy !== null} onChange={(e) => setBankName(e.target.value)} autoComplete="off" />
      </label>
      {tried && name === null && <p className="error">{copy.autoCashBankProblem}</p>}
      <label className="field">
        <span>{copy.bankAccountName}</span>
        <input value={accountName} disabled={props.busy !== null} onChange={(e) => setAccountName(e.target.value)} autoComplete="off" />
      </label>
      <label className="field">
        <span>{copy.bankAccountNumber}</span>
        <input inputMode="numeric" value={accountNumber} disabled={props.busy !== null} onChange={(e) => setAccountNumber(e.target.value)} autoComplete="off" />
      </label>
      {tried && last4 === null && <p className="error">{copy.autoCashNumberProblem}</p>}
      <p className="hint">{props.changing && props.initial.bank ? copy.autoCashSameBank : copy.autoCashBankKept}</p>

      <p className="settings-group">{copy.autoCashWhat}</p>
      <label className="check-row">
        <input type="radio" name="autocash-what" checked={!keepOn} disabled={props.busy !== null} onChange={() => setKeepOn(false)} />
        <span>{copy.autoCashEverything}</span>
      </label>
      <label className="check-row">
        <input type="radio" name="autocash-what" checked={keepOn} disabled={props.busy !== null} onChange={() => setKeepOn(true)} />
        <span>{copy.autoCashAboveKeep}</span>
      </label>
      {keepOn && (
        <label className="field">
          <span>{copy.autoCashKeep}</span>
          <input inputMode="decimal" value={keepText} disabled={props.busy !== null} onChange={(e) => setKeepText(e.target.value)} placeholder="100" />
          <AmountUnderstood text={keepText} decimals={LIMIT_DECIMALS} />
        </label>
      )}

      <label className="field">
        <span>{copy.autoCashCap}</span>
        <input inputMode="decimal" value={capText} disabled={props.busy !== null} onChange={(e) => setCapText(e.target.value)} />
      </label>
      <AmountUnderstood text={capText} decimals={LIMIT_DECIMALS} />
      {capProblem ? <p className="error">{capProblem}</p> : <p className="hint">{copy.autoCashCapHint(usd(dailyLimit))}</p>}

      {cap !== null && capProblem === null && <p className="autocash-desk">{copy.autoCashDeskCan(usd(cap))}</p>}
      <p className="hint">{copy.autoCashFingerprints}</p>
      {props.busy && (
        <p className="hint" role="status">
          {props.busy}
        </p>
      )}
      {props.notice && <NoticeLine notice={props.notice} />}
      <button type="submit" className="pill-btn" disabled={props.busy !== null || !props.enabled}>
        {props.changing ? copy.autoCashSave : copy.autoCashTurnOn}
      </button>
      {props.onBack && (
        <button type="button" className="btn ghost" disabled={props.busy !== null} onClick={props.onBack}>
          {copy.back}
        </button>
      )}
    </form>
  );
}
