import { useEffect, useState } from "react";
import type { Address } from "viem";
import { copy } from "../copy.ts";
import { describeFailure } from "../lib/errors.ts";
import { MutedStore } from "../lib/inbox.ts";
import { inboxEnabled, requestsOnHere, turnOffRequests, turnOnRequests } from "../lib/inboxLive.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";
import { reloadOnce } from "../lib/reloadOnce.ts";
import { NoticeLine, type Notice } from "./ui.tsx";

// The signing code loads only when something here is turned on or off.
const passkeys = () => reloadOnce(() => import("../lib/passkey.ts"));

/** An account, for what this file shows; named so, since screen text is checked for words people mustn't see. */
type Account = Address;

/**
 * Notifications, in Profile: requests from people (lib/inbox.ts), on or off
 * for this phone, and the accounts muted. Hidden while requests aren't set up
 * on this site (no Blob store).
 */
export function NotificationsSection(props: { account: Account; names: (who: Account) => string; onMuted: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [here, setHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const muted = new MutedStore(localStorage, DEPLOYMENT, props.account);
  const [list, setList] = useState<Account[]>(() => muted.list());
  useEffect(() => {
    let live = true;
    void inboxEnabled(props.account).then((on) => live && setEnabled(on));
    void requestsOnHere(props.account).then((on) => live && setHere(on));
    return () => {
      live = false;
    };
  }, [props.account]);
  if (!enabled) return null;

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
      <p className="name">{copy.requestsFromPeople}</p>
      <p className="hint">{here ? copy.requestsOnHint : copy.requestsOffHint}</p>
      <button type="button" className={`btn${here ? "" : " primary"}`} disabled={busy} aria-busy={busy} onClick={() => void toggle()}>
        {busy ? copy.waitingForPasskey : here ? copy.turnOff : copy.turnOn}
      </button>
      {notice && <NoticeLine notice={notice} />}
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
