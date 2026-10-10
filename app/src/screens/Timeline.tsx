import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isAddressEqual, type Address } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import type { StoredAccount } from "../lib/accounts.ts";
import { BlockTimes, timesFor } from "../lib/blockTimes.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";
import { AppError } from "../lib/errors.ts";
import type { PotEvent } from "../lib/feed.ts";
import type { PotLink } from "../lib/invites.ts";
import { formatAmount } from "../lib/money.ts";
import { PERSON_COLORS } from "../lib/potmap.ts";
import { linkFor, type StoredPot } from "../lib/potstore.ts";
import { openPot, potFeed, readPotState, type PotInfo, type PotState } from "../lib/potview.ts";
import { receiptUrl } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { ordered, replayStepMs, replaySteps, storyRows, type Order, type ReplayStep } from "../lib/story.ts";
import { AskSheet, useAskFlow } from "./Ask.tsx";
import { usePayMotion } from "./payMotion.ts";
import { mapLines } from "./mapNames.ts";
import { PotMap, type MapPayee, type MapPerson } from "./PotMap.tsx";
import { factsOf, layersOf, peopleOf } from "./Request.tsx";
import { Icon, NoticeLine, type Notice } from "./ui.tsx";

const blockTimes = new BlockTimes(localStorage, DEPLOYMENT);
const ORDER_KEY = "nivpay.storyorder.v1";
const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function savedOrder(): Order {
  try {
    return localStorage.getItem(ORDER_KEY) === "oldest" ? "oldest" : "newest";
  } catch {
    return "newest";
  }
}

/** The pot's story (docs/design/Live-Timeline.dc.html): everything that happened, from finalized events only. */
export function TimelineScreen(props: {
  account: StoredAccount;
  pot: StoredPot;
  banner: ReactNode;
  onBack: () => void;
  onOpenRequest: (proposalId: bigint) => void;
  /** Close and split, from More options. */
  onOpenClose?: () => void;
  /** Extra actions in the footer, such as taking a share out. */
  footer?: (state: PotState, info: PotInfo) => ReactNode;
}) {
  const me = props.account.address;
  const link = useMemo(() => linkFor(props.pot), [props.pot]);
  const potId = BigInt(props.pot.potId);
  const [info, setInfo] = useState<PotInfo | null>(null);
  const [state, setState] = useState<PotState | null>(null);
  const [events, setEvents] = useState<PotEvent[] | null>(null);
  const [times, setTimes] = useState<Map<bigint, bigint>>(() => blockTimes.all());
  const [failure, setFailure] = useState<Notice | null>(link ? null : { tone: "bad", text: copy.errLinkDamaged, code: ERROR_CODES.LINK_DAMAGED });
  const [readFailed, setReadFailed] = useState(false);
  const [order, setOrder] = useState<Order>(savedOrder);
  const [arrived, setArrived] = useState<Set<string>>(new Set());
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const { motion, run } = usePayMotion();
  const alive = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const askFlow = useAskFlow(me, potId, props.onOpenRequest);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);
  useEffect(() => {
    if (askFlow.resumable) setAskOpen(true);
  }, [askFlow.resumable]);

  useEffect(() => {
    if (!link) return;
    let live = true;
    openPot(link as PotLink)
      .then((i) => live && setInfo(i))
      .catch((e) => live && setFailure(e instanceof AppError ? { tone: "bad", text: e.message, code: e.code } : { tone: "bad", text: copy.errPotUnreachable }));
    return () => {
      live = false;
    };
  }, [link]);

  const read = useCallback(async () => {
    const accounts = info?.labelsOk ? info.people.map((p) => p.account) : [];
    let s = await readPotState(potId, [...accounts, me], me);
    if (!info?.labelsOk && s.deciders.some((a) => s.held[a.toLowerCase()] === undefined)) s = await readPotState(potId, [...s.deciders, me], me);
    return s;
  }, [potId, me, info]);

  useEffect(() => {
    if (!info) return;
    read()
      .then((s) => alive.current && setState(s))
      .catch(() => alive.current && setFailure({ tone: "bad", text: copy.errPotUnreachable }));
  }, [info, read]);

  // The pot's events, from its creation block to finalized, 101 blocks a page, its place kept on the phone.
  useEffect(() => {
    if (!info) return;
    const feed = potFeed(info.potId, info.block);
    feed.start(
      (all, fresh) => {
        if (!alive.current) return;
        setReadFailed(false);
        setEvents(all);
        if (!fresh.length) return;
        // New entries land only now, at Finalized, with the numbers read at Finalized.
        setArrived(new Set(fresh.map((e) => `${e.tx}:${e.logIndex}`)));
        const payout = fresh.filter((e) => e.name === "PayoutExecuted").at(-1);
        void read()
          .then((s) => {
            if (!alive.current) return;
            if (payout) run(Number(payout.args.destIndex), () => setState(s), () => {});
            else setState(s);
          })
          .catch(() => {});
      },
      () => alive.current && setReadFailed(true),
    );
    return () => feed.stop();
  }, [info, read, run]);

  // Dates for the rows: each block's time, read once.
  useEffect(() => {
    if (!events?.length) return;
    let live = true;
    void timesFor(
      events.map((e) => e.block),
      blockTimes,
      async (b) => (await readClient.getBlock({ blockNumber: b })).timestamp,
    ).then((t) => live && setTimes(t));
    return () => {
      live = false;
    };
  }, [events]);

  const people = info && state ? peopleOf(info, state, me) : [];
  const colorOf = (a: Address | null) => {
    const i = a ? people.findIndex((p) => isAddressEqual(p.account, a)) : -1;
    return i >= 0 && i < PERSON_COLORS.length ? PERSON_COLORS[i]!.fill : "var(--ink)";
  };

  const setOrderSaved = (o: Order) => {
    setOrder(o);
    try {
      localStorage.setItem(ORDER_KEY, o);
    } catch {
      // A preference only.
    }
  };

  const steps: ReplayStep[] = useMemo(() => (events ? replaySteps(events) : []), [events]);
  // Worked out once per change in the history or the numbers, not on every replay step.
  const rows = useMemo(() => {
    if (!events || !info || !state) return [];
    const ps = peopleOf(info, state, me);
    const find = (a: Address) => ps.find((p) => isAddressEqual(p.account, a));
    return storyRows(events, {
      me,
      nameOf: (a) => find(a)?.name ?? copy.accountEnding(a),
      cityOf: (a) => find(a)?.city ?? "",
      payeeName: (i) => state.payees[i]?.name ?? "",
      money: (v) => formatAmount(v, state.decimals, "cents"),
      now: state.now,
    });
  }, [events, info, state, me]);
  const byOrder = useMemo(() => ({ newest: ordered(rows, "newest"), oldest: ordered(rows, "oldest") }), [rows]);
  const replay = () => {
    if (!steps.length || replayAt !== null) return;
    timers.current.forEach(clearTimeout);
    const each = replayStepMs(steps.length);
    setReplayAt(-1);
    steps.forEach((_, i) => timers.current.push(setTimeout(() => alive.current && setReplayAt(i), 200 + i * each)));
    timers.current.push(setTimeout(() => alive.current && setReplayAt(null), 200 + steps.length * each + 400));
  };
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const bar = (
    <div className="bar">
      <button type="button" className="icon-btn" aria-label={copy.back} onClick={props.onBack}>
        <Icon name="back" size={22} />
      </button>
      <div className="bar-title">{state?.name ?? props.pot.name ?? copy.potStory}</div>
      {props.onOpenClose ? (
        <button type="button" className="icon-btn" aria-label={copy.moreOptions} onClick={props.onOpenClose}>
          <Icon name="more" size={22} />
        </button>
      ) : (
        <div className="bar-spacer" />
      )}
    </div>
  );

  if (failure || !info || !state) {
    return (
      <div className="screen">
        {bar}
        {props.banner}
        <div className="screen-body">{failure ? <NoticeLine notice={failure} /> : <p className="lede">{copy.readingStory}</p>}</div>
      </div>
    );
  }

  const d = state.decimals;
  const fmt = (v: bigint, style: "auto" | "cents" = "auto") => formatAmount(v, d, style);
  const shown = byOrder[order];

  // During the replay the map shows each step as it was; the rows light up in step.
  const step = replayAt === null ? null : replayAt >= 0 ? steps[replayAt]! : null;
  const replaying = replayAt !== null;
  const litUpTo = step ? rows.findIndex((r) => r.key === step.key) : replaying ? -1 : rows.length - 1;
  const lit = new Set(rows.slice(0, litUpTo + 1).map((r) => r.key));
  const paidSoFar = new Set(replaying ? steps.slice(0, (replayAt ?? -1) + 1).filter((s) => s.payee !== null).map((s) => s.payee!) : []);
  const shownState: PotState = step ? { ...state, totalAssets: step.assets, held: step.held } : replaying ? { ...state, totalAssets: 0n, held: {} } : state;
  const replayDate = step ? times.get(step.block) : undefined;

  const mapPayees: MapPayee[] = state.payees.map((p, i) => {
    if (!replaying && motion.payee === i) return { name: p.name, sub: copy.limitOf(fmt(p.spent), fmt(p.cap)), state: motion.arrived ? "paid" : "paying" };
    const paid = replaying ? paidSoFar.has(i) : p.spent > 0n;
    return { name: p.name, sub: paid && !replaying ? copy.limitOf(fmt(p.spent), fmt(p.cap)) : copy.upTo(fmt(p.cap)), state: paid ? "paid" : undefined };
  });
  const mapPeople: MapPerson[] = people.map((p) => {
    const inPot = (shownState.held[p.account.toLowerCase()] ?? 0n) > 0n;
    return {
      name: p.name,
      ...mapLines(p, info.labelsOk, p.me ? copy.youCap : p.name, ""),
      subStrong: p.me,
      ring: inPot ? "solid" : "pencil",
      dim: !inPot,
      route: inPot ? "solid" : "pencil",
    };
  });
  const iDecide = state.deciders.some((a) => isAddressEqual(a, me));

  return (
    <div className="screen">
      {bar}
      {props.banner}
      <div className="screen-body">
        <PotMap
          people={mapPeople}
          payees={mapPayees}
          payeeRoutes="dotted"
          lid="shut"
          lock={false}
          layers={layersOf(people, shownState)}
          potText={fmt(shownState.totalAssets, replaying ? "auto" : "cents")}
          badge="live"
          badgeText={replaying ? copy.replayBadge(replayDate ? dayFormat.format(new Date(Number(replayDate) * 1000)) : "") : undefined}
          label={copy.storyMap(fmt(state.totalAssets, "cents"), rows.length)}
          tilt={replaying ? step?.payee != null : motion.tilt}
          draining={replaying || motion.draining}
          stream={replaying ? null : motion.stream}
        >
          {!reduced && steps.length > 0 && (
            <button type="button" className="replay-btn" aria-label={copy.replay} disabled={replaying} onClick={replay}>
              <Icon name="replay" size={18} />
            </button>
          )}
        </PotMap>

        <div className="story-total enter" style={{ animationDelay: "120ms" }}>
          <div className="story-amount">{fmt(state.totalAssets, "cents")}</div>
          <div className="story-amount-label">{copy.leftInThePot}</div>
        </div>

        <div className="story-head enter" style={{ animationDelay: "180ms" }}>
          <h2>{copy.whatHappened}</h2>
          <div className="seg" role="radiogroup" aria-label={copy.storyOrder}>
            {(["newest", "oldest"] as const).map((o) => (
              <button key={o} type="button" role="radio" aria-checked={order === o} className={`seg-btn${order === o ? " on" : ""}`} onClick={() => setOrderSaved(o)}>
                {o === "newest" ? copy.newest : copy.oldest}
              </button>
            ))}
          </div>
        </div>

        {events === null && <p className="hint">{copy.readingStory}</p>}
        {readFailed && <NoticeLine notice={{ tone: "bad", text: copy.errStoryRead, code: ERROR_CODES.STORY_READ_FAILED }} />}
        {events !== null && rows.length === 0 && <p className="hint">{copy.nothingYet}</p>}
        <ol className="story enter" style={{ animationDelay: "240ms" }}>
          {shown.map((r) => {
            const t = times.get(r.block);
            return (
              <li
                key={r.key}
                className={`story-row${lit.has(r.key) ? "" : " dim"}${arrived.has(r.key) ? " arrived" : ""}`}
                style={{ "--dot": colorOf(r.who), "--dot-fill": r.who ? colorOf(r.who) : "var(--bg)" } as CSSProperties}
              >
                <span className="story-dot" aria-hidden="true" />
                <div className="story-text">
                  <div className="story-title">{r.title}</div>
                  {r.sub && <div className="story-sub">{r.sub}</div>}
                  <a className="receipt-link" href={receiptUrl(r.tx)} target="_blank" rel="noopener noreferrer" aria-label={copy.receiptFor(r.title)}>
                    {copy.receipt}
                  </a>
                </div>
                <div className="story-date">{t ? dayFormat.format(new Date(Number(t) * 1000)) : ""}</div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="screen-foot story-foot enter" style={{ animationDelay: "300ms" }}>
        {iDecide && !state.closed && !state.frozen && (
          <button type="button" className="pill-btn" onClick={() => setAskOpen(true)}>
            {copy.askForPayment}
          </button>
        )}
        {props.footer?.(state, info)}
      </div>

      {askOpen && <AskSheet me={me} facts={factsOf(state)} flow={askFlow} onClose={() => setAskOpen(false)} />}
    </div>
  );
}
