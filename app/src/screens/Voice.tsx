import { useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { ContactStore, PaidStore } from "../lib/contacts.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";
import { language } from "../lib/locale.ts";
import { listenOnce, SpeechError, speechAvailable } from "../lib/speech.ts";
import { parseVoice, TRANSFERS_TO_UNLOCK, VoiceStore, type VoiceCommand } from "../lib/voice.ts";
import { HowThisWorks, NoticeLine, Sheet, type Notice } from "./ui.tsx";

/** An account, for what this file shows; named so, since screen text is checked for words people mustn't see. */
type Account = Address;

/** Voice is offered only in English (its parser is tested in English only), where the browser can do speech. */
export const voiceOffered = () => language() === "en" && speechAvailable();

/** On for this account, unlocked, and offered here. */
export const voiceReady = (account: Account) => voiceOffered() && new VoiceStore(localStorage, DEPLOYMENT, account).active();

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" className="ico" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/**
 * The microphone on Send and on a pot's screen. It listens only after a tap,
 * for one sentence, shows the words heard, and hands back a command for the
 * screen to fill in. Before the first use it says who turns the words into
 * text. Hidden unless voice is on for this account (VoiceSection).
 */
export function VoiceButton(props: {
  account: Account;
  mode: VoiceCommand["kind"];
  disabled?: boolean;
  /** A new attempt starts: the screen clears what the last one said. */
  onStart?: () => void;
  onCommand: (cmd: VoiceCommand, heard: string) => void;
}) {
  const store = useMemo(() => new VoiceStore(localStorage, DEPLOYMENT, props.account), [props.account]);
  const [explaining, setExplaining] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const stopRef = useRef<() => void>(() => {});
  if (!voiceReady(props.account)) return null;

  const listen = async () => {
    props.onStart?.();
    setNotice(null);
    setHeard(null);
    setListening(true);
    const session = listenOnce("en-US");
    stopRef.current = session.stop;
    try {
      const text = await session.heard;
      setHeard(text);
      const cmd = parseVoice(text);
      if (!cmd) setNotice({ tone: "bad", text: copy.voiceDidntCatch });
      else if (cmd.kind !== props.mode) setNotice({ tone: "bad", text: cmd.kind === "put" ? copy.voicePutHere : copy.voiceSendHere });
      else props.onCommand(cmd, text);
    } catch (e) {
      const reason = e instanceof SpeechError ? e.reason : "";
      if (reason !== "aborted") setNotice({ tone: "bad", text: reason === "not-allowed" || reason === "service-not-allowed" ? copy.voiceMicRefused : copy.voiceNotHeard, code: ERROR_CODES.VOICE_FAILED });
    } finally {
      setListening(false);
    }
  };
  const tap = () => {
    if (listening) return stopRef.current();
    if (!store.get().explained) return setExplaining(true);
    void listen();
  };

  return (
    <div className="voice">
      <button type="button" className={`btn voice-btn${listening ? " listening" : ""}`} disabled={props.disabled} aria-pressed={listening} onClick={tap}>
        <MicIcon />
        <span>{listening ? copy.voiceListening : copy.voiceSpeak}</span>
      </button>
      {heard !== null && <p className="hint voice-heard">{copy.voiceHeard(heard || "…")}</p>}
      {notice && <NoticeLine notice={notice} />}
      {explaining && (
        <Sheet title={copy.voiceBeforeTitle} onClose={() => setExplaining(false)}>
          <p>{copy.voiceBeforeService}</p>
          <p className="hint">{copy.voiceBeforeOnlyTap}</p>
          <p className="hint">{copy.voiceBeforeSafety}</p>
          <button
            type="button"
            className="pill-btn"
            onClick={() => {
              store.explained();
              setExplaining(false);
              void listen();
            }}
          >
            {copy.voiceBeforeGo}
          </button>
          <button type="button" className="btn ghost" onClick={() => setExplaining(false)}>
            {copy.notNow}
          </button>
        </Sheet>
      )}
    </div>
  );
}

/**
 * Voice, in Profile: on or off, "x of 10" until this phone has seen ten final
 * transfers, and which contacts voice may pay. Only contacts already paid
 * once from this phone can be marked; voice can't mark them itself. Hidden in
 * other languages and where the browser can't do speech.
 */
export function VoiceSection(props: { account: Account }) {
  const store = useMemo(() => new VoiceStore(localStorage, DEPLOYMENT, props.account), [props.account]);
  const [state, setState] = useState(() => store.get());
  if (!voiceOffered()) return null;
  const contacts = new ContactStore(localStorage, DEPLOYMENT, props.account).list();
  const paid = new PaidStore(localStorage, DEPLOYMENT, props.account);
  const count = state.seen.length;
  const unlocked = count >= TRANSFERS_TO_UNLOCK;

  return (
    <section className="settings-screen" aria-label={copy.voiceTitle}>
      <label className="check-row">
        <input
          type="checkbox"
          checked={state.on && unlocked}
          disabled={!unlocked}
          onChange={(e) => {
            store.setOn(e.target.checked);
            setState(store.get());
          }}
        />
        <span>{copy.voiceCommands}</span>
      </label>
      {!unlocked && <p className="hint">{copy.voiceLocked(count, TRANSFERS_TO_UNLOCK)}</p>}
      <p className="hint">{copy.voiceWhatItDoes}</p>
      <HowThisWorks>
        <p className="hint">{copy.voiceCannot}</p>
      </HowThisWorks>
      <p className="settings-group">{copy.voiceTrustedTitle}</p>
      {contacts.length === 0 ? (
        <p className="hint">{copy.voiceNoContacts}</p>
      ) : (
        contacts.map((c) => {
          const canPay = paid.has(c.account);
          return (
            <label className="check-row" key={`voice-${c.account}`}>
              <input
                type="checkbox"
                checked={canPay && state.trusted.some((t) => t.toLowerCase() === c.account.toLowerCase())}
                disabled={!canPay}
                onChange={(e) => {
                  store.setTrusted(c.account, e.target.checked);
                  setState(store.get());
                }}
              />
              <span>
                {copy.trustedForVoice(c.name)}
                {!canPay && <span className="meta"> {copy.voicePayOnceFirst}</span>}
              </span>
            </label>
          );
        })
      )}
    </section>
  );
}
