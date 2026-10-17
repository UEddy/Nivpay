import { useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddressEqual, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { cleanName } from "../lib/accounts.ts";
import { liveWriteChain } from "../lib/chain.ts";
import { changeLabel, changeStatusLine, changeTitle, choicesFor, isComing, openChanges, waitText, widens, type ChangeKind, type ChangeWords, type PotChange } from "../lib/changes.ts";
import { changeData, changeRefusalOf, type ChangeCall } from "../lib/changesLive.ts";
import type { Contact } from "../lib/contacts.ts";
import { confirmsAccount, parseAccountId } from "../lib/draft.ts";
import { describeFailure, SendFailure } from "../lib/errors.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";
import { idbWriteStore } from "../lib/idb.ts";
import { notifyTx } from "../lib/notify.ts";
import { amountIn, formatAmount } from "../lib/money.ts";
import type { PotState } from "../lib/potview.ts";
import { rememberReceipt } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { sendWrite, type Step } from "../lib/send.ts";
import { fitsText32, toText32 } from "../lib/text32.ts";
import { followToFinality, type PendingWrite } from "../lib/writes.ts";
import { beforePasskey } from "../lib/cancel.ts";
import { dateLocale } from "../lib/locale.ts";
import { AmountUnderstood, NoticeLine, Sheet, STOPPED, useCancellable, type Notice } from "./ui.tsx";

const changeWhen = new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** A time in seconds as "Mon 20 Oct, 09:00", in the phone's own time, as Who controls this pot writes dates. */
export const whenText = (seconds: bigint) => changeWhen.format(new Date(Number(seconds) * 1000)).replace(",", "");

/** How a pot's changes are told: its payees by name, its dollar, and dates as "Mon 20 Oct, 09:00". */
export function changeWordsFor(state: Pick<PotState, "payees" | "decimals">): ChangeWords {
  return {
    payeeName: (i) => state.payees[i]?.name || copy.unnamedPayee,
    money: (u) => formatAmount(u, state.decimals, "auto"),
    when: whenText,
  };
}

/** Everyone who put money in, from the pot's events, once each. */
export function fundersOf(events: readonly { name: string; args: Record<string, unknown> }[]): Address[] {
  const out = new Map<string, Address>();
  for (const e of events) if (e.name === "Funded") out.set(String(e.args.funder).toLowerCase(), getAddress(String(e.args.funder)));
  return [...out.values()];
}

/**
 * A pot's changes on NivPayPotsV2 (README, "Pots that can change"): those on
 * the way, with how many yeses each has, when one takes effect, and, for
 * anyone with money in, Take my part out before it does. Deciders get
 * Propose a change. Shown only for a pot on V2; a NivPayPots pot never can.
 */
export function PotChanges(props: {
  state: PotState;
  me: Address;
  potId: bigint;
  pots: Address;
  contacts: Contact[];
  words: ChangeWords;
  nameOf: (account: Address) => string;
  /** Opens Take my part out (the Close screen). */
  onTakeOut: () => void;
  /** Reads the pot again once a change is final. */
  onChanged: () => void;
  /** Accounts that put money in, from the pot's events, so they can be told when a change is agreed. */
  funders: Address[];
}) {
  const { state, me } = props;
  const writes = useChangeWrites(me, props.pots, props.potId, props.onChanged, props.funders);
  const [proposing, setProposing] = useState(false);
  if (!state.onV2) return null;
  const iDecide = state.deciders.some((d) => isAddressEqual(d, me));
  const open = openChanges(state.changes);
  const myWorth = state.held[me.toLowerCase()] ?? 0n;
  if (!open.length && !iDecide && !writes.result) return null;

  return (
    <section className="card pot-changes enter" aria-labelledby="pot-changes">
      <p className="eyebrow" id="pot-changes">
        {copy.changesTitle}
      </p>
      {open.map((c) => {
        const can = choicesFor(c, me, iDecide);
        const busy = writes.busy === c.id.toString();
        return (
          <div className="change-row" key={c.id.toString()}>
            <p className="name">{changeTitle(c, props.words)}</p>
            <p className="meta">{copy.changeProposedBy(isAddressEqual(c.proposer, me) ? copy.youCap : props.nameOf(c.proposer))}</p>
            <p className="meta">{changeStatusLine(c, props.words)}</p>
            {isComing(c) && <p className="hint">{copy.changeComingHint}</p>}
            <div className="change-actions">
              {can.yes && (
                <button type="button" className="btn small" disabled={writes.busy !== null} aria-busy={busy} onClick={() => writes.run({ functionName: "approveChange", args: [c.id] }, copy.changeYesDone, c.id.toString())}>
                  {busy ? writes.stepText : copy.changeSayYes}
                </button>
              )}
              {can.apply && !state.closed && (
                <button type="button" className="btn small" disabled={writes.busy !== null || state.frozen} aria-busy={busy} onClick={() => writes.run({ functionName: "applyChange", args: [c.id] }, copy.changeMadeDone, c.id.toString())}>
                  {busy ? writes.stepText : copy.changeMakeIt}
                </button>
              )}
              {can.withdraw && (
                <button type="button" className="btn ghost small" disabled={writes.busy !== null} onClick={() => writes.run({ functionName: "withdrawChange", args: [c.id] }, copy.changeWithdrawnDone, c.id.toString())}>
                  {copy.changeWithdrawIt}
                </button>
              )}
              {isComing(c) && myWorth > 0n && (
                <button type="button" className="btn ghost small" onClick={props.onTakeOut}>
                  {copy.takeMyPartOut}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {writes.result && !proposing && <NoticeLine notice={writes.result} />}
      {iDecide && !state.closed && (
        <button type="button" className="pill-btn outline" disabled={writes.busy !== null} onClick={() => (writes.clear(), setProposing(true))}>
          {copy.proposeChange}
        </button>
      )}
      {proposing && <ProposeChangeSheet state={state} potId={props.potId} contacts={props.contacts} words={props.words} writes={writes} onClose={() => setProposing(false)} />}
    </section>
  );
}

/**
 * Proposing, saying yes to, withdrawing and making a change: each run as a
 * call first, so a refusal costs no gas grant and no passkey prompt, then
 * sent through sendWrite and followed to finality.
 */
function useChangeWrites(me: Address, pots: Address, potId: bigint, onChanged: () => void, funders: Address[]) {
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [result, setResult] = useState<Notice | null>(null);
  const running = useCancellable();
  const alive = useRef(true);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const people = useRef(funders);
  people.current = funders;
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const land = async (write: PendingWrite, done: string) => {
    const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
    if (!alive.current) return;
    if (outcome.kind === "final") {
      // Who to tell that a change was agreed goes first; the receipt's own notice follows and finds it handled.
      void notifyChangeTx(write.hash, people.current);
      rememberReceipt(write.address, write.hash);
      setResult({ tone: "ok", text: done });
      // Read again a little later too: the public RPC's nodes don't all reach the same finalized block at once.
      changed.current();
      setTimeout(() => alive.current && changed.current(), 3000);
      setTimeout(() => alive.current && changed.current(), 8000);
    } else if (outcome.kind === "reverted") setResult({ tone: "bad", text: copy.requestDidNotGoThrough, code: ERROR_CODES.REVERTED });
    else if (outcome.kind === "superseded") setResult({ tone: "bad", text: copy.requestDidNotGoThrough, code: ERROR_CODES.SUPERSEDED });
    else setResult(outcome.refused ? { tone: "bad", text: copy.requestTurnedDown, code: ERROR_CODES.REFUSED } : { tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
  };

  // A change in flight when the app was closed: followed again to its end.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    void idbWriteStore.get(me).then((w) => {
      if (!w || !alive.current || !w.label.startsWith(changeLabel(potId, "")) || w.replaceable) return;
      setBusy("resumed");
      void land(w, copy.changeYesDone).finally(() => alive.current && setBusy(null));
    });
  }, [me, potId]);

  const run = async (call: ChangeCall, done: string, key: string): Promise<boolean> => {
    setResult(null);
    setBusy(key);
    const r = running.start();
    try {
      setStep("preparing");
      const refusal = await changeRefusalOf(readClient, pots, me, call);
      if (refusal) throw refusal;
      const write = await sendWrite({ from: me, to: pots, data: changeData(call), label: changeLabel(potId, call.functionName), signal: r.signal, onStep: r.track((s: Step) => setStep(s)) });
      try {
        await land(write, done);
      } catch (e) {
        if (alive.current) setResult({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
        return false;
      }
      return true;
    } catch (e) {
      if (alive.current && !r.signal.aborted) setResult({ tone: "bad", ...describeFailure(e) });
      return false;
    } finally {
      if (alive.current) {
        setStep(null);
        setBusy(null);
      }
    }
  };

  const stop = () => {
    if (!beforePasskey(step) || !running.cancel()) return false;
    setStep(null);
    setBusy(null);
    setResult(STOPPED);
    return true;
  };

  const stepText = step === "confirm" ? copy.stepConfirm : step === "preparing" ? copy.stepPreparing : step === "getting-ready" ? copy.stepGettingReady : copy.asking;
  return { busy, step, stepText, result, run, stop, clear: () => setResult(null) };
}

/** Tells /api/notify about a final change, with who put money in, for it to check on the chain (lib/notify.ts). */
const notifyChangeTx = (tx: Hex, people: Address[]) => notifyTx(DEPLOYMENT, tx, people);

const KIND_LABELS: Record<ChangeKind, () => string> = {
  add: () => copy.changeKindAdd,
  raise: () => copy.changeKindRaise,
  lower: () => copy.changeKindLower,
  remove: () => copy.changeKindRemove,
  later: () => copy.changeKindLater,
};
const SHEET_KINDS: ChangeKind[] = ["add", "raise", "lower", "remove", "later"];

/** Two digits, for the date and time fields. */
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Propose a change: what kind, then only what that kind needs. Each field
 * says what the contract would refuse before anything is asked of the
 * fingerprint; the contract checks it all again as a call.
 */
function ProposeChangeSheet(props: { state: PotState; potId: bigint; contacts: Contact[]; words: ChangeWords; writes: ReturnType<typeof useChangeWrites>; onClose: () => void }) {
  const { state, writes } = props;
  const d = state.decimals;
  const fmt = (v: bigint) => formatAmount(v, d, "auto");
  const live = state.payees.map((p, i) => ({ ...p, index: i })).filter((p) => !state.removed[p.index]);
  const [kind, setKind] = useState<ChangeKind>("add");
  const [payee, setPayee] = useState(live[0]?.index ?? 0);
  const [limitText, setLimitText] = useState("");
  const [name, setName] = useState("");
  const [idText, setIdText] = useState("");
  const [last4, setLast4] = useState("");
  const [contact, setContact] = useState<Address | null>(null);
  const end = new Date(Number(state.endTime) * 1000);
  const [dateText, setDateText] = useState(`${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`);
  const [timeText, setTimeText] = useState(`${pad(end.getHours())}:${pad(end.getMinutes())}`);

  const chosen = state.payees[payee];
  const limit = amountIn(limitText, d);
  const pasted = parseAccountId(idText);
  const account: Address | null = contact ?? (pasted && confirmsAccount(pasted, last4) ? pasted : null);
  const newEnd = useMemo(() => {
    const t = new Date(`${dateText}T${timeText || "00:00"}`).getTime();
    return Number.isFinite(t) ? BigInt(Math.floor(t / 1000)) : null;
  }, [dateText, timeText]);

  // A change that adds to spending applies only after its wait: if the pot closes first, it never can.
  const tooLate = state.endTime < state.now + state.exitWindow;

  // What the contract would refuse, said before anything is sent.
  const problem: string | null = (() => {
    if (widens(kind) && tooLate) return copy.changeClosesTooSoon(waitText(state.exitWindow, dateLocale()));
    if (kind === "add") {
      if (!cleanName(name)) return copy.changeNameMissing;
      if (!fitsText32(cleanName(name))) return copy.changeNameTooLong;
      if (!account) return copy.changePayeeMissing;
      if (limit === null || limit <= 0n) return copy.changeLimitMissing;
      return null;
    }
    if (kind === "later") return newEnd === null || newEnd <= state.endTime ? copy.changeDateNotLater : null;
    if (!chosen) return copy.changePayeeMissing;
    if (kind === "remove") return null;
    if (limit === null || limit <= 0n) return copy.changeLimitMissing;
    if (kind === "raise" && limit <= chosen.cap) return copy.changeLimitNotHigher(fmt(chosen.cap));
    if (kind === "lower" && limit >= chosen.cap) return copy.changeLimitNotLower(fmt(chosen.cap));
    if (kind === "lower" && limit < chosen.spent) return copy.changeLimitBelowPaid(fmt(chosen.spent));
    return null;
  })();

  const call = (): ChangeCall | null => {
    if (problem) return null;
    const id = props.potId;
    switch (kind) {
      case "add":
        return { functionName: "proposeAddPayee", args: [id, account!, toText32(cleanName(name)), limit!] };
      case "raise":
        return { functionName: "proposeRaiseLimit", args: [id, payee, limit!] };
      case "lower":
        return { functionName: "proposeLowerLimit", args: [id, payee, limit!] };
      case "remove":
        return { functionName: "proposeRemovePayee", args: [id, payee] };
      case "later":
        return { functionName: "proposeLaterClose", args: [id, newEnd!] };
    }
  };
  const busy = writes.busy === "propose";

  return (
    // Closing the sheet before the passkey stops the proposal and keeps the sheet open, saying nothing was sent.
    <Sheet title={copy.changeSheetTitle} onClose={() => writes.stop() || beforePasskey(writes.step) || props.onClose()}>
      <div className="payee-choice" role="radiogroup" aria-label={copy.changeSheetTitle}>
        {SHEET_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`payee-option${kind === k ? " on" : ""}`} disabled={busy} onClick={() => setKind(k)}>
            <span className="name">{KIND_LABELS[k]()}</span>
          </button>
        ))}
      </div>

      {(kind === "raise" || kind === "lower" || kind === "remove") && (
        <div className="payee-choice" role="radiogroup" aria-label={copy.changeWhichPayee}>
          {live.map((p) => (
            <button key={p.index} type="button" role="radio" aria-checked={payee === p.index} className={`payee-option${payee === p.index ? " on" : ""}`} disabled={busy} onClick={() => setPayee(p.index)}>
              <span className="name">{p.name || props.words.payeeName(p.index)}</span>
              <span className="meta">{copy.changeNowLimit(fmt(p.cap), fmt(p.spent))}</span>
            </button>
          ))}
        </div>
      )}

      {kind === "add" && (
        <>
          <label className="field">
            <span>{copy.changePayeeName}</span>
            <input value={name} maxLength={32} disabled={busy} onChange={(e) => setName(e.target.value)} />
          </label>
          {props.contacts.length > 0 && (
            <div className="payee-choice" role="radiogroup" aria-label={copy.changeOrContact}>
              <p className="hint">{copy.changeOrContact}</p>
              {props.contacts.map((c) => (
                <button
                  key={c.account}
                  type="button"
                  role="radio"
                  aria-checked={contact !== null && isAddressEqual(contact, c.account)}
                  className={`payee-option${contact !== null && isAddressEqual(contact, c.account) ? " on" : ""}`}
                  disabled={busy}
                  onClick={() => {
                    setContact(c.account);
                    if (!name) setName(c.name);
                  }}
                >
                  <span className="name">{c.name}</span>
                  <span className="meta">{copy.accountEnding(c.account)}</span>
                </button>
              ))}
            </div>
          )}
          {!contact && (
            <>
              <label className="field">
                <span>{copy.theirAccountId}</span>
                <input value={idText} autoComplete="off" spellCheck={false} disabled={busy} onChange={(e) => setIdText(e.target.value)} />
              </label>
              {idText.trim() && !pasted && <p className="hint">{copy.accountIdInvalid}</p>}
              {pasted && (
                <label className="field">
                  <span>{copy.typeLast4}</span>
                  <input value={last4} maxLength={4} autoComplete="off" spellCheck={false} disabled={busy} onChange={(e) => setLast4(e.target.value)} />
                </label>
              )}
              {pasted && last4.length === 4 && !confirmsAccount(pasted, last4) && <p className="hint">{copy.last4Wrong}</p>}
            </>
          )}
        </>
      )}

      {kind !== "remove" && kind !== "later" && (
        <>
          <label className="field">
            <span>{copy.changeNewLimit}</span>
            <input value={limitText} inputMode="decimal" disabled={busy} onChange={(e) => setLimitText(e.target.value)} />
          </label>
          <AmountUnderstood text={limitText} decimals={d} />
        </>
      )}

      {kind === "later" && (
        <div className="field-pair">
          <label className="field">
            <span>{copy.changeNewDate}</span>
            <input type="date" value={dateText} disabled={busy} onChange={(e) => setDateText(e.target.value)} />
          </label>
          <label className="field">
            <span>{copy.changeNewTime}</span>
            <input type="time" value={timeText} disabled={busy} onChange={(e) => setTimeText(e.target.value)} />
          </label>
        </div>
      )}

      {widens(kind) && tooLate && <p className="hint">{copy.changeClosesTooSoon(waitText(state.exitWindow, dateLocale()))}</p>}
      <p className="hint">{widens(kind) ? copy.changeWidensHint(waitText(state.exitWindow, dateLocale())) : copy.changeNarrowsHint}</p>
      {problem && (limitText || name || idText || kind === "later") && <p className="hint">{problem}</p>}
      {writes.result && <NoticeLine notice={writes.result} />}
      <button
        type="button"
        className="btn primary"
        disabled={busy || problem !== null}
        aria-busy={busy}
        onClick={async () => {
          const c = call();
          if (c && (await writes.run(c, copy.changeProposedDone, "propose"))) props.onClose();
        }}
      >
        {busy ? writes.stepText : copy.changeProposeIt}
      </button>
    </Sheet>
  );
}
