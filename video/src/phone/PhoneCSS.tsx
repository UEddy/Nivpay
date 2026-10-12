/**
 * The CSS 3D fallback for the phone frame: the same pose as the WebGL phone,
 * drawn with a perspective transform on plain elements. Like the 3D phone,
 * its screen only shows an already redacted file or a placeholder.
 */
import { OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { poseAt } from "./pose.ts";
import { checkedScreenFile } from "./screens.ts";
import type { ScreenSource } from "./Phone3D.tsx";

const fit = (aspect: number, maxW: number, maxH: number) => (maxW / maxH > aspect ? { width: maxH * aspect, height: maxH } : { width: maxW, height: maxW / aspect });

function Screen(props: { source: ScreenSource }) {
  const s = props.source;
  if (s.kind === "redacted") {
    return <OffthreadVideo src={staticFile(checkedScreenFile(s.file))} muted playbackRate={s.playbackRate ?? 1} style={{ width: "100%", height: "100%", display: "block" }} />;
  }
  return (
    <div style={{ width: "100%", height: "100%", background: "repeating-linear-gradient(135deg,#3b2a20 0 24px,#2c1f17 24px 48px)", color: "white", fontFamily: "Work Sans, sans-serif", padding: 24, boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center", gap: 12 }}>
      <div style={{ background: "#b3261e", alignSelf: "flex-start", padding: "4px 12px", fontWeight: 600, fontSize: 30 }}>PLACEHOLDER</div>
      {s.lines.map((l, i) => (
        <div key={i} style={{ fontSize: 22 }}>
          {l}
        </div>
      ))}
    </div>
  );
}

function Phone(props: { source: ScreenSource; width: number; height: number; frames: number; still: boolean; phase: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = poseAt(frame, props.frames, fps, props.still, props.phase);
  const bezel = Math.max(10, props.width * 0.045);
  const radius = props.width * 0.11;
  return (
    <div style={{ perspective: 2400 }}>
      <div
        style={{
          transform: `translateY(${-p.lift * props.height}px) rotateX(${p.rotX}rad) rotateY(${p.rotY}rad)`,
          width: props.width + bezel * 2,
          height: props.height + bezel * 2,
          padding: bezel,
          boxSizing: "border-box",
          borderRadius: radius + bezel,
          // A dark satin slab: an inner rim and a soft shadow stand in for depth.
          background: "linear-gradient(135deg,#3a302a 0%,#1c1714 35%,#120e0c 100%)",
          boxShadow: `inset 0 0 0 2px #4a3f38, 0 ${30 + p.rotX * 200}px 80px rgba(0,0,0,0.55)`,
        }}
      >
        <div style={{ width: props.width, height: props.height, borderRadius: radius, overflow: "hidden", background: "black" }}>
          <Screen source={props.source} />
        </div>
      </div>
    </div>
  );
}

/** One or two phones in a width x height box, posed like the 3D stage. */
export function PhoneStageCSS(props: { sources: ScreenSource[]; width: number; height: number; frames: number; still: boolean }) {
  const two = props.sources.length === 2;
  const each = (props.width - (two ? 60 : 0)) / props.sources.length;
  return (
    <div style={{ width: props.width, height: props.height, display: "flex", justifyContent: "center", alignItems: "center", gap: 60 }}>
      {props.sources.map((s, i) => {
        const aspect = s.kind === "redacted" ? s.width / s.height : s.aspect;
        const box = fit(aspect, each * 0.86, props.height * 0.86);
        return <Phone key={i} source={s} width={box.width} height={box.height} frames={props.frames} still={props.still} phase={i * 1.7} />;
      })}
    </div>
  );
}
