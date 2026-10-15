import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isAddressEqual, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { otherCurrencyNote } from "../lib/currencyNote.ts";
import { recipientDetail } from "../lib/recipient.ts";
import { cleanName, NAME_MAX, type StoredAccount } from "../lib/accounts.ts";
import { ContactStore, NamePairStore, namePairCheck, PaidStore, sendWarnings, type Contact } from "../lib/contacts.ts";
import { holderOf, namesOn } from "../lib/names.ts";
import { looksLikeAccountId, normalizeUsername, usernameProblem } from "../lib/usernames.ts";
import { ERC20_READ_ABI } from "../lib/abi.ts";
import { liveWriteChain } from "../lib/chain.ts";
import { CTK, SETTLEMENT_PAIR, SETTLEMENT_WHITELISTER } from "../lib/config.ts";
import { DEPLOYMENT, DOLLAR } from "../lib/deployment.ts";
import { confirmsAccount, parseAccountId } from "../lib/draft.ts";
import { AppError, describeFailure, SendFailure } from "../lib/errors.ts";
import { idbWriteStore } from "../lib/idb.ts";
import type { PayLink } from "../lib/invites.ts";
import { amountForField, amountIn, formatAmount, formatCurrency } from "../lib/money.ts";
import { receiptUrl, rememberReceipt } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { retryStuckWrite, sendSequence, sendWrite, type Step } from "../lib/send.ts";
import { assertSameQuote, fromCurrencyLabel, quote, received, settlementCalls, stepOf, type Quote } from "../lib/settle.ts";
import { readSettlement } from "../lib/settleLive.ts";
import { checkSend, SEND_LABEL, transferData, transferRefused } from "../lib/transfer.ts";
import { followSequence, followToFinality, type PendingWrite } from "../lib/writes.ts";
import { AmountUnderstood, Icon, type Notice, NoticeLine, Sheet, STOPPED, useCancellable, useOnline } from "./ui.tsx";
import { beforePasskey } from "../lib/cancel.ts";
import { checkDailyLimit, spendEnded, spendSent } from "../lib/spending.ts";
import { fromSent, NotesStore } from "../lib/notes.ts";
import { matchName, payableByVoice, VOICE_CAP, VOICE_DECIMALS, VoiceStore, withinVoiceCap, type VoiceCommand } from "../lib/voice.ts";
import { VoiceButton } from "./Voice.tsx";
import { balanceNote } from "../lib/connection.ts";
import { Avatar } from "./Avatar.tsx";

/** A username is set when the recipient was found by one, so it is checked again before signing. */
type Recipient = { account: Address; name: string; username?: string };
type Done = { to: Recipient; amount: bigint; settledMs: number; hash: Hex; received?: string; setupDone?: boolean };

/** Sending in another currency works through Agora's pair, which pairs AUSD with CTK: AUSD builds only. */
const OTHER_CURRENCY = DEPLOYMENT === "ausd";
const SETTLEMENT = { pair: SETTLEMENT_PAIR, whitelister: SETTLEMENT_WHITELISTER, dollar: DOLLAR, other: CTK };
const PROGRESS = { setup: copy.progressSetup, allow: copy.progressAllow, send: copy.stepSendingPayment } as const;

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
 * This account's own payment, once final, in its notifications (lib/notes.ts),
 * and counted towards turning voice on (lib/voice.ts). Amounts are in dollars.
 */
function noteSent(me: Address, tx: string, to: Recipient, amount: bigint): void {
  new VoiceStore(localStorage, DEPLOYMENT, me).saw(tx);
  try {
    new NotesStore(localStorage, DEPLOYMENT, me).update((s) => fromSent(s, { tx, to: to.account, toName: to.name, amount, decimals: 6, symbol: "$" }, Date.now()));
  } catch {
    // Storage refused: the payment itself is unaffected.
  }
}

/**
 * Sending dollars to another person: by their request link, or by an Account
 * ID pasted and confirmed by its last 4 characters. A confirm sheet shows who,
 * how much and the fee before one fingerprint signs it, and success is shown
 * only at Finalized, with the time it took.
 */
export function SendScreen(props: { account: StoredAccount; request: PayLink | null; banner: ReactNode; onClose: () => void }) {
  const me = props.account.address;
  const request = props.request && props.request.deployment === DEPLOYMENT ? props.request : null;
  // A link's name is whatever its maker typed: cleaned, and checked against contacts before paying.
  const linkName = request ? cleanName(request.name) || copy.accountEnding(request.account) : null;
  const [to, setTo] = useState<Recipient | null>(request ? { account: request.account, name: linkName! } : null);
  // Contacts and accounts paid before, on this phone, for this account (lib/contacts.ts).
  const contactStore = useMemo(() => new ContactStore(localStorage, DEPLOYMENT, me), [me]);
  const paid = useMemo(() => new PaidStore(localStorage, DEPLOYMENT, me), [me]);
  const [contacts, setContacts] = useState<Contact[]>(() => contactStore.list());
  // Usernames this account has paid, and the account each pointed at then (lib/contacts.ts).
  const pairs = useMemo(() => new NamePairStore(localStorage, DEPLOYMENT, me), [me]);
  const saveContact = (account: Address, name: string) => {
    const ok = contactStore.save(account, name, Date.now());
    setContacts(contactStore.list());
    return ok;
  };
  // What voice filled in (screens/Voice.tsx), and close names to pick from: never more than $200, still confirmed with a fingerprint.
  const [voice, setVoice] = useState<{ heard: string; account: Address; amount: bigint } | null>(null);
  const [voicePick, setVoicePick] = useState<{ options: Contact[]; amount: bigint; heard: string } | null>(null);
  const [idText, setIdText] = useState("");
  const [last4, setLast4] = useState("");
  const [amountText, setAmountText] = useState("");
  const [holding, setHolding] = useState<{ balance: bigint; decimals: number; readAt: number } | null>(null);
  const online = useOnline();
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [stuck, setStuck] = useState(false);
  const [result, setResult] = useState<Notice | null>(
    props.request && !request ? { tone: "bad", text: copy.errPayLinkOtherVersion, code: ERROR_CODES.PAY_LINK_OTHER_VERSION } : null,
  );
  const [done, setDone] = useState<Done | null>(null);
  const [currency, setCurrency] = useState<"dollars" | "other">("dollars");
  const [otherSymbol, setOtherSymbol] = useState<string | null>(null);
  const [shown, setShown] = useState<Quote | null>(null);
  const [sheetNotice, setSheetNotice] = useState<Notice | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const shownRef = useRef<Quote | null>(null);
  const otherSymbolRef = useRef<string | null>(null);
  shownRef.current = shown;
  otherSymbolRef.current = otherSymbol;
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
    if (alive.current) setHolding({ balance, decimals, readAt: Date.now() });
  }, [me]);
  useEffect(() => {
    void readHolding().catch(() => {});
    if (OTHER_CURRENCY) {
      void readClient
        .readContract({ address: CTK, abi: ERC20_READ_ABI, functionName: "symbol" })
        .then((sym) => alive.current && setOtherSymbol(sym))
        .catch(() => {});
    }
  }, [readHolding]);

  // A requested amount fills the field once decimals are known.
  useEffect(() => {
    if (request && request.amount > 0n && holding && !amountText) setAmountText(amountForField(request.amount, holding.decimals));
  }, [request, holding, amountText]);

  const land = useCallback(
    async (write: PendingWrite, recipient: Recipient, amount: bigint) => {
      setStep("landing");
      try {
        const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
        spendEnded(me, write, outcome.kind);
        if (!alive.current) return;
        setStep(null);
        if (outcome.kind === "final") {
          rememberReceipt(write.address, write.hash);
          noteSent(me, write.hash, recipient, amount);
          paid.add(recipient.account);
          if (recipient.username) pairs.remember(recipient.username, recipient.account);
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
    [readHolding, paid, pairs],
  );

  /** Follows a payment in another currency through its steps, each final before the next. */
  const landSequence = useCallback(
    async (write: PendingWrite, recipient: Recipient, amountIn: bigint, setupIncluded: boolean) => {
      const labels = [write.label, ...(write.then ?? []).map((n) => n.label)];
      setStep("landing");
      try {
        const { outcome, step, steps, write: last } = await followSequence(idbWriteStore, liveWriteChain, write, (i, n) => {
          const kind = stepOf(labels[i] ?? "");
          if (alive.current) setProgress(n > 1 ? copy.progressOf(i + 1, n, kind ? PROGRESS[kind] : copy.stepSettling) : null);
        });
        // Only the last step moves the dollars to them: a final setup alone doesn't settle the spend.
        spendEnded(me, write, outcome.kind === "final" && step !== steps - 1 ? "stuck" : outcome.kind);
        if (!alive.current) return;
        setStep(null);
        setProgress(null);
        const setupDone = setupIncluded && (step > 0 || outcome.kind === "final");
        if (outcome.kind === "final" && step === steps - 1) {
          rememberReceipt(last.address, last.hash);
          noteSent(me, last.hash, recipient, amountIn);
          paid.add(recipient.account);
          if (recipient.username) pairs.remember(recipient.username, recipient.account);
          setStuck(false);
          const receipt = await readClient.getTransactionReceipt({ hash: last.hash }).catch(() => null);
          const got = receipt ? received(receipt.logs, CTK, recipient.account) : null;
          setDone({
            to: recipient,
            amount: amountIn,
            settledMs: outcome.settledMs,
            hash: last.hash,
            received: got !== null ? formatCurrency(got, shownRef.current?.outDecimals ?? 18, otherSymbolRef.current ?? "") : undefined,
            setupDone,
          });
          void readHolding().catch(() => {});
        } else if (outcome.kind === "stuck") {
          setStuck(true);
          setResult({ tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
        } else {
          setStuck(false);
          const text = setupDone ? copy.setupDoneButNotSent : copy.sendDidNotGoThrough;
          setResult({ tone: "bad", text, code: outcome.kind === "reverted" ? ERROR_CODES.REVERTED : ERROR_CODES.SUPERSEDED });
        }
      } catch (e) {
        if (!alive.current) return;
        setStep(null);
        setProgress(null);
        setResult({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
      }
    },
    [readHolding, paid, pairs],
  );

  // Resume a payment that was in flight when the app was closed.
  useEffect(() => {
    void idbWriteStore.get(me).then((w) => {
      const resumed = w ? fromCurrencyLabel(w.label) : null;
      if (w && resumed && alive.current) {
        const recipient = { account: resumed.to, name: copy.accountEnding(resumed.to) };
        setTo(recipient);
        setCurrency("other");
        if (w.replaceable) {
          setStuck(true);
          setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
        } else void landSequence(w, recipient, resumed.amountIn, stepOf(w.label) === "setup");
        return;
      }
      const sent = w ? fromLabel(w.label) : null;
      if (!w || !sent || !alive.current) return;
      const recipient = { account: sent.to, name: copy.accountEnding(sent.to) };
      setTo(recipient);
      if (w.replaceable) {
        setStuck(true);
        setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
      } else void land(w, recipient, sent.amount);
    });
  }, [me, land, landSequence]);

  const decimals = holding?.decimals ?? 6;
  const amount = amountIn(amountText, decimals);
  const pasted = parseAccountId(idText);
  const pastedOk = pasted !== null && confirmsAccount(pasted, last4);

  const choosePasted = () => {
    if (pasted && pastedOk) setTo({ account: pasted, name: copy.accountEnding(pasted) });
  };

  // Send to also takes @username, looked up at the finalized block a moment after typing stops.
  const typedName = namesOn && !pasted && idText.trim() && !looksLikeAccountId(idText) ? normalizeUsername(idText) : "";
  const nameProblem = typedName ? usernameProblem(typedName) : null;
  const [found, setFound] = useState<{ name: string; account: Address | null } | "looking" | null>(null);
  useEffect(() => {
    if (!typedName || nameProblem) return setFound(null);
    setFound("looking");
    let live = true;
    const t = setTimeout(() => {
      holderOf(typedName)
        .then((account) => live && setFound({ name: typedName, account }))
        .catch(() => live && setFound(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [typedName, nameProblem]);
  const foundName = found && found !== "looking" && found.name === typedName ? found : null;
  // The first payment to a username asks for the last 4 characters, as a pasted Account ID does.
  const pairCheck = foundName?.account ? namePairCheck(foundName.account, pairs.get(foundName.name)) : null;
  const nameOk = foundName?.account && (pairCheck === "same" || (pairCheck === "first" && confirmsAccount(foundName.account, last4)));
  const chooseName = () => {
    if (foundName?.account && nameOk) setTo({ account: foundName.account, name: `@${foundName.name}`, username: foundName.name });
  };

  /** A username must still point where it did when it was chosen, and where it pointed when paid before. */
  const assertNameStill = async (r: Recipient) => {
    if (!r.username) return;
    const holder = await holderOf(r.username);
    const remembered = pairs.get(r.username);
    if (!holder || !isAddressEqual(holder, r.account) || namePairCheck(holder, remembered) === "changed") {
      throw new AppError(copy.errNameChanged(r.username), ERROR_CODES.NAME_CHANGED);
    }
  };

  /** A heard "send": only to a contact trusted for voice and paid before, and only up to $200. */
  const onVoice = (cmd: VoiceCommand, heard: string) => {
    if (cmd.kind !== "send") return;
    setResult(null);
    setVoicePick(null);
    if (!withinVoiceCap(cmd.amount)) return setResult({ tone: "bad", text: copy.errVoiceCap, code: ERROR_CODES.VOICE_OVER_CAP });
    const can = payableByVoice(contacts, new VoiceStore(localStorage, DEPLOYMENT, me).get().trusted, paid.all());
    const found = matchName(cmd.name, can);
    if (found.length === 0) return setResult({ tone: "bad", text: copy.voiceNoSuchContact(cmd.name) });
    if (found.length > 1) return setVoicePick({ options: found, amount: cmd.amount, heard });
    fillFromVoice(found[0]!, cmd.amount, heard);
  };
  const fillFromVoice = (c: Contact, amount: bigint, heard: string) => {
    setVoicePick(null);
    setTo({ account: c.account, name: c.name });
    setAmountText(amountForField(amount, VOICE_DECIMALS));
    setVoice({ heard, account: c.account, amount });
  };
  const voiceRead = (shownName: string, amount: bigint) =>
    voice && to && isAddressEqual(voice.account, to.account) ? <p className="hint voice-heard">{copy.voiceReadBack(money(amount), shownName, voice.heard)}</p> : null;

  /** Every check that needs no signature, then the confirm sheet. */
  const review = async () => {
    if (!to || !holding) return;
    setResult(null);
    setStep("preparing");
    const run = running.start();
    try {
      await assertNameStill(to);
      const code = await readClient.getCode({ address: to.account });
      const problem = checkSend({ me, to: to.account, amount: amount ?? 0n, balance: holding.balance, decimals, recipientHasCode: (code?.length ?? 0) > 2 });
      if (problem) throw problem;
      // The daily limit, before the confirm sheet (lib/limits.ts).
      checkDailyLimit(me, amount!);
      // A payment voice filled in is at most $200, even if the amount was changed afterwards (lib/voice.ts).
      if (voice && isAddressEqual(voice.account, to.account) && amount! > VOICE_CAP) throw new AppError(copy.errVoiceCap, ERROR_CODES.VOICE_OVER_CAP);
      if (currency === "other") {
        // The dollars go to Agora's pair, so that is the transfer that must be allowed.
        if (await transferRefused(readClient, DOLLAR, me, SETTLEMENT_PAIR, amount!)) throw new AppError(copy.errSendRefused, ERROR_CODES.SEND_REFUSED);
        const { state, deadline } = await readSettlement(readClient, SETTLEMENT, me, amount!);
        const q = quote(state, amount!, deadline);
        if (!alive.current || run.signal.aborted) return;
        setShown(q);
        setSheetNotice(null);
        setConfirming(true);
        return;
      }
      if (await transferRefused(readClient, DOLLAR, me, to.account, amount!)) throw new AppError(copy.errSendRefused, ERROR_CODES.SEND_REFUSED);
      if (alive.current && !run.signal.aborted) setConfirming(true);
    } catch (e) {
      if (alive.current && !run.signal.aborted) setResult({ tone: "bad", ...(e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e)) });
    } finally {
      // Stopped by X: the screen already says so, and may have started again.
      if (alive.current && !run.signal.aborted) setStep(null);
    }
  };

  const send = async (retry: boolean) => {
    if (!to || amount === null) return;
    setConfirming(false);
    setResult(null);
    const run = running.start();
    const call = {
      from: me,
      to: DOLLAR,
      data: transferData(to.account, amount),
      label: labelFor(to.account, amount),
      signal: run.signal,
      onStep: run.track((s: Step) => setStep(s)),
    };
    try {
      // Right before signing: the username still points where it did, and the limit still allows it.
      await assertNameStill(to);
      if (!retry) checkDailyLimit(me, amount);
      const write = retry ? await retryStuckWrite(call) : await sendWrite(call);
      spendSent(me, write, "send", amount);
      await land(write, to, amount);
    } catch (e) {
      if (run.signal.aborted) return;
      setStep(null);
      setResult({ tone: "bad", ...(e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e)) });
    }
  };

  /** Quotes again right before signing; if anything changed, the sheet shows the new quote instead of sending. */
  const sendOther = async (retry: boolean) => {
    if (!to || amount === null || !shown) return;
    setSheetNotice(null);
    setStep("preparing");
    const run = running.start();
    let fresh: Quote;
    try {
      await assertNameStill(to);
      const { state, deadline } = await readSettlement(readClient, SETTLEMENT, me, amount);
      if (run.signal.aborted) return;
      fresh = quote(state, amount, deadline);
      try {
        assertSameQuote(shown, fresh);
      } catch (changed) {
        // The new numbers replace the old ones on the sheet; the person decides again.
        setShown(fresh);
        throw changed;
      }
    } catch (e) {
      if (run.signal.aborted) return;
      setStep(null);
      setSheetNotice({ tone: "bad", ...(e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e)) });
      return;
    }
    setConfirming(false);
    setResult(null);
    try {
      if (!retry) checkDailyLimit(me, amount);
      const write = await sendSequence(me, settlementCalls(SETTLEMENT, fresh, me, to.account), run.track((st: Step) => setStep(st)), retry, run.signal);
      spendSent(me, write, "currency", amount);
      await landSequence(write, to, amount, fresh.needsSetup);
    } catch (e) {
      if (run.signal.aborted) return;
      setStep(null);
      setResult({ tone: "bad", ...describeFailure(e) });
    }
  };

  /** A saved contact's name comes first; the link's name, if different, second. */
  const savedFor = (account: Address) => contacts.find((c) => isAddressEqual(c.account, account));
  const shownTo = (r: Recipient) => ({ account: r.account, name: savedFor(r.account)?.name ?? r.name });
  const fromLink = to && request && linkName && isAddressEqual(to.account, request.account) ? linkName : null;
  const warnings = to ? sendWarnings(to.account, fromLink, contacts, paid.has(to.account)) : null;
  const toRow = to && (
    <div className="list-row">
      <Avatar account={to.account} name={shownTo(to).name} reportable />
      <div className="grow">
        <span className="meta">{copy.confirmTo}</span>
        <span className="name">{shownTo(to).name}</span>
        {warnings?.savedAs && fromLink && <span className="meta">{copy.linkCallsThem(fromLink)}</span>}
        {recipientDetail(shownTo(to)) && <span className="meta">{recipientDetail(shownTo(to))}</span>}
      </div>
    </div>
  );
  const warningLines = to && warnings && (
    <>
      {warnings.clash && (
        <p className="risk-line strong" role="alert">
          {copy.warnNameClash(warnings.clash.name)}
        </p>
      )}
      {warnings.firstTime && <p className="risk-line">{copy.warnFirstTime(copy.accountEnding(to.account))}</p>}
    </>
  );

  const money = (v: bigint) => formatAmount(v, decimals, "auto");
  const other = (v: bigint) => (shown ? formatCurrency(v, shown.outDecimals, shown.outSymbol) : "");
  const symbol = otherSymbol ?? copy.anotherCurrency;

  // X before the passkey stops the check or the send and stays, saying nothing was sent; otherwise it closes.
  const stop = (say: (notice: Notice) => void) => {
    if (running.cancel()) {
      setStep(null);
      say(STOPPED);
    }
  };
  const closeOrStop = () => (beforePasskey(step) ? stop(setResult) : props.onClose());

  return (
    <div className="screen">
      <div className="bar">
        <button type="button" className="icon-btn" aria-label={copy.close} onClick={closeOrStop}>
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
            <h1>{copy.sentTitle(money(done.amount), shownTo(done.to).name)}</h1>
            {done.received && <p className="lede">{copy.theyReceived(done.received)}</p>}
            <p className="lede">{copy.settledIn((done.settledMs / 1000).toFixed(1))}</p>
            {done.setupDone && <p className="hint">{copy.setupDoneNote}</p>}
            <a className="receipt-link" href={receiptUrl(done.hash)} target="_blank" rel="noopener noreferrer">
              {copy.viewReceipt}
            </a>
            <SaveContact already={Boolean(savedFor(done.to.account))} suggested={done.to.name} onSave={(name) => saveContact(done.to.account, name)} />
          </div>
        ) : (
          <>
            {request && linkName && <p className="lede enter">{copy.sendFromRequest(linkName)}</p>}
            {request && linkName && !step && (
              <SaveContact already={Boolean(savedFor(request.account))} suggested={linkName} onSave={(name) => saveContact(request.account, name)} />
            )}
            <div className="card enter" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {!step && !stuck && <VoiceButton account={me} mode="send" onCommand={onVoice} />}
              {voicePick && (
                <div className="list" aria-label={copy.voiceWhichOne}>
                  <p className="hint">{copy.voiceWhichOne}</p>
                  {voicePick.options.map((c) => (
                    <button type="button" className="home-pot" key={`voice-${c.account}`} onClick={() => fillFromVoice(c, voicePick.amount, voicePick.heard)}>
                      <span className="grow">
                        <span className="name">{c.name}</span>
                        <span className="meta">{copy.accountEnding(c.account)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {to ? (
                <div className="list-row">
                  <Avatar account={to.account} name={shownTo(to).name} reportable />
                  <div className="grow">
                    <span className="name">{copy.sendingTo(shownTo(to).name)}</span>
                    {recipientDetail(shownTo(to)) && <span className="meta">{recipientDetail(shownTo(to))}</span>}
                  </div>
                  {!step && !stuck && (
                    <button type="button" className="btn ghost small" onClick={() => setTo(null)}>
                      {copy.changeRecipient}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {contacts.length > 0 && (
                    <div className="list" aria-label={copy.yourContacts}>
                      <p className="eyebrow">{copy.yourContacts}</p>
                      {contacts.map((c) => (
                        <button type="button" className="home-pot" key={`contact-${c.account}`} onClick={() => setTo({ account: c.account, name: c.name })}>
                          <span className="grow">
                            <span className="name">{c.name}</span>
                            <span className="meta">{copy.accountEnding(c.account)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="eyebrow">{copy.sendTo}</p>
                  <p className="hint">{namesOn ? copy.sendToHintNames : copy.sendToHint}</p>
                  <label className="field">
                    <span>{namesOn ? copy.accountIdOrUsername : copy.pasteAccountId}</span>
                    <input value={idText} onChange={(e) => setIdText(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
                  </label>
                  {idText.trim() && !pasted && !typedName && <p className="error">{copy.notAnAccountId}</p>}
                  {typedName && nameProblem && <p className="error">{copy.notAUsername}</p>}
                  {found === "looking" && <p className="hint">{copy.lookingUpUsername}</p>}
                  {foundName && !foundName.account && <NoticeLine notice={{ tone: "bad", text: copy.errNameNotFound(foundName.name), code: ERROR_CODES.NAME_NOT_FOUND }} />}
                  {foundName?.account && pairCheck === "changed" && (
                    <NoticeLine notice={{ tone: "bad", text: copy.errNameChanged(foundName.name), code: ERROR_CODES.NAME_CHANGED }} />
                  )}
                  {foundName?.account && pairCheck === "first" && (
                    <>
                      <p className="hint">{copy.confirmUsernameLast4(foundName.name)}</p>
                      <label className="field">
                        <span>{copy.confirmLast4}</span>
                        <input value={last4} onChange={(e) => setLast4(e.target.value)} maxLength={4} autoComplete="off" autoCapitalize="off" spellCheck={false} />
                      </label>
                      {last4.trim().length === 4 && !nameOk && <p className="error">{copy.last4Mismatch}</p>}
                    </>
                  )}
                  {foundName?.account && nameOk && <p className="success">{copy.usernameLine(foundName.name, copy.accountEnding(foundName.account))}</p>}
                  {pasted && (
                    <label className="field">
                      <span>{copy.confirmLast4}</span>
                      <input value={last4} onChange={(e) => setLast4(e.target.value)} maxLength={4} autoComplete="off" autoCapitalize="off" spellCheck={false} />
                    </label>
                  )}
                  {pasted && last4.trim().length === 4 && !pastedOk && <p className="error">{copy.last4Mismatch}</p>}
                  <button type="button" className="btn" disabled={!pastedOk && !nameOk} onClick={pastedOk ? choosePasted : chooseName}>
                    {copy.useThisAccount}
                  </button>
                </>
              )}
            </div>
            {to && (
              <div className="card enter" style={{ display: "flex", flexDirection: "column", gap: 8, animationDelay: "80ms" }}>
                <label className="field">
                  <span>{copy.howMuch}</span>
                  <input inputMode="decimal" value={amountText} disabled={step !== null || stuck} onChange={(e) => setAmountText(e.target.value)} placeholder={copy.amountPlaceholder} />
                </label>
                <AmountUnderstood text={amountText} decimals={holding?.decimals ?? null} />
                {request && request.amount > 0n && <p className="hint">{copy.requestedAmount(money(request.amount))}</p>}
                {holding && <p className="hint">{copy.yourBalanceIs(formatAmount(holding.balance, decimals, "cents"))}</p>}
                {holding && !online && <p className="hint stale-note">{balanceNote(true, holding.readAt)}</p>}
                {OTHER_CURRENCY && (
                  <div className="currency-choice" role="radiogroup" aria-label={copy.theyReceive}>
                    <span className="meta">{copy.theyReceive}</span>
                    <div className="seg">
                      {(["dollars", "other"] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={currency === c}
                          className={`seg-btn${currency === c ? " on" : ""}`}
                          disabled={step !== null || stuck}
                          onClick={() => setCurrency(c)}
                        >
                          {c === "dollars" ? copy.dollars : symbol}
                        </button>
                      ))}
                    </div>
                    {otherCurrencyNote([otherSymbol]) && <p className="hint">{otherCurrencyNote([otherSymbol])}</p>}
                  </div>
                )}
              </div>
            )}
            {progress && (
              <p className="hint progress-line" aria-live="polite">
                {progress}
              </p>
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
          <button type="button" className="pill-btn" onClick={() => (currency === "other" ? review() : send(true))}>
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
      {confirming && to && amount !== null && currency === "other" && shown && (
        <Sheet title={copy.confirmSendTitle} onClose={() => (beforePasskey(step) ? stop(setSheetNotice) : step === null && setConfirming(false))}>
          {voiceRead(shownTo(to).name, amount)}
          <div className="list">
            {toRow}
            <div className="list-row">
              <div className="grow">
                <span className="meta">{copy.youSend}</span>
                <span className="name">{money(amount)}</span>
              </div>
            </div>
            <div className="list-row">
              <div className="grow">
                <span className="meta">{copy.theyReceive}</span>
                <span className="name">{other(shown.out)}</span>
                <span className="meta">{copy.atLeast(other(shown.minOut))}</span>
              </div>
            </div>
            <div className="list-row">
              <div className="grow">
                <span className="meta">{copy.rate}</span>
                <span className="name">{copy.rateValue(other(shown.rate))}</span>
              </div>
            </div>
            <div className="list-row">
              <div className="grow">
                <span className="meta">{copy.agoraFee}</span>
                <span className="name">{other(shown.feeOut)}</span>
                <span className="meta">{copy.nivpayFeeNone}</span>
              </div>
            </div>
          </div>
          {warningLines}
          <p className="hint">{copy.atLeastHint}</p>
          {shown.needsSetup && <p className="hint">{copy.oneTimeSetup}</p>}
          <p className="hint">{copy.stepsLine(1 + (shown.needsSetup ? 1 : 0) + (shown.needsAllowance ? 1 : 0))}</p>
          {sheetNotice && <NoticeLine notice={sheetNotice} />}
          <button
            type="button"
            className={`pill-btn${step ? " busy" : ""}`}
            disabled={step !== null}
            aria-busy={step !== null}
            onClick={() => sendOther(stuck)}
          >
            {step ? STEP_TEXT[step] : copy.sendAsAction(money(amount), shown.outSymbol)}
          </button>
          <button type="button" className="btn ghost" disabled={step !== null} onClick={() => setConfirming(false)}>
            {copy.back}
          </button>
        </Sheet>
      )}
      {confirming && to && amount !== null && currency === "dollars" && (
        <Sheet title={copy.confirmSendTitle} onClose={() => setConfirming(false)}>
          {voiceRead(shownTo(to).name, amount)}
          <div className="list">
            {toRow}
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
          {warningLines}
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

/**
 * Saves who this is as a contact, on this phone (lib/contacts.ts). Offered on
 * a pay link and after a final payment. A contact is a label, not a check.
 */
function SaveContact(props: { already: boolean; suggested: string; onSave: (name: string) => boolean }) {
  const [open, setOpen] = useState(false);
  // "account ending 7bC1" is what shows when there's no name; it isn't one to save.
  const [name, setName] = useState(/^account ending /i.test(props.suggested) ? "" : props.suggested);
  const [saved, setSaved] = useState<string | null>(null);
  const clean = cleanName(name);
  if (saved) {
    return (
      <p className="success" role="status">
        {copy.contactSaved(saved)}
      </p>
    );
  }
  // Already a contact, and not saved just now: nothing to offer.
  if (props.already) return null;
  if (!open) {
    return (
      <button type="button" className="btn ghost small" onClick={() => setOpen(true)}>
        {copy.saveAsContact}
      </button>
    );
  }
  return (
    <form
      className="name-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean && props.onSave(clean)) setSaved(clean);
      }}
    >
      <label className="field">
        <span>{copy.contactName}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={NAME_MAX * 2} placeholder={copy.theirNamePlaceholder} />
      </label>
      <p className="hint">{copy.contactHint}</p>
      <button type="submit" className="btn primary" disabled={!clean}>
        {copy.saveName}
      </button>
    </form>
  );
}
