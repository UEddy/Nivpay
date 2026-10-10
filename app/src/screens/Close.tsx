import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isAddressEqual, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import type { StoredAccount } from "../lib/accounts.ts";
import { BlockTimes, timesFor } from "../lib/blockTimes.ts";
import { liveWriteChain } from "../lib/chain.ts";
import { askCloseLabel, closeState, putInBy, shareFraction, splitNow, takeLabel, takeView, totalsOf } from "../lib/close.ts";
import { askCloseCall, closeRefusalOf, dataOf, takeCall } from "../lib/closeLive.ts";
import { DEPLOYMENT, POTS } from "../lib/deployment.ts";
import { AppError, describeFailure, SendFailure } from "../lib/errors.ts";
import type { PotEvent } from "../lib/feed.ts";
import { idbWriteStore } from "../lib/idb.ts";
import type { PotLink } from "../lib/invites.ts";
import { formatAmount } from "../lib/money.ts";
import { requestsFrom, waitingRequests } from "../lib/payout.ts";
import { proposalIdIn } from "../lib/payoutLive.ts";
import { MAX_DRAWN_PEOPLE } from "../lib/potmap.ts";
import { linkFor, type StoredPot } from "../lib/potstore.ts";
import { openPot, potFeed, readPotState, type PotInfo, type PotState } from "../lib/potview.ts";
import { rememberReceipt } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { retryStuckWrite, sendWrite, type Step } from "../lib/send.ts";
import { followToFinality, type PendingWrite } from "../lib/writes.ts";
import { mapLines } from "./mapNames.ts";
import { PotMap, type Coin, type MapPayee, type MapPerson } from "./PotMap.tsx";
import { layersOf, peopleOf } from "./Request.tsx";
import { andList, Icon, NoticeLine, shareLink, type Notice } from "./ui.tsx";

type Action = "take" | "ask close";
const FLIGHT_MS = 900;
const blockTimes = new BlockTimes(localStorage, DEPLOYMENT);
const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const whenFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Close and split (docs/design/Live-Close.dc.html): the closing date, each share, and taking yours out. */
export function CloseScreen(props: {
  account: StoredAccount;
  pot: StoredPot;
  banner: ReactNode;
  onBack: () => void;
  onOpenRequest: (proposalId: bigint) => void;
}) {
  const me = props.account.address;
  const link = useMemo(() => linkFor(props.pot), [props.pot]);
  const potId = BigInt(props.pot.potId);
  const [info, setInfo] = useState<PotInfo | null>(null);
  const [state, setState] = useState<PotState | null>(null);
  const [events, setEvents] = useState<PotEvent[] | null>(null);
  const [times, setTimes] = useState<Map<bigint, bigint>>(() => blockTimes.all());
  const [failure, setFailure] = useState<Notice | null>(link ? null : { tone: "bad", text: copy.errLinkDamaged, code: ERROR_CODES.LINK_DAMAGED });
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [acting, setActing] = useState<Action | null>(null);
  const [stuck, setStuck] = useState<Action | null>(null);
  const [result, setResult] = useState<Notice | null>(null);
  const [took, setTook] = useState<bigint | null>(null);
  const [coin, setCoin] = useState<Coin["at"] | null>(null);
  const [announce, setAnnounce] = useState("");
  const [shareNote, setShareNote] = useState<string | null>(null);
  const alive = useRef(true);
  const myTx = useRef<Hex | null>(null);
  const openRequest = useRef(props.onOpenRequest);
  openRequest.current = props.onOpenRequest;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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

  // The feed tells the totals, who closed it, and anyone else's change; numbers land at Finalized.
  useEffect(() => {
    if (!info) return;
    const feed = potFeed(info.potId, info.block);
    feed.start((all, fresh) => {
      if (!alive.current) return;
      setEvents(all);
      if (fresh.some((e) => e.tx !== myTx.current && ["Funded", "Exited", "Claimed", "PayoutExecuted", "Closed", "Frozen", "Unfrozen"].includes(e.name))) {
        void read()
          .then((s) => alive.current && setState(s))
          .catch(() => {});
      }
    });
    return () => feed.stop();
  }, [info, read]);

  useEffect(() => {
    const closed = events?.filter((e) => e.name === "Closed") ?? [];
    if (!closed.length) return;
    let live = true;
    void timesFor(
      closed.map((e) => e.block),
      blockTimes,
      async (b) => (await readClient.getBlock({ blockNumber: b })).timestamp,
    ).then((t) => live && setTimes(t));
    return () => {
      live = false;
    };
  }, [events]);

  /** My own request, followed to the finalized receipt. A share lands in the balance only then. */
  const land = useCallback(
    async (write: PendingWrite, action: Action, amount: bigint) => {
      setStep("landing");
      setActing(action);
      myTx.current = write.hash;
      if (action === "take") setCoin((c) => c ?? "hold");
      const stop = (notice: Notice) => {
        if (!alive.current) return;
        setStep(null);
        setActing(null);
        if (action === "take") {
          setCoin("back");
          setTimeout(() => alive.current && setCoin(null), FLIGHT_MS);
        }
        setResult(notice);
      };
      try {
        const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
        if (outcome.kind === "final") {
          rememberReceipt(write.address, write.hash);
          setStuck(null);
          if (action === "ask close") {
            const id = await proposalIdIn(readClient, POTS, write.hash);
            if (!alive.current) return;
            setStep(null);
            setActing(null);
            if (id !== null) openRequest.current(id);
            return;
          }
          const next = await read();
          if (!alive.current) return;
          setCoin("end");
          setTimeout(() => {
            if (!alive.current) return;
            setCoin(null);
            setStep(null);
            setActing(null);
            setState(next);
            setTook(amount);
            setAnnounce(copy.tookAnnounce(formatAmount(amount, next.decimals, "cents")));
          }, 150);
        } else if (outcome.kind === "reverted") stop({ tone: "bad", text: copy.requestDidNotGoThrough, code: ERROR_CODES.REVERTED });
        else if (outcome.kind === "superseded") stop({ tone: "bad", text: copy.requestDidNotGoThrough, code: ERROR_CODES.SUPERSEDED });
        else {
          setStuck(action);
          stop(outcome.refused ? { tone: "bad", text: copy.requestTurnedDown, code: ERROR_CODES.REFUSED } : { tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
        }
      } catch (e) {
        if (!alive.current) return;
        setStep(null);
        setActing(null);
        setResult({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
      }
    },
    [read],
  );

  // A request in flight when the app was closed: follow it again, or offer to retry it on the same nonce.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !state) return;
    resumed.current = true;
    void idbWriteStore.get(me).then((w) => {
      if (!w || !alive.current) return;
      const action: Action | null = w.label === takeLabel(potId) ? "take" : w.label === askCloseLabel(potId) ? "ask close" : null;
      if (!action) return;
      if (w.replaceable) {
        setStuck(action);
        setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
      } else void land(w, action, state.held[me.toLowerCase()] ?? 0n);
    });
  }, [me, potId, land, state]);

  const act = async (action: Action, retry: boolean) => {
    if (!state) return;
    setResult(null);
    setActing(action);
    const myShares = state.shares[me.toLowerCase()] ?? 0n;
    const amount = state.held[me.toLowerCase()] ?? 0n;
    try {
      setStep("preparing");
      const take = takeView({ closed: state.closed, myShares, myWorth: amount });
      if (action === "take" && !take.action) throw take.refusal!;
      const call = action === "take" ? takeCall(potId, take.action!, myShares) : askCloseCall(potId);
      // Run it as a call first: a refusal costs no gas grant and no passkey prompt.
      const refusal = await closeRefusalOf(readClient, POTS, me, call);
      if (refusal) throw refusal;
      const req = {
        from: me,
        to: POTS,
        data: dataOf(call),
        label: action === "take" ? takeLabel(potId) : askCloseLabel(potId),
        onStep: (s: Step) => {
          setStep(s);
          // The coin leaves the pot once the fingerprint has signed, and waits by the city until final.
          if (s === "sending" && action === "take") {
            setCoin("start");
            requestAnimationFrame(() => requestAnimationFrame(() => setCoin("hold")));
          }
        },
      };
      const write = retry ? await retryStuckWrite(req) : await sendWrite(req);
      await land(write, action, amount);
    } catch (e) {
      if (!alive.current) return;
      setStep(null);
      setActing(null);
      setCoin(null);
      setResult({ tone: "bad", ...describeFailure(e) });
    }
  };

  const bar = (
    <div className="bar">
      <button type="button" className="icon-btn" aria-label={copy.back} onClick={props.onBack}>
        <Icon name="back" size={22} />
      </button>
      <div className="bar-title">{state?.name ?? props.pot.name ?? copy.closeAndSplit}</div>
      <div className="bar-spacer" />
    </div>
  );

  if (failure || !info || !state) {
    return (
      <div className="screen">
        {bar}
        {props.banner}
        <div className="screen-body">{failure ? <NoticeLine notice={failure} /> : <p className="lede">{copy.openingPot}</p>}</div>
      </div>
    );
  }

  const d = state.decimals;
  const fmt = (v: bigint, style: "auto" | "cents" = "cents") => formatAmount(v, d, style);
  const people = peopleOf(info, state, me);
  const nameOf = (a: Address) => (isAddressEqual(a, me) ? copy.youCap : (people.find((p) => isAddressEqual(p.account, a))?.name ?? copy.accountEnding(a)));
  const lower = me.toLowerCase();
  const myShares = state.shares[lower] ?? 0n;
  const myWorth = state.held[lower] ?? 0n;
  const take = takeView({ closed: state.closed, myShares, myWorth });
  const cs = closeState(state.closed, state.endTime, state.now);
  const totals = events ? totalsOf(events) : null;
  const myPut = events ? (putInBy(events).get(lower) ?? 0n) : 0n;
  const fraction = totals ? shareFraction(myPut, totals.wentIn, myShares, state.totalShares, totals.anyTaken) : null;
  const split = splitNow(
    people.map((p) => ({ account: p.account, worth: state.held[p.account.toLowerCase()] ?? 0n })),
    state.totalAssets,
  );
  const myClaims = events?.filter((e) => (e.name === "Claimed" || e.name === "Exited") && isAddressEqual(e.args.funder as Address, me)) ?? [];
  const tookAmount = took ?? (myShares === 0n && myClaims.length ? (myClaims.at(-1)!.args.assets as bigint) : null);
  const waitingPayment = events ? waitingRequests(requestsFrom(events), state.now).some((r) => r.kind === 0) : false;
  const iDecide = state.deciders.some((a) => isAddressEqual(a, me));
  const busy = step !== null;

  // How it closed: the Closed event's day, and who asked and agreed for an early close.
  const closedEvent = events?.filter((e) => e.name === "Closed").at(-1);
  const closedAt = closedEvent ? times.get(closedEvent.block) : cs === "closed-on-date" ? state.endTime : undefined;
  const closedDay = closedAt !== undefined ? dayFormat.format(new Date(Number(closedAt) * 1000)) : "";
  const closeReq = events ? requestsFrom(events).find((r) => r.kind === 1 && r.status === "paid") : undefined;
  const howClosed =
    cs === "closed-on-date"
      ? copy.closedOnDateLine(closedDay)
      : cs === "closed-early"
        ? closeReq && closeReq.yes.length > 1
          ? copy.closedEarlyLine(closedDay, nameOf(closeReq.asker), andList(closeReq.yes.filter((a) => !isAddressEqual(a, closeReq.asker)).map((a) => (isAddressEqual(a, me) ? copy.you : nameOf(a)))))
          : copy.closedEarlyPlain(closedDay)
        : null;

  const mapPeople: MapPerson[] = people.map((p) => {
    const worth = state.held[p.account.toLowerCase()] ?? 0n;
    const inPot = worth > 0n;
    const mine = p.account.toLowerCase() === lower;
    return {
      name: p.name,
      ...mapLines(p, info.labelsOk, p.me ? copy.youCap : p.name, ""),
      subStrong: p.me,
      ring: inPot || (mine && tookAmount !== null) ? "solid" : "pencil",
      dim: !inPot,
      check: mine && tookAmount !== null && coin === null,
      route: inPot ? "solid" : "pencil",
      split: state.closed && inPot,
      share: state.closed && inPot ? fmt(worth) : undefined,
    };
  });
  const myIndex = people.findIndex((p) => p.me);
  const coins: Coin[] = coin && myIndex >= 0 && myIndex < MAX_DRAWN_PEOPLE ? [{ person: myIndex, to: "city", at: coin, label: fmt(myWorth || (tookAmount ?? 0n), "auto") }] : [];
  const mapPayees: MapPayee[] = state.payees.map((p) => ({ name: p.name, sub: p.spent > 0n ? copy.payeeSubPaid(fmt(p.spent, "auto")) : copy.upTo(fmt(p.cap, "auto")), state: p.spent > 0n ? "paid" : undefined }));
  const mapLabel = state.closed
    ? copy.mapClosed(fmt(state.totalAssets), split.rows.map((r) => copy.mapShare(nameOf(r.account as Address), fmt(r.worth))).join(", "))
    : copy.mapOpenShares(fmt(state.totalAssets));
  const others = people.filter((p) => !p.me && (state.held[p.account.toLowerCase()] ?? 0n) > 0n).map((p) => p.name);

  const takeText =
    acting === "take" && step === "confirm"
      ? copy.stepConfirm
      : acting === "take" && step === "preparing"
        ? copy.stepPreparing
        : acting === "take" && step === "getting-ready"
          ? copy.stepGettingReady
          : acting === "take" && step
            ? copy.takingOut
            : take.action === "claim"
              ? copy.takeMy(fmt(myWorth))
              : copy.takeMyShareOut(fmt(myWorth));

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
          lock={state.closed}
          layers={layersOf(people, state)}
          coins={coins}
          potText={fmt(state.totalAssets)}
          badge="live"
          badgeText={state.closed ? copy.closedBadge(closedDay) : undefined}
          label={mapLabel}
        />

        <div className="intro enter" style={{ animationDelay: "120ms" }}>
          <h1>{state.closed ? copy.closeTitleClosed : copy.closeTitleOpen}</h1>
          {state.closed && totals && <p>{copy.closeSummary(fmt(totals.wentIn, "auto"), fmt(totals.paid, "auto"), fmt(totals.fees), fmt(state.totalAssets))}</p>}
          {!state.closed && (
            <>
              <p>{copy.closesAt(whenFormat.format(new Date(Number(state.endTime) * 1000)).replace(",", ""))}</p>
              <p>{copy.whatHappensAtClose}</p>
            </>
          )}
        </div>

        {(myShares > 0n || tookAmount !== null) && (
          <div className="share-card enter" style={{ animationDelay: "200ms" }}>
            <div className="share-head">
              <span>{copy.yourShare}</span>
              {tookAmount !== null && (
                <span className="share-tag">
                  <Icon name="check" size={12} />
                  {copy.inYourBalance}
                </span>
              )}
            </div>
            <div className="share-amount">{fmt(tookAmount ?? myWorth)}</div>
            {tookAmount === null && <div className="share-why">{fraction ? copy.shareBecause(fmt(myPut, "auto"), fraction) : copy.shareFromShares}</div>}
          </div>
        )}

        {!state.closed && split.rows.length > 0 && (
          <div className="money-rows enter" style={{ animationDelay: "260ms" }}>
            <p className="eyebrow">{copy.ifClosedNow}</p>
            {split.rows.map((r) => (
              <div key={r.account}>
                <span>{nameOf(r.account as Address)}</span>
                <span>{fmt(r.worth)}</span>
              </div>
            ))}
            {split.rest > 0n && (
              <div>
                <span>{copy.othersAndRounding}</span>
                <span>{fmt(split.rest)}</span>
              </div>
            )}
          </div>
        )}

        {howClosed && <p className="hint enter">{howClosed}</p>}
        {shareNote && <p className="hint">{shareNote}</p>}
      </div>

      <div className="screen-foot enter" style={{ animationDelay: "320ms" }}>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        {tookAmount !== null && coin === null ? (
          <p className="foot-line done-line">
            <svg width="18" height="18" viewBox="0 0 24 24" className="ico check-ico" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {copy.tookLine(fmt(tookAmount))} {others.length ? copy.tookOthers(andList(others)) : ""}
          </p>
        ) : (
          <>
            {result && <NoticeLine notice={result} />}
            {!take.action && !busy && !stuck && <NoticeLine notice={{ tone: "bad", text: copy.nothingToTakeLine, code: ERROR_CODES.NOTHING_TO_TAKE }} />}
            {stuck && !busy ? (
              <button type="button" className="pill-btn" onClick={() => act(stuck, true)}>
                {copy.tryAgain}
              </button>
            ) : (
              take.action && (
                <button type="button" className={`pill-btn${acting === "take" && busy ? " busy" : ""}`} disabled={busy} aria-busy={acting === "take" && busy} onClick={() => act("take", false)}>
                  {takeText}
                </button>
              )
            )}
            {take.action === "exit" && <p className="foot-hint">{waitingPayment ? `${copy.exitWarning} ${copy.exitWithPaymentWaiting}` : copy.exitWarning}</p>}
            {iDecide && !state.closed && !stuck && (
              <button type="button" className={`pill-btn outline${acting === "ask close" && busy ? " busy" : ""}`} disabled={busy} onClick={() => act("ask close", false)}>
                {acting === "ask close" && step === "confirm" ? copy.stepConfirm : acting === "ask close" && step ? copy.asking : copy.askToCloseEarly}
              </button>
            )}
          </>
        )}
        {props.pot.fragment && (
          <button
            type="button"
            className="pill-btn outline"
            onClick={async () => {
              const how = await shareLink(`${location.origin}/#${props.pot.fragment}`, copy.shareText(state.name));
              setShareNote(how === "copied" ? copy.linkCopied : how === "failed" ? copy.copyFailed : null);
            }}
          >
            {copy.shareThePot}
          </button>
        )}
      </div>
    </div>
  );
}
