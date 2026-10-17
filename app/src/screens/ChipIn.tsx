import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion } from "../lib/reduced.ts";
import { isAddressEqual, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import type { StoredAccount } from "../lib/accounts.ts";
import { liveWriteChain } from "../lib/chain.ts";
import { DEPLOYMENT, POTS } from "../lib/deployment.ts";
import type { Person } from "../lib/draft.ts";
import { AppError, describeFailure, SendFailure } from "../lib/errors.ts";
import type { PotEvent } from "../lib/feed.ts";
import { idbWriteStore } from "../lib/idb.ts";
import type { PotLink } from "../lib/invites.ts";
import { amountForField, amountIn, formatAmount } from "../lib/money.ts";
import { MAX_DRAWN_PEOPLE } from "../lib/potmap.ts";
import { NO_DATA, POUR_GAS_HINT, POUR_LABEL, pourData, readPermitTerms, type PermitTerms } from "../lib/pour.ts";
import { linkFor, type StoredPot } from "../lib/potstore.ts";
import { openPot, potFeed, putIn, readPotState, type PotInfo, type PotState } from "../lib/potview.ts";
import { retryStuckWrite, sendWrite, type Step } from "../lib/send.ts";
import { rememberReceipt } from "../lib/receipts.ts";
import { followToFinality, type PendingWrite } from "../lib/writes.ts";
import { requestsFrom, waitingRequests } from "../lib/payout.ts";
import { AskSheet, useAskFlow, WaitingRequests } from "./Ask.tsx";
import { usePayMotion } from "./payMotion.ts";
import { PotMap, type Coin, type Layer, type MapPayee, type MapPerson } from "./PotMap.tsx";
import { WhoControls } from "./WhoControls.tsx";
import { MoneyCards } from "./MoneyCards.tsx";
import { anyPaymentMade } from "../lib/ledger.ts";
import { ContactStore } from "../lib/contacts.ts";
import { ScanStore } from "../lib/discover.ts";
import { matchName, VOICE_CAP, withinVoiceCap, type VoiceCommand } from "../lib/voice.ts";
import { VoiceButton } from "./Voice.tsx";
import { mapLines } from "./mapNames.ts";
import { factsOf } from "./Request.tsx";
import { AmountUnderstood, andList, copyLink, CopyLinkButton, Icon, type Notice, NoticeLine, phoneTimeZone, shareLink, Sheet, STOPPED, useCancellable, useSlowStepLine } from "./ui.tsx";
import { beforePasskey } from "../lib/cancel.ts";
import { checkDailyLimit, spendEnded, spendSent } from "../lib/spending.ts";
import { dateLocale } from "../lib/locale.ts";
import { photoKnownMissing, photoVersion, usePhotosOn } from "./Avatar.tsx";
import { initialsFor, photoUrl } from "../lib/photo.ts";
import { CityShare } from "./CityShare.tsx";
import { fetchCities, keyFromFragment, readCities, type SharedCity } from "../lib/cityShare.ts";

const orList = new Intl.ListFormat(dateLocale(), { style: "long", type: "disjunction" });
const FLIGHT_MS = 900;

/** Whole dollars while a number moves, exact at rest (docs/MOTION.md). */
function useTicker(target: bigint | null, decimals: number): string {
  const [shown, setShown] = useState<{ value: bigint; moving: boolean } | null>(null);
  const from = useRef<bigint | null>(null);
  useEffect(() => {
    if (target === null) return;
    const start = from.current;
    from.current = target;
    if (start === null || start === target || prefersReducedMotion()) {
      setShown({ value: target, moving: false });
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 750);
      const eased = BigInt(Math.round((1 - (1 - p) ** 3) * 1000));
      setShown({ value: start + ((target - start) * eased) / 1000n, moving: p < 1 });
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  if (!shown) return "";
  return formatAmount(shown.value, decimals, shown.moving ? "whole" : "auto");
}

type Who = { account: Address; name: string; city: string; timeZone: string; me: boolean };

/** Pour in your share (docs/design/Live-ChipIn.dc.html). */
export function ChipInScreen(props: {
  account: StoredAccount;
  pot: StoredPot;
  banner: ReactNode;
  onName: (name: string) => void;
  onOpenRequest: (proposalId: bigint) => void;
  onOpenStory: () => void;
  onOpenClose: () => void;
  onClose: () => void;
  /** Takes the pot off Home on this phone. It can't be deleted: it lives on the chain. */
  onHide: (name: string) => void;
}) {
  const { account } = props;
  const me = account.address;
  const link = useMemo(() => linkFor(props.pot), [props.pot]);
  const potId = BigInt(props.pot.potId);

  const [info, setInfo] = useState<PotInfo | null>(null);
  const [state, setState] = useState<PotState | null>(null);
  const [events, setEvents] = useState<PotEvent[]>([]);
  const [complete, setComplete] = useState(false);
  const [failure, setFailure] = useState<Notice | null>(link ? null : { tone: "bad", text: copy.errLinkDamaged, code: ERROR_CODES.LINK_DAMAGED });
  const [amount, setAmount] = useState<bigint | null>(null);
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [myCoin, setMyCoin] = useState<Coin["at"] | null>(null);
  const [theirCoins, setTheirCoins] = useState<Record<number, Coin["at"]>>({});
  const [done, setDone] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [result, setResult] = useState<Notice | null>(null);
  const [slosh, setSlosh] = useState(0);
  const [announce, setAnnounce] = useState("");
  const [exact, setExact] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  // What voice filled in (screens/Voice.tsx): never more than $200, and the fingerprint still follows.
  const [voice, setVoice] = useState<{ heard: string; amount: bigint } | null>(null);
  const [voiceNote, setVoiceNote] = useState<Notice | null>(null);
  const alive = useRef(true);
  const running = useCancellable();
  const myTx = useRef<Hex | null>(null);
  const { motion, run } = usePayMotion();
  // The feed's handler reads the numbers on screen without restarting the feed when they change.
  const stateRef = useRef<PotState | null>(null);
  stateRef.current = state;
  const askFlow = useAskFlow(me, potId, props.onOpenRequest);
  const photosOn = usePhotosOn();
  // Where people are, shared with this pot only (lib/cityShare.ts): read with the link's key, none without a link.
  const [sharedCities, setSharedCities] = useState<Record<string, SharedCity>>({});
  const [citiesOn, setCitiesOn] = useState(false);
  const [cityReads, setCityReads] = useState(0);
  const { fragment } = props.pot;
  useEffect(() => {
    if (!fragment) return;
    let live = true;
    void (async () => {
      const key = await keyFromFragment(fragment);
      const found = await fetchCities(DEPLOYMENT, potId.toString());
      if (!live) return;
      setCitiesOn(found.enabled);
      if (key && found.enabled) {
        const read = await readCities(key, found.entries);
        if (live) setSharedCities(read);
      }
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [fragment, potId, cityReads]);
  const contacts = useMemo(() => new ContactStore(localStorage, DEPLOYMENT, me).list(), [me]);
  // An ask that was in flight when the app was closed opens its sheet again.
  useEffect(() => {
    if (askFlow.resumable) setAskOpen(true);
  }, [askFlow.resumable]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Everyone on the map, in join order: the labelled deciders, then me if I'm not one. */
  const people: Who[] = useMemo(() => {
    if (!info) return [];
    const labelled: Person[] = info.labelsOk
      ? info.people
      : (state?.deciders ?? []).map((a) => ({ account: a, name: copy.accountEnding(a), city: "", timeZone: "UTC" }));
    const list: Who[] = labelled.map((p) => ({ account: p.account, name: p.name, city: sharedCities[p.account.toLowerCase()]?.city ?? p.city, timeZone: p.timeZone, me: isAddressEqual(p.account, me) }));
    if (!list.some((p) => p.me)) list.push({ account: me, name: copy.youCap, city: "", timeZone: phoneTimeZone(), me: true });
    return list;
  }, [info, state?.deciders, me, sharedCities]);

  const accounts = useMemo(() => people.map((p) => p.account), [people]);

  // Home lists the pot by the name it has on chain.
  const { onName } = props;
  const seenName = state?.name;
  useEffect(() => {
    if (seenName && seenName !== props.pot.name) onName(seenName);
  }, [seenName, props.pot.name, onName]);

  const read = useCallback(() => readPotState(potId, accounts.length ? accounts : [me], me), [potId, accounts, me]);

  // Open the pot: check the link against its PotCreated event, then read its numbers.
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

  const refresh = useCallback(async () => {
    try {
      const s = await read();
      if (alive.current) setState(s);
      return s;
    } catch {
      if (alive.current && !state) setFailure({ tone: "bad", text: copy.errPotUnreachable });
      return null;
    }
  }, [read, state]);

  useEffect(() => {
    if (info) void refresh();
    // Only when the pot (and so the list of people) is known.
  }, [info, accounts.length]);

  // The stepper starts at my suggested share, signed with the names; else a round amount I can afford.
  useEffect(() => {
    if (!state || !info || amount !== null) return;
    const unit = 10n ** BigInt(state.decimals);
    const suggested = info.shares.find((s) => isAddressEqual(s.account, me))?.amount;
    const fallback = state.myBalance >= 100n * unit || state.myBalance < 10n * unit ? 100n * unit : (state.myBalance / (10n * unit)) * 10n * unit;
    setAmount(suggested && suggested > 0n ? suggested : fallback);
  }, [state, info, amount, me]);

  const indexOf = useCallback((who: string) => people.findIndex((p) => p.account.toLowerCase() === who.toLowerCase()), [people]);

  /** Someone else's money, final: their coin flies in, then the numbers land and their layer rises. */
  const landTheirs = useCallback(
    async (fresh: PotEvent[]) => {
      const funded = fresh.filter((e) => e.name === "Funded" && e.tx !== myTx.current);
      const asked = fresh.filter((e) => e.name === "Proposed" && Number(e.args.kind) === 0).at(-1);
      const shown = stateRef.current;
      if (asked && shown) {
        const who = people[indexOf(String(asked.args.proposer))]?.name ?? copy.someoneElse;
        const payee = shown.payees[Number(asked.args.destIndex)]?.name ?? "";
        setAnnounce(copy.paymentAskedAnnounce(who, formatAmount(asked.args.amount as bigint, shown.decimals, "auto"), payee));
      }
      const changes = fresh.filter((e) => e.tx !== myTx.current && ["Funded", "Exited", "Claimed", "PayoutExecuted", "Closed", "Frozen", "Unfrozen"].includes(e.name));
      if (changes.length === 0) return;
      const next = await read().catch(() => null);
      if (!next || !alive.current) return;
      // A payment made, final: the pot tips, a stream runs to the payee, every layer drains.
      const payout = changes.filter((e) => e.name === "PayoutExecuted").at(-1);
      if (payout) {
        const payee = Number(payout.args.destIndex);
        run(
          payee,
          () => alive.current && setState(next),
          () => {
            if (!alive.current) return;
            const fmt = (v: bigint) => formatAmount(v, next.decimals, "auto");
            setAnnounce(copy.paidLine(fmt(payout.args.amount as bigint), next.payees[payee]?.name ?? "", formatAmount(next.totalAssets, next.decimals, "cents")));
          },
        );
        return;
      }
      const flying = funded.map((e) => indexOf(String(e.args.funder))).filter((i) => i >= 0 && i < MAX_DRAWN_PEOPLE);
      const settle = () => {
        if (!alive.current) return;
        setState(next);
        setTheirCoins({});
        if (funded.length) setSlosh((n) => n + 1);
        const last = funded.at(-1);
        if (last) {
          const who = people[indexOf(String(last.args.funder))]?.name ?? copy.someoneElse;
          setAnnounce(copy.addedAnnounce(who, formatAmount(last.args.assets as bigint, next.decimals, "auto"), formatAmount(next.totalAssets, next.decimals, "auto")));
        }
      };
      if (flying.length === 0 || prefersReducedMotion()) {
        settle();
        return;
      }
      setTheirCoins(Object.fromEntries(flying.map((i) => [i, "start"])));
      requestAnimationFrame(() => requestAnimationFrame(() => setTheirCoins(Object.fromEntries(flying.map((i) => [i, "end"])))));
      setTimeout(settle, FLIGHT_MS);
    },
    [read, indexOf, people, run],
  );

  // One event feed for this pot, from its creation block, up to finalized.
  useEffect(() => {
    if (!info) return;
    const feed = potFeed(info.potId, info.block);
    feed.start((all, fresh, progress) => {
      if (!alive.current) return;
      setEvents(all);
      setComplete(progress.complete);
      if (fresh.length) void landTheirs(fresh);
    });
    return () => feed.stop();
  }, [info, landTheirs]);

  /** My own pour, followed to the finalized receipt. The coin waits at the rim until then. */
  const land = useCallback(
    async (write: PendingWrite) => {
      setStep("landing");
      myTx.current = write.hash;
      setMyCoin((c) => c ?? "hold");
      const flyBack = (notice: Notice) => {
        if (!alive.current) return;
        setStep(null);
        setMyCoin("back");
        setTimeout(() => alive.current && setMyCoin(null), FLIGHT_MS);
        setResult(notice);
      };
      try {
        const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
        spendEnded(me, write, outcome.kind);
        if (outcome.kind === "final") {
          rememberReceipt(write.address, write.hash);
          const next = await read();
          if (!alive.current) return;
          setMyCoin("end");
          setTimeout(() => {
            if (!alive.current) return;
            setMyCoin(null);
            setState(next);
            setSlosh((n) => n + 1);
            setStep(null);
            setStuck(false);
            setDone(true);
            setAnnounce(copy.addedAnnounce(copy.youCap, formatAmount(amount ?? 0n, next.decimals, "auto"), formatAmount(next.totalAssets, next.decimals, "auto")));
          }, 150);
        } else if (outcome.kind === "reverted") flyBack({ tone: "bad", text: copy.pourDidNotGoThrough, code: ERROR_CODES.REVERTED });
        else if (outcome.kind === "superseded") flyBack({ tone: "bad", text: copy.pourDidNotGoThrough, code: ERROR_CODES.SUPERSEDED });
        else if (alive.current) {
          setStep(null);
          setStuck(true);
          setResult({ tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
        }
      } catch (e) {
        if (!alive.current) return;
        setStep(null);
        setResult({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
      }
    },
    [read, amount],
  );

  // Resume a pour that was in flight when the app was closed.
  useEffect(() => {
    void idbWriteStore.get(me).then((w) => {
      if (!w || w.label !== `${POUR_LABEL} ${potId}` || !alive.current) return;
      if (w.replaceable) {
        setStuck(true);
        setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
      } else void land(w);
    });
  }, [me, potId, land]);

  const pour = async (retry: boolean) => {
    if (!state || amount === null) return;
    setResult(null);
    setShareNote(null);
    // The daily limit counts chipping in (lib/limits.ts). Nothing is signed if it would pass it.
    if (!retry) {
      try {
        checkDailyLimit(me, amount);
        // An amount voice filled in is at most $200, even if changed afterwards (lib/voice.ts).
        if (voice && amount > VOICE_CAP) throw new AppError(copy.errVoiceCap, ERROR_CODES.VOICE_OVER_CAP);
      } catch (e) {
        setResult({ tone: "bad", ...(e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e)) });
        return;
      }
    }
    const run = running.start();
    // Read with the nonce and fees (sendCore.ts), and used inside the passkey session.
    let terms: PermitTerms | undefined;
    try {
      setStep("preparing");
      const call = {
        from: me,
        to: POTS,
        data: NO_DATA,
        label: `${POUR_LABEL} ${potId}`,
        signal: run.signal,
        onStep: run.track((s: Step) => {
          setStep(s);
          // The flight starts once the fingerprint has signed, and holds at the rim until final.
          if (s === "sending") {
            setMyCoin("start");
            requestAnimationFrame(() => requestAnimationFrame(() => setMyCoin("hold")));
          }
        }),
        presign: {
          gasHint: POUR_GAS_HINT,
          ready: async () => {
            terms = await readPermitTerms(state.asset, me, BigInt(Math.floor(Date.now() / 1000)));
          },
          build: (signer: Parameters<typeof pourData>[0]) => pourData(signer, POTS, potId, amount, terms!),
        },
      };
      const write = retry ? await retryStuckWrite(call) : await sendWrite(call);
      spendSent(me, write, "pour", amount, potId);
      await land(write);
    } catch (e) {
      // Stopped by X: the screen already says so.
      if (run.signal.aborted) return;
      setStep(null);
      if (myCoin !== null) setMyCoin("back");
      setTimeout(() => alive.current && setMyCoin(null), FLIGHT_MS);
      setResult({ tone: "bad", ...describeFailure(e) });
    }
  };

  const decimals = state?.decimals ?? 6;
  const potText = useTicker(state?.totalAssets ?? null, decimals);
  const slowLine = useSlowStepLine(step);

  // X before the passkey stops the pour and stays, saying nothing was sent; otherwise it closes.
  const closeOrStop = () => {
    if (!beforePasskey(step)) return props.onClose();
    if (running.cancel()) {
      setStep(null);
      setResult(STOPPED);
    }
  };

  const close = (
    <div className="bar">
      <button type="button" className="icon-btn" aria-label={copy.close} onClick={closeOrStop}>
        <Icon name="close" size={22} />
      </button>
      <div className="bar-title">{state?.name ?? props.pot.name}</div>
      {props.pot.fragment && link && info ? (
        <button
          type="button"
          className="icon-btn"
          aria-label={copy.shareInviteLink}
          onClick={async () => {
            const how = await shareLink(`${location.origin}/#${props.pot.fragment}`, copy.shareText(state?.name ?? props.pot.name));
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

  if (failure || !info || !state || amount === null) {
    return (
      <div className="screen">
        {close}
        {props.banner}
        <div className="screen-body">
          {failure ? <NoticeLine notice={failure} /> : <p className="lede">{copy.openingPot}</p>}
        </div>
      </div>
    );
  }

  const unit = 10n ** BigInt(decimals);
  const stepSize = 10n * unit;
  const fmt = (v: bigint, style: "auto" | "cents" = "auto") => formatAmount(v, decimals, style);
  const totals = putIn(events);
  const caps = state.payees.reduce((sum, p) => sum + p.cap, 0n);
  const fraction = (v: bigint) => (caps > 0n ? Number((v * 10_000n) / caps) / 10_000 : 0);
  const busy = step !== null;
  const tooMuch = amount > state.myBalance;
  const blocked = state.closed || state.frozen;
  const creator = info.labelsOk ? info.people.find((p) => isAddressEqual(p.account, info.creator)) : undefined;
  const iAmCreator = isAddressEqual(info.creator, me);

  // Layers, bottom first, in join order: what each person could take out now.
  const known = people.map((p) => state.held[p.account.toLowerCase()] ?? 0n);
  const knownSum = known.reduce((a, b) => a + b, 0n);
  const layers: Layer[] = people.map((_, i) => ({ person: i < MAX_DRAWN_PEOPLE ? i : null, fraction: fraction(known[i]!) }));
  if (state.totalAssets > knownSum) layers.push({ person: null, fraction: fraction(state.totalAssets - knownSum) });

  const face = (p: Who) =>
    photosOn ? { face: { photo: photoKnownMissing(p.account) ? null : photoUrl(p.account, photoVersion(p.account)), initials: initialsFor(p.name, p.account) } } : {};
  const mapPeople: MapPerson[] = people.map((p, i) => {
    // Until the whole history is read, whether someone is in comes from what they hold now, and no total is shown.
    const holds = (state.held[p.account.toLowerCase()] ?? 0n) > 0n;
    const inPot = complete ? (totals[p.account.toLowerCase()] ?? 0n) > 0n && holds : holds;
    const named = info.labelsOk;
    if (p.me) {
      const poured = inPot || done;
      return {
        name: p.name,
        ...face(p),
        ...mapLines(p, named, copy.youCap, ""),
        subStrong: true,
        ring: poured ? "solid" : "dashed",
        check: poured,
        ping: !poured && !busy,
        route: poured ? "solid" : myCoin ? "none" : "march",
      };
    }
    const put = fmt(totals[p.account.toLowerCase()] ?? 0n);
    return {
      name: p.name,
      ...face(p),
      ...mapLines(
        p,
        named,
        inPot ? (complete ? copy.personPutIn(p.name, put) : p.name) : copy.personNotYet(p.name),
        inPot ? (complete ? put : "") : copy.notYet2,
      ),
      ring: inPot ? "solid" : "pencil",
      dim: !inPot,
      check: inPot && theirCoins[i] === undefined,
      route: inPot || theirCoins[i] !== undefined ? "solid" : "pencil",
    };
  });
  const myIndex = people.findIndex((p) => p.me);
  const coins: Coin[] = [
    ...(myCoin && myIndex < MAX_DRAWN_PEOPLE ? [{ person: myIndex, to: "pot" as const, at: myCoin, label: `+${fmt(amount)}` }] : []),
    ...Object.entries(theirCoins).map(([i, at]) => ({ person: Number(i), to: "pot" as const, at })),
  ];
  const mapLabel = [
    copy.mapHolds(fmt(state.totalAssets)),
    ...people
      .filter((p) => !p.me)
      .map((p) => {
        const put = totals[p.account.toLowerCase()] ?? 0n;
        if (!complete) return copy.mapHoldsShare(p.name, p.city);
        return put > 0n ? copy.mapPutIn(p.name, fmt(put), p.city) : copy.mapNotYet(p.name, p.city);
      }),
  ].join(" ");
  const others = people.filter((p) => !p.me).map((p) => p.name);
  const facts = factsOf(state);
  const waiting = waitingRequests(requestsFrom(events), state.now);
  const askedFor = new Map(waiting.filter((r) => r.kind === 0).map((r) => [r.payee, r.amount]));
  const iDecide = state.deciders.some((a) => isAddressEqual(a, me));
  const mapPayees: MapPayee[] = state.payees.map((p, i) => {
    if (motion.payee === i) return { name: p.name, sub: copy.payeeSubPaid(fmt(p.spent)), state: motion.arrived ? "paid" : "paying" };
    const ask = askedFor.get(i);
    if (ask !== undefined) return { name: p.name, sub: copy.payeeSubAsked(fmt(ask)), state: "asked" };
    return { name: p.name, sub: copy.upTo(fmt(p.cap)) };
  });
  const nameOf = (a: Address) => people.find((p) => isAddressEqual(p.account, a))?.name ?? copy.accountEnding(a);

  const pourLabel =
    step === "confirm"
      ? copy.stepConfirm
      : step === "preparing"
        ? copy.stepPreparing
        : step === "getting-ready"
          ? copy.stepGettingReady
          : step
            ? copy.pouringIn
            : copy.pourIn(fmt(amount));

  return (
    <div className="screen">
      {close}
      {props.banner}
      <div className="screen-body">
        <PotMap
          people={mapPeople}
          payees={mapPayees}
          // The fingerprint icon breathes while the phone asks for it.
          outsideLoop={step === "confirm"}
          payeeRoutes="dotted"
          lid="shut"
          lock={false}
          layers={layers}
          coins={coins}
          sloshKey={slosh}
          potText={potText}
          badge="live"
          label={mapLabel}
          tilt={motion.tilt}
          draining={motion.draining}
          stream={motion.stream}
        />

        <div className="intro enter" style={{ animationDelay: "120ms" }}>
          <h1>{copy.addYourShare}</h1>
          <p>
            {iAmCreator ? copy.yourOwnPot(state.name) : creator ? copy.invitedYou(creator.name, state.name) : copy.invitedToPot(state.name)}
          </p>
        </div>

        {!busy && !done && !blocked && (
          <VoiceButton
            account={me}
            mode="put"
            onStart={() => setVoiceNote(null)}
            onCommand={(cmd: VoiceCommand, heard: string) => {
              if (cmd.kind !== "put") return;
              setVoiceNote(null);
              // Only pots this account is already in: this one if it is in it, the others from Home's list.
              const amIn = iDecide || state.payees.some((p) => isAddressEqual(p.to, me)) || (state.held[me.toLowerCase()] ?? 0n) > 0n;
              const others = new ScanStore(localStorage, DEPLOYMENT, me).load().found.filter((p) => p.potId !== potId.toString());
              const options = [...(amIn ? [{ name: state.name, potId: potId.toString() }] : []), ...others.map((p) => ({ name: p.name, potId: p.potId }))];
              const found = matchName(cmd.pot, options);
              if (!found.length) return setVoiceNote({ tone: "bad", text: copy.voiceNoSuchPot(cmd.pot) });
              if (found[0]!.potId !== potId.toString()) return setVoiceNote({ tone: "bad", text: copy.voiceOtherPot(found[0]!.name) });
              if (!withinVoiceCap(cmd.amount)) return setVoiceNote({ tone: "bad", text: copy.errVoiceCap, code: ERROR_CODES.VOICE_OVER_CAP });
              setAmount(cmd.amount);
              setVoice({ heard, amount: cmd.amount });
            }}
          />
        )}
        {voiceNote && <NoticeLine notice={voiceNote} />}
        {voice && amount !== null && !done && <p className="hint voice-heard">{copy.voiceReadBackPot(fmt(amount), state.name, voice.heard)}</p>}
        <div className="stepper-card enter" style={{ animationDelay: "220ms" }}>
          <button type="button" className="step-btn" aria-label={copy.less} disabled={busy || done || amount <= unit}
            onClick={() => setAmount((a) => (a === null ? a : a - stepSize >= unit ? a - stepSize : unit))}>
            <svg width="22" height="22" viewBox="0 0 24 24" className="ico" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
          <button type="button" className={`step-amount${fmt(amount).length > 6 ? " long" : ""}`} disabled={busy || done} onClick={() => setExact(true)} aria-label={copy.exactAmount}>
            {fmt(amount)}
          </button>
          <button type="button" className="step-btn" aria-label={copy.more} disabled={busy || done} onClick={() => setAmount((a) => (a === null ? a : a + stepSize))}>
            <svg width="22" height="22" viewBox="0 0 24 24" className="ico" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
          </button>
        </div>

        <div className="chips enter" style={{ animationDelay: "300ms" }}>
          <span className="chip">{copy.chipPoursOnlyTo(orList.format(state.payees.map((p) => p.name)))}</span>
          <span className="chip">{copy.chipRule(state.threshold, state.deciders.length)}</span>
          <span className="chip">{copy.chipLeftover}</span>
        </div>
        <WhoControls state={state} maker={info.creator} me={me} labels={info.labelsOk ? info.people : []} contacts={contacts} />
        {!info.labelsOk && <p className="hint">{copy.namesUnchecked}</p>}
        {citiesOn && props.pot.fragment && (
          <CityShare
            account={me}
            potId={potId.toString()}
            fragment={props.pot.fragment}
            offer={done || iDecide || state.payees.some((p) => isAddressEqual(p.to, me)) || (state.held[me.toLowerCase()] ?? 0n) > 0n}
            onChanged={() => setCityReads((n) => n + 1)}
          />
        )}
        <WaitingRequests requests={waiting} facts={facts} nameOf={nameOf} me={me} onOpen={props.onOpenRequest} />
        {iDecide && !blocked && (
          <button type="button" className="pill-btn outline enter" style={{ animationDelay: "340ms" }} onClick={() => setAskOpen(true)}>
            {copy.askForPayment}
          </button>
        )}
        <MoneyCards
          events={events}
          complete={complete}
          decimals={decimals}
          held={state.held}
          payeeNames={state.payees.map((p) => p.name)}
          me={me}
          nameOf={nameOf}
          onStale={() => void refresh()}
        />
        <div className="foot-row">
          <button type="button" className="text-btn story-link" onClick={props.onOpenStory}>
            {copy.openStory}
          </button>
          <button type="button" className="text-btn story-link" onClick={props.onOpenClose}>
            {state.closed ? copy.seeTheSplit : copy.closeAndSplit}
          </button>
        </div>
        <button type="button" className="text-btn hide-pot" onClick={() => props.onHide(state.name)}>
          {copy.hideFromHome}
        </button>
        {props.pot.fragment && link && (
          <CopyLinkButton
            onCopy={async () => {
              const how = await copyLink(`${location.origin}/#${props.pot.fragment}`);
              setShareNote(how === "failed" ? copy.copyFailed : null);
              return how;
            }}
          />
        )}
        {shareNote && <p className="hint">{shareNote}</p>}
      </div>

      <div className="screen-foot enter" style={{ animationDelay: "380ms" }}>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        {done ? (
          <>
            <p className="foot-line done-line">
              <svg width="18" height="18" viewBox="0 0 24 24" className="ico check-ico" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
              {others.length ? copy.pouredIn(andList(others)) : copy.pouredInAlone}
            </p>
            <button type="button" className="pill-btn" onClick={props.onClose}>
              {copy.done}
            </button>
          </>
        ) : (
          <>
            {result && <NoticeLine notice={result} />}
            {blocked && <p className="foot-hint">{state.closed ? copy.potClosedNote : copy.potPausedNote}</p>}
            {!blocked && complete && anyPaymentMade(events) && <p className="foot-hint">{copy.paymentsAlreadyMade}</p>}
            {slowLine && (
              <p className="foot-hint" role="status">
                {slowLine}
              </p>
            )}
            {stuck && !busy ? (
              <button type="button" className="pill-btn" onClick={() => pour(true)}>
                {copy.tryAgain}
              </button>
            ) : (
              <button type="button" className={`pill-btn${busy ? " busy" : ""}`} disabled={busy || tooMuch || blocked} aria-busy={busy} onClick={() => pour(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" className={`ico${step === "confirm" ? " breathe" : ""}`} aria-hidden="true">
                  <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
                  <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
                  <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
                  <path d="M2 12a10 10 0 0 1 18-6" />
                  <path d="M2 16h.01" />
                  <path d="M21.8 16c.2-2 .131-5.354 0-6" />
                  <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
                  <path d="M8.65 22c.21-.66.45-1.32.57-2" />
                  <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
                </svg>
                {pourLabel}
              </button>
            )}
            <p className="foot-hint">
              {tooMuch
                ? copy.moreThanBalance(fmt(state.myBalance, "cents"))
                : `${copy.fromYourBalance(fmt(state.myBalance, "cents"))} ${DEPLOYMENT === "ausd" ? copy.dollarsLine : copy.testDollarsLine}`}
            </p>
          </>
        )}
      </div>

      {askOpen && <AskSheet me={me} facts={facts} flow={askFlow} onClose={() => setAskOpen(false)} />}

      {exact && (
        <ExactSheet
          decimals={decimals}
          value={amount}
          onSave={(v) => setAmount(v)}
          onClose={() => setExact(false)}
        />
      )}
    </div>
  );
}

function ExactSheet(props: { decimals: number; value: bigint; onSave: (v: bigint) => void; onClose: () => void }) {
  const [text, setText] = useState(amountForField(props.value, props.decimals));
  const v = amountIn(text, props.decimals);
  const ok = v !== null && v > 0n;
  return (
    <Sheet title={copy.exactAmount} onClose={props.onClose}>
      <label className="field">
        <span>{copy.exactAmount}</span>
        <input value={text} inputMode="decimal" autoFocus onChange={(e) => setText(e.target.value)} />
      </label>
      <AmountUnderstood text={text} decimals={props.decimals} />
      {text.trim() && !ok && <p className="error">{copy.limitInvalid}</p>}
      <button
        type="button"
        className="btn primary"
        disabled={!ok}
        onClick={() => {
          if (v !== null) props.onSave(v);
          props.onClose();
        }}
      >
        {copy.done}
      </button>
    </Sheet>
  );
}
