import { useCallback, useEffect, useRef, useState } from "react";
import { isAddressEqual, type Address } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { liveWriteChain } from "../lib/chain.ts";
import { POTS } from "../lib/deployment.ts";
import { describeFailure, SendFailure } from "../lib/errors.ts";
import { idbWriteStore } from "../lib/idb.ts";
import { formatAmount, parseAmount } from "../lib/money.ts";
import { askLabel, askView, ttlDays, type AskedRequest, type PotFacts } from "../lib/payout.ts";
import { askCall, askData, askIn, proposalIdIn, readFeeTerms, refusalOf, type FeeTerms } from "../lib/payoutLive.ts";
import { rememberReceipt } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { retryStuckWrite, sendWrite, type Step } from "../lib/send.ts";
import { followToFinality, type PendingWrite } from "../lib/writes.ts";
import { Icon, NoticeLine, Sheet, type Notice } from "./ui.tsx";

export type Asking = { payee: number; amount: bigint };

/**
 * Asking for a payment from a pot: run as a call, signed once, followed to
 * Finalized. The request's number is read from its own finalized receipt and
 * handed to `onAsked`, which opens it. An ask in flight when the app was
 * closed is picked up again from its saved bytes; a stuck one is retried with
 * the same payee and amount, on the same nonce.
 */
export function useAskFlow(me: Address, potId: bigint, onAsked: (proposalId: bigint) => void) {
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [stuck, setStuck] = useState<Asking | null>(null);
  const [result, setResult] = useState<Notice | null>(null);
  const alive = useRef(true);
  const askedRef = useRef(onAsked);
  askedRef.current = onAsked;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const land = useCallback(async (write: PendingWrite, what: Asking) => {
    setStep("landing");
    setAsking(what);
    const stop = (notice: Notice) => {
      if (!alive.current) return;
      setStep(null);
      setResult(notice);
    };
    try {
      const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
      if (outcome.kind === "final") {
        rememberReceipt(write.address, write.hash);
        const id = await proposalIdIn(readClient, POTS, write.hash);
        if (!alive.current) return;
        setStep(null);
        setStuck(null);
        if (id === null) setResult({ tone: "bad", text: copy.requestDidNotGoThrough, code: ERROR_CODES.REVERTED });
        else askedRef.current(id);
      } else if (outcome.kind === "reverted") stop({ tone: "bad", text: copy.requestDidNotGoThrough, code: ERROR_CODES.REVERTED });
      else if (outcome.kind === "superseded") stop({ tone: "bad", text: copy.requestDidNotGoThrough, code: ERROR_CODES.SUPERSEDED });
      else {
        setStuck(what);
        stop(outcome.refused ? { tone: "bad", text: copy.requestTurnedDown, code: ERROR_CODES.REFUSED } : { tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
      }
    } catch (e) {
      stop({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
    }
  }, []);

  /** True when an ask for this pot was in flight when the app was closed. */
  const [resumable, setResumable] = useState(false);
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    void idbWriteStore.get(me).then((w) => {
      if (!w || w.label !== askLabel(potId) || !alive.current) return;
      const what = askIn(w.raw, POTS, potId);
      if (!what) return;
      setResumable(true);
      setAsking(what);
      if (w.replaceable) {
        setStuck(what);
        setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
      } else void land(w, what);
    });
  }, [me, potId, land]);

  const ask = async (what: Asking, facts: PotFacts, retry: boolean) => {
    setResult(null);
    setAsking(what);
    try {
      setStep("preparing");
      // Run it as a call first: a refusal costs no gas grant and no passkey prompt.
      const refusal = await refusalOf(readClient, POTS, me, askCall(potId, what.payee, what.amount), facts, what);
      if (refusal) throw refusal;
      const call = { from: me, to: POTS, data: askData(potId, what.payee, what.amount), label: askLabel(potId), onStep: setStep };
      const write = retry ? await retryStuckWrite(call) : await sendWrite(call);
      await land(write, what);
    } catch (e) {
      if (!alive.current) return;
      setStep(null);
      setResult({ tone: "bad", ...describeFailure(e) });
    }
  };

  return { step, asking, stuck, result, resumable, ask };
}

/** The ask sheet: one of the pot's payees, an amount, and the fee before the asker's own yes. */
export function AskSheet(props: {
  me: Address;
  facts: PotFacts;
  flow: ReturnType<typeof useAskFlow>;
  onClose: () => void;
}) {
  const { facts, flow } = props;
  const d = facts.decimals;
  const fmt = (v: bigint, style: "auto" | "cents" = "auto") => formatAmount(v, d, style);
  const [terms, setTerms] = useState<FeeTerms | null>(null);
  const [termsFailed, setTermsFailed] = useState(false);
  const [payee, setPayee] = useState(flow.asking?.payee ?? 0);
  const [text, setText] = useState(flow.asking ? fmt(flow.asking.amount).replace(/^\$/, "") : "");

  useEffect(() => {
    let live = true;
    readFeeTerms(readClient, POTS)
      .then((t) => live && setTerms(t))
      .catch(() => live && setTermsFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const busy = flow.step !== null;
  const amount = parseAmount(text, d);
  const chosen = facts.payees[payee];
  const view = terms ? askView(facts, props.me, payee, amount, terms.feeBps, terms.feeCap) : null;
  const what = flow.stuck ?? (busy && flow.asking ? flow.asking : null);
  const label =
    flow.step === "confirm"
      ? copy.stepConfirm
      : flow.step === "preparing"
        ? copy.stepPreparing
        : flow.step === "getting-ready"
          ? copy.stepGettingReady
          : flow.step && what
            ? copy.askingFor(fmt(what.amount), facts.payees[what.payee]?.name ?? "")
            : flow.step
              ? copy.asking
              : copy.askAction(fmt(amount ?? 0n), chosen?.name ?? "");
  const shownRefusal = view?.refusal && (text.trim() !== "" || view.refusal.code !== ERROR_CODES.PAY_NO_AMOUNT) ? view.refusal : null;

  return (
    <Sheet title={copy.askForPayment} onClose={props.onClose}>
      <p className="hint">{copy.askLede}</p>
      <div className="payee-choice" role="radiogroup" aria-label={copy.whoToPay}>
        {facts.payees.map((p, i) => (
          <button
            key={`${p.name}-${i}`}
            type="button"
            role="radio"
            aria-checked={payee === i}
            className={`payee-option${payee === i ? " on" : ""}`}
            disabled={busy || flow.stuck !== null}
            onClick={() => setPayee(i)}
          >
            <span className="name">{p.name}</span>
            <span className="meta">{copy.payeeLeft(fmt(p.cap - p.spent), fmt(p.cap))}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>{copy.askAmount}</span>
        <input value={text} inputMode="decimal" disabled={busy || flow.stuck !== null} onChange={(e) => setText(e.target.value)} />
      </label>
      {view && chosen && (
        <div className="money-rows">
          <div>
            <span>{copy.nivpayFee}</span>
            <span>{fmt(view.fee, "cents")}</span>
          </div>
          <div>
            <span>{copy.leftInPotAfter}</span>
            <strong>{fmt(view.leftAfter < 0n ? 0n : view.leftAfter, "cents")}</strong>
          </div>
          <div>
            <span>{copy.payeeLimit(chosen.name)}</span>
            <span>{copy.limitOf(fmt(view.limitAfter), fmt(chosen.cap))}</span>
          </div>
        </div>
      )}
      {view && chosen && <p className="hint">{copy.askCountsAsYes(view.more, chosen.name)}</p>}
      {terms && <p className="hint">{copy.needsYesesWithin(facts.threshold, ttlDays(terms.ttl))}</p>}
      {termsFailed && <NoticeLine notice={{ tone: "bad", text: copy.errPreparing, code: ERROR_CODES.PREPARING }} />}
      {shownRefusal && !busy && <NoticeLine notice={{ tone: "bad", text: shownRefusal.message, code: shownRefusal.code }} />}
      {flow.result && <NoticeLine notice={flow.result} />}
      {flow.stuck && !busy ? (
        <button type="button" className="btn primary" onClick={() => flow.ask(flow.stuck!, facts, true)}>
          {copy.tryAgain}
        </button>
      ) : (
        <button
          type="button"
          className="btn primary"
          disabled={busy || !view || view.refusal !== null || amount === null}
          aria-busy={busy}
          onClick={() => amount !== null && flow.ask({ payee, amount }, facts, false)}
        >
          {label}
        </button>
      )}
    </Sheet>
  );
}

/** Payment requests still waiting for a yes, newest first. Each opens its request screen. */
export function WaitingRequests(props: {
  requests: AskedRequest[];
  facts: PotFacts;
  nameOf: (account: Address) => string;
  me: Address;
  onOpen: (proposalId: bigint) => void;
}) {
  if (props.requests.length === 0) return null;
  const fmt = (v: bigint) => formatAmount(v, props.facts.decimals, "auto");
  return (
    <section className="list waiting-requests">
      <p className="eyebrow">{copy.waitingForYes}</p>
      {props.requests.map((r) => (
        <button type="button" className="row-btn" key={r.proposalId.toString()} onClick={() => props.onOpen(r.proposalId)}>
          <span className="row-text">
            <span className="v">
              {r.kind === 1
                ? copy.requestRowClose(isAddressEqual(r.asker, props.me) ? copy.youCap : props.nameOf(r.asker))
                : copy.requestRow(isAddressEqual(r.asker, props.me) ? copy.youCap : props.nameOf(r.asker), fmt(r.amount), props.facts.payees[r.payee]?.name ?? "")}
            </span>
            <span className="k">{copy.requestRowMeta(r.yes.length, props.facts.threshold)}</span>
          </span>
          <Icon name="chevron" size={18} className="row-chevron" />
        </button>
      ))}
    </section>
  );
}
