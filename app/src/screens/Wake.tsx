import { useEffect, useRef, useState } from "react";
import { copy } from "../copy.ts";
import { onVoiceBusy } from "../lib/voiceAsk.ts";
import { loadModel, startMic } from "../lib/wake/mic.ts";
import { WakeSession, type WakeState, type WakeStop } from "../lib/wake/session.ts";

/**
 * Listening for "Hey NivPay" while the app is open (README, "Hey NivPay"),
 * and the bar that says so whenever the microphone is on. Shown over every
 * screen while the switch in Profile, Voice is on. It stops when the app goes
 * to the background or the screen locks, after 5 minutes with no tap, and
 * says which; Listen again starts it again.
 *
 * On a wake: a chime, the microphone let go, then `onHeard` (App opens Send
 * if no microphone button is on screen, and asks it to listen). If nothing
 * takes the ask soon, listening comes back by itself.
 */
export function WakeHost(props: { onHeard: () => void }) {
  const [state, setState] = useState<WakeState>({ kind: "off" });
  const [hidden, setHidden] = useState(false);
  const sessionRef = useRef<WakeSession | null>(null);
  const heardRef = useRef(props.onHeard);
  heardRef.current = props.onHeard;

  useEffect(() => {
    let taken = false;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const session = new WakeSession({
      loadModel,
      startMic,
      onState: (s) => {
        setHidden(false);
        setState(s);
      },
      onWake: () => {
        taken = false;
        heardRef.current();
        // No microphone button took the ask (a send in progress, say): listen for the wake word again.
        clearTimeout(fallback);
        fallback = setTimeout(() => {
          if (!taken) session.resume();
        }, 4_000);
      },
    });
    sessionRef.current = session;
    void session.start();

    const away = () => {
      if (document.visibilityState === "hidden") session.stop("background");
    };
    const gone = () => session.stop("background");
    const used = () => session.used();
    document.addEventListener("visibilitychange", away);
    window.addEventListener("pagehide", gone);
    document.addEventListener("freeze", gone);
    window.addEventListener("pointerdown", used, { capture: true, passive: true });
    window.addEventListener("keydown", used, { capture: true, passive: true });
    const offBusy = onVoiceBusy((busy) => {
      if (busy) {
        taken = true;
        session.pause();
      } else {
        session.resume();
      }
    });
    return () => {
      clearTimeout(fallback);
      offBusy();
      document.removeEventListener("visibilitychange", away);
      window.removeEventListener("pagehide", gone);
      document.removeEventListener("freeze", gone);
      window.removeEventListener("pointerdown", used, { capture: true });
      window.removeEventListener("keydown", used, { capture: true });
      session.off();
      sessionRef.current = null;
    };
  }, []);

  const start = () => void sessionRef.current?.start();
  if (state.kind === "off" || hidden) return null;

  return (
    <div className={`wake-bar ${state.kind}`} role="status" aria-live="polite">
      {state.kind === "listening" && (
        <>
          <span className="wake-dot" aria-hidden="true" />
          <span className="wake-text">{copy.wakeListening}</span>
          <button type="button" className="wake-action" onClick={() => sessionRef.current?.stop("user")}>
            {copy.wakeStop}
          </button>
        </>
      )}
      {state.kind === "starting" && <span className="wake-text">{copy.wakeStarting}</span>}
      {state.kind === "paused" && (
        <>
          <span className="wake-dot" aria-hidden="true" />
          <span className="wake-text">{copy.wakeHeard}</span>
        </>
      )}
      {state.kind === "needs-tap" && (
        <>
          <span className="wake-text">{copy.wakeNeedsTap}</span>
          <button type="button" className="wake-action" onClick={start}>
            {copy.wakeStart}
          </button>
        </>
      )}
      {state.kind === "stopped" && (
        <>
          <span className="wake-text">{stoppedText(state.why)}</span>
          {state.why !== "unavailable" && state.why !== "mic-refused" && (
            <button type="button" className="wake-action" onClick={start}>
              {copy.wakeListenAgain}
            </button>
          )}
          <button type="button" className="wake-close" aria-label={copy.close} onClick={() => setHidden(true)}>
            ×
          </button>
        </>
      )}
    </div>
  );
}

function stoppedText(why: WakeStop): string {
  switch (why) {
    case "background":
      return copy.wakeStoppedBackground;
    case "idle":
      return copy.wakeStoppedIdle;
    case "mic-refused":
      return copy.voiceMicRefused;
    case "mic-lost":
      return copy.wakeStoppedMicLost;
    case "unavailable":
      return copy.wakeUnavailable;
    case "user":
      return copy.wakeStoppedByYou;
  }
}
