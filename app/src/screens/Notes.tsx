import { copy } from "../copy.ts";
import { POTS_AUSD, POTS_TESTUSD, SETTLEMENT_PAIR } from "../lib/config.ts";
import { dateLocale } from "../lib/locale.ts";
import { formatAmount, formatCurrency } from "../lib/money.ts";
import type { Note, NotesState } from "../lib/notes.ts";
import { senderKind } from "../lib/transfer.ts";
import { Sheet } from "./ui.tsx";

const dayFormat = new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function amountOf(n: Note): string {
  if (!n.amount) return "";
  const decimals = n.decimals ?? 6;
  return n.symbol && n.symbol !== "$" ? formatCurrency(BigInt(n.amount), decimals, n.symbol) : formatAmount(BigInt(n.amount), decimals, "cents");
}

function fromOf(n: Note): string {
  if (!n.from) return copy.someoneElse;
  const kind = senderKind(n.from, [POTS_AUSD, POTS_TESTUSD], SETTLEMENT_PAIR);
  return kind === "pot" ? copy.fromAPot : kind === "settlement" ? copy.fromAgoraSettlement : copy.accountEnding(n.from);
}

/** What a note says, in the language in use. */
export function noteText(n: Note): string {
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
  }
}

/**
 * The notifications list, newest first (lib/notes.ts). Tapping one opens the
 * screen it is about and marks it read. It says when the list started and
 * where it comes from: no server, no push messages.
 */
export function NotesSheet(props: { state: NotesState; onOpen: (n: Note) => void; onReadAll: () => void; onClose: () => void }) {
  const { state } = props;
  return (
    <Sheet title={copy.notifications} onClose={props.onClose}>
      {state.notes.length === 0 ? (
        <p className="hint">{copy.noNotesYet}</p>
      ) : (
        <div className="list" role="list">
          {state.notes.map((n) => (
            <button type="button" role="listitem" className={`home-pot note${n.read ? "" : " unread"}`} key={n.id} onClick={() => props.onOpen(n)}>
              <span className="grow">
                <span className="name">{noteText(n)}</span>
                <span className="meta">{timeFormat.format(new Date(n.at))}</span>
              </span>
              {!n.read && <span className="tag live">{copy.noteNew}</span>}
            </button>
          ))}
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
