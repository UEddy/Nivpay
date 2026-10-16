import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { describeFailure } from "../lib/errors.ts";
import { makePhoto, photoUrl, removePhoto, uploadPhoto } from "../lib/photo.ts";
import { reloadOnce } from "../lib/reloadOnce.ts";
import { Avatar, photoChanged, usePhotosOn } from "./Avatar.tsx";
import { NoticeLine, Sheet, type Notice } from "./ui.tsx";

// The signing code loads only when a photo is saved or removed.
const passkeys = () => reloadOnce(() => import("../lib/passkey.ts"));

/**
 * Photo, in Account details: Add, Change or Remove, from the camera or the
 * gallery, through a file input (so the camera=() header stays). The picture
 * is redrawn on a canvas here (lib/photo.ts), shown before anything is sent,
 * with who can see it, and saved with one fingerprint.
 */
export function PhotoSection(props: { account: Address; name: string; inScreen?: boolean }) {
  const on = usePhotosOn();
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [asking, setAsking] = useState(false);
  const [has, setHas] = useState(false);
  const [version, setVersion] = useState(0);
  // Whether this account has a photo, asked of the server, not guessed from a failed image.
  useEffect(() => {
    if (!on) return;
    let live = true;
    fetch(photoUrl(props.account), { method: "HEAD" })
      .then((r) => live && setHas(r.ok))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [on, props.account]);
  if (!on) return null;

  const sign = async (message: string) => {
    const { withSigner } = await passkeys();
    return withSigner(props.account, (a) => a.signMessage({ message }));
  };

  const chosen = async (file: File | undefined) => {
    setNotice(null);
    setReady(null);
    if (!file || !canvas.current) return;
    try {
      setReady(await makePhoto(file, canvas.current));
    } catch {
      setNotice({ tone: "bad", text: copy.errPhotoUnreadable, code: ERROR_CODES.PHOTO_UNREADABLE });
    }
  };

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setNotice(null);
    try {
      await uploadPhoto(props.account, ready, sign);
      photoChanged(props.account);
      setHas(true);
      setReady(null);
      setNotice({ tone: "ok", text: copy.photoSaved });
    } catch (e) {
      setNotice(e instanceof Error && /photo refused/.test(e.message) ? { tone: "bad", text: copy.errPhotoSave, code: ERROR_CODES.PHOTO_SAVE_FAILED } : { tone: "bad", ...describeFailure(e) });
    } finally {
      setBusy(false);
      setVersion((n) => n + 1);
    }
  };

  const remove = async () => {
    setAsking(false);
    setBusy(true);
    setNotice(null);
    try {
      await removePhoto(props.account, sign);
      photoChanged(props.account, true);
      setHas(false);
      setNotice({ tone: "ok", text: copy.photoRemoved });
    } catch (e) {
      setNotice(e instanceof Error && /photo refused/.test(e.message) ? { tone: "bad", text: copy.errPhotoSave, code: ERROR_CODES.PHOTO_SAVE_FAILED } : { tone: "bad", ...describeFailure(e) });
    } finally {
      setBusy(false);
      setVersion((n) => n + 1);
    }
  };

  return (
    <section aria-labelledby="photo-title" className="photo-section">
      <p className={props.inScreen ? "sr-only" : "eyebrow"} id="photo-title">
        {copy.photo}
      </p>
      <div className="photo-row">
        {/* A new key after each change, so the photo shown is the new one. */}
        <Avatar key={version} account={props.account} name={props.name} size={64} />
        <canvas ref={canvas} className={`photo-preview${ready ? " on" : ""}`} width={256} height={256} aria-hidden={!ready} />
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void chosen(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {ready ? (
        <>
          <p className="hint">{copy.photoPublic}</p>
          <p className="hint">{copy.photoHint}</p>
          <button type="button" className="btn primary" disabled={busy} aria-busy={busy} onClick={() => void save()}>
            {busy ? copy.savingPhoto : copy.usePhoto}
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setReady(null)}>
            {copy.back}
          </button>
        </>
      ) : (
        <div className="new-pot-actions">
          <button type="button" className="btn small" disabled={busy} onClick={() => input.current?.click()}>
            {has ? copy.changePhoto : copy.addPhoto}
          </button>
          {has && (
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => setAsking(true)}>
              {copy.removePhoto}
            </button>
          )}
        </div>
      )}
      {!ready && <p className="hint">{copy.photoPublic}</p>}
      {notice && <NoticeLine notice={notice} />}
      {asking && (
        <Sheet title={copy.removePhotoTitle} onClose={() => setAsking(false)}>
          <p className="lede">{copy.removePhotoLede}</p>
          <button type="button" className="pill-btn" onClick={() => void remove()}>
            {copy.removePhoto}
          </button>
          <button type="button" className="btn ghost" onClick={() => setAsking(false)}>
            {copy.back}
          </button>
        </Sheet>
      )}
    </section>
  );
}
