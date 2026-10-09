import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import type { StoredAccount } from "../lib/accounts.ts";
import { ERC20_READ_ABI } from "../lib/abi.ts";
import { liveWriteChain } from "../lib/chain.ts";
import { DEPLOYMENT, DOLLAR } from "../lib/deployment.ts";
import { confirmsAccount, parseAccountId } from "../lib/draft.ts";
import { AppError, describeFailure, SendFailure } from "../lib/errors.ts";
import { idbWriteStore } from "../lib/idb.ts";
import type { PayLink } from "../lib/invites.ts";
import { formatAmount, parseAmount } from "../lib/money.ts";
import { receiptUrl, rememberReceipt } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { retryStuckWrite, sendWrite, type Step } from "../lib/send.ts";
import { checkSend, SEND_LABEL, transferData, transferRefused } from "../lib/transfer.ts";
import { followToFinality, type PendingWrite } from "../lib/writes.ts";
import { Icon, NoticeLine, Sheet, type Notice } from "./ui.tsx";

type Recipient = { account: Address; name: string };
type Done = { to: Recipient; amount: bigint; settledMs: number; hash: Hex };

/** The write's label carries who and how much, so a payment resumed after a reload can still say so. */
const labelFor = (to: Address, amount: bigint) => `${SEND_LABEL} ${to} ${amount}`;
function fromLabel(label: string): { to: Address; amount: bigint } | null {
  const [kind, to, amount] = label.split(" ");
  const account = to ? parseAccountId(to) : null;
  return kind === SEND_LABEL && account && amount && /^\d+$/.test(amount) ? { to: account, amount: BigInt(amount) } : null;
}

const STEP_TEXT: Record<Step | "landing", string> = {
  preparing: copy.stepPreparing,
  "getting-ready": copy.stepGettingReady,
  confirm: copy.stepConfirm,
  sending: copy.stepSendingPayment,
  landing: copy.stepSettling,
};

/**
 * Sending dollars to another person: by their request link, or by an Account
 * ID pasted and confirmed by its last 4 characters. A confirm sheet shows who,
 * how much and the fee before one fingerprint signs it, and success is shown
 * only at Finalized, with the time it took.
 */
export function SendScreen(props: { account: StoredAccount; request: PayLink | null; banner: ReactNode; onClose: () => void }) {
  const me = props.account.address;
  const request = props.request && props.request.deployment === DEPLOYMENT ? props.request : null;
  const [to, setTo] = useState<Recipient | null>(request ? { account: request.account, name: request.name } : null);
  const [idText, setIdText] = useState("");
  const [last4, setLast4] = useState("");
  const [amountText, setAmountText] = useState("");
  const [holding, setHolding] = useState<{ balance: bigint; decimals: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [stuck, setStuck] = useState(false);
  const [result, setResult] = useState<Notice | null>(
    props.request && !request ? { tone: "bad", text: copy.errPayLinkOtherVersion, code: ERROR_CODES.PAY_LINK_OTHER_VERSION } : null,
  );
  const [done, setDone] = useState<Done | null>(null);
  const alive = useRef(true);
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

  // A requested amount fills the field once decimals are known.
  useEffect(() => {
    if (request && request.amount > 0n && holding && !amountText) setAmountText(formatAmount(request.amount, holding.decimals, "auto").replace(/^\$/, ""));
  }, [request, holding, amountText]);

  const land = useCallback(
    async (write: PendingWrite, recipient: Recipient, amount: bigint) => {
      setStep("landing");
      try {
        const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
        if (!alive.current) return;
        setStep(null);
        if (outcome.kind === "final") {
          rememberReceipt(write.address, write.hash);
          setStuck(false);
          setDone({ to: recipient, amount, settledMs: outcome.settledMs, hash: write.hash });
          void readHolding().catch(() => {});
        } else if (outcome.kind === "stuck") {
          setStuck(true);
          setResult({ tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
        } else {
          setStuck(false);
          setResult({ tone: "bad", text: copy.sendDidNotGoThrough, code: outcome.kind === "reverted" ? ERROR_CODES.REVERTED : ERROR_CODES.SUPERSEDED });
        }
      } catch (e) {
        if (!alive.current) return;
        setStep(null);
        setResult({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
      }
    },
    [readHolding],
  );

  // Resume a payment that was in flight when the app was closed.
  useEffect(() => {
    void idbWriteStore.get(me).then((w) => {
      const sent = w ? fromLabel(w.label) : null;
      if (!w || !sent || !alive.current) return;
      const recipient = { account: sent.to, name: copy.accountEnding(sent.to) };
      setTo(recipient);
      if (w.replaceable) {
        setStuck(true);
        setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
      } else void land(w, recipient, sent.amount);
    });
  }, [me, land]);

  const decimals = holding?.decimals ?? 6;
  const amount = parseAmount(amountText, decimals);
  const pasted = parseAccountId(idText);
  const pastedOk = pasted !== null && confirmsAccount(pasted, last4);

  const choosePasted = () => {
    if (pasted && pastedOk) setTo({ account: pasted, name: copy.accountEnding(pasted) });
  };

  /** Every check that needs no signature, then the confirm sheet. */
  const review = async () => {
    if (!to || !holding) return;
    setResult(null);
    setStep("preparing");
    try {
      const code = await readClient.getCode({ address: to.account });
      const problem = checkSend({ me, to: to.account, amount: amount ?? 0n, balance: holding.balance, decimals, recipientHasCode: (code?.length ?? 0) > 2 });
      if (problem) throw problem;
      if (await transferRefused(readClient, DOLLAR, me, to.account, amount!)) throw new AppError(copy.errSendRefused, ERROR_CODES.SEND_REFUSED);
      if (alive.current) setConfirming(true);
    } catch (e) {
      if (alive.current) setResult({ tone: "bad", ...(e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e)) });
    } finally {
      if (alive.current) setStep(null);
    }
  };

  const send = async (retry: boolean) => {
    if (!to || amount === null) return;
    setConfirming(false);
    setResult(null);
    const call = { from: me, to: DOLLAR, data: transferData(to.account, amount), label: labelFor(to.account, amount), onStep: (s: Step) => setStep(s) };
    try {
      const write = retry ? await retryStuckWrite(call) : await sendWrite(call);
      await land(write, to, amount);
    } catch (e) {
      setStep(null);
      setResult({ tone: "bad", ...describeFailure(e) });
    }
  };

  const money = (v: bigint) => formatAmount(v, decimals, "auto");

  return (
    <div className="screen">
      <div className="bar">
        <button type="button" className="icon-btn" aria-label={copy.close} onClick={props.onClose}>
          <Icon name="close" size={22} />
        </button>
        <div className="bar-title">{copy.sendTitle}</div>
        <div className="bar-spacer" />
      </div>
      {props.banner}
      <div className="screen-body">
        {done ? (
          <div className="card enter sent-card" role="status">
            <p className="eyebrow">{copy.sentEyebrow}</p>
            <h1>{copy.sentTitle(money(done.amount), done.to.name)}</h1>
            <p className="lede">{copy.settledIn((done.settledMs / 1000).toFixed(1))}</p>
            <a className="receipt-link" href={receiptUrl(done.hash)} target="_blank" rel="noopener noreferrer">
              {copy.viewReceipt}
            </a>
          </div>
        ) : (
          <>
            {request && <p className="lede enter">{copy.sendFromRequest(request.name)}</p>}
            <div className="card enter" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {to ? (
                <div className="list-row">
                  <div className="grow">
                    <span className="name">{copy.sendingTo(to.name)}</span>
                    <span className="meta">{copy.accountEnding(to.account)}</span>
                  </div>
                  {!step && !stuck && (
                    <button type="button" className="btn ghost small" onClick={() => setTo(null)}>
                      {copy.changeRecipient}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <p className="eyebrow">{copy.sendTo}</p>
                  <p className="hint">{copy.sendToHint}</p>
                  <label className="field">
                    <span>{copy.pasteAccountId}</span>
                    <input value={idText} onChange={(e) => setIdText(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
                  </label>
                  {idText.trim() && !pasted && <p className="error">{copy.notAnAccountId}</p>}
                  {pasted && (
                    <label className="field">
                      <span>{copy.confirmLast4}</span>
                      <input value={last4} onChange={(e) => setLast4(e.target.value)} maxLength={4} autoComplete="off" autoCapitalize="off" spellCheck={false} />
                    </label>
                  )}
                  {pasted && last4.trim().length === 4 && !pastedOk && <p className="error">{copy.last4Mismatch}</p>}
                  <button type="button" className="btn" disabled={!pastedOk} onClick={choosePasted}>
                    {copy.useThisAccount}
                  </button>
                </>
              )}
            </div>
            {to && (
              <div className="card enter" style={{ display: "flex", flexDirection: "column", gap: 8, animationDelay: "80ms" }}>
                <label className="field">
                  <span>{copy.howMuch}</span>
                  <input inputMode="decimal" value={amountText} disabled={step !== null || stuck} onChange={(e) => setAmountText(e.target.value)} placeholder="25" />
                </label>
                {request && request.amount > 0n && <p className="hint">{copy.requestedAmount(money(request.amount))}</p>}
                {holding && <p className="hint">{copy.yourBalanceIs(formatAmount(holding.balance, decimals, "cents"))}</p>}
              </div>
            )}
            {result && <NoticeLine notice={result} />}
          </>
        )}
      </div>
      <div className="screen-foot">
        {done ? (
          <button type="button" className="pill-btn" onClick={props.onClose}>
            {copy.done}
          </button>
        ) : stuck && step === null ? (
          <button type="button" className="pill-btn" onClick={() => send(true)}>
            {copy.tryAgain}
          </button>
        ) : (
          to && (
            <button
              type="button"
              className={`pill-btn${step ? " busy" : ""}`}
              disabled={step !== null || amount === null || amount <= 0n || !holding}
              aria-busy={step !== null}
              onClick={review}
            >
              {step ? STEP_TEXT[step] : copy.reviewSend}
            </button>
          )
        )}
      </div>
      {confirming && to && amount !== null && (
        <Sheet title={copy.confirmSendTitle} onClose={() => setConfirming(false)}>
          <div className="list">
            <div className="list-row">
              <div className="grow">
                <span className="meta">{copy.confirmTo}</span>
                <span className="name">{to.name}</span>
                <span className="meta">{copy.accountEnding(to.account)}</span>
              </div>
            </div>
            <div className="list-row">
              <div className="grow">
                <span className="meta">{copy.confirmAmount}</span>
                <span className="name">{money(amount)}</span>
              </div>
            </div>
            <div className="list-row">
              <div className="grow">
                <span className="meta">{copy.confirmFee}</span>
                <span className="name">{copy.noFee}</span>
              </div>
            </div>
            <div className="list-row">
              <div className="grow">
                <span className="meta">{copy.confirmArrives}</span>
                <span className="name">{copy.arrivesInSeconds}</span>
              </div>
            </div>
          </div>
          <button type="button" className="pill-btn" onClick={() => send(false)}>
            {copy.sendAction(money(amount))}
          </button>
          <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
            {copy.back}
          </button>
        </Sheet>
      )}
    </div>
  );
}
