/**
 * Real screen recordings of the live app, played inside a drawn phone. The
 * phone shows the recording as it was, at its own aspect; a stretch played
 * faster than life always carries a "Sped up" tag.
 */
import type { CSSProperties, ReactNode } from "react";
import { OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { SEGS, segFrames, type Focus, type Seg, type SegId } from "./clips.ts";
import darkFile from "./dark.json" with { type: "json" };

const DARK = darkFile as unknown as Record<string, [number, number][]>;
import { C, DISPLAY, Pill, PopIn, pop, prog, Rays, Rise, Scene, Sfx, Words, type Enter } from "./kit.tsx";

const BEZEL = 16;

/** A phone playing segments one after another, from frame `at` of its scene. */
export function ClipPhone({ segs, x, y, height, at = 0, label, tilt = 0, style }: { segs: SegId[]; x: number; y: number; height: number; at?: number; label?: string; tilt?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const aspect = SEGS[segs[0]].aspect;
  const sh = height - BEZEL * 2;
  const sw = sh * aspect;
  const enter = pop(frame, fps, at - 8, 14);
  let t = at;
  const starts = segs.map((id) => {
    const s = t;
    t += segFrames(id);
    return s;
  });
  const now = segs.findIndex((id, i) => frame >= starts[i] && frame < starts[i] + segFrames(id));
  const speed = now >= 0 ? (SEGS[segs[now]] as Seg).speed ?? 1 : 1;
  const last = segs.length - 1;
  const local = now >= 0 ? (frame - starts[now]) / 30 : -1;
  const dark = now >= 0 && (DARK[segs[now]] ?? []).some(([a, b]) => local >= a - 0.05 && local <= b + 0.05);
  const pw = sw + BEZEL * 2;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: sw + BEZEL * 2, height, transform: `translateY(${(1 - enter) * 80}px) rotate(${tilt}deg)`, opacity: Math.min(1, enter * 2), ...style }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 54, background: C.night, boxShadow: "0 40px 80px rgba(0,0,0,0.35), 0 14px 0 rgba(0,0,0,0.2)" }} />
      <div style={{ position: "absolute", left: BEZEL, top: BEZEL, width: sw, height: sh, borderRadius: 40, overflow: "hidden", background: C.night }}>
        {segs.map((id, i) => (
          // The last segment stays up after it ends, on its held last frame.
          <Sequence key={id + i} from={starts[i]} durationInFrames={i === last ? undefined : segFrames(id)} layout="none">
            <OffthreadVideo src={staticFile(`clips/${id}.mp4`)} muted style={{ width: sw, height: sh, objectFit: "cover", display: "block" }} />
          </Sequence>
        ))}
      </div>
      {dark && (
        <div style={{ position: "absolute", left: BEZEL, top: BEZEL, width: sw, height: sh, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14, color: C.white, fontFamily: DISPLAY, textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: Math.min(90, sw * 0.22) }}>👆🏾</div>
          <div style={{ fontWeight: 900, fontSize: Math.min(34, sw * 0.08) }}>Confirming with fingerprint</div>
          <div style={{ fontWeight: 700, fontSize: Math.min(22, sw * 0.05), opacity: 0.7 }}>The phone hides its screen while it asks</div>
        </div>
      )}
      {segs.map((id, i) =>
        ((SEGS[id] as Seg).focus ?? []).map((f, k) => (
          <Sequence key={`${id}-f${k}`} from={starts[i]} durationInFrames={i === last ? undefined : segFrames(id)} layout="none">
            <Loupe id={id} f={f} sw={sw} sh={sh} pw={pw} />
          </Sequence>
        )),
      )}
      {speed > 1 && (
        <div style={{ position: "absolute", right: -14, top: 40, background: C.gold, color: C.night, fontFamily: DISPLAY, fontWeight: 900, fontSize: 24, padding: "6px 14px", borderRadius: 12, boxShadow: "0 5px 0 rgba(0,0,0,0.2)" }}>
          Sped up ×{speed}
        </div>
      )}
      {label && (
        <div style={{ position: "absolute", left: 0, right: 0, top: height + 14, textAlign: "center" }}>
          <span style={{ background: C.night, color: C.white, fontFamily: DISPLAY, fontWeight: 900, fontSize: 26, padding: "6px 18px", borderRadius: 999 }}>{label}</span>
        </div>
      )}
    </div>
  );
}

/** The width a ClipPhone of this height takes. */
export const phoneWidth = (seg: SegId, height: number) => (height - BEZEL * 2) * SEGS[seg].aspect + BEZEL * 2;

/** A standard footage scene: the step and what to notice on the left, the real phone on the right. */
export function FootageScene({ step, color = C.clay, title, lines, segs, enter = "wipe", bg = C.cream, dark = false, children, at = 6 }: { step?: string; color?: string; title: string; lines: string[]; segs: SegId[]; enter?: Enter; bg?: string; dark?: boolean; children?: ReactNode; at?: number }) {
  const H = 980;
  const pw = phoneWidth(segs[0], H);
  const ink = dark ? C.white : C.ink;
  return (
    <Scene bg={bg} enter={enter}>
      <Rays color={dark ? "rgba(255,255,255,0.04)" : "rgba(165,69,31,0.05)"} cx="78%" cy="50%" />
      <div style={{ position: "absolute", left: 110, top: 150, width: 1700 - pw - 220 }}>
        {step && (
          <PopIn at={0}>
            <Pill bg={color} size={30}>{step}</Pill>
          </PopIn>
        )}
        <Words text={title} at={4} size={92} color={ink} accent={color} style={{ marginTop: 28 }} />
        <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 22 }}>
          {lines.map((l, i) => (
            <Rise key={i} at={30 + i * 20}>
              <div style={{ fontWeight: 800, fontSize: 42, color: ink, display: "flex", gap: 16, alignItems: "baseline", lineHeight: 1.25 }}>
                <span style={{ color, fontSize: 34 }}>●</span>
                <span>{l}</span>
              </div>
              <Sfx at={30 + i * 20} name="pop" vol={0.22} />
            </Rise>
          ))}
        </div>
        <Rise at={20} style={{ marginTop: 50 }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, color: dark ? "rgba(255,255,255,0.65)" : C.muted }}>● Recorded on a phone: the live app at nivpay.vercel.app, test mode</span>
        </Rise>
      </div>
      <ClipPhone segs={segs} x={1920 - pw - 150} y={50} height={H} at={at} tilt={1.5} />
      {children}
    </Scene>
  );
}

/** A count up of seconds from `from`, stopping at `secs`. */
export function Stopwatch({ from, secs, size = 56 }: { from: number; secs: number; size?: number }) {
  const frame = useCurrentFrame();
  const v = Math.min(secs, Math.max(0, (frame - from) / 30));
  const done = frame - from >= secs * 30;
  return <span style={{ fontFamily: "Besley, Georgia, serif", fontSize: size, color: done ? C.gold : C.white, fontVariantNumeric: "tabular-nums" }}>{v.toFixed(1)}s</span>;
}

export const reveal = (frame: number, at: number) => prog(frame, at, at + 12);

/** A moment of the recording, magnified, popping out of the phone. */
function Loupe({ id, f, sw, sh, pw }: { id: SegId; f: Focus; sw: number; sh: number; pw: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = Math.round(f.at * 30);
  if (frame < at - 2) return null;
  const end = f.until !== undefined ? Math.round(f.until * 30) : Infinity;
  if (frame > end + 8) return null;
  const s = pop(frame, fps, at, 11) * (frame > end ? 1 - (frame - end) / 8 : 1);
  const side = f.side ?? "over";
  const maxW = side === "over" ? pw * 1.3 : 640;
  const k = Math.min(maxW / (f.w * sw), 2.6);
  const w = f.w * sw * k, h = f.h * sh * k;
  const cy = BEZEL + (f.y + f.h / 2 + (f.dy ?? 0)) * sh;
  const left = side === "left" ? -w + pw * 0.35 : side === "right" ? pw * 0.65 : (pw - w) / 2;
  return (
    <div style={{ position: "absolute", left, top: cy - h / 2, width: w, height: h, borderRadius: 18, overflow: "hidden", border: `6px solid ${C.gold}`, boxShadow: "0 24px 50px rgba(0,0,0,0.35)", transform: `scale(${0.3 + 0.7 * s})`, opacity: Math.min(1, s * 2), zIndex: 5, background: C.cream }}>
      <OffthreadVideo src={staticFile(`clips/${id}.mp4`)} muted style={{ position: "absolute", left: -f.x * sw * k, top: -f.y * sh * k, width: sw * k, height: sh * k, maxWidth: "none" }} />
      <Sfx at={at} name="pop" vol={0.35} />
    </div>
  );
}
