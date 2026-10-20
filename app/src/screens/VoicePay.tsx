import { useEffect, useMemo, useRef, useState } from "react";
import { copy, ERROR_CODES } from "../copy.ts";
import type { StoredAccount } from "../lib/accounts.ts";
import { ERC20_READ_ABI } from "../lib/abi.ts";
import { liveWriteChain } from "../lib/chain.ts";
import { ContactStore, PaidStore, type Contact } from "../lib/contacts.ts";
import { DEPLOYMENT, DOLLAR } from "../lib/deployment.ts";
import { AppError, describeFailure } from "../lib/errors.ts";
import { idbWriteStore } from "../lib/idb.ts";
import { formatAmount } from "../lib/money.ts";
import { rememberReceipt } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { sendWrite, type Step } from "../lib/send.ts";
import { labelFor, noteSent } from "../lib/sent.ts";
import { checkDailyLimit, spendEnded, spendSent } from "../lib/spending.ts";
import { listenOnce, say, SpeechError, stopSaying } from "../lib/speech.ts";
import { checkSend, transferData, transferRefused } from "../lib/transfer.ts";
import { parseVoice, VoiceStore, VOICE_DECIMALS } from "../lib/voice.ts";
import { micPermission, voiceBusy } from "../lib/voiceAsk.ts";
import { heardYesNo, planVoiceSend } from "../lib/voicePay.ts";
import { followToFinality } from "../lib/writes.ts";
import { NoticeLine, Sheet, type Notice } from "./ui.tsx";

const LANG = "en-US";
const STEP_TEXT: Record<Step | "landing", string> = {
  preparing: copy.stepPreparing,
  "getting-ready": copy.stepGettingReady,
  confirm: copy.stepConfirm,
  sending: copy.stepSendingPayment,
  landing: copy.stepSettling,
};

type Phase =
  | { kind: "explain" }
  | { kind: "tap" }
  | { kind: "listening" }
  | { kind: "checking"; heard: string }
  | { kind: "pick"; heard: string; options: Contact[]; amount: bigint }
  | { kind: "asking"; heard: string; to: Contact; amount: bigint; hearing: boolean }
  | { kind: "signing"; to: Contact; amount: bigint; step: Step | "landing" }
  | { kind: "needs-tap"; to: Contact; amount: bigint }
  | { kind: "done"; to: Contact; amount: bigint; settledMs: number }
  | { kind: "ended"; notice: Notice; heard?: string };

const money = (v: bigint) => formatAmount(v, VOICE_DECIMALS, "auto");

/**
 * "Hey NivPay", hands free (README, "Hey NivPay"): over whatever screen is
 * open, it hears one sentence, reads the payment back aloud, listens for a
 * yes, and asks for the fingerprint, with no screen to fill in. The rules are
 * Send's and voice's own: a trusted contact only, at most $200, the daily
 * limit, every check Send makes before its confirm sheet, and the same write
 * (sendWrite), so a payment cut off by a reload is picked up on Send. Yes
 * and No are buttons too. Where the phone wants a tap before the fingerprint
 * (Safari on iPhone), it shows one big button for it. The wake word stays
 * paused (voiceBusy) while it listens, checks, asks or signs.
 */
export function VoicePay(props: { account: StoredAccount; onClose: () => void }) {
  const me = props.account.address;
  const store = useMemo(() => new VoiceStore(localStorage, DEPLOYMENT, me), [me]);
  const paid = useMemo(() => new PaidStore(localStorage, DEPLOYMENT, me), [me]);
  const [phase, setPhaseState] = useState<Phase>({ kind: "listening" });
  const alive = useRef(true);
  const stopListening = useRef<() => void>(() => {});
  // Bumped by every tap or new step, so an answer still being listened for is ignored once something else decided.
  const turn = useRef(0);
  const setPhase = (p: Phase) => {
    if (alive.current) setPhaseState(p);
  };

  /** Says it and shows it: the end of this attempt. */
  const end = (notice: Notice, heard?: string) => {
    setPhase({ kind: "ended", notice, heard });
    void say(notice.text, LANG);
  };

  const hear = async (): Promise<string | null> => {
    try {
      const session = listenOnce(LANG);
      stopListening.current = session.stop;
      return await session.heard;
    } catch (e) {
      if (e instanceof SpeechError && (e.reason === "not-allowed" || e.reason === "service-not-allowed")) throw e;
      return null;
    } finally {
      stopListening.current = () => {};
    }
  };

  /** One sentence, then who and how much, then every check Send makes before its confirm sheet. */
  const listen = async () => {
    const mine = ++turn.current;
    setPhase({ kind: "listening" });
    let heard: string | null;
    try {
      heard = await hear();
    } catch {
      return end({ tone: "bad", text: copy.voiceMicRefused, code: ERROR_CODES.VOICE_FAILED });
    }
    if (mine !== turn.current) return;
    if (!heard) return end({ tone: "bad", text: copy.voiceNotHeard, code: ERROR_CODES.VOICE_FAILED });
    const cmd = parseVoice(heard);
    if (!cmd) return end({ tone: "bad", text: copy.voiceDidntCatch }, heard);
    const contacts = new ContactStore(localStorage, DEPLOYMENT, me).list();
    const plan = planVoiceSend(cmd, contacts, store.get(), paid.all());
    switch (plan.kind) {
      case "not-send":
        return end({ tone: "bad", text: copy.voicePutHere }, heard);
      case "over-cap":
        return end({ tone: "bad", text: copy.errVoiceCap, code: ERROR_CODES.VOICE_OVER_CAP }, heard);
      case "no-contact":
        return end({ tone: "bad", text: copy.voiceNoSuchContact(plan.name) }, heard);
      case "pick":
        setPhase({ kind: "pick", heard, options: plan.options, amount: plan.amount });
        return void say(copy.voiceWhichOne, LANG);
      case "pay":
        return check(heard, plan.to, plan.amount);
    }
  };

  const check = async (heard: string, to: Contact, amount: bigint) => {
    const mine = ++turn.current;
    setPhase({ kind: "checking", heard });
    try {
      const block = await readClient.getBlock({ blockTag: "finalized" });
      const [decimals, balance, code] = await Promise.all([
        readClient.readContract({ address: DOLLAR, abi: ERC20_READ_ABI, functionName: "decimals", blockNumber: block.number }),
        readClient.readContract({ address: DOLLAR, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [me], blockNumber: block.number }),
        readClient.getCode({ address: to.account }),
      ]);
      const problem = checkSend({ me, to: to.account, amount, balance, decimals, recipientHasCode: (code?.length ?? 0) > 2 });
      if (problem) throw problem;
      checkDailyLimit(me, amount);
      if (await transferRefused(readClient, DOLLAR, me, to.account, amount)) throw new AppError(copy.errSendRefused, ERROR_CODES.SEND_REFUSED);
    } catch (e) {
      if (mine === turn.current) end(e instanceof AppError ? { tone: "bad", text: e.message, code: e.code } : { tone: "bad", ...describeFailure(e) }, heard);
      return;
    }
    if (mine === turn.current) void ask(heard, to, amount);
  };

  /** Reads it back aloud and listens for a yes, twice at most. Anything but a clear yes sends nothing. */
  const ask = async (heard: string, to: Contact, amount: bigint) => {
    const mine = ++turn.current;
    setPhase({ kind: "asking", heard, to, amount, hearing: false });
    await say(copy.voicePayAskAloud(money(amount), to.name), LANG);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (mine !== turn.current) return;
      setPhase({ kind: "asking", heard, to, amount, hearing: true });
      let answer: string | null = null;
      try {
        answer = await hear();
      } catch {
        // The microphone went: the Yes and No buttons still work.
      }
      if (mine !== turn.current) return;
      const said = answer ? heardYesNo(answer) : null;
      if (said === "yes") return pay(to, amount);
      if (said === "no") return end({ tone: "bad", text: copy.voicePayCancelled });
      if (attempt === 0) {
        setPhase({ kind: "asking", heard, to, amount, hearing: false });
        await say(copy.voicePayYesOrNo, LANG);
      }
    }
    if (mine === turn.current) end({ tone: "bad", text: copy.voicePayCancelled });
  };

  /** Send's own write: the daily limit again right before signing, then the fingerprint, then Finalized. */
  const pay = async (to: Contact, amount: bigint) => {
    const mine = ++turn.current;
    stopListening.current();
    stopSaying();
    setPhase({ kind: "signing", to, amount, step: "preparing" });
    let write;
    try {
      checkDailyLimit(me, amount);
      write = await sendWrite({
        from: me,
        to: DOLLAR,
        data: transferData(to.account, amount),
        label: labelFor(to.account, amount),
        onStep: (step: Step) => mine === turn.current && setPhase({ kind: "signing", to, amount, step }),
      });
      spendSent(me, write, "send", amount);
    } catch (e) {
      const failure = e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e);
      // Nothing was sent: often the phone wanted a tap before the fingerprint, so offer one.
      if (failure.code === ERROR_CODES.PASSKEY_CANCELLED) return setPhase({ kind: "needs-tap", to, amount });
      return end({ tone: "bad", ...failure });
    }
    setPhase({ kind: "signing", to, amount, step: "landing" });
    try {
      const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
      spendEnded(me, write, outcome.kind);
      if (outcome.kind === "final") {
        rememberReceipt(write.address, write.hash);
        noteSent(me, write.hash, to, amount);
        paid.add(to.account);
        setPhase({ kind: "done", to, amount, settledMs: outcome.settledMs });
        void say(copy.voicePaySentAloud(money(amount), to.name), LANG);
      } else if (outcome.kind === "stuck") {
        end({ tone: "bad", text: copy.voicePayStuck, code: ERROR_CODES.STUCK });
      } else {
        end({ tone: "bad", text: copy.sendDidNotGoThrough, code: outcome.kind === "reverted" ? ERROR_CODES.REVERTED : ERROR_CODES.SUPERSEDED });
      }
    } catch (e) {
      end({ tone: "bad", ...describeFailure(e) });
    }
  };

  /** Starts listening, unless the phone first needs voice explained or a tap for the microphone. */
  const begin = async () => {
    if (!store.get().explained) return setPhase({ kind: "explain" });
    if ((await micPermission()) !== "granted") return setPhase({ kind: "tap" });
    void listen();
  };

  // The wake word stays paused while this listens, checks, asks or signs; once it is done, dropped, or waiting
  // for a tap, "Hey NivPay" listens again, and a new wake opens a new sheet in place of this one.
  const busy = phase.kind === "listening" || phase.kind === "checking" || phase.kind === "asking" || phase.kind === "signing";
  useEffect(() => voiceBusy(busy), [busy]);

  useEffect(() => {
    alive.current = true;
    void begin();
    return () => {
      alive.current = false;
      turn.current++;
      stopListening.current();
      stopSaying();
      voiceBusy(false);
    };
    // Once, when "Hey NivPay" opened it.
  }, []);

  // While the fingerprint is asked for or the payment lands, closing would hide it, not stop it.
  const close = () => {
    if (phase.kind === "signing" && phase.step !== "preparing") return;
    turn.current++;
    props.onClose();
  };
  const heardLine = (heard?: string) => (heard ? <p className="hint voice-heard">{copy.voiceHeard(heard)}</p> : null);

  return (
    <Sheet title={copy.voicePayTitle} onClose={close}>
      {phase.kind === "explain" && (
        <>
          <p>{copy.voiceBeforeService}</p>
          <p className="hint">{copy.voiceBeforeSafety}</p>
          <button
            type="button"
            className="pill-btn"
            onClick={() => {
              store.explained();
              void listen();
            }}
          >
            {copy.voiceBeforeGo}
          </button>
        </>
      )}
      {phase.kind === "tap" && (
        <button type="button" className="pill-btn voice-big" onClick={() => void listen()}>
          {copy.voiceTapToSpeak}
        </button>
      )}
      {phase.kind === "listening" && (
        <button type="button" className="btn voice-btn listening" aria-pressed="true" onClick={() => stopListening.current()}>
          <span>{copy.voicePaySay}</span>
        </button>
      )}
      {phase.kind === "checking" && (
        <>
          {heardLine(phase.heard)}
          <p className="hint">{copy.voicePayChecking}</p>
        </>
      )}
      {phase.kind === "pick" && (
        <div className="list" aria-label={copy.voiceWhichOne}>
          {heardLine(phase.heard)}
          <p className="hint">{copy.voiceWhichOne}</p>
          {phase.options.map((c) => (
            <button type="button" className="home-pot" key={`voice-pay-${c.account}`} onClick={() => void check(phase.heard, c, phase.amount)}>
              <span className="pot-name">{c.name}</span>
            </button>
          ))}
        </div>
      )}
      {phase.kind === "asking" && (
        <>
          {heardLine(phase.heard)}
          <p className="lede">{copy.voicePayAsk(money(phase.amount), phase.to.name)}</p>
          {phase.hearing && <p className="hint">{copy.voicePayYesOrNo}</p>}
          <button type="button" className="pill-btn" onClick={() => void pay(phase.to, phase.amount)}>
            {copy.voicePayYes}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              turn.current++;
              stopListening.current();
              end({ tone: "bad", text: copy.voicePayCancelled });
            }}
          >
            {copy.voicePayNo}
          </button>
        </>
      )}
      {phase.kind === "signing" && (
        <>
          <p className="lede">{copy.voicePayAsk(money(phase.amount), phase.to.name)}</p>
          <p className="hint" role="status">
            {STEP_TEXT[phase.step]}
          </p>
        </>
      )}
      {phase.kind === "needs-tap" && (
        <>
          <p className="lede">{copy.voicePayAsk(money(phase.amount), phase.to.name)}</p>
          <p className="hint">{copy.voicePayNeedsTap}</p>
          <button type="button" className="pill-btn voice-big" onClick={() => void pay(phase.to, phase.amount)}>
            {copy.stepConfirm}
          </button>
          <button type="button" className="btn ghost" onClick={close}>
            {copy.voicePayNo}
          </button>
        </>
      )}
      {phase.kind === "done" && (
        <>
          <p className="lede">{copy.voicePaySent(money(phase.amount), phase.to.name)}</p>
          <p className="hint">{copy.settledIn((phase.settledMs / 1000).toFixed(1))}</p>
          <button type="button" className="pill-btn" onClick={close}>
            {copy.done}
          </button>
        </>
      )}
      {phase.kind === "ended" && (
        <>
          {heardLine(phase.heard)}
          <NoticeLine notice={phase.notice} />
          <button type="button" className="pill-btn" onClick={() => void listen()}>
            {copy.tryAgain}
          </button>
          <button type="button" className="btn ghost" onClick={close}>
            {copy.close}
          </button>
        </>
      )}
    </Sheet>
  );
}
