import "@fontsource/besley/600.css";
import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/600.css";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, continueRender, delayRender, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { fact, FACTS, shortHex } from "./facts.ts";
import { RedactedClip } from "./Redact.tsx";
import { visibleArea, visiblePixels, type ClipEntry, type Redactions } from "./redactions.ts";
import receiptsFile from "./receipts.json" with { type: "json" };
import type { Receipts } from "./receipts.ts";
import { heldTag, isPlaceholder, NOT_MEASURED, onPhone, phoneStill, resolve, segmentFrames, SPED_UP_TAG, starts, type Segment, type Take, type Timeline } from "./timeline.ts";
import { PHONE_FRAME, type PhoneFrame } from "./phone/frame.ts";
import { PhoneStage3D, type ScreenSource } from "./phone/Phone3D.tsx";
import { screenFileFor } from "./phone/screens.ts";

/** `frame` overrides the one setting in phone/frame.ts, for the prototype and tests only. */
export type VideoProps = { timeline: Timeline; map: Redactions | null; frame?: PhoneFrame };

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

const visibleAspect = (e: ClipEntry) => {
  const v = visibleArea(e);
  return (e.width * v.w) / (e.height * v.h);
};

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
        // Word by word, three frames apart: each rises, overshoots a little and settles.
        const o = props.build === false ? 1 : interpolate(frame - i * 3, [0, 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const s = props.build === false ? 1 : interpolate(frame - i * 3, [0, 6, 11], [0.6, 1.08, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const unmeasured = w.includes(marker);
        return (
          <span key={i} style={{ opacity: o, display: "inline-block", transform: `translateY(${(1 - o) * 28}px) scale(${s})`, transformOrigin: "50% 80%", ...(unmeasured ? { background: "repeating-linear-gradient(45deg,#7a1d1d 0 8px,#3a0d0d 8px 16px)", padding: "0 6px" } : {}) }}>
            {w}
            {i < parts.length - 1 ? "\u00a0" : ""}
          </span>
        );
      })}
    </span>
  );
}

function SpedUp(props: { speed: number; size: number }) {
  return <Tag text={`${SPED_UP_TAG} \u00d7${props.speed}`} size={props.size} />;
}

function Tag(props: { text: string; size: number }) {
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
      {props.text}
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
            <RedactedClip clip={take.clip} from={take.in} to={take.out} map={props.map} speed={s.speed ?? 1} holdFontSize={props.width * 0.07} hold={take.hold} />
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

/**
 * What one take shows on the 3D phone's screen: the file video:screens
 * rendered for it, already redacted and at the segment's speed, or a
 * placeholder card with the shot it waits for. Never the raw recording.
 */
function screenSource(s: Segment, take: Take, map: Redactions | null, frames: number): ScreenSource {
  if (take.clip === null) {
    return { kind: "placeholder", aspect: aspectOf(s, take, map), lines: [`Shot ${s.shot}`, s.plan, `${take.in} to ${take.out} s of the recording, ${(frames / 30).toFixed(1)} s on screen`] };
  }
  const entry = map?.clips[take.clip];
  if (!entry?.reviewed) throw new Error(`clip ${take.clip} has no reviewed entry in redactions.json, so it can't be rendered`);
  return { kind: "redacted", file: screenFileFor({ ...take, clip: take.clip }, s.speed ?? 1), ...visiblePixels(entry) };
}

/** Phone shots in the 3D phone: one phone, or two side by side with their labels above. */
function Phones3D(props: { segment: Segment; takes: Take[]; labels: (string | undefined)[]; map: Redactions | null; area: { x: number; y: number; w: number; h: number }; labelH: number; frames: number }) {
  const { segment: s, area, labelH } = props;
  const two = props.takes.length === 2;
  return (
    <>
      {two
        ? props.labels.map((l, i) =>
            l ? (
              <div key={i} style={{ position: "absolute", top: area.y, height: labelH, left: area.x + (area.w / 2) * i, width: area.w / 2, display: "flex", justifyContent: "center", alignItems: "flex-end" }}>
                <Text text={l} build={false} style={{ fontFamily: SANS, fontWeight: 600, color: C.text, fontSize: 40 }} />
              </div>
            ) : null,
          )
        : null}
      <div style={{ position: "absolute", left: area.x, top: area.y + labelH, width: area.w, height: area.h - labelH }}>
        <PhoneStage3D
          sources={props.takes.map((t) => screenSource(s, t, props.map, props.frames))}
          width={area.w}
          height={area.h - labelH}
          frames={props.frames}
          still={phoneStill(s)}
          // A placeholder is never zoomed, so its text stays readable.
          zoom={s.take?.clip != null ? s.zoom : undefined}
        />
      </div>
    </>
  );
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
      {s.lines ? <Lines lines={s.lines} square={square} /> : null}
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
function SegmentView(props: { segment: Segment; map: Redactions | null; frames: number; legend?: string[]; frame: PhoneFrame }) {
  const { segment: s, map, frames } = props;
  const { width, height } = useVideoConfig();
  const square = width === height;
  if (s.kind === "card") return <Card segment={s} square={square} />;
  const speed = s.speed ?? 1;
  const captionSize = square ? 64 : 84;
  const calloutSize = square ? 38 : 44;
  const held = heldTag(s);
  const words = (
    <>
      {s.caption ? <Text text={s.caption} style={{ display: "block", fontFamily: SERIF, fontWeight: 600, color: C.text, fontSize: captionSize, lineHeight: 1.18 }} /> : null}
      {s.callout ? <Text text={s.callout} style={{ display: "block", marginTop: captionSize * 0.45, fontFamily: SANS, color: C.muted, fontSize: calloutSize, lineHeight: 1.3 }} /> : null}
      {speed > 1 ? <SpedUp speed={speed} size={calloutSize * 0.9} /> : null}
      {held ? <Tag text={held} size={calloutSize * 0.9} /> : null}
    </>
  );
  if (s.kind === "receipt") {
    return (
      <AbsoluteFill>
        <div style={square ? { position: "absolute", left: 60, right: 60, top: 50, height: 230, textAlign: "center" } : { position: "absolute", left: 110, width: 640, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {words}
        </div>
        <ReceiptCard segment={s} area={square ? { x: 60, y: 300, w: width - 120, h: height - 340 } : { x: 800, y: 50, w: width - 860, h: height - 100 }} />
      </AbsoluteFill>
    );
  }
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
      {props.frame === "3d" && onPhone(s) ? (
        <Phones3D segment={s} takes={takes} labels={labels} map={map} area={area} labelH={labelH} frames={frames} />
      ) : (
      <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", justifyContent: "center", alignItems: "center", gap }}>
        {takes.map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            {labels[i] ? <Text text={labels[i]!} build={false} style={{ fontFamily: SANS, fontWeight: 600, color: C.text, fontSize: 40 }} /> : null}
            <Footage segment={s} take={t} map={map} width={boxes[i]!.width} height={boxes[i]!.height} frames={frames} />
          </div>
        ))}
      </div>
      )}
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
            <SegmentView segment={s} map={map} frames={frames} legend={t.legend} frame={props.frame ?? PHONE_FRAME} />
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

/** Feature lines under a card's title, one after another. */
function Lines(props: { lines: string[]; square: boolean }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: props.square ? 18 : 22, marginTop: 16, textAlign: "left", maxWidth: props.square ? 900 : 1400 }}>
      {props.lines.map((l, i) => {
        const o = interpolate(frame - 18 - i * 14, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={i} style={{ opacity: o, transform: `translateX(${(1 - o) * -30}px)`, display: "flex", gap: 18, alignItems: "baseline", fontFamily: SANS, color: C.text, fontSize: props.square ? 34 : 40, lineHeight: 1.3 }}>
            <span style={{ color: C.primary, fontWeight: 600 }}>{"\u2022"}</span>
            <span>{resolve(l)}</span>
          </div>
        );
      })}
    </div>
  );
}

const RECEIPTS = receiptsFile as Receipts;

/**
 * A transaction's receipt as read from the chain (scripts/read-receipts.ts):
 * status, block, finalized, each Transfer with its amount and the recipient's
 * last four. Every number on it is from receipts.json, never typed in.
 */
function ReceiptCard(props: { segment: Segment; area: { x: number; y: number; w: number; h: number } }) {
  const frame = useCurrentFrame();
  const hash = fact(props.segment.receipt ?? "");
  const r = hash ? RECEIPTS.receipts[hash] : undefined;
  if (!hash || !r) throw new Error(`${props.segment.id}: no receipt read for ${props.segment.receipt}; run node scripts/read-receipts.ts`);
  const rows: [string, string][] = [
    ["Status", r.status === "success" ? "Success" : "Reverted"],
    ["Block", r.block.toLocaleString("en-US")],
    ["Finalized", r.finalized ? "Yes" : "Not yet"],
    ["Transfer logs", String(r.transfers.length)],
    ...r.transfers.map((x): [string, string] => [r.transfers.length > 1 ? `Transfer, ${x.token}` : "Amount", `${x.amount} ${x.token} to address ending ${x.toLastFour}`]),
  ];
  const w = Math.min(props.area.w * 0.94, 980);
  const rise = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: props.area.x + (props.area.w - w) / 2, top: props.area.y, width: w, height: props.area.h, display: "flex", alignItems: "center" }}>
      <div style={{ width: "100%", opacity: rise, transform: `translateY(${(1 - rise) * 40}px)`, background: "#fbf3e8", borderRadius: 28, padding: "40px 48px", boxShadow: "0 30px 80px rgba(0,0,0,0.55)", fontFamily: SANS, color: "#2b1d14" }}>
        <div style={{ display: "inline-block", background: C.primary, color: "white", fontWeight: 600, fontSize: 26, padding: "6px 18px", borderRadius: 999 }}>Read from Monad testnet</div>
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 52, marginTop: 20 }}>Receipt</div>
        <div style={{ fontSize: 30, color: "#7a5a44", marginTop: 4, fontFamily: "monospace" }}>{shortHex(hash)}</div>
        <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map(([k, v], i) => {
            const o = interpolate(frame - 16 - i * 9, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <div key={i} style={{ opacity: o, transform: `translateX(${(1 - o) * 24}px)`, display: "flex", justifyContent: "space-between", gap: 24, borderTop: "2px solid #ead8c4", paddingTop: 12, fontSize: 34 }}>
                <span style={{ color: "#7a5a44" }}>{k}</span>
                <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
