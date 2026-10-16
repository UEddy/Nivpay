import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { encodeFunctionData, type Address, type Hex, type Log } from "viem";
import { copy, ERROR_CODES, offlineMessage } from "./copy.ts";
import { CredentialStore } from "./lib/credentials.ts";
import { AccountStore, cleanName, NAME_MAX, shownName, type StoredAccount } from "./lib/accounts.ts";
import { ERC20_READ_ABI, TEST_DOLLAR_ABI } from "./lib/abi.ts";
import { liveWriteChain } from "./lib/chain.ts";
import { AUSD, AUSD_FAUCET, CTK, LOG_PAGE_BLOCKS, TESTUSD } from "./lib/config.ts";
import { DEPLOYMENT, POTS, POTS_DEPLOY_BLOCK } from "./lib/deployment.ts";
import { DraftStore, newDraft } from "./lib/draft.ts";
import { findPots, ScanStore, type FoundPot, type Role, type ScanState } from "./lib/discover.ts";
import { askReader, creatorReader, fundingsReader, makerReader, potsReader } from "./lib/discoverLive.ts";
import { FundingsCursor, memberCache, readFundings } from "./lib/fundings.ts";
import { ContactStore, nameOnPhone } from "./lib/contacts.ts";
import { learnPotMakers, PotChoiceStore, PotMakers, sortFound, type HiddenPot, type SortFacts } from "./lib/potSort.ts";
import { REASONS, sendReport, type Reason } from "./lib/report.ts";
import { AskScanStore, findOpenRequests, learnPotBlocks, needingMyYes, PotBlocks, type AskScan } from "./lib/waiting.ts";
import { AppError, describeFailure, SendFailure } from "./lib/errors.ts";
import { openedPotMeta, ROLE_TEXT } from "./lib/potRow.ts";
import { addDollarsField, checkClaim, claimData, cooldownIn, readFaucetTerms, secondsUntil, type FaucetTerms } from "./lib/faucet.ts";
import { idbWriteStore, pendingWriteCount } from "./lib/idb.ts";
import { InvitedStore, matchInvites, type AnsweredInvite } from "./lib/invited.ts";
import { decodeLink, type AskLink, type Invite, type PayLink, type PotLink } from "./lib/invites.ts";
import { amountForField, amountIn, formatAmount } from "./lib/money.ts";
import { hostCheck } from "./lib/passkeyHost.ts";
import { readClient } from "./lib/rpc.ts";
import { prefersReducedMotion } from "./lib/reduced.ts";
import { PotStore, rememberPotLink, type StoredPot } from "./lib/potstore.ts";
import type { Step } from "./lib/send.ts";
import { latestReceipt, receiptUrl, rememberReceipt } from "./lib/receipts.ts";
import { CURRENCY_LABEL } from "./lib/settle.ts";
import { incomingFrom, incomingSource, SEND_LABEL, withFloor } from "./lib/transfer.ts";
import { PotFeed } from "./lib/feed.ts";
import { idbFeedStore } from "./lib/idb.ts";
import { LimitStore, settle } from "./lib/limits.ts";
import { dismiss, fromArrivals, fromPoll, fromRequests, markAllRead, markRead, NotesStore, start as startNotes, unread, withoutRequestsFrom, type Funding, type Note, type NotesState, type PollInputs } from "./lib/notes.ts";
import { MutedStore } from "./lib/inbox.ts";
import { VoiceStore } from "./lib/voice.ts";
import { readInbox } from "./lib/inboxLive.ts";
import { parseGo, type Go } from "./lib/push.ts";
import { syncPush } from "./lib/pushLive.ts";
import { CASHOUT_LABEL } from "./lib/rampDesk.ts";
import { followToFinality, type Outcome, type PendingWrite } from "./lib/writes.ts";
// Every screen but Home loads when it is first opened, and so does the code
// that signs (passkeys, keys, signatures): the first screen stays small.
// A page left open across a deploy can ask for a file the new build no longer
// has; then it reloads once, onto the new build (lib/reloadOnce.ts).
const ChipInScreen = lazy(() => reloadOnce(() => import("./screens/ChipIn.tsx")).then((m) => ({ default: m.ChipInScreen })));
const CreateScreen = lazy(() => reloadOnce(() => import("./screens/Create.tsx")).then((m) => ({ default: m.CreateScreen })));
const JoinScreen = lazy(() => reloadOnce(() => import("./screens/Join.tsx")).then((m) => ({ default: m.JoinScreen })));
const ReceiveScreen = lazy(() => reloadOnce(() => import("./screens/Receive.tsx")).then((m) => ({ default: m.ReceiveScreen })));
const RequestScreen = lazy(() => reloadOnce(() => import("./screens/Request.tsx")).then((m) => ({ default: m.RequestScreen })));
const TimelineScreen = lazy(() => reloadOnce(() => import("./screens/Timeline.tsx")).then((m) => ({ default: m.TimelineScreen })));
const CloseScreen = lazy(() => reloadOnce(() => import("./screens/Close.tsx")).then((m) => ({ default: m.CloseScreen })));
const MoneyScreen = lazy(() => reloadOnce(() => import("./screens/Money.tsx")).then((m) => ({ default: m.MoneyScreen })));
const HelpSheet = lazy(() => reloadOnce(() => import("./screens/Help.tsx")).then((m) => ({ default: m.HelpSheet })));
const NotesSheet = lazy(() => reloadOnce(() => import("./screens/Notes.tsx")).then((m) => ({ default: m.NotesSheet })));
const ProfilePage = lazy(() => reloadOnce(() => import("./screens/Profile.tsx")).then((m) => ({ default: m.ProfilePage })));
const SendScreen = lazy(() => reloadOnce(() => import("./screens/Send.tsx")).then((m) => ({ default: m.SendScreen })));
const passkeys = () => reloadOnce(() => import("./lib/passkey.ts"));
const sending = () => reloadOnce(() => import("./lib/send.ts"));
import { AmountUnderstood, formatDay, Icon, InstallBanner, InstallHow, NameForm, type Notice, NoticeLine, openHelp, phoneTimeZone, Sheet, useInstallWay, useOnline } from "./screens/ui.tsx";
import { balanceNote } from "./lib/connection.ts";
import { LastBalanceStore, SingleRead, SLOW_READ_MS, type Holding } from "./lib/balanceRead.ts";
import { reloadOnce } from "./lib/reloadOnce.ts";
import { LastUsedStore } from "./lib/forget.ts";
import { namesOn, USERNAME_LABEL, usernameOf } from "./lib/names.ts";
import { photosEnabled, photoUrl } from "./lib/photo.ts";
import { dateLocale, LANGS, LANGUAGE_NAMES, language, readPick, type Lang } from "./lib/locale.ts";
import { pickLanguage } from "./i18n/start.ts";

const accounts = new AccountStore(localStorage);
const credentials = new CredentialStore(localStorage);
const drafts = new DraftStore(localStorage);
const pots = new PotStore(localStorage);
const invited = new InvitedStore(localStorage);
const potBlocks = new PotBlocks(localStorage, DEPLOYMENT);
const potMakers = new PotMakers(localStorage, DEPLOYMENT);
const lastBalances = new LastBalanceStore(localStorage);
const lastUsed = new LastUsedStore(localStorage);

/** The dollar this deployment pays in, for notifications of money coming in. */
const DOLLAR_FOR_NOTES: Address = DEPLOYMENT === "ausd" ? AUSD : TESTUSD;

/** A pot to open by its number: its link on this phone, else its creation block alone. Null if neither is known yet. */
function potToOpen(potId: string): StoredPot | null {
  const known = pots.get(DEPLOYMENT, potId);
  if (known) return known;
  const block = potBlocks.get(potId);
  return block ? { deployment: DEPLOYMENT, potId, block, fragment: "", name: "", addedAt: 0 } : null;
}

type Screen =
  | { kind: "home" }
  | { kind: "create"; draftId: Hex }
  | { kind: "join"; invite: Invite }
  | { kind: "pot"; pot: StoredPot }
  | { kind: "request"; pot: StoredPot; proposalId: bigint }
  | { kind: "story"; pot: StoredPot }
  | { kind: "close"; pot: StoredPot }
  | { kind: "send"; request: PayLink | null }
  | { kind: "receive" }
  | { kind: "money"; mode: "add" | "out" };

function storedFromLink(link: PotLink, fragment: string): StoredPot {
  return rememberPotLink(pots, link, fragment, Date.now());
}

/**
 * The pot a payment request link points at: the one on this phone, with its
 * signed names, or else one with no link, read from the chain alone.
 */
function potForRequest(link: AskLink): StoredPot {
  const known = pots.get(link.deployment, link.potId.toString());
  if (known && known.block === link.block.toString()) return known;
  return { deployment: link.deployment, potId: link.potId.toString(), block: link.block.toString(), fragment: "", name: "", addedAt: Date.now() };
}

/**
 * Swaps screens inside a view transition where the browser has one, so the
 * pot map can stay put while the rest changes. Elsewhere it swaps at once.
 */
function withTransition(change: () => void) {
  if (!prefersReducedMotion() && typeof document.startViewTransition === "function") {
    document.startViewTransition(() => flushSync(change));
  } else change();
}

/** Reads a NivPay link from the page's fragment once, then clears it so a reload doesn't act on it twice. */
function takeLinkFragment(): string | null {
  const fragment = location.hash.replace(/^#/, "");
  if (!fragment) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return fragment;
}

/**
 * Connection health: real read failures, and the phone saying it is offline.
 * Offline is certain when the phone says so; online is only proved by a read
 * that comes back.
 */
function useConnection() {
  const online = useOnline();
  const [failing, setDown] = useState(false);
  const down = failing || !online;
  const track = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    try {
      const v = await p;
      setDown(false);
      return v;
    } catch (e) {
      setDown(true);
      throw e;
    }
  }, []);
  return { down, offline: !online, track };
}

const POT_OUTLINE = "M72 38 C72 50 60 54 50 63 C28 82 23 118 35 146 C47 173 76 186 100 186 C124 186 153 173 165 146 C177 118 172 82 150 63 C140 54 128 50 128 38 Z";

/** The NivPay mark (brand/nivpay-mark.svg): the pot, one band per person, and a lid that is a padlock. */
function PotMark() {
  return (
    <svg className="pot-mark" viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <clipPath id="pot-mark-clip">
          <path d={POT_OUTLINE} />
        </clipPath>
      </defs>
      <path d="M82 33 V21 a18 18 0 0 1 36 0 V33" fill="none" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" />
      <path d={POT_OUTLINE} fill="var(--pot-clay)" />
      <g clipPath="url(#pot-mark-clip)">
        <rect x="0" y="150" width="200" height="40" fill="var(--primary)" />
        <rect x="0" y="122" width="200" height="29" fill="var(--person-2)" />
        <path d="M0 103 Q12.5 96 25 103 T50 103 T75 103 T100 103 T125 103 T150 103 T175 103 T200 103 V123 H0 Z" fill="var(--person-3)" />
        <ellipse cx="60" cy="96" rx="8" ry="22" fill="var(--highlight)" opacity="0.28" />
      </g>
      <path d={POT_OUTLINE} fill="none" stroke="var(--ink)" strokeWidth="7" strokeLinejoin="round" />
      <rect x="58" y="28" width="84" height="16" rx="8" fill="var(--pot-lid)" stroke="var(--ink)" strokeWidth="7" />
      <circle cx="100" cy="135" r="8.5" fill="var(--bg)" />
      <path d="M95 139 L105 139 L108.5 160 L91.5 160 Z" fill="var(--bg)" />
    </svg>
  );
}

function TestModeBadge() {
  return <span className="badge">{copy.testMode}</span>;
}

/** A screen still loading shows the page's background, briefly; nothing on it claims anything. */
export function App() {
  return (
    <>
      <Suspense fallback={<div className="page" aria-busy="true" />}>
        <Screens />
      </Suspense>
      <HelpHost />
    </>
  );
}

/** Help and support, over any screen, opened by openHelp (a Get help link, or Account details). */
function HelpHost() {
  const [open, setOpen] = useState<{ code: number | null } | null>(null);
  useEffect(() => {
    const show = (e: Event) => setOpen({ code: (e as CustomEvent<{ code: number | null }>).detail?.code ?? null });
    // A link opened meanwhile takes the person somewhere else: the sheet closes, not lingers over it.
    const hide = () => setOpen(null);
    window.addEventListener("nivpay:help", show);
    window.addEventListener("hashchange", hide);
    return () => {
      window.removeEventListener("nivpay:help", show);
      window.removeEventListener("hashchange", hide);
    };
  }, []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <HelpSheet code={open.code} onClose={() => setOpen(null)} />
    </Suspense>
  );
}

/** The three places the tab bar leads to, on the signed-in page. */
type Tab = "home" | "pots" | "profile";

function Screens() {
  const [active, setActive] = useState<StoredAccount | undefined>(() => accounts.active());
  const [tab, setTab] = useState<Tab>("home");
  // A tapped notification asking for the bell (lib/push.ts): Home opens it when this changes.
  const [notesAsked, setNotesAsked] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [notice, setNotice] = useState<Notice | null>(null);
  // An invite or pot opened before this phone had an account: opened once there is one.
  const [pendingInvite, setPendingInvite] = useState<Invite | null>(null);
  const [pendingPot, setPendingPot] = useState<StoredPot | null>(null);
  const [pendingPay, setPendingPay] = useState<PayLink | null>(null);
  const [pendingRequest, setPendingRequest] = useState<Extract<Screen, { kind: "request" }> | null>(null);
  const connection = useConnection();
  // Requests from this phone still in flight. Unknown until checked, and
  // unknown is never read as "nothing moved".
  const [inFlight, setInFlight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!connection.down) return;
    let live = true;
    const check = () => pendingWriteCount().then((n) => live && setInFlight(n));
    void check();
    const t = setInterval(check, 2_000);
    return () => {
      live = false;
      clearInterval(t);
      setInFlight(undefined);
    };
  }, [connection.down]);

  const go = useCallback((next: Screen, message: Notice | null = null) => {
    withTransition(() => {
      setNotice(message);
      setScreen(next);
    });
  }, []);

  /** Acts on a link opened from a chat: an invite, a reply to one of our drafts, or a pot. */
  const openLink = useCallback(
    async (fragment: string) => {
      let link;
      try {
        link = decodeLink(fragment);
      } catch {
        go({ kind: "home" }, { tone: "bad", text: copy.errLinkDamaged, code: ERROR_CODES.LINK_DAMAGED });
        return;
      }
      if (link.kind === "invite") {
        if (accounts.active()) go({ kind: "join", invite: link });
        else setPendingInvite(link);
        return;
      }
      if (link.kind === "reply") {
        try {
          const { acceptReply } = await reloadOnce(() => import("./lib/replies.ts"));
          const { draft, text } = await acceptReply(drafts, POTS, link);
          // The reply belongs to whichever account on this phone is making that pot.
          if (accounts.list().some((a) => a.address === draft.owner)) {
            accounts.setActive(draft.owner);
            setActive(accounts.active());
          }
          go({ kind: "create", draftId: draft.id }, { tone: "ok", text });
        } catch (e) {
          const failure = e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e);
          go({ kind: "home" }, { tone: "bad", ...failure });
        }
        return;
      }
      if (link.kind === "pay") {
        if (accounts.active()) go({ kind: "send", request: link });
        else setPendingPay(link);
        return;
      }
      if (link.kind === "ask") {
        if (link.deployment !== DEPLOYMENT) {
          go({ kind: "home" }, { tone: "bad", text: copy.errPotOtherVersion, code: ERROR_CODES.POT_OTHER_VERSION });
          return;
        }
        // Names come from the pot link already on this phone, if there is one.
        const request = { kind: "request", pot: potForRequest(link), proposalId: link.proposalId } as const;
        if (accounts.active()) go(request);
        else setPendingRequest(request);
        return;
      }
      const pot = storedFromLink(link, fragment);
      // Opening a pot's link brings it back to Home if it was hidden.
      const opener = accounts.active();
      if (opener) new PotChoiceStore(localStorage, DEPLOYMENT, opener.address).unhide(pot.potId);
      if (accounts.active()) go({ kind: "pot", pot });
      else setPendingPot(pot);
    },
    [go],
  );

  /** Opens the screen a tapped notification is about (public/sw.js urlFor). */
  const openGo = useCallback(
    (g: Go) => {
      if (!accounts.active()) return;
      if (g.kind === "receive") return go({ kind: "receive" });
      if (g.kind === "notes") {
        setTab("home");
        go({ kind: "home" });
        return setNotesAsked((n) => n + 1);
      }
      const pot = potToOpen(g.potId);
      if (!pot) {
        setTab("pots");
        return go({ kind: "home" });
      }
      go(g.kind === "request" ? { kind: "request", pot, proposalId: BigInt(g.proposalId) } : { kind: "pot", pot });
    },
    [go],
  );
  useEffect(() => {
    const g = parseGo(location.search);
    if (g) {
      history.replaceState(null, "", location.pathname + location.hash);
      openGo(g);
    }
    // The app was already open: the service worker says where to go.
    const onMessage = (e: MessageEvent) => {
      const url = (e.data as { nivpayGo?: unknown } | null)?.nivpayGo;
      if (typeof url !== "string") return;
      const next = parseGo(new URL(url, location.origin).search);
      if (next) openGo(next);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [openGo]);

  useEffect(() => {
    const check = () => {
      const fragment = takeLinkFragment();
      if (fragment) void openLink(fragment);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [openLink]);

  const choose = (address: Address, name: string, credentialId: string) => {
    accounts.upsert({ address, name });
    lastUsed.touch(address, Date.now());
    credentials.rememberCredential(address, credentialId);
    accounts.setActive(address);
    setActive(accounts.active());
    setSwitching(false);
    setTab("home");
    if (pendingInvite) {
      go({ kind: "join", invite: pendingInvite });
      setPendingInvite(null);
    } else if (pendingPot) {
      go({ kind: "pot", pot: pendingPot });
      setPendingPot(null);
    } else if (pendingPay) {
      go({ kind: "send", request: pendingPay });
      setPendingPay(null);
    } else if (pendingRequest) {
      go(pendingRequest);
      setPendingRequest(null);
    }
  };

  const renameActive = (name: string) => {
    if (active) accounts.rename(active.address, name);
    setActive(accounts.active());
  };

  const banner: ReactNode = connection.down && (
    <div className="banner" role="status">
      {offlineMessage(inFlight, connection.offline)}
    </div>
  );

  if (active && !switching && screen.kind === "create") {
    return (
      <CreateScreen
        key={screen.draftId}
        account={active}
        draftId={screen.draftId}
        drafts={drafts}
        banner={banner}
        notice={notice}
        onBack={() => go({ kind: "home" })}
        onOpenPot={(pot) => go({ kind: "pot", pot })}
        onDeleted={() => go({ kind: "home" }, { tone: "ok", text: copy.draftDeleted })}
      />
    );
  }
  if (active && !switching && screen.kind === "pot") {
    return (
      <ChipInScreen
        key={screen.pot.potId + active.address}
        account={active}
        pot={screen.pot}
        banner={banner}
        // A pot opened with no link is not kept: Home shows it from the invite it was matched to.
        onName={(name) => screen.pot.fragment && pots.put({ ...screen.pot, name })}
        onOpenRequest={(proposalId) => go({ kind: "request", pot: screen.pot, proposalId })}
        onOpenStory={() => go({ kind: "story", pot: screen.pot })}
        onOpenClose={() => go({ kind: "close", pot: screen.pot })}
        onClose={() => go({ kind: "home" })}
        onHide={(name) => {
          new PotChoiceStore(localStorage, DEPLOYMENT, active.address).hide(screen.pot.potId, name, Date.now());
          go({ kind: "home" }, { tone: "ok", text: copy.potHiddenFromHome });
        }}
      />
    );
  }
  if (active && !switching && screen.kind === "story") {
    return (
      <TimelineScreen
        key={screen.pot.potId + ":" + active.address}
        account={active}
        pot={screen.pot}
        banner={banner}
        onBack={() => go({ kind: "pot", pot: screen.pot })}
        onOpenRequest={(proposalId) => go({ kind: "request", pot: screen.pot, proposalId })}
        onOpenClose={() => go({ kind: "close", pot: screen.pot })}
        footer={(state) => {
          const worth = state.held[active.address.toLowerCase()] ?? 0n;
          return worth > 0n ? (
            <button type="button" className="pill-btn outline" onClick={() => go({ kind: "close", pot: screen.pot })}>
              {state.closed ? copy.takeMy(formatAmount(worth, state.decimals, "cents")) : copy.takeMyShareOut(formatAmount(worth, state.decimals, "cents"))}
            </button>
          ) : null;
        }}
      />
    );
  }
  if (active && !switching && screen.kind === "close") {
    return (
      <CloseScreen
        key={screen.pot.potId + ":" + active.address}
        account={active}
        pot={screen.pot}
        banner={banner}
        onBack={() => go({ kind: "story", pot: screen.pot })}
        onOpenRequest={(proposalId) => go({ kind: "request", pot: screen.pot, proposalId })}
      />
    );
  }
  if (active && !switching && screen.kind === "request") {
    return (
      <RequestScreen
        key={screen.pot.potId + ":" + screen.proposalId + ":" + active.address}
        account={active}
        pot={screen.pot}
        proposalId={screen.proposalId}
        banner={banner}
        onClose={() => go({ kind: "pot", pot: screen.pot })}
        onOpenClose={() => go({ kind: "close", pot: screen.pot })}
      />
    );
  }
  if (active && !switching && screen.kind === "send") {
    // Keyed by the link too: a second pay link opened over this screen starts afresh, never keeping the first one's recipient.
    const linkKey = screen.request ? `${screen.request.account}:${screen.request.amount}:${screen.request.name}` : "";
    return <SendScreen key={active.address + ":" + linkKey} account={active} request={screen.request} banner={banner} onClose={() => go({ kind: "home" })} />;
  }
  if (active && !switching && screen.kind === "money") {
    return <MoneyScreen key={active.address + screen.mode} account={active} mode={screen.mode} banner={banner} onClose={() => go({ kind: "home" })} />;
  }
  if (active && !switching && screen.kind === "receive") {
    return <ReceiveScreen key={active.address} account={active} banner={banner} onClose={() => go({ kind: "home" })} />;
  }
  if (active && !switching && screen.kind === "join") {
    return (
      <JoinScreen account={active} invite={screen.invite} banner={banner} onAnswered={(row) => invited.put(row)} onClose={() => go({ kind: "home" })} />
    );
  }

  return (
    <div className={`page${active && !switching ? " with-tabs" : ""}`}>
      <InstallBanner />
      {banner}
      {active && !switching ? (
        <Home
          tab={tab}
          onTab={setTab}
          notesAsked={notesAsked}
          account={active}
          connection={connection}
          notice={notice}
          onSwitch={() => setSwitching(true)}
          onOpenDraft={(draftId) => go({ kind: "create", draftId })}
          onOpenPot={(pot) => go({ kind: "pot", pot })}
          onOpenRequest={(pot, proposalId) => go({ kind: "request", pot, proposalId })}
          onSend={() => go({ kind: "send", request: null })}
          onPay={(request) => go({ kind: "send", request })}
          onReceive={() => go({ kind: "receive" })}
          onMoney={(mode) => go({ kind: "money", mode })}
          onRename={renameActive}
          onRemoved={(removed, name) => {
            // Removing the account in use leaves no active one: Welcome shows, with the others listed.
            setActive(accounts.active());
            setSwitching(false);
            go({ kind: "home" }, { tone: "ok", text: copy.removedFromPhone(name) });
          }}
        />
      ) : (
        <Welcome
          known={accounts.list()}
          current={active}
          note={pendingInvite ? copy.joinNeedsAccount(pendingInvite.from) : pendingPot || pendingRequest ? copy.potNeedsAccount : undefined}
          onReady={choose}
          onCancel={active ? () => setSwitching(false) : undefined}
        />
      )}
    </div>
  );
}

function Welcome(props: {
  known: StoredAccount[];
  current?: StoredAccount;
  /** Why the account is needed, when a link brought someone here. */
  note?: string;
  onReady: (address: Address, name: string, credentialId: string) => void;
  onCancel?: () => void;
}) {
  const host = useMemo(() => hostCheck(), []);
  const [name, setName] = useState("");
  // "up" makes an account, an address signs in to that account, "in" lets the phone list every passkey.
  const [busy, setBusy] = useState<"up" | "in" | Address | null>(null);
  const [error, setError] = useState<Notice | null>(null);

  const run = async (kind: "up" | "in" | Address) => {
    setError(null);
    setBusy(kind);
    try {
      const { signIn, signUp } = await passkeys();
      if (kind === "up") {
        const made = await signUp(cleanName(name));
        props.onReady(made.address, cleanName(name), made.credentialId);
      } else {
        // An account on this phone asks for its own passkey only; "in" is for a passkey this phone doesn't list.
        const opened = await signIn(kind === "in" ? undefined : kind);
        props.onReady(opened.address, props.known.find((a) => a.address === opened.address)?.name ?? "", opened.credentialId);
      }
    } catch (e) {
      setError({ tone: "bad", ...describeFailure(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <header className="top">
        <PotMark />
        <TestModeBadge />
      </header>
      <h1>{props.current ? copy.switchAccount : copy.appName}</h1>
      <p className="lede">{copy.tagline}</p>
      {props.note && <div className="banner">{props.note}</div>}

      {!host.ok ? (
        <div className="card">
          <p className="lede">{host.message}</p>
          <p className="reason">{copy.code(ERROR_CODES.HOST_NOT_ALLOWED)}</p>
        </div>
      ) : (
        <>
          {props.known.length > 0 && (
            <section className="card">
              <p className="eyebrow">{props.known.length > 1 ? copy.whoIsSigningIn : copy.accountsOnThisPhone}</p>
              {props.known.map((a) => (
                <button className="btn account-choice" key={a.address} disabled={busy !== null} onClick={() => run(a.address)}>
                  <span>{busy === a.address ? copy.waitingForPasskey : shownName(a)}</span>
                  <span className="label">{copy.accountEnding(a.address)}</span>
                </button>
              ))}
              <button className="btn ghost" disabled={busy !== null} onClick={() => run("in")}>
                {busy === "in" ? copy.waitingForPasskey : copy.anotherAccount}
              </button>
              <p className="hint">{copy.pickAccountHint}</p>
            </section>
          )}

          <section className="card">
            <p className="eyebrow">{props.known.length ? copy.addAnotherAccount : copy.makeYourAccount}</p>
            <label className="field">
              <span>{copy.yourName}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="given-name"
                maxLength={NAME_MAX * 2}
                placeholder={copy.namePlaceholder}
              />
            </label>
            <p className="hint">{copy.nameHint}</p>
            <button className="btn primary" disabled={busy !== null || !cleanName(name)} onClick={() => run("up")}>
              {busy === "up" ? copy.waitingForPasskey : copy.createAccount}
            </button>
            <p className="hint">{copy.createAccountHint}</p>
          </section>

          {props.known.length === 0 && (
            <button className="btn" disabled={busy !== null} onClick={() => run("in")}>
              {busy === "in" ? copy.waitingForPasskey : copy.alreadyHaveAccount}
            </button>
          )}
        </>
      )}

      {error && <NoticeLine notice={error} />}
      {props.onCancel && (
        <button className="btn ghost" onClick={props.onCancel}>
          {copy.back}
        </button>
      )}
    </>
  );
}


/**
 * Asks what to call the person. The name is cleaned (lib/accounts.ts) and
 * rendered only as text. It stays on this phone: never on chain, never sent
 * to /api.
 */

/**
 * On the AUSD deployment, "Add test dollars" claims test AUSD from Agora's
 * faucet and only Dollars are shown. On TESTUSD it mints test dollars.
 */
type Balances = (
  | { kind: "ausd"; dollars: Holding; faucet: FaucetTerms }
  | { kind: "testusd"; dollars: Holding; testDollars: Holding; maxMint: bigint }
) & { readAt: number };

/** Claims are told apart from mints by their label, which survives a reload. */
const CLAIM_LABEL = "claim";
const MINT_LABEL = "mint";

async function readBalances(address: Address): Promise<Balances> {
  const block = await readClient.getBlock({ blockTag: "finalized" });
  const at = { blockNumber: block.number } as const;
  const holding = async (asset: Address): Promise<Holding> => {
    const [decimals, balance] = await Promise.all([
      readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "decimals", ...at }),
      readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [address], ...at }),
    ]);
    return { decimals, balance };
  };
  if (DEPLOYMENT === "ausd") {
    const [dollars, faucet] = await Promise.all([holding(AUSD), readFaucetTerms(block.number)]);
    return { kind: "ausd", dollars, faucet, readAt: Date.now() };
  }
  const [testDollars, dollars, maxMint] = await Promise.all([
    holding(TESTUSD),
    holding(AUSD),
    readClient.readContract({ address: TESTUSD, abi: TEST_DOLLAR_ABI, functionName: "MAX_MINT", ...at }),
  ]);
  return { kind: "testusd", testDollars, dollars, maxMint, readAt: Date.now() };
}

const STEP_LABEL: Record<Step, string> = {
  preparing: copy.stepPreparing,
  "getting-ready": copy.stepGettingReady,
  confirm: copy.stepConfirm,
  sending: copy.stepSending,
};

function Home(props: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** Changes when a tapped notification asks for the bell. */
  notesAsked: number;
  account: StoredAccount;
  connection: ReturnType<typeof useConnection>;
  notice: Notice | null;
  onSwitch: () => void;
  onOpenDraft: (draftId: Hex) => void;
  onOpenPot: (pot: StoredPot) => void;
  onOpenRequest: (pot: StoredPot, proposalId: bigint) => void;
  onSend: () => void;
  /** Pay a request from a person: Send, filled in from it. */
  onPay: (request: PayLink) => void;
  onReceive: () => void;
  onMoney: (mode: "add" | "out") => void;
  onRename: (name: string) => void;
  onRemoved: (account: Address, name: string) => void;
}) {
  const { account, connection } = props;
  // A passkey brings back its account but not its name. With usernames on,
  // the account's username comes back from the passkey alone and stands in
  // for the name; otherwise, or with none, ask once, on this phone.
  const [askName, setAskName] = useState(() => !namesOn && accounts.needsName(account.address));
  const rename = useRef(props.onRename);
  rename.current = props.onRename;
  useEffect(() => {
    const needs = accounts.needsName(account.address);
    if (!needs || !namesOn) return setAskName(needs);
    let live = true;
    usernameOf(account.address)
      .then((name) => {
        if (!live) return;
        if (name) rename.current(`@${name}`);
        setAskName(!name);
      })
      .catch(() => live && setAskName(true));
    return () => {
      live = false;
    };
  }, [account.address]);

  const skipAsking = () => {
    accounts.skipName(account.address);
    setAskName(false);
  };
  const [balances, setBalances] = useState<Balances | null>(null);
  // A payment from this account still being confirmed: the Send screen follows it.
  const [sendInFlight, setSendInFlight] = useState(false);
  // Account details is the Profile tab.
  const details = props.tab === "profile";
  const setDetails = (open: boolean) => props.onTab(open ? "profile" : "home");
  // Requests waiting for this account's yes, for the count on the Pots tab.
  const [waitingCount, setWaitingCount] = useState(0);
  // Notifications (lib/notes.ts), per account on this phone.
  const owner = account.address;
  const notesStore = useMemo(() => new NotesStore(localStorage, DEPLOYMENT, owner), [owner]);
  const [notes, setNotes] = useState<NotesState>(() => notesStore.get());
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => {
    if (props.notesAsked > 0) setNotesOpen(true);
  }, [props.notesAsked]);
  useEffect(() => setNotes(notesStore.get()), [notesStore]);
  const unreadCount = unread(notes);
  const onPoll = useCallback(
    (inputs: Omit<PollInputs, "now" | "pours" | "raised">) => {
      try {
        const limit = settle(new LimitStore(localStorage, DEPLOYMENT, owner).get(), Date.now());
        setNotes(notesStore.update((s) => fromPoll(s, { ...inputs, now: Date.now(), pours: limit.spends.filter((x) => x.kind === "pour"), raised: limit.raised })));
      } catch {
        // Storage refused: no notifications this time.
      }
    },
    [owner, notesStore],
  );
  // Payments coming in, read like Receive reads them but less often, from where the list started.
  useEffect(() => {
    let live = true;
    const feeds: PotFeed[] = [];
    const finalizedBlock = async () => (await readClient.getBlock({ blockTag: "finalized" })).number;
    void (async () => {
      try {
        const first = await finalizedBlock();
        if (!live) return;
        const started = notesStore.update((s) => startNotes(s, Date.now(), first));
        setNotes(started);
        const floor = BigInt(started.startBlock ?? first);
        const watched: { asset: Address; decimals: number; symbol: string }[] = [{ asset: DOLLAR_FOR_NOTES, decimals: 6, symbol: "$" }];
        if (DEPLOYMENT === "ausd") {
          const [decimals, symbol] = await Promise.all([
            readClient.readContract({ address: CTK, abi: ERC20_READ_ABI, functionName: "decimals" }),
            readClient.readContract({ address: CTK, abi: ERC20_READ_ABI, functionName: "symbol" }),
          ]);
          watched.push({ asset: CTK, decimals, symbol });
        }
        if (!live) return;
        for (const w of watched) {
          const source = incomingSource(w.asset, owner, finalizedBlock, (params) => readClient.request({ method: "eth_getLogs", params: [params] }) as Promise<Log[]>);
          const feed = new PotFeed(source, withFloor(idbFeedStore(`notes-in:${w.asset}:${owner}`), floor), floor, { pageSize: LOG_PAGE_BLOCKS, parallel: 2, everyMs: 15_000 });
          feeds.push(feed);
          feed.start((_all, added) => {
            const arrivals = incomingFrom(added, owner).map((a) => ({ ...a, decimals: w.decimals, symbol: w.symbol }));
            if (!live || !arrivals.length) return;
            // Each one counts towards turning voice on (lib/voice.ts).
            const voice = new VoiceStore(localStorage, DEPLOYMENT, owner);
            for (const a of arrivals) voice.saw(`${a.tx}:${a.logIndex}`);
            setNotes(notesStore.update((s) => fromArrivals(s, arrivals, Date.now())));
          });
        }
      } catch {
        // Reads failed: Home's own reads say so; notifications just wait for the next open.
      }
    })();
    return () => {
      live = false;
      for (const f of feeds) f.stop();
    };
  }, [owner, notesStore]);
  // Requests sent straight to this account (lib/inbox.ts), read while Home is open, if this phone turned them on.
  const muted = useMemo(() => new MutedStore(localStorage, DEPLOYMENT, owner), [owner]);
  useEffect(() => {
    let live = true;
    const read = async () => {
      const got = await readInbox(owner, DEPLOYMENT).catch(() => []);
      if (!live || !got.length) return;
      const asked = got.map((g) => ({ digest: g.digest, from: g.request.from, name: g.request.name, amount: g.request.amount, at: g.request.at }));
      setNotes(notesStore.update((s) => fromRequests(s, asked, muted.list())));
    };
    void read();
    const t = setInterval(read, INBOX_EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && void read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [owner, notesStore, muted]);
  const payNote = (n: Note) => {
    setNotes(notesStore.update((s) => markRead(s, n.id)));
    setNotesOpen(false);
    if (n.from) props.onPay({ kind: "pay", deployment: DEPLOYMENT, account: n.from, name: n.fromName ?? "", amount: BigInt(n.amount ?? "0") });
  };
  const muteNote = (n: Note) => {
    if (!n.from) return;
    muted.mute(n.from);
    setNotes(notesStore.update((s) => withoutRequestsFrom(s, n.from!)));
    void syncPush(owner);
  };
  /** A contact's name, or an account's on this phone, for notes about them. */
  const nameOf = (who: Address): string | null => nameOnPhone(who, new ContactStore(localStorage, DEPLOYMENT, owner).list(), accounts.list());
  const openNote = (n: Note) => {
    setNotes(notesStore.update((s) => markRead(s, n.id)));
    setNotesOpen(false);
    const pot = n.potId === undefined ? null : potToOpen(n.potId);
    if (n.kind === "received") props.onReceive();
    else if (n.kind === "limitRaised") setDetails(true);
    else if ((n.kind === "askYes" || n.kind === "askClose") && pot && n.proposalId) props.onOpenRequest(pot, BigInt(n.proposalId));
    else if (pot) props.onOpenPot(pot);
  };
  // When this account was last used on this phone (Account details, This phone).
  useEffect(() => {
    try {
      lastUsed.touch(account.address, Date.now());
    } catch {
      // Storage refused: the date just won't show.
    }
  }, [account.address]);
  // A cash out still being confirmed: the Cash out screen follows it.
  const [cashOutInFlight, setCashOutInFlight] = useState(false);
  // A username claim, change or let go still being confirmed: Account details follows it.
  const [usernameInFlight, setUsernameInFlight] = useState(false);
  useEffect(() => {
    void idbWriteStore
      .get(account.address)
      .then((w) => {
        setSendInFlight(Boolean(w && (w.label.startsWith(`${SEND_LABEL} `) || w.label.startsWith(`${CURRENCY_LABEL} `))));
        setCashOutInFlight(Boolean(w && w.label.startsWith(`${CASHOUT_LABEL} `)));
        setUsernameInFlight(Boolean(w && w.label.startsWith(`${USERNAME_LABEL} `)));
      })
      .catch(() => {
        setSendInFlight(false);
        setCashOutInFlight(false);
        setUsernameInFlight(false);
      });
  }, [account.address, details]);
  const [amountText, setAmountText] = useState(() => amountForField(1_000_000_000n, 6));
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [result, setResult] = useState<Notice | null>(null);
  const [stuck, setStuck] = useState(false);
  // Keep and Hide for pots that name this account (lib/potSort.ts). The tick re-reads them after a change.
  const choices = useMemo(() => new PotChoiceStore(localStorage, DEPLOYMENT, account.address), [account.address]);
  const [, setChoiceTick] = useState(0);
  const choiceChanged = useCallback(() => setChoiceTick((n) => n + 1), []);
  // The faucet's shared cooldown: when, on this phone's clock, a claim is
  // allowed again. Nothing is claimed when it ends; the person taps again.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);

  useEffect(() => {
    if (cooldownUntil === null) return;
    setNow(Date.now());
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= cooldownUntil) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [cooldownUntil]);
  const cooldownLeft = cooldownUntil === null ? 0 : secondsUntil(cooldownUntil, now);

  // One balance read at a time; after SLOW_READ_MS the last balance known shows, dimmed (lib/balanceRead.ts).
  const single = useMemo(() => new SingleRead(), [account.address]);
  const lastKnown = useMemo(() => lastBalances.get(account.address), [account.address, balances]);
  const [slow, setSlow] = useState(false);
  const refresh = useCallback(() => {
    const read = single.run(() => readBalances(account.address));
    if (!read) return;
    const slowAfter = setTimeout(() => alive.current && setSlow(true), SLOW_READ_MS);
    connection
      .track(read)
      .then((b) => {
        lastBalances.put(account.address, { dollars: b.dollars, ...(b.kind === "testusd" ? { testDollars: b.testDollars } : {}), readAt: b.readAt });
        if (alive.current) setBalances(b);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(slowAfter);
        if (alive.current) setSlow(false);
      });
  }, [account.address, connection, single]);

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(refresh, 5_000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [refresh]);

  const land = useCallback(
    async (write: PendingWrite, amountLabel: string) => {
      setStep("landing");
      let outcome: Outcome;
      try {
        outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
      } catch (e) {
        // It was sent; only following it failed. The record is still saved
        // and tracking resumes on the next load.
        if (alive.current) {
          setStep(null);
          setResult({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
        }
        return;
      }
      if (!alive.current) return;
      setStep(null);
      if (outcome.kind === "final") {
        rememberReceipt(write.address, write.hash);
        setStuck(false);
        setResult({ tone: "ok", text: copy.added(amountLabel, (outcome.settledMs / 1000).toFixed(1)) });
      } else if (outcome.kind === "stuck") {
        setStuck(true);
        setResult({ tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
      } else if (outcome.kind === "reverted") {
        setStuck(false);
        setResult(
          write.label.startsWith(CLAIM_LABEL)
            ? { tone: "bad", text: copy.claimDidNotGoThrough, code: ERROR_CODES.CLAIM_REVERTED }
            : { tone: "bad", text: copy.didNotGoThrough, code: ERROR_CODES.REVERTED },
        );
      } else {
        setStuck(false);
        setResult({ tone: "bad", text: copy.didNotGoThrough, code: ERROR_CODES.SUPERSEDED });
      }
      refresh();
    },
    [refresh],
  );

  // Resume a request that was in flight when the page was closed or reloaded.
  useEffect(() => {
    idbWriteStore.get(account.address).then((w) => {
      // Only dollar claims and mints are followed here; a pot's screens follow their own.
      if (!w || !(w.label.startsWith(CLAIM_LABEL) || w.label.startsWith(MINT_LABEL))) return;
      if (w.replaceable) {
        setStuck(true);
        setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
      } else void land(w, "your");
    });
  }, [account.address, land]);

  // The last balance read stays on screen when reads stop, marked as not up to date.
  // While reads are down or slow, the last balance known stands in, dimmed, with when it was checked.
  const shown: { dollars: Holding; testDollars?: Holding; readAt: number } | null = balances
    ? { dollars: balances.dollars, ...(balances.kind === "testusd" ? { testDollars: balances.testDollars } : {}), readAt: balances.readAt }
    : (connection.down || slow) && lastKnown
      ? lastKnown
      : null;
  const stale = balanceNote(connection.down, shown?.readAt ?? null, undefined, slow);
  const decimals = balances?.kind === "testusd" ? balances.testDollars.decimals : (balances?.dollars.decimals ?? 6);
  const amount = balances?.kind === "ausd" ? balances.faucet.drip : amountIn(amountText, decimals);
  const tooMuch = amount !== null && balances?.kind === "testusd" && amount > balances.maxMint;
  const valid = amount !== null && amount > 0n && !tooMuch;

  const add = async (retry: boolean) => {
    if (!valid || amount === null || !balances) return;
    setResult(null);
    setCooldownUntil(null);
    const label = formatAmount(amount, decimals, "auto");
    try {
      const { retryStuckWrite, sendWrite } = await sending();
      if (balances.kind === "ausd") {
        const { faucet } = balances;
        const call = {
          from: account.address,
          to: AUSD_FAUCET,
          data: claimData(account.address),
          label: `${CLAIM_LABEL} ${label} AUSD`,
          onStep: setStep,
        };
        if (retry) {
          await land(await retryStuckWrite(call), label);
          return;
        }
        // Ask the faucet first, so a cooldown or the ceiling costs no grant
        // and no passkey prompt.
        setStep("preparing");
        await checkClaim(account.address, faucet, decimals);
        const write = await sendWrite(call).catch(async (e: unknown) => {
          // Someone else may have claimed since the check: say so precisely.
          if (e instanceof SendFailure && !e.broadcast && e.stage === "preparing") {
            await checkClaim(account.address, faucet, decimals);
          }
          throw e;
        });
        await land(write, label);
        return;
      }
      const call = {
        from: account.address,
        to: TESTUSD,
        data: encodeFunctionData({ abi: TEST_DOLLAR_ABI, functionName: "mint", args: [account.address, amount] }),
        label: `${MINT_LABEL} ${label} TESTUSD`,
        onStep: setStep,
      };
      const write = retry ? await retryStuckWrite(call) : await sendWrite(call);
      await land(write, label);
    } catch (e) {
      setStep(null);
      const cooldown = cooldownIn(e);
      if (cooldown) setCooldownUntil(cooldown.until);
      else setResult({ tone: "bad", ...describeFailure(e) });
    }
  };

  return (
    <>
      {/* Profile has its own header card (screens/Profile.tsx). */}
      {props.tab !== "profile" && (
        <header className="top">
          <div>
            <h1>{shownName(account)}</h1>
            {account.name && <p className="account-line">{copy.accountEndingTitle(account.address)}</p>}
            <TestModeBadge />
          </div>
          <div className="top-actions">
            <button type="button" className="icon-btn bell" aria-label={copy.notificationsUnread(unreadCount)} onClick={() => setNotesOpen(true)}>
              <Icon name="bell" size={22} />
              {unreadCount > 0 && (
                <span className="bell-count" aria-hidden="true">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>
      )}

      {props.notice && <NoticeLine notice={props.notice} />}
      {usernameInFlight && !details && (
        <button type="button" className="btn ghost small" onClick={() => setDetails(true)}>
          {copy.usernameStillGoing}
        </button>
      )}

      {props.tab === "home" && askName && (
        <section className="card" aria-labelledby="ask-name">
          <p className="eyebrow" id="ask-name">
            {copy.yourName}
          </p>
          <p className="hint">{copy.askNameLede}</p>
          <NameForm
            initial=""
            onSave={(name) => {
              props.onRename(name);
              setAskName(false);
            }}
            onSkip={skipAsking}
            skipLabel={copy.skipName}
          />
        </section>
      )}

      {props.tab === "home" && (
      <section className={`card balances${stale ? " stale" : ""}`} aria-live="polite">
        <p className="eyebrow">{copy.yourBalance}</p>
        {stale && <p className="hint stale-note">{stale}</p>}
        {!shown ? (
          <p className="lede">{slow ? copy.readingBalanceSlow : copy.readingBalance}</p>
        ) : (
          <>
            <div className="row balance">
              <span className="label">
                {copy.dollars}
                <br />
                <small>{copy.dollarsLine}</small>
              </span>
              <span className="balance-amount">{formatAmount(shown.dollars.balance, shown.dollars.decimals, "cents")}</span>
            </div>
            {shown.testDollars && (
              <div className="row balance">
                <span className="label">
                  {copy.testDollars}
                  <br />
                  <small>{copy.testDollarsLine}</small>
                </span>
                <span className="balance-amount">{formatAmount(shown.testDollars.balance, shown.testDollars.decimals, "cents")}</span>
              </div>
            )}
            <div className="money-actions">
              <button type="button" className="btn primary" onClick={props.onSend}>
                {copy.sendDollars}
              </button>
              <button type="button" className="btn" onClick={props.onReceive}>
                {copy.receive}
              </button>
            </div>
            {sendInFlight && (
              <button type="button" className="btn ghost small" onClick={props.onSend}>
                {copy.sendStillConfirming}
              </button>
            )}
          </>
        )}
      </section>

      )}

      {props.tab === "home" && DEPLOYMENT === "ausd" && (
        <section className="card" aria-labelledby="your-bank">
          <p className="eyebrow" id="your-bank">
            {copy.yourBank}
          </p>
          <p className="hint">{copy.yourBankHint}</p>
          <p className="ramp-test">{copy.rampTestMode}</p>
          <div className="money-actions">
            <button type="button" className="btn primary" onClick={() => props.onMoney("add")}>
              {copy.addMoney}
            </button>
            <button type="button" className="btn" onClick={() => props.onMoney("out")}>
              {copy.cashOut}
            </button>
          </div>
          {cashOutInFlight && (
            <button type="button" className="btn ghost small" onClick={() => props.onMoney("out")}>
              {copy.cashOutStillGoing}
            </button>
          )}
        </section>
      )}

      {/* Always mounted, so pots are found and notifications made whichever tab is open. */}
      <div className="tab-panel" hidden={props.tab !== "pots"}>
      <YourPots
        onWaiting={setWaitingCount}
        onPoll={onPoll}
        account={account}
        connection={props.connection}
        choices={choices}
        onChoice={choiceChanged}
        onOpen={props.onOpenDraft}
        onOpenPot={props.onOpenPot}
        onOpenRequest={props.onOpenRequest}
      />
      </div>

      {props.tab === "home" && (
      <section className="card">
        <p className="eyebrow">{copy.addTestDollars}</p>
        <p className="hint">{copy.addTestDollarsHint}</p>
        {balances?.kind === "ausd" ? (
          <p className="hint">
            {copy.claimAmountHint(formatAmount(balances.faucet.drip, decimals, "auto"), formatAmount(balances.faucet.ceiling, decimals, "auto"))}
          </p>
        ) : addDollarsField(DEPLOYMENT, balances !== null) === "reading" ? (
          <p className="hint">{copy.readingBalance}</p>
        ) : (
          <label className="field">
            <span>{copy.howMany}</span>
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            <AmountUnderstood text={amountText} decimals={decimals} />
          </label>
        )}
        {tooMuch && balances?.kind === "testusd" && (
          <p className="error">{copy.upToAtATime(formatAmount(balances.maxMint, decimals, "auto"))}</p>
        )}
        {cooldownUntil === null ? (
          <button className="btn primary" disabled={!valid || step !== null || !balances} onClick={() => add(false)}>
            {step === "landing" ? copy.stepSending : step ? STEP_LABEL[step] : copy.addTestDollars}
          </button>
        ) : (
          <>
            <button className="btn primary" disabled={cooldownLeft > 0 || step !== null} onClick={() => add(false)}>
              {copy.tryAgain}
            </button>
            <NoticeLine
              notice={
                cooldownLeft > 0
                  ? { tone: "bad", text: `${copy.errClaimCooldown(cooldownLeft)} ${copy.nothingWasSent}`, code: ERROR_CODES.CLAIM_COOLDOWN }
                  : { tone: "ok", text: copy.claimCooldownOver }
              }
            />
          </>
        )}
        {stuck && step === null && (
          <button className="btn" onClick={() => add(true)}>
            {copy.tryAgain}
          </button>
        )}
        {result && <NoticeLine notice={result} />}
      </section>
      )}

      {notesOpen && (
        <Suspense fallback={null}>
          <NotesSheet
            state={notes}
            nameOf={nameOf}
            onPay={payNote}
            onIgnore={(n) => setNotes(notesStore.update((s) => dismiss(s, n.id)))}
            onMute={muteNote}
            onOpen={openNote} onReadAll={() => setNotes(notesStore.update(markAllRead))} onClose={() => setNotesOpen(false)} />
        </Suspense>
      )}
      {details && (
        <Suspense fallback={null}>
          <ProfilePage
            account={account}
            hidden={choices.hidden()}
            onUnhide={(potId) => {
              choices.unhide(potId);
              choiceChanged();
            }}
            onRename={props.onRename}
            onRemoved={(removed, name) => {
              setDetails(false);
              props.onRemoved(removed, name);
            }}
            onSwitch={() => {
              setDetails(false);
              props.onSwitch();
            }}
            names={(who) => nameOf(who) ?? copy.accountEnding(who)}
            onMuted={() => setNotes(notesStore.get())}
          />
        </Suspense>
      )}
      <TabBar tab={props.tab} onTab={props.onTab} account={account} waiting={waitingCount} />
    </>
  );
}

/**
 * The tab bar: Home, the pot mark for Pots, and Profile with the person's
 * photo, or the first letter of their name. Fixed at the bottom of the
 * signed-in page, which leaves room under it so it never covers a button.
 */
function TabBar(props: { tab: Tab; onTab: (tab: Tab) => void; account: StoredAccount; waiting: number }) {
  const tabProps = (t: Tab) => ({
    type: "button" as const,
    className: `tab${props.tab === t ? " on" : ""}`,
    "aria-current": props.tab === t ? ("page" as const) : undefined,
    onClick: () => props.onTab(t),
  });
  return (
    <nav className="tab-bar" aria-label={copy.mainNav}>
      <button {...tabProps("home")}>
        <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
        </svg>
        <span>{copy.tabHome}</span>
      </button>
      <button {...tabProps("pots")}>
        <span className="tab-pot">
          <PotMark />
          {props.waiting > 0 && (
            <span className="tab-badge" aria-label={copy.waitingForYourYes}>
              {props.waiting > 9 ? "9+" : props.waiting}
            </span>
          )}
        </span>
        <span>{copy.tabPots}</span>
      </button>
      <button {...tabProps("profile")}>
        <ProfileFace account={props.account} />
        <span>{copy.tabProfile}</span>
      </button>
    </nav>
  );
}

/** The person's photo when photos are set up and they have one, else the first letter of their name. */
function ProfileFace(props: { account: StoredAccount }) {
  const [on, setOn] = useState(false);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    void photosEnabled().then((v) => live && setOn(v));
    // A photo saved or removed in Profile: show the new one.
    const changed = () => {
      setFailed(false);
      setVersion((n) => n + 1);
    };
    window.addEventListener("nivpay:photo", changed);
    return () => {
      live = false;
      window.removeEventListener("nivpay:photo", changed);
    };
  }, []);
  const letter = (Array.from(shownName(props.account).trim())[0] ?? "?").toLocaleUpperCase();
  return (
    <span className="tab-face" aria-hidden="true">
      {on && !failed ? <img src={photoUrl(props.account.address, version)} alt="" width={28} height={28} onError={() => setFailed(true)} /> : letter}
    </span>
  );
}

const FIND_POTS_EVERY_MS = 10_000;
/** How often Home looks for requests sent straight to this account. */
const INBOX_EVERY_MS = 30_000;
/** When a request must be answered by, in the phone's own time. */
const answerByFormat = new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const livePots = potsReader(readClient, POTS);
const liveCreators = creatorReader(readClient, POTS);
const liveAsks = askReader(readClient, POTS);
const liveMakers = makerReader(readClient, POTS);
const liveFundings = fundingsReader(readClient, POTS);
/** Each of this account's pots' deciders and payees, read once: they never change. */
const potMembers = memberCache();

/**
 * Pots this account is named on, found from the chain (lib/discover.ts), so
 * a pot appears on every phone of everyone in it even if its link never
 * arrived. Read when Home opens, which is also when the app opens, when the
 * app comes back to the front, and every few seconds while Home stays open. What was found is remembered, so it shows
 * at once next time. After each read, answered invites still waiting are
 * matched against what was found (lib/invited.ts).
 */
function useFoundPots(account: Address, connection: ReturnType<typeof useConnection>) {
  const store = useMemo(() => new ScanStore(localStorage, DEPLOYMENT, account), [account]);
  const [scan, setScan] = useState<ScanState>(() => store.load());
  const [failed, setFailed] = useState(false);
  const [answeredInvites, setAnswered] = useState<AnsweredInvite[]>(() => invited.forAccount(DEPLOYMENT, account, Date.now()));
  const askStore = useMemo(() => new AskScanStore(localStorage, DEPLOYMENT, account), [account]);
  const [asks, setAsks] = useState<AskScan>(() => askStore.load());
  const [starts, setStarts] = useState<Record<string, string>>(() => potBlocks.all());
  const [makers, setMakers] = useState<Record<string, Address>>(() => potMakers.all());
  // Money put into this account's own pots by the people in them, since the poll before (lib/fundings.ts).
  const [fundings, setFundings] = useState<Funding[]>([]);
  const cursor = useMemo(() => new FundingsCursor(localStorage, DEPLOYMENT, account), [account]);
  const { track } = connection;
  useEffect(() => {
    let live = true;
    let state = store.load();
    let askState = askStore.load();
    setScan(state);
    setAsks(askState);
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const next = await track(findPots(livePots, state, account));
        if (!live) return;
        // Read up to the same block as the totals, so a rise and who caused it arrive together.
        if (next.at) {
          const made = potMakers.all();
          const mine = next.found.filter((p) => made[p.potId]?.toLowerCase() === account.toLowerCase() && !p.closed).map((p) => p.potId);
          const read = await readFundings(liveFundings, account, mine, cursor.get(), BigInt(next.at), LOG_PAGE_BLOCKS, potMembers).catch(() => null);
          if (!live) return;
          if (read) {
            cursor.set(read.readTo);
            setFundings(read.fundings);
          }
        }
        state = next;
        store.save(next);
        setScan(next);
        setFailed(false);
        const rows = invited.forAccount(DEPLOYMENT, account, Date.now());
        setAnswered(rows);
        const matched = await track(matchInvites(rows, next.found, liveCreators, POTS_DEPLOY_BLOCK));
        if (!live) return;
        for (const row of matched) invited.put(row);
        setAnswered(invited.forAccount(DEPLOYMENT, account, Date.now()));
        // Requests waiting for this account's yes, on pots it decides on: no link needed.
        const decides = new Set(next.found.filter((p) => p.roles.includes("decides")).map((p) => p.potId));
        const nextAsks = await track(findOpenRequests(liveAsks, askState, decides));
        if (!live) return;
        askState = nextAsks;
        askStore.save(nextAsks);
        setAsks(nextAsks);
        // So every pot found opens with no link: its creation block, found once.
        await learnPotBlocks(potBlocks, next.found.map((p) => p.potId), liveCreators, POTS_DEPLOY_BLOCK).catch(() => {});
        // Who made each, from its creation event, so Home can tell pots from people you know (lib/potSort.ts).
        await learnPotMakers(potMakers, potBlocks.all(), next.found.map((p) => p.potId), liveMakers).catch(() => {});
        if (live) {
          setStarts(potBlocks.all());
          setMakers(potMakers.all());
        }
      } catch {
        if (live) setFailed(true);
      } finally {
        running = false;
      }
    };
    void poll();
    const t = setInterval(poll, FIND_POTS_EVERY_MS);
    // A phone brings the app back from the background without reopening Home.
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [account, store, askStore, track, cursor]);
  return { scan, failed, answered: answeredInvites, asks, starts, makers, fundings };
}


/**
 * A pot found from the chain whose link hasn't been opened on this phone:
 * live numbers, no names yet. Once its creation block is known it opens
 * here with no link, people shown by the end of their account.
 */
function FoundPotRow(props: { pot: FoundPot; decimals: number | null; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const { pot } = props;
  const holds = props.decimals === null ? "…" : formatAmount(BigInt(pot.totalAssets), props.decimals, "auto");
  if (props.onOpen) {
    return (
      <button type="button" className="home-pot" onClick={props.onOpen}>
        <span className="grow">
          <span className="name">{pot.name || copy.unnamedPot}</span>
          <span className="meta">{copy.addedToAPot}</span>
          <span className="meta">{copy.foundMeta(pot.roles.map((r) => ROLE_TEXT[r]), holds)}</span>
          <span className="meta">{copy.foundOpens}</span>
        </span>
        <span className={`tag${pot.closed ? "" : " live"}`}>{pot.closed ? copy.closedTag : copy.live}</span>
      </button>
    );
  }
  return (
    <>
      <button type="button" className="home-pot" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="grow">
          <span className="name">{pot.name || copy.unnamedPot}</span>
          <span className="meta">{copy.addedToAPot}</span>
          <span className="meta">{copy.foundMeta(pot.roles.map((r) => ROLE_TEXT[r]), holds)}</span>
        </span>
        <span className={`tag${pot.closed ? "" : " live"}`}>{pot.closed ? copy.closedTag : copy.live}</span>
      </button>
      {open && <p className="hint found-note">{copy.foundNeedsLink}</p>}
    </>
  );
}

/** An invite this account answered whose pot hasn't been made yet. */
function WaitingRow(props: { row: AnsweredInvite; decimals: number | null }) {
  const { row } = props;
  const share = BigInt(row.share);
  return (
    <div className="home-pot">
      <span className="grow">
        <span className="name">{row.potName || copy.unnamedPot}</span>
        <span className="meta">{copy.invitedWaiting(row.potName || copy.unnamedPot, row.from)}</span>
        {share > 0n && props.decimals !== null && <span className="meta">{copy.invitedShare(formatAmount(share, props.decimals, "auto"))}</span>}
      </span>
      <span className="tag">{copy.invitedTag}</span>
    </div>
  );
}

/**
 * A pot matched to an invite this account answered: its name and live numbers
 * from the chain, the inviter's name from the invite, and everyone else by
 * the end of their account until a pot link with names is opened. Opens with
 * no link.
 */
function MatchedRow(props: { row: AnsweredInvite; pot: FoundPot | undefined; decimals: number | null; me: Address; onOpen: () => void }) {
  const { row, pot } = props;
  const match = row.match!;
  const holds = !pot || props.decimals === null ? "…" : formatAmount(BigInt(pot.totalAssets), props.decimals, "auto");
  const others = [...new Set([...match.deciders, ...match.payees].map((a) => a.toLowerCase()))]
    .filter((a) => a !== props.me.toLowerCase())
    .map((a) => copy.accountEnding(a));
  return (
    <button type="button" className="home-pot" onClick={props.onOpen}>
      <span className="grow">
        <span className="name">{pot?.name || row.potName || copy.unnamedPot}</span>
        <span className="meta">{copy.invitedBy(row.from)}</span>
        {pot && <span className="meta">{copy.foundMeta(pot.roles.map((r) => ROLE_TEXT[r]), holds)}</span>}
        {others.length > 0 && <span className="meta">{copy.alsoInIt(others)}</span>}
      </span>
      <span className={`tag${pot?.closed ? "" : " live"}`}>{pot?.closed ? copy.closedTag : copy.live}</span>
    </button>
  );
}

/** Pots this account is making, pots made or opened on this phone, invites it answered, and pots it is named on. */
function YourPots(props: {
  /** How many requests wait for this account's yes, for the count on the Pots tab. */
  onWaiting: (n: number) => void;
  /** Each poll's reads, for notifications (lib/notes.ts): only pots that are this account's own. */
  onPoll: (inputs: Omit<PollInputs, "now" | "pours" | "raised">) => void;
  account: StoredAccount;
  connection: ReturnType<typeof useConnection>;
  choices: PotChoiceStore;
  onChoice: () => void;
  onOpen: (draftId: Hex) => void;
  onOpenPot: (pot: StoredPot) => void;
  onOpenRequest: (pot: StoredPot, proposalId: bigint) => void;
}) {
  const { scan, failed, answered, asks, starts, makers, fundings } = useFoundPots(props.account.address, props.connection);
  const owner = props.account.address;
  const contacts = useMemo(() => new ContactStore(localStorage, DEPLOYMENT, owner).list(), [owner]);
  const [reporting, setReporting] = useState<{ potId: string; name: string } | null>(null);
  const [reportNote, setReportNote] = useState<string | null>(null);
  const mine = drafts.forOwner(props.account.address).filter((d) => !d.made?.fragment);
  // Pots made before the pot list existed are added to it once.
  for (const d of drafts.forOwner(props.account.address)) {
    if (d.made?.fragment && !pots.get(DEPLOYMENT, d.made.potId)) {
      pots.put({ deployment: DEPLOYMENT, potId: d.made.potId, block: d.made.block, fragment: d.made.fragment, name: d.name, addedAt: d.createdAt });
    }
  }
  const hiddenIds = new Set(props.choices.hidden().map((h) => h.potId));
  const opened = pots.all(DEPLOYMENT).filter((p) => !hiddenIds.has(p.potId));
  // Pots whose link is open on this phone show with their names; the rest of what was found shows here.
  const linked = new Set(opened.map((p) => p.potId));
  const waiting = answered.filter((r) => !r.match);
  const matched = answered.filter((r) => r.match && !linked.has(r.match.potId) && !hiddenIds.has(r.match.potId));
  const matchedIds = new Set(matched.map((r) => r.match!.potId));
  // Pots from people you may not know go in their own list, not here (lib/potSort.ts).
  const phoneAccounts = accounts.list().map((a) => a.address);
  const facts: SortFacts = {
    madeHere: new Set(phoneAccounts.flatMap((a) => drafts.forOwner(a)).flatMap((d) => (d.made ? [d.made.potId] : []))),
    opened: linked,
    answered: new Set(answered.flatMap((r) => (r.match ? [r.match.potId] : []))),
    kept: props.choices.kept(),
    hidden: new Set(props.choices.hidden().map((h) => h.potId)),
    trusted: [...phoneAccounts, ...contacts.map((c) => c.account)],
    makers,
  };
  const sorted = sortFound(scan.found, facts);
  const notYours = new Set([...sorted.fresh, ...sorted.hidden].map((p) => p.potId));
  const found = sorted.yours.filter((p) => !linked.has(p.potId) && !matchedIds.has(p.potId));
  /** The pot to open for a pot number: its link on this phone, else its matched invite, else its creation block alone. */
  const storedFor = (potId: string): StoredPot | null => {
    const known = pots.get(DEPLOYMENT, potId);
    if (known) return known;
    const block = answered.find((r) => r.match?.potId === potId)?.match?.block ?? starts[potId];
    return block ? { deployment: DEPLOYMENT, potId, block, fragment: "", name: "", addedAt: 0 } : null;
  };
  // A pot that is new to you, or hidden, never asks for your yes on Home.
  const waitingMine = needingMyYes(asks, props.account.address).filter((r) => !notYours.has(r.potId));
  // Notifications from the same reads: never about a pot that is new to this account or hidden.
  const { onPoll, onWaiting } = props;
  useEffect(() => onWaiting(waitingMine.length), [onWaiting, waitingMine.length]);
  useEffect(() => {
    onPoll({
      found: scan.found.filter((p) => !notYours.has(p.potId)),
      waiting: waitingMine,
      ended: (asks.ended ?? []).filter((e) => !notYours.has(e.potId)),
      me: owner,
      makers,
      trusted: facts.trusted,
      fundings,
    });
    // Once per poll: scan and asks are new objects after each one.
  }, [scan, asks]);
  const start = () => {
    const draft = newDraft(props.account.address, phoneTimeZone(), Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
    drafts.put(draft);
    props.onOpen(draft.id);
  };
  return (
    <>
    {waitingMine.length > 0 && (
      <section className="card">
        <p className="eyebrow">{copy.waitingForYourYes}</p>
        {waitingMine.map((r) => {
        const stored = storedFor(r.potId);
        const name = scan.found.find((p) => p.potId === r.potId)?.name || stored?.name || copy.unnamedPot;
        const amount = scan.decimals === null ? "…" : formatAmount(BigInt(r.amount), scan.decimals, "auto");
        return (
          <button
            type="button"
            className="home-pot"
            key={`ask-${r.proposalId}`}
            disabled={!stored}
            onClick={() => stored && props.onOpenRequest(stored, BigInt(r.proposalId))}
          >
            <span className="grow">
              <span className="name">{name}</span>
              <span className="meta">{r.kind === 1 ? copy.homeAskCloseMeta(r.yes.length, r.threshold) : copy.homeAskMeta(amount, r.yes.length, r.threshold)}</span>
              <span className="meta">{copy.answerBy(answerByFormat.format(new Date(Number(r.expiresAt) * 1000)).replace(",", ""))}</span>
              {!stored && <span className="meta">{copy.gettingReadyToOpen}</span>}
            </span>
            <span className="tag live">{copy.yourYesTag}</span>
          </button>
        );
      })}
      </section>
    )}
    <section className="card">
      <p className="eyebrow">{copy.yourPots}</p>
      {mine.length + opened.length + found.length + answered.length === 0 && <p className="hint">{copy.noPotsYet}</p>}

      {matched.map((r) => (
        <MatchedRow
          key={`matched-${r.match!.potId}`}
          row={r}
          pot={scan.found.find((p) => p.potId === r.match!.potId)}
          decimals={scan.decimals}
          me={props.account.address}
          onOpen={() => props.onOpenPot({ deployment: DEPLOYMENT, potId: r.match!.potId, block: r.match!.block, fragment: "", name: "", addedAt: r.answeredAt })}
        />
      ))}
      {waiting.map((r) => (
        <WaitingRow key={`invited-${r.draftId}-${r.role}-${r.slot}`} row={r} decimals={scan.decimals} />
      ))}
      {found.map((p) => {
        const stored = storedFor(p.potId);
        return <FoundPotRow key={`found-${p.potId}`} pot={p} decimals={scan.decimals} onOpen={stored ? () => props.onOpenPot(stored) : undefined} />;
      })}
      {opened.map((p) => (
        <button
          type="button"
          className="home-pot"
          key={`pot-${p.potId}`}
          onClick={() => props.onOpenPot(p)}
        >
          <span className="grow">
            <span className="name">{p.name || copy.unnamedPot}</span>
            <span className="meta">
              {(() => {
                const f = scan.found.find((x) => x.potId === p.potId);
                return openedPotMeta(f, f && scan.decimals !== null ? formatAmount(BigInt(f.totalAssets), scan.decimals, "auto") : "…");
              })()}
            </span>
          </span>
          <span className="tag live">{copy.live}</span>
        </button>
      ))}
      {mine.map((d) => (
        <button type="button" className="home-pot" key={d.id} onClick={() => props.onOpen(d.id)}>
          <span className="grow">
            <span className="name">{d.name || copy.unnamedPot}</span>
            <span className="meta">{d.made ? copy.potRowMade(formatDay(d.closes)) : copy.potRowDraft(d.deciders.length + 1)}</span>
          </span>
          <span className={`tag${d.made ? " live" : ""}`}>{d.made ? copy.live : copy.draft}</span>
        </button>
      ))}
      {failed && <NoticeLine notice={{ tone: "bad", text: copy.errFindPots, code: ERROR_CODES.FIND_POTS_FAILED }} />}
      <button type="button" className="btn primary" onClick={start}>
        {copy.makeAPot}
      </button>
    </section>
    {sorted.fresh.length > 0 && (
      <NewPots
        pots={sorted.fresh}
        decimals={scan.decimals}
        makers={makers}
        onKeep={(potId) => {
          props.choices.keep(potId);
          setReportNote(null);
          props.onChoice();
        }}
        onHide={(potId, name) => {
          props.choices.hide(potId, name, Date.now());
          setReportNote(null);
          props.onChoice();
        }}
        onReport={(potId, name) => {
          setReportNote(null);
          setReporting({ potId, name });
        }}
      />
    )}
    {reportNote && (
      <p className="success" role="status">
        {reportNote}
      </p>
    )}
    {reporting && (
      <ReportSheet
        potId={reporting.potId}
        onClose={() => setReporting(null)}
        onReported={() => {
          props.choices.hide(reporting.potId, reporting.name, Date.now());
          setReporting(null);
          setReportNote(copy.reportSent);
          props.onChoice();
        }}
        onHide={() => {
          props.choices.hide(reporting.potId, reporting.name, Date.now());
          setReporting(null);
          props.onChoice();
        }}
      />
    )}
    </>
  );
}

/**
 * Pots that name this account, made by someone this phone doesn't know
 * (lib/potSort.ts). Collapsed, with no badge and no announcement: a stranger
 * naming you shouldn't get your attention for free. Each row says who made it
 * and what you'd do in it, and offers Keep, Hide and Report.
 */
function NewPots(props: {
  pots: FoundPot[];
  decimals: number | null;
  makers: Record<string, Address>;
  onKeep: (potId: string) => void;
  onHide: (potId: string, name: string) => void;
  onReport: (potId: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card" aria-labelledby="new-pots">
      <button type="button" className="new-pots-toggle" aria-expanded={open} aria-controls="new-pots-list" onClick={() => setOpen((o) => !o)}>
        <span className="eyebrow" id="new-pots">
          {copy.newPotsThatNameYou}
        </span>
        <Icon name="chevron" size={18} />
      </button>
      {open && (
        <div id="new-pots-list">
          <p className="hint">{copy.newPotsHint}</p>
          {props.pots.map((p) => {
            const name = cleanName(p.name);
            const maker = props.makers[p.potId];
            const holds = props.decimals === null ? "…" : formatAmount(BigInt(p.totalAssets), props.decimals, "auto");
            return (
              <div key={`new-${p.potId}`}>
                <div className="home-pot">
                  <span className="grow">
                    <span className="name">{name || copy.unnamedPot}</span>
                    <span className="meta">{maker ? copy.newPotMadeBy(copy.accountEnding(maker)) : copy.newPotMakerUnknown}</span>
                    <span className="meta">{copy.foundMeta(p.roles.map((r) => ROLE_TEXT[r]), holds)}</span>
                  </span>
                </div>
                <div className="new-pot-actions">
                  <button type="button" className="btn small" onClick={() => props.onKeep(p.potId)}>
                    {copy.keepPot}
                  </button>
                  <button type="button" className="btn ghost small" onClick={() => props.onHide(p.potId, name)}>
                    {copy.hidePot}
                  </button>
                  <button type="button" className="btn ghost small" onClick={() => props.onReport(p.potId, name)}>
                    {copy.reportPot}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const REASON_TEXT: Record<Reason, string> = {
  scam: copy.reasonScam,
  impersonation: copy.reasonImpersonation,
  spam: copy.reasonSpam,
  "not-for-me": copy.reasonNotForMe,
};

/** Asks why, sends only the pot and the reason to /api/report, then the pot is hidden. */
function ReportSheet(props: { potId: string; onClose: () => void; onReported: () => void; onHide: () => void }) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Notice | null>(null);
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setFailure(null);
    try {
      await sendReport({ deployment: DEPLOYMENT, potId: props.potId, reason });
      props.onReported();
    } catch {
      setFailure({ tone: "bad", text: copy.errReportFailed, code: ERROR_CODES.REPORT_FAILED });
      setBusy(false);
    }
  };
  return (
    <Sheet title={copy.reportTitle} onClose={() => !busy && props.onClose()}>
      <p className="hint">{copy.reportLede}</p>
      <div className="report-reasons" role="radiogroup" aria-label={copy.reportTitle}>
        {REASONS.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} className={`btn${reason === r ? " primary" : ""}`} disabled={busy} onClick={() => setReason(r)}>
            {REASON_TEXT[r]}
          </button>
        ))}
      </div>
      {failure && <NoticeLine notice={failure} />}
      <button type="button" className={`pill-btn${busy ? " busy" : ""}`} disabled={!reason || busy} aria-busy={busy} onClick={send}>
        {busy ? copy.sendingReport : copy.sendReport}
      </button>
      {failure && (
        <button type="button" className="btn ghost" onClick={props.onHide}>
          {copy.hidePot}
        </button>
      )}
      <button type="button" className="btn ghost" disabled={busy} onClick={props.onClose}>
        {copy.back}
      </button>
    </Sheet>
  );
}

