import { useState, type ReactNode } from "react";
import { copy } from "../copy.ts";
import type { StoredAccount } from "../lib/accounts.ts";
import { POTS } from "../lib/deployment.ts";
import { describeFailure } from "../lib/errors.ts";
import { linkUrl, ROLE, signReply, type Invite, type Reply } from "../lib/invites.ts";
import { withSigner } from "../lib/passkey.ts";
import { Icon, NoticeLine, phoneTimeZone, shareLink, type Notice } from "./ui.tsx";

/**
 * Joining a pot that is still being made. The invitee signs a reply with
 * their passkey, saying "this account is mine, use it", and sends the link
 * back to the creator over chat. Nothing is sent anywhere else and no money
 * moves.
 */
export function JoinScreen(props: { account: StoredAccount; invite: Invite; banner: ReactNode; onClose: () => void }) {
  const { account, invite } = props;
  const [name, setName] = useState(account.name);
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<Notice | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const timeZone = phoneTimeZone();
  const ready = name.trim().length > 0 && city.trim().length > 0;

  const make = async () => {
    setError(null);
    setBusy(true);
    try {
      const person = { account: account.address, name: name.trim(), city: city.trim(), timeZone };
      setReply(await withSigner(account.address, (signer) => signReply(signer, POTS, invite, person)));
    } catch (e) {
      setError({ tone: "bad", ...describeFailure(e) });
    } finally {
      setBusy(false);
    }
  };

  const url = reply ? linkUrl(location.origin, reply) : "";
  const send = async () => {
    setNote(null);
    const how = await shareLink(url, copy.replyShareText(invite.from));
    if (how === "copied") setNote(copy.linkCopied);
    if (how === "failed") setNote(copy.copyFailed);
  };

  return (
    <div className="screen">
      <div className="bar">
        <button type="button" className="icon-btn" aria-label={copy.close} onClick={props.onClose}>
          <Icon name="close" size={22} />
        </button>
        <div className="bar-title">{copy.joinAPot}</div>
        <div className="bar-spacer" />
      </div>
      {props.banner}
      <div className="screen-body">
        <div className="intro enter">
          <h1>{invite.potName}</h1>
          <p>
            {invite.role === ROLE.decider
              ? copy.joinAsDecider(invite.from, invite.potName)
              : copy.joinAsPayee(invite.from, invite.potName, invite.payeeName)}
          </p>
        </div>
        {!reply ? (
          <div className="card enter" style={{ animationDelay: "120ms", display: "flex", flexDirection: "column", gap: 12 }}>
            <label className="field">
              <span>{copy.yourName}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" />
            </label>
            <label className="field">
              <span>{copy.yourCity}</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={40} placeholder={copy.cityPlaceholder} autoComplete="off" />
            </label>
            <p className="hint">{copy.timeZoneLine(timeZone)}</p>
          </div>
        ) : (
          <div className="card enter" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p className="eyebrow">{copy.replyTitle}</p>
            <p className="lede">{copy.replyBody(invite.from)}</p>
            <div className="link-box">{url}</div>
          </div>
        )}
        {error && <NoticeLine notice={error} />}
      </div>
      <div className="screen-foot">
        {!reply ? (
          <button type="button" className={`pill-btn${busy ? " busy" : ""}`} disabled={busy || !ready} onClick={make}>
            {busy ? copy.stepConfirm : copy.makeMyReply}
          </button>
        ) : (
          <>
            <button type="button" className="pill-btn" onClick={send}>
              <Icon name="share" />
              {copy.sendTheReply}
            </button>
            {note && <p className="foot-hint">{note}</p>}
            <button type="button" className="btn ghost" onClick={props.onClose}>
              {copy.done}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
