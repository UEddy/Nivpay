/**
 * A generic phone built in code: a bevelled rounded slab with a screen. No brand, no
 * logo, no model file. The screen is unlit, so the footage's pixels are shown
 * as recorded; the phone is a frame only.
 *
 * The screen only ever shows a source that is already redacted: a file
 * rendered by the redaction step (RedactedClip, then video:privacy-check), or
 * a placeholder. It never sees raw footage, so blur and black holds are in the
 * pixels before they reach the screen.
 */
import { useThree } from "@react-three/fiber";
import { Video } from "@remotion/media";
import { ThreeCanvas } from "@remotion/three";
import { useCallback, useEffect, useMemo, useState } from "react";
import { staticFile, useCurrentFrame, useRemotionEnvironment, useVideoConfig } from "remotion";
import { CanvasTexture, ExtrudeGeometry, PMREMGenerator, Shape, ShapeGeometry, SRGBColorSpace, type BufferGeometry } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { poseAt } from "./pose.ts";
import { checkedScreenFile } from "./screens.ts";

/** What a phone's screen shows: a redacted file in footage/, or a placeholder card. */
export type ScreenSource =
  | { kind: "redacted"; file: string; width: number; height: number; playbackRate?: number }
  | { kind: "placeholder"; lines: string[]; aspect: number };

const SCREEN_H = 1.9;
const BEZEL = 0.045;
const DEPTH = 0.085;

function roundedShape(w: number, h: number, r: number): Shape {
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

/** The body: a rounded slab with softly bevelled edges, corners matching the screen. */
function slab(w: number, h: number, r: number): BufferGeometry {
  const bevel = DEPTH * 0.3;
  const g = new ExtrudeGeometry(roundedShape(w - bevel * 2, h - bevel * 2, r - bevel), { depth: DEPTH - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 16 });
  g.translate(0, 0, -(DEPTH - bevel * 2) / 2);
  return g;
}

function roundedRect(w: number, h: number, r: number): BufferGeometry {
  const g = new ShapeGeometry(roundedShape(w, h, r), 12);
  // Map the texture across the whole screen, corner to corner.
  const pos = g.attributes.position!;
  const uv = g.attributes.uv!;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  uv.needsUpdate = true;
  return g;
}

/** Studio light from three's own procedural room: no files fetched. */
function Light() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[2.5, 3, 4]} intensity={1.1} />
    </>
  );
}

function placeholderTexture(lines: string[], aspect: number): CanvasTexture<OffscreenCanvas> {
  const H = 1024;
  const W = Math.round(H * aspect);
  const c = new OffscreenCanvas(W, H);
  const x = c.getContext("2d")!;
  for (let i = -H; i < W + H; i += 48) {
    x.fillStyle = (i / 48) % 2 === 0 ? "#3b2a20" : "#2c1f17";
    x.beginPath();
    x.moveTo(i, 0);
    x.lineTo(i + 24, 0);
    x.lineTo(i + 24 - H, H);
    x.lineTo(i - H, H);
    x.fill();
  }
  x.fillStyle = "#b3261e";
  x.fillRect(24, H * 0.36, W - 48, 64);
  x.fillStyle = "white";
  x.font = "600 44px Work Sans, sans-serif";
  x.fillText("PLACEHOLDER", 40, H * 0.36 + 48);
  x.font = "28px Work Sans, sans-serif";
  lines.forEach((l, i) => x.fillText(l, 40, H * 0.36 + 120 + i * 40, W - 80));
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A redacted file drawn into a texture frame by frame, as Remotion recommends for video in three. */
function VideoScreen(props: { source: Extract<ScreenSource, { kind: "redacted" }>; geometry: BufferGeometry }) {
  const { source } = props;
  const [s] = useState(() => {
    const canvas = new OffscreenCanvas(source.width, source.height);
    const context = canvas.getContext("2d")!;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return { context, texture };
  });
  const { invalidate, advance } = useThree();
  const { isRendering } = useRemotionEnvironment();
  const onVideoFrame = useCallback(
    (frame: CanvasImageSource) => {
      s.context.drawImage(frame, 0, 0, source.width, source.height);
      s.texture.needsUpdate = true;
      if (isRendering) advance(performance.now());
      else invalidate();
    },
    [s, source.width, source.height, invalidate, advance, isRendering],
  );
  return (
    <>
      <Video src={staticFile(checkedScreenFile(source.file))} onVideoFrame={onVideoFrame} muted headless playbackRate={source.playbackRate ?? 1} />
      <mesh geometry={props.geometry} position={[0, 0, DEPTH / 2 + 0.001]}>
        <meshBasicMaterial map={s.texture} toneMapped={false} />
      </mesh>
    </>
  );
}

function Phone(props: { source: ScreenSource; x: number; scale: number; frames: number; still: boolean; phase: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const aspect = props.source.kind === "redacted" ? props.source.width / props.source.height : props.source.aspect;
  const sw = SCREEN_H * aspect;
  const body = useMemo(() => slab(sw + BEZEL * 2, SCREEN_H + BEZEL * 2, 0.085 + BEZEL), [sw]);
  const screen = useMemo(() => roundedRect(sw, SCREEN_H, 0.085), [sw]);
  const placeholder = useMemo(() => (props.source.kind === "placeholder" ? placeholderTexture(props.source.lines, aspect) : null), [props.source, aspect]);
  const p = poseAt(frame, props.frames, fps, props.still, props.phase);
  return (
    <group position={[props.x, p.lift * SCREEN_H, 0]} rotation={[p.rotX, p.rotY, 0]} scale={props.scale}>
      <mesh geometry={body}>
        <meshPhysicalMaterial color="#1c1714" metalness={0.55} roughness={0.32} clearcoat={1} clearcoatRoughness={0.15} />
      </mesh>
      {/* Two side buttons, plain. */}
      <mesh position={[(sw + BEZEL * 2) / 2 + 0.006, 0.45, 0]}>
        <boxGeometry args={[0.014, 0.28, DEPTH * 0.45]} />
        <meshPhysicalMaterial color="#2a221d" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[(sw + BEZEL * 2) / 2 + 0.006, 0.12, 0]}>
        <boxGeometry args={[0.014, 0.16, DEPTH * 0.45]} />
        <meshPhysicalMaterial color="#2a221d" metalness={0.6} roughness={0.3} />
      </mesh>
      {props.source.kind === "redacted" ? (
        <VideoScreen source={props.source} geometry={screen} />
      ) : (
        <mesh geometry={screen} position={[0, 0, DEPTH / 2 + 0.001]}>
          <meshBasicMaterial map={placeholder} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/**
 * One or two phones in a WebGL stage of width x height pixels. `still` holds
 * them face-on and motionless for the whole segment (an amount or "Settled in"
 * to read); otherwise they float and tilt slowly, face-on at both ends.
 */
export function PhoneStage3D(props: { sources: ScreenSource[]; width: number; height: number; frames: number; still: boolean }) {
  const two = props.sources.length === 2;
  // The camera sees SCREEN_H plus a margin top and bottom at rest.
  const viewH = (SCREEN_H + BEZEL * 2) / 0.9;
  const fov = 24;
  const z = viewH / 2 / Math.tan((fov / 2) * (Math.PI / 180));
  const viewW = (viewH * props.width) / props.height;
  const scale = two ? Math.min(1, viewW / 2 / 1.25) : 1;
  return (
    <ThreeCanvas width={props.width} height={props.height} camera={{ fov, position: [0, 0, z], near: 0.1, far: 100 }} gl={{ antialias: true, alpha: true }}>
      <Light />
      {props.sources.map((src, i) => (
        <Phone key={i} source={src} x={two ? (i === 0 ? -1 : 1) * (viewW / 4) : 0} scale={scale} frames={props.frames} still={props.still} phase={i * 1.7} />
      ))}
    </ThreeCanvas>
  );
}
