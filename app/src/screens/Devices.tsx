import { useState } from "react";
import type { Address } from "viem";
import { copy } from "../copy.ts";
import { AccountStore, shownName, type StoredAccount } from "../lib/accounts.ts";
import { forgetAccount, LastUsedStore } from "../lib/forget.ts";
import { idbWriteStore } from "../lib/idb.ts";
import { forgetInboxKey } from "../lib/inboxLive.ts";
import { dateLocale } from "../lib/locale.ts";
import { HowThisWorks, NoticeLine, Sheet, type Notice } from "./ui.tsx";

const whenFormat = new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Devices and sessions, in Account details. This phone: the accounts on it,
 * when each was last used here, and Remove from this phone (lib/forget.ts).
 * Signing: NivPay keeps no signing session, so every payment asks for the
 * fingerprint. Your passkey: where it lives, and how to cut off a lost phone,
 * which only the password manager can do: NivPay keeps no sessions on a
 * server, so it can't list or sign out other devices.
 */
export function DevicesSection(props: { current: Address; onRemoved: (account: Address, name: string) => void }) {
  const [accounts, setAccounts] = useState<StoredAccount[]>(() => new AccountStore(localStorage).list());
  const lastUsed = new LastUsedStore(localStorage);
  const [asking, setAsking] = useState<StoredAccount | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const remove = async (a: StoredAccount) => {
    // Refused while a request from it is in flight: its record must stay to finish it.
    const inFlight = await idbWriteStore.get(a.address).catch(() => undefined);
    if (inFlight) {
      setAsking(null);
      setNotice({ tone: "bad", text: copy.removeInFlight });
      return;
    }
    forgetAccount(localStorage, a.address);
    void forgetInboxKey(a.address);
    setAsking(null);
    setAccounts(new AccountStore(localStorage).list());
    props.onRemoved(a.address, shownName(a));
  };

  return (
    <section className="devices-screen" aria-labelledby="this-phone">
      <p className="settings-group" id="this-phone">
        {copy.thisPhone}
      </p>
      <div className="settings-list">
        {accounts.map((a) => {
          const used = lastUsed.get(a.address);
          return (
            <div className="device-row" key={a.address}>
              <span className="name">{shownName(a)}</span>
              <span className="meta">
                {copy.accountEnding(a.address)}
                {a.address === props.current ? ` · ${copy.signedInHere}` : ""}
              </span>
              <span className="meta">{used ? copy.lastUsed(whenFormat.format(new Date(used))) : copy.notUsedHereYet}</span>
              <button type="button" className="danger-text-btn" onClick={() => (setNotice(null), setAsking(a))}>
                {copy.removeFromPhone}
              </button>
            </div>
          );
        })}
      </div>
      {notice && <NoticeLine notice={notice} />}
      <p className="hint">{copy.signingEachTime}</p>
      <HowThisWorks>
        <p className="hint">{copy.signingNoSession}</p>
        <p className="hint">{copy.passkeyWhere}</p>
        <p className="hint">{copy.passkeyNoServer}</p>
      </HowThisWorks>

      {asking && (
        <Sheet title={copy.removeTitle(shownName(asking))} onClose={() => setAsking(null)}>
          <p className="lede">{copy.removeLede}</p>
          <button type="button" className="pill-btn" onClick={() => void remove(asking)}>
            {copy.removeFromPhone}
          </button>
          <button type="button" className="btn ghost" onClick={() => setAsking(null)}>
            {copy.back}
          </button>
        </Sheet>
      )}
    </section>
  );
}
