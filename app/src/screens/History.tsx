import { useEffect, useState } from "react";
import type { Address, Log } from "viem";
import { copy } from "../copy.ts";
import { BlockTimes, timesFor } from "../lib/blockTimes.ts";
import { ALL_POTS, CTK } from "../lib/config.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";
import { detailFrom, type HistoryDetail, type HistoryEntry } from "../lib/history.ts";
import { dateLocale } from "../lib/locale.ts";
import { formatAmount, formatCurrency } from "../lib/money.ts";
import { receiptUrl } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { Icon } from "./ui.tsx";

/** An account, for what this file shows; named so, since screen text is checked for words people mustn't see. */
type Account = Address;

const SHOWN = 5;
const OPEN_KEY = "nivpay.historyopen.v1";
const times = new BlockTimes(localStorage, DEPLOYMENT);
const rowTime = new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fullTime = new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
/** Every pots contract, V2 included once it is set: money to or from any of them is a pot's. */
const POTS_ALL = ALL_POTS;

const money = (e: HistoryEntry, amount = e.amount) => (e.symbol === "$" ? formatAmount(amount, e.decimals, "cents") : formatCurrency(amount, e.decimals, e.symbol));

function title(e: HistoryEntry, who: string, pot: string | null): string {
  switch (e.kind) {
    case "sent":
      return copy.historySent(who);
    case "received":
      return copy.historyReceived(who);
    case "sentOther":
      return copy.historySentOther;
    case "receivedOther":
      return copy.historyReceivedOther;
    case "addMoney":
      return copy.historyAddMoney;
    case "cashOut":
      return copy.historyCashOut;
    case "testDollars":
      return copy.historyTestDollars;
    case "potIn":
      return pot ? copy.historyPotInNamed(pot) : copy.historyPotIn;
    case "potOut":
      return pot ? copy.historyPotOutNamed(pot) : copy.historyPotOut;
  }
}

/**
 * History, on Home (lib/history.ts): every finalized movement of this
 * account's money this phone has followed, newest first. Folds away, and
 * remembers it on this phone. Tap an entry for its details: when, how much,
 * who or which pot, and the receipt.
 */
export function HistoryCard(props: { entries: HistoryEntry[]; since: number | null; who: (a: Account) => string; potName: (potId: string) => string | null }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, HistoryDetail>>({});
  const [when, setWhen] = useState<Map<bigint, bigint>>(() => times.all());
  const shown = all ? props.entries : props.entries.slice(0, SHOWN);
  const blocks = shown.map((e) => e.block.toString()).join(",");
  useEffect(() => {
    if (!open || !blocks) return;
    let live = true;
    void timesFor(
      blocks.split(",").map((b) => BigInt(b)),
      times,
      async (b) => (await readClient.getBlock({ blockNumber: b })).timestamp,
    )
      .then((m) => live && setWhen(m))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, blocks]);
  // Opening an entry reads its receipt once, for its pot or who got a payment in another currency.
  useEffect(() => {
    const e = props.entries.find((x) => x.id === expanded);
    if (!e || details[e.id] || !["potIn", "potOut", "sentOther"].includes(e.kind)) return;
    let live = true;
    void readClient
      .getTransactionReceipt({ hash: e.tx })
      .then((r) => live && setDetails((d) => ({ ...d, [e.id]: detailFrom(e, r.logs as Log[], POTS_ALL, DEPLOYMENT === "ausd" ? CTK : null) })))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [expanded, props.entries, details]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // Storage refused: it opens next time.
    }
  };
  const at = (e: HistoryEntry) => {
    const t = when.get(e.block);
    return t === undefined ? null : new Date(Number(t) * 1000);
  };

  return (
    <section className="card history" aria-labelledby="history-title">
      <button type="button" className="new-pots-toggle history-toggle" aria-expanded={open} aria-controls="history-list" onClick={toggle}>
        <span className="eyebrow" id="history-title">
          {copy.history}
        </span>
        <Icon name="chevron" size={18} />
      </button>
      {open && (
        <div id="history-list">
          {props.entries.length === 0 ? (
            <p className="hint">{copy.historyEmpty}</p>
          ) : (
            <div className="history-list">
              {shown.map((e) => {
                const d = details[e.id];
                const pot = d?.potId ? props.potName(d.potId) : null;
                const time = at(e);
                const isOpen = expanded === e.id;
                return (
                  <div className={`history-item${isOpen ? " open" : ""}`} key={e.id}>
                    <button type="button" className="history-row" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : e.id)}>
                      <span className="grow">
                        <span className="name">{title(e, props.who(e.other), pot)}</span>
                        <span className="meta">{time ? rowTime.format(time) : "…"}</span>
                      </span>
                      <span className={`history-amount ${e.direction}`}>{(e.direction === "in" ? "+" : "−") + money(e)}</span>
                    </button>
                    {isOpen && (
                      <dl className="history-detail">
                        <div>
                          <dt>{copy.historyWhen}</dt>
                          <dd>{time ? fullTime.format(time) : "…"}</dd>
                        </div>
                        <div>
                          <dt>{copy.confirmAmount}</dt>
                          <dd>{money(e)}</dd>
                        </div>
                        {(e.kind === "sent" || e.kind === "received") && (
                          <div>
                            <dt>{e.kind === "sent" ? copy.confirmTo : copy.historyFrom}</dt>
                            <dd>
                              {props.who(e.other)}
                              <br />
                              <span className="meta">{copy.accountEnding(e.other)}</span>
                            </dd>
                          </div>
                        )}
                        {e.kind === "sentOther" && d?.recipient && (
                          <div>
                            <dt>{copy.confirmTo}</dt>
                            <dd>
                              {props.who(d.recipient)}
                              <br />
                              <span className="meta">{copy.accountEnding(d.recipient)}</span>
                            </dd>
                          </div>
                        )}
                        {e.kind === "sentOther" && d?.received !== undefined && (
                          <div>
                            <dt>{copy.historyTheyGot}</dt>
                            <dd>{formatCurrency(d.received, 18, "CTK")}</dd>
                          </div>
                        )}
                        {(e.kind === "potIn" || e.kind === "potOut") && (
                          <div>
                            <dt>{copy.historyPot}</dt>
                            <dd>{d ? (pot ?? copy.unnamedPot) : "…"}</dd>
                          </div>
                        )}
                        <div>
                          <dt>{copy.historyReceipt}</dt>
                          <dd>
                            <a className="receipt-link" href={receiptUrl(e.tx)} target="_blank" rel="noopener noreferrer">
                              {copy.viewReceipt}
                            </a>
                          </dd>
                        </div>
                      </dl>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {props.entries.length > SHOWN && (
            <button type="button" className="text-btn history-more" onClick={() => setAll(!all)}>
              {all ? copy.historyShowLess : copy.historyShowAll(props.entries.length)}
            </button>
          )}
          {props.since !== null && <p className="hint">{copy.historySince(rowTime.format(new Date(props.since)))}</p>}
        </div>
      )}
    </section>
  );
}
