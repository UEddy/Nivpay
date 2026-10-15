import { useState } from "react";
import { copy } from "../copy.ts";
import { AccountStore } from "../lib/accounts.ts";
import { emailLink, LastCodeStore, supportEmail, supportWhatsApp, whatsAppLink } from "../lib/support.ts";
import { Sheet } from "./ui.tsx";

/** From the build; each button hides while its value is missing (lib/support.ts). */
const EMAIL = supportEmail(import.meta.env.VITE_SUPPORT_EMAIL);
const WHATSAPP = supportWhatsApp(import.meta.env.VITE_SUPPORT_WHATSAPP);
const VERSION: string = import.meta.env.VITE_APP_VERSION ?? "local";

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
  try {
    code ??= new LastCodeStore(localStorage).get();
    account = new AccountStore(localStorage).active()?.address ?? null;
  } catch {
    // Storage refused: nothing filled in.
  }
  const facts = { version: VERSION, code, accountId: withId ? account : null };
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
