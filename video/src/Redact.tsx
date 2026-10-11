import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { regionsAt, timeline, type ClipEntry, type Redactions } from "./redactions.ts";
import { FPS, pieceFrames } from "./timing.ts";

export type RedactedClipProps = { clip: string; from: number; to: number; map: Redactions | null; speed?: number; holdFontSize?: number };

/** A strong blur plus an 85 percent tint, over a region and its padding. Fractions are of the uncropped frame. */
export function Redact(props: { entry: ClipEntry; t: number }) {
  const { entry, t } = props;
  const visible = 1 - entry.statusBar - (entry.bottomBar ?? 0);
  return (
    <>
      {regionsAt(entry, t).map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${r.rect.x * 100}%`,
            top: `${((r.rect.y - entry.statusBar) / visible) * 100}%`,
            width: `${r.rect.w * 100}%`,
            height: `${(r.rect.h / visible) * 100}%`,
            backdropFilter: "blur(48px)",
            WebkitBackdropFilter: "blur(48px)",
            background: "rgba(36, 28, 24, 0.85)",
          }}
        />
      ))}
    </>
  );
}

/** The phone frame with the status bar and notification area cropped off the top, always, and any bottom bar. */
function Cropped(props: { entry: ClipEntry; from: number; to: number; speed: number }) {
  const { entry } = props;
  const frame = useCurrentFrame();
  const t = props.from + (frame * props.speed) / FPS;
  const visible = 1 - entry.statusBar - (entry.bottomBar ?? 0);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "black" }}>
      <OffthreadVideo
        src={staticFile(entry.file)}
        trimBefore={Math.round(props.from * FPS)}
        trimAfter={Math.round(props.to * FPS)}
        muted
        playbackRate={props.speed}
        style={{ position: "absolute", left: 0, top: `${(-entry.statusBar / visible) * 100}%`, width: "100%", height: `${(1 / visible) * 100}%` }}
      />
      <Redact entry={entry} t={t} />
    </AbsoluteFill>
  );
}

/** A black hold in place of a cut or of the phone's own blackout, with its true caption. */
function BlackHold(props: { caption: string; fontSize?: number }) {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "black", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#f7efe4", fontFamily: "Work Sans, sans-serif", fontSize: props.fontSize ?? width * 0.05, margin: 0, textAlign: "center" }}>{props.caption}</p>
    </AbsoluteFill>
  );
}

/** Source seconds [from, to) of one clip, redacted, with cuts taken out. Refuses a clip with no reviewed entry. */
export function RedactedClip(props: RedactedClipProps) {
  const entry = props.map?.clips[props.clip];
  if (!entry?.reviewed) throw new Error(`clip ${props.clip} has no reviewed entry in redactions.json, so it can't be rendered`);
  const speed = props.speed ?? 1;
  let at = 0;
  return (
    <AbsoluteFill style={{ background: "black" }}>
      {timeline(entry, props.from, props.to).map((p, i) => {
        const frames = pieceFrames(p, speed);
        const seq = (
          <Sequence key={i} from={at} durationInFrames={frames}>
            {p.kind === "clip" ? <Cropped entry={entry} from={p.from} to={p.to} speed={speed} /> : <BlackHold caption={p.caption} fontSize={props.holdFontSize} />}
          </Sequence>
        );
        at += frames;
        return seq;
      })}
    </AbsoluteFill>
  );
}
