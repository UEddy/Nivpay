import "@fontsource/besley/600.css";
import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/600.css";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, continueRender, delayRender, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { FACTS } from "./facts.ts";
import { RedactedClip } from "./Redact.tsx";
import type { ClipEntry, Redactions } from "./redactions.ts";
import { isPlaceholder, NOT_MEASURED, resolve, segmentFrames, SPED_UP_TAG, starts, type Segment, type Take, type Timeline } from "./timeline.ts";

export type VideoProps = { timeline: Timeline; map: Redactions | null };

/** The app's clay palette (app/src/styles.css), on a dark ground so the phone screen carries the light. */
const C = {
  ground: "#21140d",
  glow: "rgba(165, 69, 31, 0.28)",
  text: "#faf1e4",
  muted: "#e7c29c",
  primary: "#a5451f",
  bezel: "#0d0907",
};
const SERIF = "Besley, serif";
const SANS = "Work Sans, sans-serif";

/** The S24's recording with the status bar and the browser's bottom toolbar cropped, for placeholders. */
const PHONE_ASPECT = 1080 / (2340 * (1 - 0.04 - 0.07));
const PC_ASPECT = 16 / 9;

const visibleAspect = (e: ClipEntry) => e.width / (e.height * (1 - e.statusBar - (e.bottomBar ?? 0)));

function useFonts() {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    document.fonts.ready.then(() => continueRender(handle));
  }, [handle]);
}

/** A fact not measured yet is shown struck through in a draft, never as a number. */
function Text(props: { text: string; style?: CSSProperties; build?: boolean }) {
  const frame = useCurrentFrame();
  const marker = NOT_MEASURED.replaceAll(" ", "\u00a0");
  const parts = resolve(props.text).replaceAll(NOT_MEASURED, marker).split(" ");
  return (
    <span style={props.style}>
      {parts.map((w, i) => {
        // Word by word, two frames apart, as Sample Vid 2 builds its captions.
        const o = props.build === false ? 1 : interpolate(frame - i * 2, [0, 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const unmeasured = w.includes(marker);
        return (
          <span key={i} style={{ opacity: o, display: "inline-block", transform: `translateY(${(1 - o) * 12}px)`, ...(unmeasured ? { background: "repeating-linear-gradient(45deg,#7a1d1d 0 8px,#3a0d0d 8px 16px)", padding: "0 6px" } : {}) }}>
            {w}
            {i < parts.length - 1 ? "\u00a0" : ""}
          </span>
        );
      })}
    </span>
  );
}

function SpedUp(props: { speed: number; size: number }) {
  return (
    <div
      style={{
        display: "inline-block",
        alignSelf: "flex-start",
        marginTop: props.size * 0.6,
        padding: `${props.size * 0.2}px ${props.size * 0.5}px`,
        borderRadius: 999,
        border: `3px solid ${C.muted}`,
        color: C.muted,
        fontFamily: SANS,
        fontWeight: 600,
        fontSize: props.size,
      }}
    >
      {`${SPED_UP_TAG} \u00d7${props.speed}`}
    </div>
  );
}

/** Clearly not real footage: hatched, watermarked, with the shot it waits for. */
function Placeholder(props: { segment: Segment; take: Take; seconds: number; width: number }) {
  const { segment: s } = props;
  // Sized to the box, so a phone-shaped placeholder reads as well as a PC-shaped one.
  const u = props.width / 500;
  return (
    <AbsoluteFill style={{ background: "repeating-linear-gradient(135deg,#3b2a20 0 24px,#2c1f17 24px 48px)", color: C.text, fontFamily: SANS, overflow: "hidden" }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", transform: "rotate(-30deg)", opacity: 0.22 }}>
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} style={{ fontSize: 64 * u, fontWeight: 600, letterSpacing: 6 * u, whiteSpace: "nowrap" }}>
            PLACEHOLDER PLACEHOLDER PLACEHOLDER
          </div>
        ))}
      </AbsoluteFill>
      <AbsoluteFill style={{ padding: 28 * u, justifyContent: "center", gap: 16 * u }}>
        <div style={{ fontSize: 44 * u, fontWeight: 600, background: "#b3261e", alignSelf: "flex-start", padding: `${4 * u}px ${14 * u}px` }}>PLACEHOLDER</div>
        <div style={{ fontSize: 40 * u, fontWeight: 600 }}>Shot {s.shot}</div>
        <div style={{ fontSize: 30 * u, lineHeight: 1.3 }}>{s.plan}</div>
        <div style={{ fontSize: 28 * u, color: C.muted }}>
          {props.take.in} to {props.take.out} s of the recording, {props.seconds.toFixed(1)} s on screen
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** One recording in a plain device frame, redacted, at the segment's speed and zoom. */
function Footage(props: { segment: Segment; take: Take; map: Redactions | null; width: number; height: number; frames: number }) {
  const { segment: s, take } = props;
  const frame = useCurrentFrame();
  const z = s.zoom;
  // A placeholder is never zoomed, so its text stays readable.
  const scale = z && take.clip !== null ? interpolate(frame, [0, props.frames], [z.from, z.to], { extrapolateRight: "clamp" }) : 1;
  const radius = Math.min(props.width, props.height) * (s.device === "pc" || (s.kind === "explorer" && s.device !== "phone") ? 0.02 : 0.09);
  const bezel = Math.max(10, props.width * 0.03);
  return (
    <div style={{ width: props.width + bezel * 2, height: props.height + bezel * 2, padding: bezel, background: C.bezel, borderRadius: radius + bezel, boxShadow: "0 30px 80px rgba(0,0,0,0.55)", boxSizing: "border-box" }}>
      <div style={{ position: "relative", width: props.width, height: props.height, overflow: "hidden", borderRadius: radius, background: "black" }}>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${scale})`, transformOrigin: z ? `${z.x * 100}% ${z.y * 100}%` : "50% 50%" }}>
          {take.clip === null ? (
            <Placeholder segment={s} take={take} seconds={props.frames / 30} width={props.width} />
          ) : (
            <RedactedClip clip={take.clip} from={take.in} to={take.out} map={props.map} speed={s.speed ?? 1} holdFontSize={props.width * 0.07} />
          )}
        </div>
      </div>
    </div>
  );
}

function aspectOf(s: Segment, take: Take, map: Redactions | null): number {
  const entry = take.clip !== null ? map?.clips[take.clip] : undefined;
  if (entry) return visibleAspect(entry);
  const device = s.device ?? (s.kind === "explorer" ? "pc" : "phone");
  return device === "pc" ? PC_ASPECT : PHONE_ASPECT;
}

/** Fits a box of the given aspect inside maxW by maxH. */
const fit = (aspect: number, maxW: number, maxH: number) => (maxW / maxH > aspect ? { width: maxH * aspect, height: maxH } : { width: maxW, height: maxW / aspect });

function Card(props: { segment: Segment; square: boolean }) {
  const { segment: s, square } = props;
  const frame = useCurrentFrame();
  const pill = interpolate(frame, [12, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: square ? 80 : 200, textAlign: "center", gap: 28 }}>
      {s.title ? <Text text={s.title} style={{ fontFamily: SERIF, fontWeight: 600, color: C.text, fontSize: square ? 76 : 92, lineHeight: 1.15 }} /> : null}
      {s.subtitle ? <Text text={s.subtitle} style={{ fontFamily: SANS, color: C.muted, fontSize: square ? 40 : 46, lineHeight: 1.3 }} /> : null}
      {s.url ? (
        <div style={{ opacity: pill, marginTop: 20, background: C.primary, color: "white", fontFamily: SANS, fontWeight: 600, fontSize: square ? 46 : 52, padding: "18px 44px", borderRadius: 999 }}>
          {FACTS.app.url}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

/**
 * Captions sit beside the footage (16:9) or above it (1:1), never on it, so
 * they can't cover an amount on the phone's screen.
 */
function SegmentView(props: { segment: Segment; map: Redactions | null; frames: number; legend?: string[] }) {
  const { segment: s, map, frames } = props;
  const { width, height } = useVideoConfig();
  const square = width === height;
  if (s.kind === "card") return <Card segment={s} square={square} />;
  const speed = s.speed ?? 1;
  const captionSize = square ? 58 : 72;
  const calloutSize = square ? 38 : 44;
  const words = (
    <>
      {s.caption ? <Text text={s.caption} style={{ display: "block", fontFamily: SERIF, fontWeight: 600, color: C.text, fontSize: captionSize, lineHeight: 1.18 }} /> : null}
      {s.callout ? <Text text={s.callout} style={{ display: "block", marginTop: captionSize * 0.45, fontFamily: SANS, color: C.muted, fontSize: calloutSize, lineHeight: 1.3 }} /> : null}
      {speed > 1 ? <SpedUp speed={speed} size={calloutSize * 0.9} /> : null}
    </>
  );
  const takes = s.kind === "pair" ? [s.take!, s.takeB!] : [s.take!];
  const labels = s.kind === "pair" ? [s.labelA, s.labelB] : [];
  // Where the footage may go.
  const area = square ? { x: 60, y: 300, w: width - 120, h: height - 340 } : { x: 800, y: 50, w: width - 860, h: height - 100 };
  const labelH = s.kind === "pair" ? 70 : 0;
  const gap = 60;
  const each = (area.w - gap * (takes.length - 1)) / takes.length;
  const boxes = takes.map((t) => fit(aspectOf(s, t, map), each * 0.92, (area.h - labelH) * 0.92));
  return (
    <AbsoluteFill>
      <div style={square ? { position: "absolute", left: 60, right: 60, top: 50, height: 230, textAlign: "center" } : { position: "absolute", left: 110, width: 640, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {words}
      </div>
      {props.legend && !square && (s.kind === "phone" || s.kind === "pair") ? <Legend lines={props.legend} /> : null}
      <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", justifyContent: "center", alignItems: "center", gap }}>
        {takes.map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            {labels[i] ? <Text text={labels[i]!} build={false} style={{ fontFamily: SANS, fontWeight: 600, color: C.text, fontSize: 40 }} /> : null}
            <Footage segment={s} take={t} map={map} width={boxes[i]!.width} height={boxes[i]!.height} frames={frames} />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

export function TimelineVideo(props: VideoProps) {
  useFonts();
  const { timeline: t, map } = props;
  const at = starts(t, map);
  const draft = t.segments.some(isPlaceholder) || t.segments.some((s) => [s.caption, s.callout, s.labelA, s.labelB, s.title, s.subtitle].some((x) => x && resolve(x).includes(NOT_MEASURED)));
  return (
    <AbsoluteFill
      style={{ background: `radial-gradient(ellipse at 70% 40%, ${C.glow}, transparent 60%), ${C.ground}` }}
    >
      {t.segments.map((s, i) => {
        const frames = segmentFrames(s, map);
        return (
          <Sequence key={s.id} from={at[i]!} durationInFrames={frames} name={s.id}>
            <SegmentView segment={s} map={map} frames={frames} legend={t.legend} />
          </Sequence>
        );
      })}
      {draft ? <DraftBadge /> : null}
    </AbsoluteFill>
  );
}

/** The example story and who is where, at the top of the caption column. */
function Legend(props: { lines: string[] }) {
  return (
    <div style={{ position: "absolute", left: 110, top: 56, width: 640, fontFamily: SANS, color: C.muted, fontSize: 30, lineHeight: 1.35 }}>
      {props.lines.map((l, i) => (
        <div key={i} style={i === 0 ? { color: C.text, fontWeight: 600, marginBottom: 6 } : undefined}>
          {resolve(l)}
        </div>
      ))}
    </div>
  );
}

/** On every frame of a render that still has placeholders or facts not measured. */
function DraftBadge(): ReactNode {
  return (
    <div style={{ position: "absolute", right: 24, bottom: 20, background: "#b3261e", color: "white", fontFamily: SANS, fontWeight: 600, fontSize: 26, padding: "6px 16px", borderRadius: 6 }}>
      DRAFT, NOT FOR UPLOAD
    </div>
  );
}
