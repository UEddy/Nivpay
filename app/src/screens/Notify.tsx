import { useEffect, useState } from "react";
import type { Address } from "viem";
import { copy } from "../copy.ts";
import { describeFailure } from "../lib/errors.ts";
import { MutedStore } from "../lib/inbox.ts";
import { inboxEnabled, requestsOnHere, turnOffRequests, turnOnRequests } from "../lib/inboxLive.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";
import { reloadOnce } from "../lib/reloadOnce.ts";
import { InstallHow, NoticeLine, useInstallWay, type Notice } from "./ui.tsx";
import { PUSH_KINDS, type PushKind, type PushSettings } from "../lib/push.ts";
import { pushInfo, pushOnHere, pushSettings, pushSupported, savePushSettings, syncPush, turnOffPush, turnOnPush } from "../lib/pushLive.ts";

// The signing code loads only when something here is turned on or off.
const passkeys = () => reloadOnce(() => import("../lib/passkey.ts"));

/** An account, for what this file shows; named so, since screen text is checked for words people mustn't see. */
type Account = Address;

/**
 * Notifications, in Profile: on this phone (Web Push, lib/push.ts), with a
 * switch for each kind and for amounts on the lock screen; requests from
 * people (lib/inbox.ts); and the accounts muted. Each part is hidden while it
 * isn't set up on this site. The phone is asked about notifications only
 * after Turn on is tapped.
 */
export function NotificationsSection(props: { account: Account; names: (who: Account) => string; onMuted: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [here, setHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const muted = new MutedStore(localStorage, DEPLOYMENT, props.account);
  const [list, setList] = useState<Account[]>(() => muted.list());
  useEffect(() => {
    let live = true;
    void inboxEnabled(props.account).then((on) => live && setEnabled(on));
    void pushInfo().then((info) => live && setPushEnabled(info.enabled));
    void requestsOnHere(props.account).then((on) => live && setHere(on));
    return () => {
      live = false;
    };
  }, [props.account]);
  if (!enabled && !pushEnabled) return null;

  const sign = async (message: string) => (await passkeys()).withSigner(props.account, (a) => a.signMessage({ message }));
  const toggle = async () => {
    setBusy(true);
    setNotice(null);
    try {
      if (here) await turnOffRequests(props.account, sign);
      else await turnOnRequests(props.account, sign);
      setHere(!here);
      setNotice({ tone: "ok", text: here ? copy.requestsTurnedOff : copy.requestsTurnedOn });
    } catch (e) {
      setNotice({ tone: "bad", ...describeFailure(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="notifications-title">
      <p className="eyebrow" id="notifications-title">
        {copy.notifications}
      </p>
      {pushEnabled && <PushPart account={props.account} />}
      {enabled && (
        <>
      <p className="name">{copy.requestsFromPeople}</p>
      <p className="hint">{here ? copy.requestsOnHint : copy.requestsOffHint}</p>
      <button type="button" className={`btn${here ? "" : " primary"}`} disabled={busy} aria-busy={busy} onClick={() => void toggle()}>
        {busy ? copy.waitingForPasskey : here ? copy.turnOff : copy.turnOn}
      </button>
      {notice && <NoticeLine notice={notice} />}
        </>
      )}
      <p className="name">{copy.mutedAccounts}</p>
      {list.length === 0 ? (
        <p className="hint">{copy.noneMuted}</p>
      ) : (
        <div className="list">
          {list.map((who) => (
            <div className="list-row" key={`muted-${who}`}>
              <div className="grow">
                <span className="name">{props.names(who)}</span>
              </div>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => {
                  muted.unmute(who);
                  setList(muted.list());
                  void syncPush(props.account);
                  props.onMuted();
                }}
              >
                {copy.unmute}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const KIND_TEXT: Record<PushKind, string> = {
  received: copy.pushKindReceived,
  sent: copy.pushKindSent,
  chippedIn: copy.pushKindChippedIn,
  askYes: copy.pushKindAskYes,
  request: copy.pushKindRequest,
  potNamesYou: copy.pushKindPotNamesYou,
};

/** On this phone: Turn on or off, what to be told about, and amounts on the lock screen. */
function PushPart(props: { account: Account }) {
  const [on, setOn] = useState(() => pushOnHere(props.account));
  const [settings, setSettings] = useState<PushSettings>(() => pushSettings(props.account));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [how, setHow] = useState(false);
  const way = useInstallWay();
  const supported = pushSupported();

  const toggle = async () => {
    setBusy(true);
    setNotice(null);
    try {
      if (on) await turnOffPush(props.account);
      else await turnOnPush(props.account, async (message) => (await passkeys()).withSigner(props.account, (a) => a.signMessage({ message })));
      setOn(!on);
      setNotice({ tone: "ok", text: on ? copy.pushTurnedOff : copy.pushTurnedOn });
    } catch (e) {
      setNotice({ tone: "bad", ...describeFailure(e) });
    } finally {
      setBusy(false);
    }
  };
  const change = (next: PushSettings) => {
    setSettings(next);
    void savePushSettings(props.account, next);
  };

  return (
    <>
      <p className="name">{copy.pushOnPhone}</p>
      <p className="hint">{copy.pushHint}</p>
      <p className="hint">{copy.pushIphone}</p>
      {way === "ios" && (
        <>
          <button type="button" className="btn ghost small" aria-expanded={how} onClick={() => setHow(!how)}>
            {copy.pushHowToAdd}
          </button>
          {how && <InstallHow way={way} />}
        </>
      )}
      <p className="hint">{on ? copy.pushIsOn : copy.pushIsOff}</p>
      <button type="button" className={`btn${on ? "" : " primary"}`} disabled={busy || (!on && !supported)} aria-busy={busy} onClick={() => void toggle()}>
        {busy ? copy.waitingForPasskey : on ? copy.turnOff : copy.turnOn}
      </button>
      {notice && <NoticeLine notice={notice} />}
      <fieldset className="push-kinds">
        <legend className="name">{copy.pushKindsTitle}</legend>
        {PUSH_KINDS.map((k) => (
          <label className="check-row" key={k}>
            <input type="checkbox" checked={settings.kinds[k]} onChange={(e) => change({ ...settings, kinds: { ...settings.kinds, [k]: e.target.checked } })} />
            <span>{KIND_TEXT[k]}</span>
          </label>
        ))}
        {settings.kinds.potNamesYou && <p className="hint">{copy.pushPotNamesYouNote}</p>}
        <label className="check-row">
          <input type="checkbox" checked={settings.amounts} onChange={(e) => change({ ...settings, amounts: e.target.checked })} />
          <span>{copy.pushAmounts}</span>
        </label>
        <p className="hint">{copy.pushAmountsHint}</p>
      </fieldset>
      <p className="hint">{copy.pushMissed}</p>
    </>
  );
}
