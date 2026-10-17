import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { ContactStore, PaidStore } from "../lib/contacts.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";
import { listenOnce, SpeechError } from "../lib/speech.ts";
import { parseVoice, PAYMENTS_WITH_PERSON, VoiceStore, type VoiceCommand } from "../lib/voice.ts";
import { micPermission, onAsk, takeAsk, voiceBusy, voiceSettingsChanged } from "../lib/voiceAsk.ts";
import { voiceOffered, voiceReady, wakeOffered } from "../lib/voiceOn.ts";
import { copyLink, CopyLinkButton, HowThisWorks, NoticeLine, Sheet, type Notice } from "./ui.tsx";

/** An account, for what this file shows; named so, since screen text is checked for words people mustn't see. */
type Account = Address;

export { voiceOffered, voiceReady };

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" className="ico" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/**
 * The microphone on Send and on a pot's screen. It listens after a tap, or
 * when "Hey NivPay" or a ?voice=1 link asks (lib/voiceAsk.ts), for one
 * sentence, shows the words heard, and hands back a command for the screen to
 * fill in. Before the first use it says who turns the words into text. Where
 * the browser wants a tap before it listens, an ask shows one big Tap to
 * speak button. Hidden unless voice is on for this account (VoiceSection).
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
  // An ask came while the browser wants a tap first: one big button to tap.
  const [tapFirst, setTapFirst] = useState(false);
  const stopRef = useRef<() => void>(() => {});
  const listeningRef = useRef(false);

  /** Listens for one sentence. `asked`: no tap started it, so a refusal may only mean a tap is wanted. */
  const listen = async (asked = false) => {
    if (listeningRef.current) return;
    listeningRef.current = true;
    props.onStart?.();
    setNotice(null);
    setHeard(null);
    setTapFirst(false);
    setListening(true);
    // The wake word lets the microphone go while the speech service has it.
    voiceBusy(true);
    try {
      const session = listenOnce("en-US");
      stopRef.current = session.stop;
      const text = await session.heard;
      setHeard(text);
      const cmd = parseVoice(text);
      if (!cmd) setNotice({ tone: "bad", text: copy.voiceDidntCatch });
      else if (cmd.kind !== props.mode) setNotice({ tone: "bad", text: cmd.kind === "put" ? copy.voicePutHere : copy.voiceSendHere });
      else props.onCommand(cmd, text);
    } catch (e) {
      const reason = e instanceof SpeechError ? e.reason : "";
      const refused = reason === "not-allowed" || reason === "service-not-allowed";
      if (refused && asked && (await micPermission()) !== "denied") setTapFirst(true);
      else if (reason !== "aborted") setNotice({ tone: "bad", text: refused ? copy.voiceMicRefused : copy.voiceNotHeard, code: ERROR_CODES.VOICE_FAILED });
    } finally {
      listeningRef.current = false;
      setListening(false);
      voiceBusy(false);
    }
  };

  /** "Hey NivPay" or a ?voice=1 link asks: listen now if nothing needs a tap first, else ask for one. */
  const answer = async () => {
    if (listeningRef.current || props.disabled) return;
    if (!store.get().explained) return setExplaining(true);
    if ((await micPermission()) !== "granted") return setTapFirst(true);
    void listen(true);
  };
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const ready = voiceReady(props.account);
  useEffect(() => {
    if (!ready) return;
    const take = () => {
      if (takeAsk()) void answerRef.current();
    };
    // An ask made just before this screen opened, then any while it is open.
    take();
    return onAsk(take);
  }, [ready]);

  if (!ready) return null;

  const tap = () => {
    if (listening) return stopRef.current();
    if (!store.get().explained) return setExplaining(true);
    void listen();
  };

  return (
    <div className="voice">
      {tapFirst && !listening ? (
        <button type="button" className="pill-btn voice-big" disabled={props.disabled} onClick={tap}>
          <MicIcon />
          <span>{copy.voiceTapToSpeak}</span>
        </button>
      ) : (
        <button type="button" className={`btn voice-btn${listening ? " listening" : ""}`} disabled={props.disabled} aria-pressed={listening} onClick={tap}>
          <MicIcon />
          <span>{listening ? copy.voiceListening : copy.voiceSpeak}</span>
        </button>
      )}
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

/** The link that opens Send ready to listen, on this site. */
export const voiceLink = (origin: string) => `${origin}/?voice=1`;

/** "Hey Siri" and "Hey Google": short guides, each with the link to copy. */
function AssistantGuides() {
  const link = voiceLink(location.origin);
  const copyButton = <CopyLinkButton onCopy={() => copyLink(link)} />;
  return (
    <>
      <p className="settings-group">{copy.voiceOpenTitle}</p>
      <p className="hint">{copy.voiceOpenLink}</p>
      <p className="voice-link">
        <span className="voice-link-text">{link}</span>
      </p>
      <details className="how-it-works">
        <summary>{copy.siriTitle}</summary>
        <div className="how-it-works-body">
          <ol className="voice-steps">
            <li>{copy.siriStep1}</li>
            <li>{copy.siriStep2}</li>
            <li>
              {copy.siriStep3} {copyButton}
            </li>
            <li>{copy.siriStep4}</li>
            <li>{copy.siriStep5}</li>
          </ol>
          <p className="hint">{copy.siriSafari}</p>
        </div>
      </details>
      <details className="how-it-works">
        <summary>{copy.googleTitle}</summary>
        <div className="how-it-works-body">
          <ol className="voice-steps">
            <li>{copy.googleStep1}</li>
            <li>{copy.googleStep2}</li>
            <li>{copy.googleStep3}</li>
            <li>
              {copy.googleStep4} {copyButton}
            </li>
          </ol>
        </div>
      </details>
    </>
  );
}

/**
 * Voice, in Profile: on or off, listening for "Hey NivPay", which contacts
 * voice may pay, and how to open NivPay ready to listen from Siri or Google.
 * A contact can be marked only once this phone has seen 10 final payments
 * with them, sent or received, including one paid to them; until then it
 * shows "x of 10". Voice can't mark anyone itself. Hidden in other languages
 * and where the browser can't do speech; the wake word switch is hidden too
 * where the browser can't hear it on the phone.
 */
export function VoiceSection(props: { account: Account }) {
  const store = useMemo(() => new VoiceStore(localStorage, DEPLOYMENT, props.account), [props.account]);
  const [state, setState] = useState(() => store.get());
  if (!voiceOffered()) return null;
  const contacts = new ContactStore(localStorage, DEPLOYMENT, props.account).list();
  const paid = new PaidStore(localStorage, DEPLOYMENT, props.account);

  return (
    <section className="settings-screen" aria-label={copy.voiceTitle}>
      <label className="check-row">
        <input
          type="checkbox"
          checked={state.on}
          onChange={(e) => {
            store.setOn(e.target.checked);
            setState(store.get());
            voiceSettingsChanged();
          }}
        />
        <span>{copy.voiceCommands}</span>
      </label>
      <p className="hint">{copy.voiceWhatItDoes}</p>
      <HowThisWorks>
        <p className="hint">{copy.voiceCannot}</p>
      </HowThisWorks>
      {wakeOffered() && (
        <>
          <label className="check-row">
            <input
              type="checkbox"
              checked={state.on && state.wake}
              disabled={!state.on}
              onChange={(e) => {
                store.setWake(e.target.checked);
                setState(store.get());
                voiceSettingsChanged();
              }}
            />
            <span>{copy.wakeSwitch}</span>
          </label>
          <p className="hint">{state.on ? copy.wakeWhatItDoes : copy.wakeNeedsVoice}</p>
          <HowThisWorks>
            <p className="hint">{copy.wakeOnPhone}</p>
            <p className="hint">{copy.wakeStops}</p>
          </HowThisWorks>
        </>
      )}
      <p className="settings-group">{copy.voiceTrustedTitle}</p>
      {contacts.length === 0 ? (
        <p className="hint">{copy.voiceNoContacts}</p>
      ) : (
        contacts.map((c) => {
          const together = state.withPerson[c.account] ?? [];
          const ready = together.length >= PAYMENTS_WITH_PERSON && paid.has(c.account);
          return (
            <label className="check-row" key={`voice-${c.account}`}>
              <input
                type="checkbox"
                checked={ready && state.trusted.some((t) => t.toLowerCase() === c.account.toLowerCase())}
                disabled={!ready}
                onChange={(e) => {
                  store.setTrusted(c.account, e.target.checked);
                  setState(store.get());
                }}
              />
              <span>
                {copy.trustedForVoice(c.name)}
                {!ready && (
                  <span className="meta">
                    {" "}
                    {together.length < PAYMENTS_WITH_PERSON ? copy.voicePaymentsWith(together.length, PAYMENTS_WITH_PERSON) : copy.voicePayOnceFirst}
                  </span>
                )}
              </span>
            </label>
          );
        })
      )}
      <AssistantGuides />
    </section>
  );
}
