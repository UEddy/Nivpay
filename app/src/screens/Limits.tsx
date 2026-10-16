import { useState } from "react";
import type { Address } from "viem";
import { copy } from "../copy.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";
import { changeLimit, DEFAULT_LIMIT, LIMIT_DECIMALS, LimitStore, limitNow, leftToday, settle, usedToday } from "../lib/limits.ts";
import { dateLocale } from "../lib/locale.ts";
import { limitUsedShare } from "../lib/profile.ts";
import { amountIn, formatAmount } from "../lib/money.ts";
import { AmountUnderstood, HowThisWorks } from "./ui.tsx";

const whenFormat = new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const money = (v: bigint) => formatAmount(v, LIMIT_DECIMALS, "cents");
const plain = (v: bigint) => formatAmount(v, LIMIT_DECIMALS, "auto");

/**
 * Daily limit, in Profile (lib/limits.ts): what was used in the last 24 hours
 * of the limit, what is left, and changing it. Lowering takes effect at once;
 * raising, 24 hours later, and the screen says when. The rules are under
 * How this works.
 */
export function DailyLimitSection(props: { account: Address }) {
  const store = new LimitStore(localStorage, DEPLOYMENT, props.account);
  const [state, setState] = useState(() => {
    const s = settle(store.get(), Date.now());
    store.set(s);
    return s;
  });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const now = Date.now();
  const next = amountIn(text, LIMIT_DECIMALS);

  const save = () => {
    if (next === null) return;
    setState(store.update((s) => changeLimit(s, next, Date.now())));
    setEditing(false);
    setText("");
    setSaved(true);
  };

  const limit = limitNow(state, now);
  const used = usedToday(state, now);
  const share = limitUsedShare(used, limit);

  return (
    <section className="limit-screen">
      <p className="limit-big">{copy.limitUsedToday(plain(used), plain(limit))}</p>
      <div className="limit-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)} aria-label={copy.dailyLimit}>
        <span style={{ width: `${share}%` }} />
      </div>
      <p className="limit-left">{copy.limitLeftToday(plain(leftToday(state, now)))}</p>
      {state.raise && <p className="hint">{copy.limitRaiseStarts(money(BigInt(state.raise.limit)), whenFormat.format(new Date(state.raise.startsAt)))}</p>}
      {editing ? (
        <form
          className="name-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="field">
            <span>{copy.newLimit}</span>
            <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder={copy.amountPlaceholder} />
          </label>
          <AmountUnderstood text={text} decimals={LIMIT_DECIMALS} />
          <p className="hint">{copy.limitRaiseLater}</p>
          <button type="submit" className="btn primary" disabled={next === null}>
            {copy.saveLimit}
          </button>
          <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
            {copy.back}
          </button>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => (setSaved(false), setEditing(true))}>
          {copy.changeLimit}
        </button>
      )}
      {saved && (
        <p className="success" role="status">
          {copy.limitSaved}
        </p>
      )}
      <p className="hint">{copy.limitCountsHere}</p>
      <HowThisWorks>
        <p className="hint">{copy.dailyLimitCounts}</p>
        <p className="hint">{copy.dailyLimitThisPhone}</p>
        <p className="hint">{copy.limitLowerNow}</p>
        <p className="hint">{copy.limitRaiseLater}</p>
        <p className="hint">{copy.limitAppOnly(money(DEFAULT_LIMIT))}</p>
      </HowThisWorks>
    </section>
  );
}
