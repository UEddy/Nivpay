import { isAddressEqual, type Address } from "viem";
import { copy } from "../copy.ts";
import { cleanName } from "../lib/accounts.ts";
import type { Contact } from "../lib/contacts.ts";
import { formatAmount } from "../lib/money.ts";
import { potRisks } from "../lib/potRisks.ts";
import { useUsernames, withUsernameOf } from "./Username.tsx";
import type { PotState } from "../lib/potview.ts";
import { dateLocale } from "../lib/locale.ts";
import { Avatar } from "./Avatar.tsx";
import { changeStatusLine, changeTitle, openChanges } from "../lib/changes.ts";
import { changeWordsFor } from "./Changes.tsx";

const whenFormat = new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Who decides, who can be paid and when it closes, all read from the chain,
 * and what that lets them do, in calm lines (lib/potRisks.ts). Each person
 * shows by the name this phone saved for them if there is one, else the
 * pot's own label, and always with the end of their account, since a label
 * is only what the pot's maker typed. Shown before anyone pours in; it never
 * stops them.
 */
export function WhoControls(props: {
  state: PotState;
  maker: Address;
  me: Address;
  /** Names from the pot's signed link, if they checked out. */
  labels: { account: Address; name: string }[];
  contacts: Contact[];
}) {
  const { state, me } = props;
  const fmt = (v: bigint) => formatAmount(v, state.decimals, "auto");
  const usernames = useUsernames([...state.deciders, ...state.payees.map((p) => p.to)]);
  const payeeLabel = (a: Address) => state.payees.find((p) => isAddressEqual(p.to, a))?.name;
  /** A contact's name, else the pot's label for them (signed link, then payee label), else their account ending. */
  const nameOf = (a: Address, label?: string): string => {
    if (isAddressEqual(a, me)) return copy.youCap;
    const saved = props.contacts.find((c) => isAddressEqual(c.account, a))?.name;
    const labelled = label ?? props.labels.find((p) => isAddressEqual(p.account, a))?.name ?? payeeLabel(a);
    return cleanName(saved ?? labelled ?? "") || copy.accountEnding(a);
  };
  /** "Idara · account ending 7bC1", or the ending alone when there is no name. */
  const who = (a: Address, label?: string) => {
    const name = nameOf(a, label);
    const shown = name === copy.accountEnding(a) ? name : `${name} · ${copy.accountEnding(a)}`;
    return withUsernameOf(usernames, a, shown);
  };
  // On a V2 pot, the changes on the way: who controls it is about to be different (lib/changes.ts).
  const words = changeWordsFor(state);
  const changes = openChanges(state.changes);
  // A removed payee can be paid nothing, so it adds no risk.
  const risks = potRisks({ deciders: state.deciders, threshold: state.threshold, payees: state.payees.filter((_, i) => !state.removed[i]), maker: props.maker });
  // Lines about the person reading are left out: they know what they can do.
  const others = risks.deciderPayees.filter((a) => !isAddressEqual(a, me));
  const lines = [
    ...(risks.oneCanPay ? [copy.riskOneCanPay] : []),
    ...others.map((a) => copy.riskDeciderIsPayee(nameOf(a))),
    ...(risks.makerIsPayee && !isAddressEqual(props.maker, me) && !others.some((a) => isAddressEqual(a, props.maker))
      ? [copy.riskMakerIsPayee(nameOf(props.maker))]
      : []),
    ...(risks.payeesCanPayThemselves && risks.deciderPayees.length > 1 ? [copy.riskPayeesPayThemselves] : []),
  ];

  return (
    <section className="card who-controls enter" aria-labelledby="who-controls">
      <p className="eyebrow" id="who-controls">
        {copy.whoControls}
      </p>
      <div className="list">
        <div className="list-row stacked">
          <span className="meta">{copy.controlDecides}</span>
          <span className="name">{copy.ruleLine(state.threshold, state.deciders.length)}</span>
          {state.deciders.map((d) => (
            <span className="meta with-avatar" key={`d-${d}`}>
              <Avatar account={d} name={nameOf(d)} size={24} reportable={d !== me} />
              {who(d)}
            </span>
          ))}
        </div>
        <div className="list-row stacked">
          <span className="meta">{copy.controlCanBePaid}</span>
          {state.payees.map((p, i) => (
            <span className="meta with-avatar" key={`p-${i}`}>
              <Avatar account={p.to} name={nameOf(p.to, p.name)} size={24} reportable={p.to !== me} />
              {who(p.to, p.name)} · {state.removed[i] ? copy.payeeRemovedTag : copy.upTo(fmt(p.cap))}
            </span>
          ))}
        </div>
        {changes.length > 0 && (
          <div className="list-row stacked">
            <span className="meta">{copy.controlWaitingChanges}</span>
            {changes.map((c) => (
              <span className="meta" key={`c-${c.id}`}>
                {changeTitle(c, words)} · {changeStatusLine(c, words)}
              </span>
            ))}
          </div>
        )}
        <div className="list-row stacked">
          <span className="name">{state.closed ? copy.potClosedNote : copy.closesAt(whenFormat.format(new Date(Number(state.endTime) * 1000)).replace(",", ""))}</span>
        </div>
      </div>
      {lines.map((l) => (
        <p className="risk-line" key={l}>
          {l}
        </p>
      ))}
      <p className="hint">{copy.cantCheckWho}</p>
    </section>
  );
}
