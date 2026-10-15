import { isAddressEqual, type Address } from "viem";
import { copy } from "../copy.ts";
import { cleanName } from "../lib/accounts.ts";
import type { Contact } from "../lib/contacts.ts";
import { formatAmount } from "../lib/money.ts";
import { potRisks } from "../lib/potRisks.ts";
import type { PotState } from "../lib/potview.ts";

const whenFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

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
  const nameOf = (a: Address, label?: string): string => {
    if (isAddressEqual(a, me)) return copy.youCap;
    const saved = props.contacts.find((c) => isAddressEqual(c.account, a))?.name;
    const labelled = label ?? props.labels.find((p) => isAddressEqual(p.account, a))?.name;
    return cleanName(saved ?? labelled ?? "") || copy.accountEnding(a);
  };
  const risks = potRisks({ deciders: state.deciders, threshold: state.threshold, payees: state.payees, maker: props.maker });
  // Lines about the person reading are left out: they know what they can do.
  const others = risks.deciderPayees.filter((a) => !isAddressEqual(a, me));
  const payeeLabel = (a: Address) => state.payees.find((p) => isAddressEqual(p.to, a))?.name;
  const lines = [
    ...(risks.oneCanPay ? [copy.riskOneCanPay] : []),
    ...others.map((a) => copy.riskDeciderIsPayee(nameOf(a, props.labels.find((p) => isAddressEqual(p.account, a))?.name ?? payeeLabel(a)))),
    ...(risks.makerIsPayee && !isAddressEqual(props.maker, me) && !others.some((a) => isAddressEqual(a, props.maker))
      ? [copy.riskMakerIsPayee(nameOf(props.maker, payeeLabel(props.maker)))]
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
            <span className="meta" key={`d-${d}`}>
              {nameOf(d)} · {copy.accountEnding(d)}
            </span>
          ))}
        </div>
        <div className="list-row stacked">
          <span className="meta">{copy.controlCanBePaid}</span>
          {state.payees.map((p, i) => (
            <span className="meta" key={`p-${i}`}>
              {nameOf(p.to, p.name)} · {copy.accountEnding(p.to)} · {copy.upTo(fmt(p.cap))}
            </span>
          ))}
        </div>
        <div className="list-row stacked">
          <span className="meta">{copy.closes}</span>
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
