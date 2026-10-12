/**
 * The phone frame prototype, for approval and for measuring render speed:
 * 10 s at 1920x1080. 0 to 3 s one phone moving, 3 to 6 s the same phone
 * face-on and still (where an amount would be read), 6 to 10 s two phones
 * moving. The screen shows a synthetic test pattern, never footage.
 */
import { AbsoluteFill, Sequence } from "remotion";
import { PhoneStage3D, type ScreenSource } from "./Phone3D.tsx";
import { PhoneStageCSS } from "./PhoneCSS.tsx";

export type PrototypeProps = { renderer: "3d" | "css" };

export const PROTOTYPE_FRAMES = 300;
const TEST: ScreenSource = { kind: "redacted", file: "_screens/test-pattern.mp4", width: 1080, height: 2082 };
const HOLDER: ScreenSource = { kind: "placeholder", lines: ["Second phone", "Prototype only"], aspect: 1080 / 2082 };
const STAGE = { left: 800, top: 50, width: 1060, height: 980 };

const PARTS: { from: number; frames: number; sources: ScreenSource[]; still: boolean; label: string }[] = [
  { from: 0, frames: 90, sources: [TEST], still: false, label: "Moving: a slow float and tilt" },
  { from: 90, frames: 90, sources: [TEST], still: true, label: "Still and face-on: something to read" },
  { from: 180, frames: 120, sources: [TEST, HOLDER], still: false, label: "Two phones" },
];

export function PhonePrototype(props: PrototypeProps) {
  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 70% 40%, rgba(165, 69, 31, 0.28), transparent 60%), #21140d" }}>
      {PARTS.map((p) => (
        <Sequence key={p.from} from={p.from} durationInFrames={p.frames}>
          <div style={{ position: "absolute", left: 110, width: 640, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", fontFamily: "Besley, serif", fontWeight: 600, color: "#faf1e4", fontSize: 64 }}>
            {p.label}
            <span style={{ fontFamily: "Work Sans, sans-serif", fontWeight: 400, fontSize: 34, color: "#e7c29c", marginTop: 24 }}>
              Prototype, {props.renderer === "3d" ? "WebGL phone" : "CSS 3D phone"}
            </span>
          </div>
          <div style={{ position: "absolute", ...STAGE }}>
            {props.renderer === "3d" ? <PhoneStage3D sources={p.sources} width={STAGE.width} height={STAGE.height} frames={p.frames} still={p.still} /> : <PhoneStageCSS sources={p.sources} width={STAGE.width} height={STAGE.height} frames={p.frames} still={p.still} />}
          </div>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
