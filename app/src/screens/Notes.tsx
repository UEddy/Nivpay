import { copy } from "../copy.ts";
import { ALL_POTS, SETTLEMENT_PAIR } from "../lib/config.ts";
import { changeWhat } from "../lib/changes.ts";
import { whenText } from "./Changes.tsx";
import { dateLocale } from "../lib/locale.ts";
import { formatAmount, formatCurrency } from "../lib/money.ts";
import { currencyFor, formatLocal, quoteCashOut } from "../lib/ramp.ts";
import type { Address } from "viem";
import type { Note, NotesState } from "../lib/notes.ts";
import { senderKind } from "../lib/transfer.ts";
import { Sheet } from "./ui.tsx";
import { Avatar } from "./Avatar.tsx";

const dayFormat = new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function amountOf(n: Note): string {
  if (!n.amount) return "";
  const decimals = n.decimals ?? 6;
  return n.symbol && n.symbol !== "$" ? formatCurrency(BigInt(n.amount), decimals, n.symbol) : formatAmount(BigInt(n.amount), decimals, "cents");
}

function fromOf(n: Note): string {
  if (!n.from) return copy.someoneElse;
  const kind = senderKind(n.from, ALL_POTS, SETTLEMENT_PAIR);
  return kind === "pot" ? copy.fromAPot : kind === "settlement" ? copy.fromAgoraSettlement : copy.accountEnding(n.from);
}

/** Someone's name for a note: a contact's, or an account's on this phone, else the end of their account. */
export type NameOf = (who: Address) => string | null;
const whoOf = (who: Address | undefined, nameOf?: NameOf) => (who ? (nameOf?.(who) ?? copy.accountEnding(who)) : copy.someoneElse);

/** What a note says, in the language in use. */
export function noteText(n: Note, nameOf?: NameOf): string {
  const pot = n.name || copy.unnamedPot;
  switch (n.kind) {
    case "received":
      return copy.noteReceived(amountOf(n), fromOf(n));
    case "chippedIn":
      return copy.noteChippedIn(amountOf(n), pot);
    case "askYes":
      return copy.noteAskYes(amountOf(n), pot);
    case "askClose":
      return copy.noteAskClose(pot);
    case "paidOut":
      return copy.notePaidOut(amountOf(n), pot);
    case "closingSoon":
      return copy.noteClosingSoon(pot);
    case "closedShare":
      return copy.noteClosedShare(pot);
    case "limitRaised":
      return copy.noteLimitRaised(amountOf(n));
    case "sent":
      return copy.noteSent(amountOf(n), n.toName || whoOf(n.to, nameOf));
    case "potNamesYou":
      return copy.notePotNamesYou(whoOf(n.from, nameOf), pot);
    case "memberChippedIn":
      return copy.noteMemberChippedIn(whoOf(n.from, nameOf), amountOf(n), pot);
    case "request": {
      const who = (n.from && nameOf?.(n.from)) || n.fromName || whoOf(n.from, nameOf);
      return n.amount && n.amount !== "0" ? copy.noteRequest(who, amountOf(n)) : copy.noteRequestAny(who);
    }
    case "autoCashOut": {
      // What the bank got, worked out as the desk does (lib/ramp.ts quoteCashOut).
      const c = currencyFor(n.cash?.currency ?? "");
      const local = c ? formatLocal(c, quoteCashOut(c, BigInt(n.amount ?? "0")).bankGets) : "";
      return copy.noteAutoCashOut(amountOf(n), local, n.cash?.bank ?? copy.autoCashYourBank);
    }
    case "autoCashHeld":
      return copy.noteAutoCashOutHeld(amountOf(n), n.cash?.why === "cap" ? copy.autoCashHeldCap : n.cash?.why === "allowance" ? copy.autoCashHeldAllowance : copy.autoCashHeldDesk);
    case "changeAgreed": {
      const c = n.change;
      if (!c) return pot;
      const decimals = n.decimals ?? 6;
      const words = { payeeName: () => c.payee || copy.unnamedPayee, money: (u: bigint) => formatAmount(u, decimals, "auto"), when: whenText };
      const what = changeWhat({ kind: c.kind, destIndex: 0, label: c.label, limit: BigInt(c.limit), endTime: BigInt(c.endTime) }, words);
      return copy.noteChangeApproved(pot, what, words.when(BigInt(c.appliesAt)));
    }
  }
}

/**
 * The notifications list, newest first (lib/notes.ts). Tapping one opens the
 * screen it is about and marks it read. It says when the list started and
 * where it comes from.
 */
export function NotesSheet(props: {
  state: NotesState;
  nameOf?: NameOf;
  onOpen: (n: Note) => void;
  /** A request from a person: Pay opens Send filled in, Ignore drops it, Mute stops that account's requests. */
  onPay: (n: Note) => void;
  /** An agreed change on a pot this account put money into: Take my part out opens it. */
  onTakeOut: (n: Note) => void;
  onIgnore: (n: Note) => void;
  onMute: (n: Note) => void;
  onReadAll: () => void;
  onClose: () => void;
}) {
  const { state } = props;
  return (
    <Sheet title={copy.notifications} onClose={props.onClose}>
      {state.notes.length === 0 ? (
        <p className="hint">{copy.noNotesYet}</p>
      ) : (
        <div className="list" role="list">
          {state.notes.map((n) =>
            n.kind === "request" ? (
              <div role="listitem" className={`home-pot note${n.read ? "" : " unread"}`} key={n.id}>
                {n.from && <Avatar account={n.from} name={noteText(n, props.nameOf)} size={32} />}
                <span className="grow">
                  <span className="name">{noteText(n, props.nameOf)}</span>
                  {n.from && <span className="meta">{copy.accountEnding(n.from)}</span>}
                  <span className="meta">{timeFormat.format(new Date(n.at))}</span>
                  <span className="note-actions">
                    <button type="button" className="btn primary small" onClick={() => props.onPay(n)}>
                      {copy.payAction}
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => props.onIgnore(n)}>
                      {copy.ignoreAction}
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => props.onMute(n)}>
                      {copy.muteAction}
                    </button>
                  </span>
                </span>
              </div>
            ) : n.kind === "changeAgreed" ? (
              <div role="listitem" className={`home-pot note${n.read ? "" : " unread"}`} key={n.id}>
                <span className="grow">
                  <span className="name">{noteText(n, props.nameOf)}</span>
                  <span className="meta">{timeFormat.format(new Date(n.at))}</span>
                  <span className="note-actions">
                    <button type="button" className="btn primary small" onClick={() => props.onTakeOut(n)}>
                      {copy.takeMyPartOut}
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => props.onOpen(n)}>
                      {copy.openThePot}
                    </button>
                  </span>
                </span>
              </div>
            ) : (
            <button type="button" role="listitem" className={`home-pot note${n.read ? "" : " unread"}`} key={n.id} onClick={() => props.onOpen(n)}>
              {n.kind === "received" && n.from && senderKind(n.from, ALL_POTS, SETTLEMENT_PAIR) === "account" && <Avatar account={n.from} name={copy.accountEnding(n.from)} size={32} />}
              <span className="grow">
                <span className="name">{noteText(n, props.nameOf)}</span>
                <span className="meta">{timeFormat.format(new Date(n.at))}</span>
              </span>
              {!n.read && <span className="tag live">{copy.noteNew}</span>}
            </button>
            ),
          )}
        </div>
      )}
      {state.notes.some((n) => !n.read) && (
        <button type="button" className="btn" onClick={props.onReadAll}>
          {copy.markAllRead}
        </button>
      )}
      {state.startedAt !== null && <p className="hint">{copy.notesSince(dayFormat.format(new Date(state.startedAt)))}</p>}
      <button type="button" className="btn ghost" onClick={props.onClose}>
        {copy.close}
      </button>
    </Sheet>
  );
}
