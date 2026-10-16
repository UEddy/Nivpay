import { useState } from "react";
import { copy } from "../copy.ts";
import { AccountStore } from "../lib/accounts.ts";
import { emailLink, LastCodeStore, supportEmail, supportWhatsApp, whatsAppLink } from "../lib/support.ts";
import { recentSends, sendKind, sendLine, type LoggedSend } from "../lib/sendLog.ts";
import { dateLocale } from "../lib/locale.ts";
import { Sheet } from "./ui.tsx";

/** From the build; each button hides while its value is missing (lib/support.ts). */
const EMAIL = supportEmail(import.meta.env.VITE_SUPPORT_EMAIL);
const WHATSAPP = supportWhatsApp(import.meta.env.VITE_SUPPORT_WHATSAPP);
const VERSION: string = import.meta.env.VITE_APP_VERSION ?? "local";

const timeFormat = new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const SEND_KIND_TEXT = { accepted: copy.sendAccepted, refused: copy.sendTurnedDown, unanswered: copy.sendNoAnswer };

const FAQ: [string, string][] = [
  [copy.faqPotQ, copy.faqPotA],
  [copy.faqFinalQ, copy.faqFinalA],
  [copy.faqNewPhoneQ, copy.faqNewPhoneA],
  [copy.faqCodeQ, copy.faqCodeA],
  [copy.faqTestQ, copy.faqTestA],
];

/**
 * Help and support: short answers, then an email or a WhatsApp chat with the
 * app version and the code already written in. The Account ID goes in only if
 * the box is ticked. No chat widget, no outside script.
 */
export function HelpSheet(props: { code: number | null; onClose: () => void }) {
  const [withId, setWithId] = useState(false);
  let code = props.code;
  let account: string | null = null;
  let sends: LoggedSend[] = [];
  try {
    code ??= new LastCodeStore(localStorage).get();
    const active = new AccountStore(localStorage).active()?.address;
    account = active ?? null;
    if (active) sends = recentSends(localStorage, active);
  } catch {
    // Storage refused: nothing filled in.
  }
  // The sends go in with the Account ID only: a transaction leads to the account.
  const facts = { version: VERSION, code, accountId: withId ? account : null, sends: withId ? sends.map(sendLine) : [] };
  return (
    <Sheet title={copy.helpAndSupport} onClose={props.onClose}>
      {props.code !== null && <p className="lede">{copy.helpAboutCode(props.code)}</p>}
      <div className="faq">
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p className="hint">{a}</p>
          </details>
        ))}
      </div>
      {sends.length > 0 && (
        <section aria-labelledby="recent-sends">
          <p className="eyebrow" id="recent-sends">
            {copy.recentSends}
          </p>
          <ul className="recent-sends">
            {sends
              .slice()
              .reverse()
              .map((s, i) => (
                <li className="hint" key={`send-${s.at}-${i}`}>
                  {SEND_KIND_TEXT[sendKind(s.result)](timeFormat.format(new Date(s.at)))}
                </li>
              ))}
          </ul>
          <p className="hint">{copy.recentSendsHint}</p>
        </section>
      )}
      {(EMAIL || WHATSAPP) && account && (
        <label className="check-row">
          <input type="checkbox" checked={withId} onChange={(e) => setWithId(e.target.checked)} />
          <span>
            {copy.includeAccountId}
            <br />
            <small className="hint">{copy.includeAccountIdHint}</small>
          </span>
        </label>
      )}
      {EMAIL && (
        <a className="btn primary link-btn" href={emailLink(EMAIL, facts)}>
          {copy.emailSupport}
        </a>
      )}
      {WHATSAPP && (
        <a className="btn link-btn" href={whatsAppLink(WHATSAPP, facts)} target="_blank" rel="noopener noreferrer">
          {copy.chatOnWhatsApp}
        </a>
      )}
      <p className="support-safety">{copy.supportSafety}</p>
      <button type="button" className="btn ghost" onClick={props.onClose}>
        {copy.close}
      </button>
    </Sheet>
  );
}
