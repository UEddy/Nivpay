import { useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { copy } from "../copy.ts";
import type { PotEvent } from "../lib/feed.ts";
import { agreesWithContract, cardsFor, ledgerOf, type LedgerPayment, type PersonLedger } from "../lib/ledger.ts";
import { formatAmount } from "../lib/money.ts";

/** While the numbers and the events disagree, the numbers are read again after 2s, then 4s, 8s, up to every 30s. */
const STALE_REREAD_MS = 2_000;
const STALE_REREAD_MAX_MS = 30_000;

/**
 * Where each person's money went (README, "Where your money went"): a card
 * for everyone who put money in, mine first. Worked out from the pot's
 * finalized events (lib/ledger.ts); Left is the contract's own number. Until
 * the whole history is read and agrees with the numbers read at the same
 * block, the cards wait; while the two disagree (the numbers were read at
 * another block than the events reached), they ask for the numbers again.
 */
export function MoneyCards(props: {
  events: readonly PotEvent[];
  complete: boolean;
  decimals: number;
  /** funderInfo.redeemable by lowercase account, as read at the finalized block. */
  held: Readonly<Record<string, bigint>>;
  payeeNames: readonly string[];
  me: Address;
  nameOf: (account: Address) => string;
  /** Reads the pot's numbers again. */
  onStale: () => void;
}) {
  const funded = props.events.some((e) => e.name === "Funded");
  const ledger = funded && props.complete ? ledgerOf(props.events, props.decimals, props.held) : null;
  const stale = ledger !== null && !agreesWithContract(ledger, props.held);
  const onStale = useRef(props.onStale);
  useEffect(() => {
    onStale.current = props.onStale;
  });
  useEffect(() => {
    if (!stale) return;
    let wait = STALE_REREAD_MS;
    const again = () => {
      onStale.current();
      wait = Math.min(wait * 2, STALE_REREAD_MAX_MS);
      t = setTimeout(again, wait);
    };
    let t = setTimeout(again, wait);
    return () => clearTimeout(t);
  }, [stale]);
  if (!funded) return null;
  if (!ledger || stale) return <p className="hint money-wait">{copy.ledgerWaiting}</p>;
  const cards = cardsFor(ledger, props.me);
  if (cards.length === 0) return null;
  return (
    <section className="money-cards" aria-label={copy.ledgerTitle}>
      <p className="eyebrow">{copy.ledgerTitle}</p>
      {cards.map((p) => (
        <MoneyCard
          key={p.account}
          person={p}
          payments={ledger.payments}
          decimals={props.decimals}
          payeeNames={props.payeeNames}
          mine={p.account === props.me.toLowerCase()}
          name={props.nameOf(getAddress(p.account))}
        />
      ))}
    </section>
  );
}

function MoneyCard(props: { person: PersonLedger; payments: readonly LedgerPayment[]; decimals: number; payeeNames: readonly string[]; mine: boolean; name: string }) {
  const { person: p, mine, name } = props;
  const [open, setOpen] = useState(false);
  const cents = (c: bigint) => formatAmount(c * 10n ** BigInt(props.decimals - 2), props.decimals, "cents");
  const minus = (c: bigint) => cents(-c);
  const payee = (i: number) => props.payeeNames[props.payments[i]!.destIndex] ?? copy.ledgerPayeeUnknown;
  // Each payee once, in the order they were paid.
  const paidTo = [...new Set(p.parts.map((x) => payee(x.payment)))];
  const listId = `ledger-${p.account}`;
  return (
    <div className="money-card">
      <p className="money-card-who">{mine ? copy.youCap : name}</p>
      <div className="money-rows">
        <div>
          <span>{mine ? copy.ledgerYouPutIn : copy.ledgerTheyPutIn(name)}</span>
          <strong>{cents(p.putIn)}</strong>
        </div>
        {p.parts.length > 0 ? (
          <button type="button" className="money-row-btn" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
            <span>
              {mine ? copy.ledgerYourPayments : copy.ledgerTheirPayments(name)}
              <span className="money-paid-to"> ({paidTo.join(", ")})</span>
            </span>
            <strong>{minus(p.payments)}</strong>
          </button>
        ) : (
          <div>
            <span>{mine ? copy.ledgerYourPayments : copy.ledgerTheirPayments(name)}</span>
            <strong>{minus(0n)}</strong>
          </div>
        )}
        {open && (
          <ul className="money-parts" id={listId}>
            {p.parts.map((x) => (
              <li key={x.payment}>
                <span>{copy.ledgerPaymentLine(payee(x.payment), cents(props.payments[x.payment]!.amount / 10n ** BigInt(props.decimals - 2)))}</span>
                <strong>{minus(x.cents)}</strong>
              </li>
            ))}
          </ul>
        )}
        <div>
          <span>{mine ? copy.ledgerYourFees : copy.ledgerTheirFees(name)}</span>
          <strong>{minus(p.fees)}</strong>
        </div>
        <div>
          <span>{copy.ledgerTakenOut}</span>
          <strong>{p.takenOut === 0n ? cents(0n) : minus(p.takenOut)}</strong>
        </div>
        {p.rounding !== 0n && (
          <div>
            <span>{copy.ledgerRounding}</span>
            <strong>{cents(p.rounding)}</strong>
          </div>
        )}
        <div className="money-total">
          <span>{mine ? copy.ledgerLeftForYou : copy.ledgerLeftFor(name)}</span>
          <strong>{cents(p.left)}</strong>
        </div>
      </div>
    </div>
  );
}
