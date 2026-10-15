import { useEffect, useState, type CSSProperties } from "react";
import type { Address } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";
import { initialsFor, photosEnabled, photoUrl, ReportedPhotos } from "../lib/photo.ts";
import { REASONS, sendReport, type Reason } from "../lib/report.ts";
import { NoticeLine, Sheet, type Notice } from "./ui.tsx";

/**
 * A person's photo, or their initials. Nothing at all while photos aren't
 * set up (api/photo), so the app looks as it always did. Photos come only from
 * this site (/api/photo/<account>). Someone else's photo can be tapped and
 * reported; a photo this phone reported shows as initials from then on.
 */

/** Whether photos are set up, asked once per page. */
export function usePhotosOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    void photosEnabled().then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, []);
  return on;
}

const missing = new Set<string>();
const versions = new Map<string, number>();
const reported = () => {
  try {
    return new ReportedPhotos(localStorage);
  } catch {
    return null;
  }
};

/** After this phone saves or removes a photo: show the new one, not a cached one. */
export function photoChanged(account: Address, removed = false): void {
  const key = account.toLowerCase();
  versions.set(key, (versions.get(key) ?? 0) + 1);
  if (removed) missing.add(key);
  else missing.delete(key);
}

export const photoVersion = (account: Address) => versions.get(account.toLowerCase()) ?? 0;
export const photoKnownMissing = (account: Address) => missing.has(account.toLowerCase()) || Boolean(reported()?.has(account));

const REASON_TEXT: Record<Reason, string> = {
  scam: copy.reasonScam,
  impersonation: copy.reasonImpersonation,
  spam: copy.reasonSpam,
  "not-for-me": copy.reasonNotForMe,
};

export function Avatar(props: { account: Address; name: string; size?: number; reportable?: boolean }) {
  const on = usePhotosOn();
  const key = props.account.toLowerCase();
  const [failed, setFailed] = useState(() => photoKnownMissing(props.account));
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  if (!on) return null;
  const size = props.size ?? 36;
  const style: CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  const face = failed ? (
    <span className="avatar-initials" aria-hidden="true">
      {initialsFor(props.name, props.account)}
    </span>
  ) : (
    <img
      src={photoUrl(props.account, versions.get(key))}
      alt={copy.photoOf(props.name)}
      width={size}
      height={size}
      onError={() => {
        missing.add(key);
        setFailed(true);
      }}
    />
  );
  if (!props.reportable || failed) {
    return (
      <span className="avatar" style={style}>
        {face}
      </span>
    );
  }
  return (
    <>
      <button type="button" className="avatar" style={style} aria-label={copy.photoOf(props.name)} onClick={() => setOpen(true)}>
        {face}
      </button>
      {open && (
        <PhotoSheet
          account={props.account}
          name={props.name}
          onClose={() => setOpen(false)}
          onReported={() => {
            setOpen(false);
            setFailed(true);
            setTick((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

/** Someone else's photo, larger, with Report this photo. */
function PhotoSheet(props: { account: Address; name: string; onClose: () => void; onReported: () => void }) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setNotice(null);
    try {
      await sendReport({ deployment: DEPLOYMENT, photo: props.account, reason });
      reported()?.add(props.account);
      missing.add(props.account.toLowerCase());
      props.onReported();
    } catch {
      setNotice({ tone: "bad", text: copy.errReportFailed, code: ERROR_CODES.REPORT_FAILED });
      setBusy(false);
    }
  };
  return (
    <Sheet title={copy.photoOf(props.name)} onClose={() => !busy && props.onClose()}>
      <img className="photo-large" src={photoUrl(props.account, versions.get(props.account.toLowerCase()))} alt={copy.photoOf(props.name)} width={192} height={192} />
      <p className="eyebrow">{copy.reportPhoto}</p>
      <div className="report-reasons" role="radiogroup" aria-label={copy.reportPhoto}>
        {REASONS.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} className={`btn${reason === r ? " primary" : ""}`} disabled={busy} onClick={() => setReason(r)}>
            {REASON_TEXT[r]}
          </button>
        ))}
      </div>
      {notice && <NoticeLine notice={notice} />}
      <button type="button" className={`pill-btn${busy ? " busy" : ""}`} disabled={!reason || busy} onClick={() => void send()}>
        {busy ? copy.sendingReport : copy.sendReport}
      </button>
      <button type="button" className="btn ghost" disabled={busy} onClick={props.onClose}>
        {copy.close}
      </button>
    </Sheet>
  );
}
