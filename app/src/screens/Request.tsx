import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isAddressEqual, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import type { StoredAccount } from "../lib/accounts.ts";
import { liveWriteChain } from "../lib/chain.ts";
import { POTS } from "../lib/deployment.ts";
import type { Person } from "../lib/draft.ts";
import { AppError, describeFailure, SendFailure } from "../lib/errors.ts";
import { idbWriteStore } from "../lib/idb.ts";
import { linkUrl, type PotLink } from "../lib/invites.ts";
import { formatAmount } from "../lib/money.ts";
import { askedAt, isExpired, localTime, requestView, takeBackLabel, ttlDays, yesLabel, type PotFacts } from "../lib/payout.ts";
import { readFeeTerms, readRequest, refusalOf, takeBackCall, takeBackData, yesCall, yesData, type FeeTerms, type ReadRequest } from "../lib/payoutLive.ts";
import { MAX_DRAWN_PEOPLE, PERSON_COLORS } from "../lib/potmap.ts";
import { linkFor, type StoredPot } from "../lib/potstore.ts";
import { openPot, potFeed, readPotState, type PotInfo, type PotState } from "../lib/potview.ts";
import { rememberReceipt } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { retryStuckWrite, sendWrite, type Step } from "../lib/send.ts";
import { followToFinality, type PendingWrite } from "../lib/writes.ts";
import { usePayMotion } from "./payMotion.ts";
import { PotMap, type Layer, type MapPayee, type MapPerson } from "./PotMap.tsx";
import { andList, Icon, NoticeLine, phoneTimeZone, shareLink, type Notice } from "./ui.tsx";

type Action = "yes" | "take back";
type Who = Person & { me: boolean };

/** The pot's numbers in the shape the payment rules read. */
export function factsOf(state: PotState): PotFacts {
  return {
    closed: state.closed,
    frozen: state.frozen,
    totalAssets: state.totalAssets,
    threshold: state.threshold,
    deciders: state.deciders,
    payees: state.payees.map((p) => ({ name: p.name, cap: p.cap, spent: p.spent })),
    decimals: state.decimals,
  };
}

/** Everyone on the map in join order: the labelled people, or the deciders by the end of their account. */
export function peopleOf(info: PotInfo, state: PotState, me: Address): Who[] {
  const labelled: Person[] = info.labelsOk
    ? info.people
    : state.deciders.map((a) => ({ account: a, name: copy.accountEnding(a), city: "", timeZone: "" }));
  const list = labelled.map((p) => ({ ...p, me: isAddressEqual(p.account, me) }));
  if (!list.some((p) => p.me)) list.push({ account: me, name: copy.youCap, city: "", timeZone: "", me: true });
  return list;
}

/** Layers, bottom first, in join order: what each person could take out now. */
export function layersOf(people: Who[], state: PotState): Layer[] {
  const caps = state.payees.reduce((sum, p) => sum + p.cap, 0n);
  const fraction = (v: bigint) => (caps > 0n ? Number((v * 10_000n) / caps) / 10_000 : 0);
  const known = people.map((p) => state.held[p.account.toLowerCase()] ?? 0n);
  const knownSum = known.reduce((a, b) => a + b, 0n);
  const layers: Layer[] = people.map((_, i) => ({ person: i < MAX_DRAWN_PEOPLE ? i : null, fraction: fraction(known[i]!) }));
  if (state.totalAssets > knownSum) layers.push({ person: null, fraction: fraction(state.totalAssets - knownSum) });
  return layers;
}

/** A payment request: say yes, take a yes back, or follow it (docs/design/Live-Approve.dc.html). */
export function RequestScreen(props: {
  account: StoredAccount;
  pot: StoredPot;
  proposalId: bigint;
  banner: ReactNode;
  onClose: () => void;
  /** Close and split, once a request to close early is agreed. */
  onOpenClose?: () => void;
}) {
  const me = props.account.address;
  const { proposalId } = props;
  const link = useMemo(() => linkFor(props.pot), [props.pot]);
  const potId = BigInt(props.pot.potId);

  const [info, setInfo] = useState<PotInfo | null>(null);
  const [state, setState] = useState<PotState | null>(null);
  const [req, setReq] = useState<ReadRequest | null>(null);
  const [terms, setTerms] = useState<FeeTerms | null>(null);
  const [failure, setFailure] = useState<Notice | null>(link ? null : { tone: "bad", text: copy.errLinkDamaged, code: ERROR_CODES.LINK_DAMAGED });
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [acting, setActing] = useState<Action | null>(null);
  const [stuck, setStuck] = useState<Action | null>(null);
  const [result, setResult] = useState<Notice | null>(null);
  const [paidNow, setPaidNow] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { motion, run } = usePayMotion();
  const alive = useRef(true);
  const myTx = useRef<Hex | null>(null);

  useEffect(() => {
    alive.current = true;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!link) return;
    let live = true;
    Promise.all([openPot(link as PotLink), readFeeTerms(readClient, POTS)])
      .then(([i, t]) => {
        if (!live) return;
        setInfo(i);
        setTerms(t);
      })
      .catch((e) => live && setFailure(e instanceof AppError ? { tone: "bad", text: e.message, code: e.code } : { tone: "bad", text: copy.errPotUnreachable }));
    return () => {
      live = false;
    };
  }, [link]);

  /** The pot and the request, both at the finalized block. */
  const read = useCallback(async () => {
    const r = await readRequest(readClient, POTS, potId, proposalId, me);
    const accounts = info?.labelsOk ? info.people.map((p) => p.account) : [];
    let s = await readPotState(potId, [...accounts, me], me);
    // Without names the deciders are only known from this read: read their shares too.
    if (!info?.labelsOk && s.deciders.some((a) => s.held[a.toLowerCase()] === undefined)) s = await readPotState(potId, [...s.deciders, me], me);
    return { r, s };
  }, [potId, proposalId, me, info]);

  const refresh = useCallback(async () => {
    try {
      const { r, s } = await read();
      if (!alive.current) return null;
      setReq(r);
      setState(s);
      return { r, s };
    } catch (e) {
      if (!alive.current) return null;
      if (e instanceof AppError) setFailure({ tone: "bad", text: e.message, code: e.code });
      else if (!req) setFailure({ tone: "bad", text: copy.errPotUnreachable });
      return null;
    }
  }, [read, req]);

  useEffect(() => {
    if (info) void refresh();
    // Once, when the pot is open; after that the feed and our own requests refresh.
  }, [info]);

  const payeeName = (s: PotState | null, r: ReadRequest | null) => (s && r ? (s.payees[r.request.payee]?.name ?? copy.accountEnding(r.request.asker)) : "");

  /** The payment is final: tip, stream, drain and check, with the new numbers landing as the stream leaves. */
  const showPaid = useCallback(
    (next: { r: ReadRequest; s: PotState }) => {
      const name = next.s.payees[next.r.request.payee]?.name ?? "";
      // Who said yes shows at once; the money lands as the stream leaves.
      setReq(next.r);
      run(
        next.r.request.payee,
        () => {
          if (!alive.current) return;
          setState(next.s);
          setReq(next.r);
        },
        () => {
          if (!alive.current) return;
          setPaidNow(true);
          const total = formatAmount(next.s.totalAssets, next.s.decimals, "cents");
          setAnnounce(copy.paidLine(formatAmount(next.r.request.amount, next.s.decimals, "auto"), name, total));
        },
      );
    },
    [run],
  );

  // Someone else's yes, a take back, a withdrawal or a payment: read again, and if it paid, show it.
  useEffect(() => {
    if (!info) return;
    const feed = potFeed(info.potId, info.block);
    feed.start((_, fresh) => {
      if (!alive.current || fresh.length === 0) return;
      const theirs = fresh.filter((e) => e.tx !== myTx.current);
      if (theirs.length === 0) return;
      const paid = theirs.some((e) => e.name === "PayoutExecuted" && e.args.proposalId === proposalId);
      void read()
        .then((next) => {
          if (!alive.current) return;
          if (paid) showPaid(next);
          else {
            setReq(next.r);
            setState(next.s);
          }
        })
        .catch(() => {});
    });
    return () => feed.stop();
  }, [info, proposalId, read, showPaid]);

  /** My own yes or take back, followed to the finalized receipt. Nothing lands before then. */
  const land = useCallback(
    async (write: PendingWrite, action: Action) => {
      setStep("landing");
      setActing(action);
      myTx.current = write.hash;
      const stop = (notice: Notice) => {
        if (!alive.current) return;
        setStep(null);
        setActing(null);
        setResult(notice);
      };
      try {
        const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
        if (outcome.kind === "final") {
          rememberReceipt(write.address, write.hash);
          setStuck(null);
          const next = await read();
          if (!alive.current) return;
          setStep(null);
          setActing(null);
          if (action === "yes" && next.r.request.status === "paid" && next.r.request.kind === 0) showPaid(next);
          else {
            setReq(next.r);
            setState(next.s);
            setResult({ tone: "ok", text: action === "yes" ? copy.yesCounted : copy.tookBack });
          }
        } else if (outcome.kind === "reverted") stop({ tone: "bad", text: copy.requestDidNotGoThrough, code: ERROR_CODES.REVERTED });
        else if (outcome.kind === "superseded") stop({ tone: "bad", text: copy.requestDidNotGoThrough, code: ERROR_CODES.SUPERSEDED });
        else {
          setStuck(action);
          stop(outcome.refused ? { tone: "bad", text: copy.requestTurnedDown, code: ERROR_CODES.REFUSED } : { tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
        }
      } catch (e) {
        stop({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
      }
    },
    [read, showPaid],
  );

  // A yes or take back that was in flight when the app was closed: follow it again, or offer to retry it.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    void idbWriteStore.get(me).then((w) => {
      if (!w || !alive.current) return;
      const action: Action | null = w.label === yesLabel(proposalId) ? "yes" : w.label === takeBackLabel(proposalId) ? "take back" : null;
      if (!action) return;
      if (w.replaceable) {
        setStuck(action);
        setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
      } else void land(w, action);
    });
  }, [me, proposalId, land]);

  const act = async (action: Action, retry: boolean) => {
    if (!state || !req) return;
    setResult(null);
    setShareNote(null);
    setActing(action);
    try {
      setStep("preparing");
      // Run it as a call first: a refusal costs no gas grant and no passkey prompt.
      const refusal = await refusalOf(readClient, POTS, me, action === "yes" ? yesCall(proposalId) : takeBackCall(proposalId), factsOf(state), req.request);
      if (refusal) throw refusal;
      const call = {
        from: me,
        to: POTS,
        data: action === "yes" ? yesData(proposalId) : takeBackData(proposalId),
        label: action === "yes" ? yesLabel(proposalId) : takeBackLabel(proposalId),
        onStep: setStep,
      };
      const write = retry ? await retryStuckWrite(call) : await sendWrite(call);
      await land(write, action);
    } catch (e) {
      if (!alive.current) return;
      setStep(null);
      setActing(null);
      setResult({ tone: "bad", ...describeFailure(e) });
    }
  };

  const bar = (
    <div className="bar">
      <button type="button" className="icon-btn" aria-label={copy.close} onClick={props.onClose}>
        <Icon name="close" size={22} />
      </button>
      <div className="bar-title">{copy.paymentRequest}</div>
      {info ? (
        <button
          type="button"
          className="icon-btn"
          aria-label={copy.shareRequest}
          onClick={async () => {
            const url = linkUrl(location.origin, { kind: "ask", deployment: props.pot.deployment, potId, block: info.block, proposalId });
            const how = await shareLink(url, copy.paymentRequestShareText(state?.name ?? props.pot.name));
            setShareNote(how === "copied" ? copy.linkCopied : how === "failed" ? copy.copyFailed : null);
          }}
        >
          <Icon name="share" size={20} />
        </button>
      ) : (
        <div className="bar-spacer" />
      )}
    </div>
  );

  if (failure || !info || !state || !req || !terms) {
    return (
      <div className="screen">
        {bar}
        {props.banner}
        <div className="screen-body">{failure ? <NoticeLine notice={failure} /> : <p className="lede">{copy.openingRequest}</p>}</div>
      </div>
    );
  }

  const { request } = req;
  const closing = request.kind === 1;
  const d = state.decimals;
  const fmt = (v: bigint, style: "auto" | "cents" = "auto") => formatAmount(v, d, style);
  const facts = factsOf(state);
  const view = requestView(request, facts, me, req.now);
  const days = ttlDays(terms.ttl);
  const people = peopleOf(info, state, me);
  const payee = state.payees[request.payee];
  const payeeLabel = payeeName(state, req);
  const asker = people.find((p) => isAddressEqual(p.account, request.asker));
  const askerName = asker?.me ? copy.youCap : (asker?.name ?? copy.accountEnding(request.asker));
  const askerZone = asker?.timeZone || phoneTimeZone();
  const busy = step !== null;
  const myFinalYes = acting === "yes" && view.paysOnMyYes && step === "landing";
  const running = motion.payee !== null && !paidNow && motion.payee === request.payee && !motion.arrived;

  const saidYes = (a: Address) => request.yes.some((y) => isAddressEqual(y, a));
  const payeeState: MapPayee["state"] = closing
    ? undefined
    : motion.payee === request.payee
      ? motion.arrived
        ? "paid"
        : "paying"
      : request.status === "paid"
        ? "paid"
        : request.status === "waiting" && !isExpired(request, req.now)
          ? "asked"
          : undefined;
  const mapPayees: MapPayee[] = state.payees.map((p, i) =>
    i === request.payee && !closing
      ? { name: p.name, sub: payeeState === "paid" ? copy.payeeSubPaid(fmt(request.amount)) : payeeState ? copy.payeeSubAsked(fmt(request.amount)) : copy.upTo(fmt(p.cap)), state: payeeState }
      : { name: p.name, sub: copy.upTo(fmt(p.cap)) },
  );
  const mapPeople: MapPerson[] = people.map((p) => {
    const inPot = (state.held[p.account.toLowerCase()] ?? 0n) > 0n;
    const time = p.timeZone ? localTime(now, p.timeZone) : "";
    const isAsker = isAddressEqual(p.account, request.asker);
    return {
      name: p.name,
      city: p.city || (p.me ? copy.youCap : ""),
      sub: isAsker && !p.me ? copy.personAsked(p.name) : time ? copy.personTime(p.me ? copy.youCap : p.name, time) : p.me ? copy.youCap : p.name,
      subStrong: p.me,
      ring: inPot ? "solid" : "pencil",
      dim: !inPot,
      check: saidYes(p.account),
      route: inPot ? "solid" : "pencil",
    };
  });
  const mapLabel = closing
    ? copy.mapHolds(fmt(state.totalAssets))
    : request.status === "paid"
      ? copy.mapPaid(fmt(state.totalAssets), fmt(request.amount), payeeLabel)
      : copy.mapAsked(fmt(state.totalAssets), askerName, fmt(request.amount), payeeLabel);

  // Each decider, in join order: asked, you, said yes, or waiting.
  const deciders = state.deciders.map((a) => {
    const p = people.find((x) => isAddressEqual(x.account, a));
    const index = people.findIndex((x) => isAddressEqual(x.account, a));
    const mine = isAddressEqual(a, me);
    const yes = saidYes(a) || (mine && acting === "yes" && step === "landing");
    const label = isAddressEqual(a, request.asker) ? copy.chipAsked : mine ? copy.youCap : yes ? copy.chipSaidYes : copy.chipWaiting;
    const initial = mine ? copy.youCap.charAt(0) : p && info.labelsOk ? p.name.charAt(0).toUpperCase() : a.slice(-1).toUpperCase();
    return { account: a, initial, index, mine, yes, holding: mine && acting === "yes" && step === "landing", label };
  });

  const otherNames = people.filter((p) => !p.me && !isAddressEqual(p.account, request.asker)).map((p) => p.name);
  const voteText = (() => {
    if (closing) {
      if (request.status === "paid") return copy.closedLine(fmt(state.totalAssets, "cents"));
      if (myFinalYes) return copy.yesClosesNow(request.threshold, state.deciders.length);
      if (view.stage === "said-yes") return copy.yourYesCounts(view.needed);
      return copy.moreYesCloses(Math.max(view.needed, 1));
    }
    if (paidNow || (request.status === "paid" && !running)) return otherNames.length ? copy.paidSeen(andList(otherNames)) : copy.paidAlone;
    if (myFinalYes || running) return copy.yesPaysNow(request.threshold, state.deciders.length, payeeLabel);
    if (view.stage === "said-yes") return copy.yourYesCounts(view.needed);
    return copy.moreYesPays(Math.max(view.needed, 1), payeeLabel);
  })();

  // Why nothing can be done here now, with its code.
  const stateNotice: Notice | null =
    view.stage === "withdrawn"
      ? { tone: "bad", text: copy.requestWithdrawn, code: ERROR_CODES.REQUEST_DECIDED }
      : view.stage === "expired"
        ? { tone: "bad", text: copy.requestExpiredLine(days), code: ERROR_CODES.REQUEST_EXPIRED }
        : view.stage === "stopped"
          ? closing
            ? { tone: "bad", text: copy.errAlreadyClosed, code: ERROR_CODES.POT_ALREADY_CLOSED }
            : { tone: "bad", text: state.closed ? copy.requestClosedLine : copy.requestPausedLine, code: ERROR_CODES.PAY_POT_STOPPED }
          : view.stage === "watching"
            ? { tone: "bad", text: copy.requestWatching, code: ERROR_CODES.NOT_DECIDER }
            : view.stage === "cannot-pay-yet" && view.refusal
              ? {
                  tone: "bad",
                  text:
                    view.refusal.code === ERROR_CODES.PAY_OVER_LIMIT
                      ? copy.cannotPayLimit(payeeLabel, fmt((payee?.cap ?? 0n) - (payee?.spent ?? 0n)))
                      : copy.cannotPayShort(fmt(state.totalAssets, "cents")),
                  code: view.refusal.code,
                }
              : null;

  const yesLabelText =
    acting === "yes" && step === "confirm"
      ? copy.stepConfirm
      : acting === "yes" && step === "preparing"
        ? copy.stepPreparing
        : acting === "yes" && step === "getting-ready"
          ? copy.stepGettingReady
          : acting === "yes" && step
            ? view.paysOnMyYes
              ? closing
                ? copy.closingNow
                : copy.payingNow(payeeLabel)
              : copy.sayingYes
            : view.paysOnMyYes
              ? closing
                ? copy.sayYesAndClose
                : copy.sayYesAndPay(payeeLabel)
              : copy.sayYes;
  const takeBackText = acting === "take back" && step === "confirm" ? copy.stepConfirm : acting === "take back" && step ? copy.takingBack : copy.takeBackYes;
  const finished = paidNow || (request.status === "paid" && !running);
  const doneLine = closing ? copy.closedLine(fmt(state.totalAssets, "cents")) : copy.paidLine(fmt(request.amount), payeeLabel, fmt(state.totalAssets, "cents"));

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
          layers={layersOf(people, state)}
          potText={fmt(state.totalAssets, "auto")}
          badge="live"
          label={mapLabel}
          tilt={motion.tilt}
          draining={motion.draining}
          stream={motion.stream}
        />

        <h1 className="request-title enter" style={{ animationDelay: "120ms" }}>
          {closing
            ? asker?.me
              ? copy.youAskedToClose
              : copy.wantsToClose(askerName)
            : asker?.me
              ? copy.youAskedToPay(fmt(request.amount), payeeLabel)
              : copy.wantsToPay(askerName, fmt(request.amount), payeeLabel)}
        </h1>

        <div className="ask-bubble enter" style={{ animationDelay: "200ms" }}>
          {asker?.city
            ? copy.askedLineIn(askerName, askedAt(request.createdAt, askerZone), asker.city)
            : copy.askedLine(askerName, askedAt(request.createdAt, askerZone))}
        </div>

        {closing ? (
          <div className="money-rows enter" style={{ animationDelay: "280ms" }}>
            <div>
              <span>{copy.leftToShare}</span>
              <strong>{fmt(state.totalAssets, "cents")}</strong>
            </div>
            <p className="hint">{copy.closeRequestLine}</p>
          </div>
        ) : (
        <div className="money-rows enter" style={{ animationDelay: "280ms" }}>
          <div>
            <span>{copy.nivpayFee}</span>
            <span>{fmt(request.fee, "cents")}</span>
          </div>
          <div>
            <span>{request.status === "paid" ? copy.leftInPot : copy.leftInPotAfter}</span>
            <strong>{fmt(view.leftAfter < 0n ? 0n : view.leftAfter, "cents")}</strong>
          </div>
          {payee && (
            <div>
              <span>{copy.payeeLimit(payee.name)}</span>
              <span>{copy.limitOf(fmt(view.limitAfter), fmt(payee.cap))}</span>
            </div>
          )}
        </div>
        )}

        <div className="vote-row enter" style={{ animationDelay: "360ms" }}>
          {deciders.map((v) => (
            <div className="voter" key={v.account}>
              <div
                className={`voter-face${v.yes ? " yes" : ""}${v.mine ? " mine" : ""}${v.holding ? " holding" : ""}`}
                style={{ "--voter": v.index >= 0 && v.index < PERSON_COLORS.length ? PERSON_COLORS[v.index]!.fill : "var(--route-empty)" } as CSSProperties}
              >
                {v.initial}
                <span className={`voter-check${v.yes && !v.holding ? " on" : ""}`}>
                  <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
              </div>
              <span className={`voter-label${v.mine ? " mine" : ""}`}>{v.label}</span>
            </div>
          ))}
          <p className="vote-text">{voteText}</p>
        </div>
        {shareNote && <p className="hint">{shareNote}</p>}
      </div>

      <div className="screen-foot enter" style={{ animationDelay: "420ms" }}>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        {finished ? (
          <>
            <p className="foot-line done-line">
              <svg width="18" height="18" viewBox="0 0 24 24" className="ico check-ico" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              {doneLine}
            </p>
            {closing && props.onOpenClose ? (
              <button type="button" className="pill-btn" onClick={props.onOpenClose}>
                {copy.seeTheSplit}
              </button>
            ) : (
              <button type="button" className="pill-btn" onClick={props.onClose}>
                {copy.done}
              </button>
            )}
          </>
        ) : (
          <>
            {result && <NoticeLine notice={result} />}
            {stateNotice && <NoticeLine notice={stateNotice} />}
            {stuck && !busy ? (
              <button type="button" className="pill-btn" onClick={() => act(stuck, true)}>
                {copy.tryAgain}
              </button>
            ) : view.stage === "can-say-yes" || (acting === "yes" && busy) ? (
              <button type="button" className={`pill-btn${busy ? " busy" : ""}`} disabled={busy || running} aria-busy={busy} onClick={() => act("yes", false)}>
                {yesLabelText}
              </button>
            ) : null}
            {view.canTakeBack && !stuck && !running && (
              <button type="button" className={`pill-btn outline${acting === "take back" && busy ? " busy" : ""}`} disabled={busy} onClick={() => act("take back", false)}>
                {takeBackText}
              </button>
            )}
            <div className="foot-row">
              <button type="button" className="text-btn" onClick={props.onClose}>
                {view.stage === "can-say-yes" ? copy.notYet : copy.close}
              </button>
            </div>
            <p className="foot-hint">{copy.needsYesesWithin(request.threshold, days)}</p>
          </>
        )}
      </div>
    </div>
  );
}
