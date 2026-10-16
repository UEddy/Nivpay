import { Fragment, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { copy } from "../copy.ts";
import { shownName, type StoredAccount } from "../lib/accounts.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";
import { pickLanguage } from "../i18n/start.ts";
import { inboxEnabled, requestsOnHere } from "../lib/inboxLive.ts";
import { LimitStore, limitNow, LIMIT_DECIMALS, settle } from "../lib/limits.ts";
import { language, LANGUAGE_NAMES, readPick, type Lang } from "../lib/locale.ts";
import { formatAmount } from "../lib/money.ts";
import { namesOn } from "../lib/names.ts";
import { photosEnabled, photoUrl } from "../lib/photo.ts";
import { pushInfo, pushOnHere } from "../lib/pushLive.ts";
import { latestReceipt, receiptUrl } from "../lib/receipts.ts";
import { VoiceStore } from "../lib/voice.ts";
import type { HiddenPot } from "../lib/potSort.ts";
import { LANGUAGE_CHOICES, profileGroups, type GroupId, type RowId } from "../lib/profile.ts";
import { Avatar } from "./Avatar.tsx";
import { closeDetail, detailIn, openDetail } from "../lib/backNav.ts";
import { reloadOnce } from "../lib/reloadOnce.ts";
import { DisplayNameForm, Icon, InstallHow, openHelp, useInstallWay } from "./ui.tsx";
import { useMyUsername } from "./Username.tsx";
import { voiceOffered } from "./Voice.tsx";

const PhotoSection = lazy(() => reloadOnce(() => import("./Photo.tsx")).then((m) => ({ default: m.PhotoSection })));
const UsernameSection = lazy(() => reloadOnce(() => import("./Username.tsx")).then((m) => ({ default: m.UsernameSection })));
const DailyLimitSection = lazy(() => reloadOnce(() => import("./Limits.tsx")).then((m) => ({ default: m.DailyLimitSection })));
const DevicesSection = lazy(() => reloadOnce(() => import("./Devices.tsx")).then((m) => ({ default: m.DevicesSection })));
const NotificationsSection = lazy(() => reloadOnce(() => import("./Notify.tsx")).then((m) => ({ default: m.NotificationsSection })));
const VoiceSection = lazy(() => reloadOnce(() => import("./Voice.tsx")).then((m) => ({ default: m.VoiceSection })));

const VERSION: string = import.meta.env.VITE_APP_VERSION ?? "local";

/** An account, for what this file shows; named so, since screen text is checked for words people mustn't see. */
type Account = Address;

type View = "main" | "name" | "photo" | "username" | "choose" | "limit" | "hidden" | "devices" | "language" | "notifications" | "voice" | "install";

/** The row icons: simple strokes in the text colour. */
const ROW_ICONS: Record<string, ReactNode> = {
  name: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  username: <path d="M16 12a4 4 0 1 1-1.2-2.9M16 8v5a2 2 0 0 0 4 0v-1a8 8 0 1 0-3 6.2" />,
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  limit: (
    <>
      <path d="M4 15a8 8 0 1 1 16 0" />
      <path d="M12 15l4-5" />
    </>
  ),
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  hidden: <path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.6 3.2M6.4 7.6A15 15 0 0 0 3 12s4 6 9 6a8.6 8.6 0 0 0 3.6-.8M10 10a2.8 2.8 0 0 0 4 4" />,
  devices: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  language: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
    </>
  ),
  notifications: <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />,
  voice: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
    </>
  ),
  install: <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />,
};

function Row(props: { icon: keyof typeof ROW_ICONS; label: string; value?: string; onClick?: () => void; href?: string }) {
  const inside = (
    <>
      <span className="settings-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          {ROW_ICONS[props.icon]}
        </svg>
      </span>
      {/* Label and value share a line when they fit; otherwise the value goes under the label, never cut short. */}
      <span className="settings-text">
        <span className="settings-label">{props.label}</span>
        {props.value && <span className="settings-value">{props.value}</span>}
      </span>
      <Icon name="chevron" size={18} className="settings-chevron" />
    </>
  );
  return props.href ? (
    <a className="settings-row" href={props.href} target="_blank" rel="noopener noreferrer">
      {inside}
    </a>
  ) : (
    <button type="button" className="settings-row" onClick={props.onClick}>
      {inside}
    </button>
  );
}

const GROUP_TEXT: Record<GroupId, string> = {
  account: copy.groupAccount,
  money: copy.groupMoney,
  security: copy.groupSecurity,
  preferences: copy.groupPreferences,
  help: copy.groupHelp,
};

function Group(props: { label: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <p className="settings-group">{props.label}</p>
      <div className="settings-list">{props.children}</div>
    </section>
  );
}

/** A detail screen: a back arrow and a title, then its contents. */
function Detail(props: { title: string; onBack: () => void; children: ReactNode }) {
  useEffect(() => window.scrollTo({ top: 0 }), []);
  return (
    <section className="settings-detail" aria-label={props.title}>
      <div className="settings-bar">
        <button type="button" className="icon-btn" aria-label={copy.back} onClick={props.onBack}>
          <Icon name="back" size={22} />
        </button>
        <h2>{props.title}</h2>
      </div>
      <Suspense fallback={null}>{props.children}</Suspense>
    </section>
  );
}

function useAsync<T>(read: () => Promise<T>, fallback: T, deps: unknown[]): T {
  const [v, setV] = useState(fallback);
  useEffect(() => {
    let live = true;
    void read()
      .then((x) => live && setV(x))
      .catch(() => {});
    return () => {
      live = false;
    };
    // The reads depend only on what is listed.
  }, deps);
  return v;
}

/**
 * The Profile tab (README, "Profile"): a header card with the photo, the
 * name and Change name, the end of the Account ID with Copy, the photo note
 * and the username; then rows grouped like a phone's settings, each opening
 * its own screen; then Switch account and the version. Each detail screen
 * keeps to a line or two, with the rest under How this works.
 */
export function ProfilePage(props: {
  account: StoredAccount;
  hidden: HiddenPot[];
  onUnhide: (potId: string) => void;
  onRename: (name: string) => void;
  onRemoved: (account: Account, name: string) => void;
  onSwitch: () => void;
  names: (who: Account) => string;
  onMuted: () => void;
}) {
  const me = props.account.address;
  const [view, showView] = useState<View>("main");
  // A detail screen is one history entry: the arrow and the phone's own back both return here (lib/backNav.ts).
  const setView = (v: View) => {
    if (v === "main") {
      if (closeDetail(history) === "shown") showView("main");
    } else {
      openDetail(history, v);
      showView(v);
    }
  };
  useEffect(() => {
    const popped = (e: PopStateEvent) => showView((detailIn(e.state) as View | null) ?? "main");
    window.addEventListener("popstate", popped);
    return () => {
      window.removeEventListener("popstate", popped);
      // Leaving Profile from a detail screen (another tab): its entry goes too.
      if (detailIn(history.state)) history.back();
    };
  }, []);
  const [copied, setCopied] = useState(false);
  const installWay = useInstallWay();
  const u = useMyUsername(me);
  const photosOn = useAsync(() => photosEnabled(), false, []);
  const hasPhoto = useAsync(() => (photosOn ? fetch(photoUrl(me), { method: "HEAD" }).then((r) => r.ok) : Promise.resolve(false)), false, [photosOn, me, view]);
  const inboxOn = useAsync(() => inboxEnabled(me), false, [me]);
  const pushOn = useAsync(() => pushInfo().then((i) => i.enabled), false, []);
  const requestsHere = useAsync(() => requestsOnHere(me), false, [me, view]);
  const receipt = latestReceipt(me);
  const name = shownName(props.account);
  const back = () => setView("main");

  let limitValue = "";
  try {
    limitValue = copy.limitPerDay(formatAmount(limitNow(settle(new LimitStore(localStorage, DEPLOYMENT, me).get(), Date.now()), Date.now()), LIMIT_DECIMALS, "auto"));
  } catch {
    // Storage refused: no value shown.
  }
  let pick: Lang | null = null;
  try {
    pick = readPick(localStorage);
  } catch {
    // Storage refused: the phone's language.
  }
  const voice = new VoiceStore(localStorage, DEPLOYMENT, me).get();
  const voiceValue = voice.on ? copy.valueOn : copy.valueOff;
  const notesValue = (pushOn && pushOnHere(me)) || (inboxOn && requestsHere) ? copy.valueOn : copy.valueOff;

  const rows: Record<RowId, ReactNode> = {
    name: <Row icon="name" label={copy.displayName} value={props.account.name || copy.valueNotSet} onClick={() => setView("name")} />,
    username: <Row icon="username" label={copy.username} value={u.name ? copy.usernameAt(u.name) : u.name === null ? copy.valueNotSet : undefined} onClick={() => setView("username")} />,
    photo: <Row icon="photo" label={copy.photo} value={hasPhoto ? copy.photoAdded : copy.photoNotAdded} onClick={() => setView("photo")} />,
    limit: <Row icon="limit" label={copy.dailyLimit} value={limitValue} onClick={() => setView("limit")} />,
    hidden: <Row icon="hidden" label={copy.hiddenPots} value={String(props.hidden.length)} onClick={() => setView("hidden")} />,
    receipt: receipt ? <Row icon="receipt" label={copy.lastReceipt} href={receiptUrl(receipt)} /> : null,
    devices: <Row icon="devices" label={copy.devicesAndSessions} onClick={() => setView("devices")} />,
    language: <Row icon="language" label={copy.language} value={pick ? LANGUAGE_NAMES[pick] : copy.languagePhone} onClick={() => setView("language")} />,
    notifications: <Row icon="notifications" label={copy.notifications} value={notesValue} onClick={() => setView("notifications")} />,
    voice: <Row icon="voice" label={copy.voiceTitle} value={voiceValue} onClick={() => setView("voice")} />,
    help: <Row icon="help" label={copy.helpAndSupport} onClick={() => openHelp()} />,
    install: <Row icon="install" label={copy.installTheApp} onClick={() => setView("install")} />,
  };

  const copyId = () => {
    navigator.clipboard
      .writeText(me)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  switch (view) {
    case "name":
      return (
        <Detail title={copy.displayName} onBack={back}>
          <DisplayNameForm account={me} initial={props.account.name} onRename={props.onRename} onDone={back} onSkip={back} skipLabel={copy.back} />
        </Detail>
      );
    case "photo":
      return (
        <Detail title={copy.photo} onBack={back}>
          <PhotoSection account={me} name={name} inScreen />
        </Detail>
      );
    case "username":
    case "choose":
      return (
        <Detail title={copy.username} onBack={back}>
          <UsernameSection me={me} start={view === "choose" ? "choose" : "view"} inScreen />
        </Detail>
      );
    case "limit":
      return (
        <Detail title={copy.dailyLimit} onBack={back}>
          <DailyLimitSection account={me} />
        </Detail>
      );
    case "hidden":
      return (
        <Detail title={copy.hiddenPots} onBack={back}>
          <p className="hint">{copy.hiddenPotsHint}</p>
          {props.hidden.length === 0 ? (
            <p className="empty-state">{copy.noHiddenPots}</p>
          ) : (
            <div className="settings-list">
              {props.hidden.map((h) => (
                <div className="settings-item" key={`hidden-${h.potId}`}>
                  <span className="settings-label">{h.name || copy.unnamedPot}</span>
                  <button type="button" className="text-btn" onClick={() => props.onUnhide(h.potId)}>
                    {copy.showAgain}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Detail>
      );
    case "devices":
      return (
        <Detail title={copy.devicesAndSessions} onBack={back}>
          <DevicesSection current={me} onRemoved={props.onRemoved} />
        </Detail>
      );
    case "language":
      return (
        <Detail title={copy.language} onBack={back}>
          <div className="settings-list" role="radiogroup" aria-label={copy.language}>
            {LANGUAGE_CHOICES.map((l) => (
              <button
                type="button"
                role="radio"
                aria-checked={pick === l}
                className="settings-item choice"
                key={l ?? "phone"}
                lang={l ?? undefined}
                onClick={() => pick !== l && pickLanguage(l)}
              >
                <span className="settings-label">{l ? LANGUAGE_NAMES[l] : copy.languagePhone}</span>
                {pick === l && <Icon name="check" size={20} className="settings-tick" />}
              </button>
            ))}
          </div>
          <p className="hint settings-note">{copy.languageHint}</p>
          {language() !== "en" && <p className="hint settings-note">{copy.translationNote}</p>}
        </Detail>
      );
    case "notifications":
      return (
        <Detail title={copy.notifications} onBack={back}>
          <NotificationsSection account={me} names={props.names} onMuted={props.onMuted} />
        </Detail>
      );
    case "voice":
      return (
        <Detail title={copy.voiceTitle} onBack={back}>
          <VoiceSection account={me} />
        </Detail>
      );
    case "install":
      return (
        <Detail title={copy.installTheApp} onBack={back}>
          {installWay && <InstallHow way={installWay} onInstalled={back} />}
        </Detail>
      );
  }

  return (
    <section className="profile-page" aria-label={copy.tabProfile}>
      <div className="profile-card">
        <button type="button" className="profile-face" aria-label={photosOn ? copy.photo : copy.changeName} onClick={() => setView(photosOn ? "photo" : "name")}>
          {photosOn ? <Avatar account={me} name={name} size={80} /> : <span className="profile-initial">{(Array.from(name.trim())[0] ?? "?").toLocaleUpperCase()}</span>}
        </button>
        <h2 className="profile-name">{name}</h2>
        <button type="button" className="text-btn small" onClick={() => setView("name")}>
          {copy.changeName}
        </button>
        <div className="profile-id">
          <span className="meta">{copy.accountEndingTitle(me)}</span>
          <button type="button" className="text-btn small" aria-label={copy.copyAccountId} onClick={copyId}>
            {copied ? copy.copied : copy.copyAction}
          </button>
        </div>
        {photosOn && <p className="hint profile-note">{copy.photoPublic}</p>}
        {namesOn && (
          <div className="profile-username">
            {u.name === undefined && u.failed ? (
              <>
                <span className="meta">{copy.usernameCheckFailed}</span>
                <button type="button" className="text-btn small" onClick={() => void u.recheck()}>
                  {copy.tryAgain}
                </button>
              </>
            ) : u.name === undefined ? (
              <span className="meta">{copy.checkingUsername}</span>
            ) : u.name ? (
              <>
                <span className="name">{copy.usernameAt(u.name)}</span>
                <button type="button" className="text-btn small" onClick={() => setView("username")}>
                  {copy.changeUsername}
                </button>
              </>
            ) : (
              <button type="button" className="btn small" onClick={() => setView("choose")}>
                {copy.chooseUsername}
              </button>
            )}
          </div>
        )}
      </div>

      {profileGroups({
        namesOn,
        photosOn,
        hiddenPots: props.hidden.length,
        hasReceipt: Boolean(receipt),
        notificationsOn: inboxOn || pushOn,
        voiceOffered: voiceOffered(),
        canInstall: Boolean(installWay),
      }).map((g) => (
        <Group key={g.group} label={GROUP_TEXT[g.group]}>
          {g.rows.map((r) => (
            <Fragment key={r}>{rows[r]}</Fragment>
          ))}
        </Group>
      ))}

      <button type="button" className="btn ghost profile-switch" onClick={props.onSwitch}>
        {copy.switchAccount}
      </button>
      <p className="profile-version">{copy.appVersion(VERSION)}</p>
    </section>
  );
}
