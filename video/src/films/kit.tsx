/**
 * The films' toolkit: NivPay's clay palette pushed bright, chunky rounded
 * type, the app's own clay pot, a flat world map, coins on routes, a drawn
 * phone, colour cards, confetti, scene wipes and Monad's block strip.
 * Everything is drawn in code; nothing here is footage.
 */
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import "@fontsource/besley/600.css";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Audio, continueRender, delayRender, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export const C = {
  night: "#1B0F0A",
  night2: "#2B1810",
  cream: "#FAF1E4",
  paper: "#FFFBF5",
  sand: "#F4E3CB",
  ink: "#3A2317",
  muted: "#6E5243",
  clay: "#A5451F",
  clayDeep: "#7F3316",
  potClay: "#E7C29C",
  lid: "#C8744A",
  teal: "#245C5A",
  tealBright: "#2F8F8A",
  sea: "#3E9C95",
  seaDeep: "#2C7C76",
  land: "#EED9B7",
  landEdge: "#D9BB8E",
  saffron: "#D99A2B",
  gold: "#F2B33D",
  olive: "#5F6F2E",
  plum: "#7A4A63",
  red: "#C8372D",
  white: "#FFFFFF",
};

/** One colour per person, by join order, as in the app. */
export const PEOPLE = [C.clay, C.teal, C.saffron];

export const DISPLAY = "Nunito, system-ui, sans-serif";
export const MONEY = "Besley, Georgia, serif";

export const OVER = 9; // frames a scene's wipe overlaps the one before

/** Holds the render until every font has loaded. */
export function Fonts({ children }: { children: ReactNode }) {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    Promise.all(["900", "800", "700"].map((w) => document.fonts.load(`${w} 40px Nunito`)))
      .then(() => document.fonts.load("600 40px Besley"))
      .then(() => document.fonts.ready)
      .then(() => continueRender(handle));
  }, [handle]);
  return <>{children}</>;
}

// ---------- time helpers ----------

export const easeOut = Easing.bezier(0.2, 0.8, 0.2, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0 to 1 between two local frames, eased. */
export function prog(frame: number, a: number, b: number, easing = easeOut) {
  return interpolate(frame, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
}

export function useSpring(at: number, config: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping: 13, stiffness: 170, mass: 0.8, ...config } });
}

export const pop = (frame: number, fps: number, at: number, damping = 11) =>
  spring({ frame: frame - at, fps, config: { damping, stiffness: 190, mass: 0.7 } });

// ---------- sound ----------

export function Sfx({ at, name, vol = 0.5 }: { at: number; name: string; vol?: number }) {
  if (at < 0) return null;
  return (
    <Sequence from={Math.round(at)} durationInFrames={75} layout="none">
      <Audio src={staticFile(`sound/${name}.wav`)} volume={vol} />
    </Sequence>
  );
}

// ---------- scenes ----------

export type Enter = "cut" | "wipe" | "circle" | "push" | "iris" | "up";

/** A scene's frame: its background, and its wipe over the scene before. */
export function Scene({ bg, enter = "wipe", children, style }: { bg: string; enter?: Enter; children: ReactNode; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = prog(frame, 0, OVER, easeInOut);
  let clip: string | undefined;
  let transform: string | undefined;
  if (enter === "wipe") clip = `polygon(0 0, ${t * 130}% 0, ${t * 130 - 30}% 100%, 0 100%)`;
  if (enter === "circle") clip = `circle(${t * 75}% at 50% 50%)`;
  if (enter === "iris") clip = `circle(${t * 75}% at 50% 42%)`;
  if (enter === "push") transform = `translateX(${(1 - t) * width}px)`;
  if (enter === "up") transform = `translateY(${(1 - t) * height}px)`;
  return (
    <AbsoluteFill style={{ background: bg, clipPath: frame < OVER ? clip : undefined, transform: frame < OVER ? transform : undefined, overflow: "hidden", fontFamily: DISPLAY, ...style }}>
      {children}
    </AbsoluteFill>
  );
}

/** Sunburst rays turning slowly, as on a party card. */
export function Rays({ color = "rgba(255,255,255,0.08)", speed = 0.15, cx = "50%", cy = "45%" }: { color?: string; speed?: number; cx?: string; cy?: string }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: `repeating-conic-gradient(from ${frame * speed}deg at ${cx} ${cy}, ${color} 0deg 9deg, transparent 9deg 18deg)`,
      }}
    />
  );
}

/** A night sky: a warm glow and slow twinkles. */
export function NightSky({ glowAt = "50% 30%", glow = "rgba(242,179,61,0.22)" }: { glowAt?: string; glow?: string }) {
  const frame = useCurrentFrame();
  const stars = Array.from({ length: 34 }, (_, i) => ({ x: (i * 37.7) % 100, y: (i * 61.3) % 100, s: 2 + (i % 3), p: i * 0.7 }));
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at ${glowAt}, ${glow}, transparent 55%), ${C.night}` }}>
      {stars.map((s, i) => (
        <div key={i} style={{ position: "absolute", left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, borderRadius: 9, background: C.gold, opacity: 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(frame / 14 + s.p)) }} />
      ))}
    </AbsoluteFill>
  );
}

/** Falling confetti, the same every render. */
export function Confetti({ count = 36, from = 0, colors = [C.gold, C.clay, C.cream, C.teal, C.saffron] }: { count?: number; from?: number; colors?: string[] }) {
  const frame = useCurrentFrame() - from;
  const { width, height } = useVideoConfig();
  if (frame < 0) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }, (_, i) => {
        const x0 = ((i * 97.13) % 100) / 100 * width;
        const vy = 4 + (i % 7);
        const y = -40 - ((i * 53) % 300) + frame * vy;
        const x = x0 + Math.sin(frame / 12 + i) * 30;
        const r = frame * (2 + (i % 3)) + i * 40;
        if (y > height + 40) return null;
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: 22, height: 13, borderRadius: 3, background: colors[i % colors.length], transform: `rotate(${r}deg)` }} />;
      })}
    </AbsoluteFill>
  );
}

/** Three skylines along the bottom: London, Houston and Nairobi in one line. */
export function Skyline({ color = "rgba(0,0,0,0.18)", height = 180 }: { color?: string; height?: number }) {
  const { width } = useVideoConfig();
  // x, w, h in a 1920 wide strip; the tall ones are the landmarks.
  const blocks: [number, number, number][] = [
    [0, 90, 60], [80, 60, 95], [140, 40, 70], [180, 34, 160], [214, 70, 80], [290, 46, 120], [336, 80, 70],
    [430, 50, 100], [480, 30, 140], [520, 90, 85], [610, 46, 200], [656, 58, 150], [714, 40, 110], [760, 90, 75],
    [860, 70, 95], [930, 40, 130], [975, 30, 175], [1010, 80, 90], [1090, 60, 70], [1150, 44, 115],
    [1200, 40, 185], [1240, 90, 80], [1330, 50, 120], [1380, 70, 65], [1450, 40, 145], [1490, 88, 90],
    [1580, 50, 110], [1630, 36, 160], [1666, 80, 75], [1746, 60, 100], [1806, 114, 70],
  ];
  const k = width / 1920;
  return (
    <svg width={width} height={height} viewBox={`0 0 1920 ${height}`} style={{ position: "absolute", left: 0, bottom: 0 }} preserveAspectRatio="none">
      {blocks.map(([x, w, h], i) => (
        <rect key={i} x={x} y={height - h * k * 0.9 - 0} width={w} height={h * 0.9 + 4} fill={color} />
      ))}
      {/* Big Ben, a spire with a clock face */}
      <polygon points={`196,${height - 150} 214,${height - 190} 232,${height - 150}`} fill={color} />
      {/* KICC, the drum on a column */}
      <rect x={1204} y={height - 200} width={34} height={20} rx={10} fill={color} />
      {/* Houston, a stepped tower */}
      <rect x={618} y={height - 220} width={30} height={22} fill={color} />
    </svg>
  );
}

// ---------- words ----------

type WordsProps = { text: string; at?: number; size: number; color?: string; accent?: string; align?: CSSProperties["textAlign"]; stagger?: number; weight?: number; lineHeight?: number; style?: CSSProperties; font?: string };

/** Word by word, each one popping up. Text between asterisks takes the accent colour, across words or inside one; a newline breaks the line. */
export function Words({ text, at = 0, size, color = C.white, accent = C.gold, align = "left", stagger = 3, weight = 900, lineHeight = 1.05, style, font = DISPLAY }: WordsProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let k = 0;
  let hot = false;
  return (
    <div style={{ fontFamily: font, fontWeight: weight, fontSize: size, lineHeight, color, textAlign: align, letterSpacing: -0.5, ...style }}>
      {text.split("\n").map((line, li) => (
        <div key={li}>
          {line.split(" ").map((w, wi) => {
            const parts = w.split("*").map((p, pi) => {
              if (pi > 0) hot = !hot;
              return { p, hot };
            });
            const s = pop(frame, fps, at + k++ * stagger, 12);
            return (
              <span key={wi} style={{ display: "inline-block", marginRight: "0.24em", opacity: Math.min(1, s * 1.5), transform: `translateY(${(1 - s) * size * 0.5}px) scale(${0.7 + 0.3 * s})` }}>
                {parts.filter((x) => x.p).map((x, xi) => <span key={xi} style={{ color: x.hot ? accent : undefined }}>{x.p}</span>)}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Typed on, a character at a time, with a caret and key ticks. */
export function TypeOn({ text, at = 0, cps = 22, size, color = C.white, accentFrom, accent = C.gold, weight = 900, caret = true, ticks = true, style }: { text: string; at?: number; cps?: number; size: number; color?: string; accentFrom?: number; accent?: string; weight?: number; caret?: boolean; ticks?: boolean; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const per = 30 / cps;
  const shown = Math.max(0, Math.min(text.length, Math.floor((frame - at) / per)));
  const done = shown >= text.length;
  return (
    <div style={{ fontFamily: DISPLAY, fontWeight: weight, fontSize: size, color, lineHeight: 1.1, ...style }}>
      {text.slice(0, shown).split("").map((ch, i) => (
        <span key={i} style={{ color: accentFrom !== undefined && i >= accentFrom ? accent : undefined }}>{ch}</span>
      ))}
      {caret && <span style={{ opacity: done ? (Math.floor(frame / 8) % 2 ? 0 : 1) : 1, color: accent }}>|</span>}
      {ticks && Array.from({ length: Math.ceil(text.length / 2) }, (_, i) => <Sfx key={i} at={at + i * 2 * per} name="tick" vol={0.25} />)}
    </div>
  );
}

export function Pill({ children, bg = C.teal, color = C.white, size = 34, style }: { children: ReactNode; bg?: string; color?: string; size?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: size * 0.4, background: bg, color, fontFamily: DISPLAY, fontWeight: 800, fontSize: size, padding: `${size * 0.35}px ${size * 0.9}px`, borderRadius: 999, boxShadow: "0 10px 0 rgba(0,0,0,0.18)", ...style }}>
      {children}
    </div>
  );
}

/** A thing that pops in at a frame. */
export function PopIn({ at, children, style, from = 0.4 }: { at: number; children: ReactNode; style?: CSSProperties; from?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = pop(frame, fps, at);
  return <div style={{ opacity: Math.min(1, s * 2), transform: `scale(${from + (1 - from) * s})`, ...style }}>{children}</div>;
}

/** Slides up and fades in. */
export function Rise({ at, children, style, dist = 60 }: { at: number; children: ReactNode; style?: CSSProperties; dist?: number }) {
  const frame = useCurrentFrame();
  const t = prog(frame, at, at + 14);
  return <div style={{ opacity: t, transform: `translateY(${(1 - t) * dist}px)`, ...style }}>{children}</div>;
}

/** Whole dollars in flight, exact cents at rest, as the app counts. */
export function Counter({ from, to, at, dur = 24, cents = true, size, color = C.ink, style }: { from: number; to: number; at: number; dur?: number; cents?: boolean; size: number; color?: string; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const t = prog(frame, at, at + dur, easeInOut);
  const v = from + (to - from) * t;
  const resting = t === 0 || t === 1;
  const text = resting && cents ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(v).toLocaleString("en-US");
  return <span style={{ fontFamily: MONEY, fontWeight: 600, fontSize: size, color, fontVariantNumeric: "tabular-nums", ...style }}>${text}</span>;
}

// ---------- the pot ----------

export const POT_PATH = "M72 38 C72 50 60 54 50 63 C28 82 23 118 35 146 C47 173 76 186 100 186 C124 186 153 173 165 146 C177 118 172 82 150 63 C140 54 128 50 128 38 Z";

export type Layer = { color: string; h: number };

/**
 * The app's clay pot. layers are heights as fractions of a full pot, bottom
 * first. lid 0 sits open beside the pot, 1 is shut. lock 0 to 1 pops the
 * lock on.
 */
export function Pot({ size, layers = [], lid = 1, lock = 0, tilt = 0, id = "pot", glow = 0, style }: { size: number; layers?: Layer[]; lid?: number; lock?: number; tilt?: number; id?: string; glow?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const FULL = 128.5;
  let y = 186.5;
  const rects = layers.map((l) => {
    const h = Math.max(0, l.h) * FULL;
    y -= h;
    return { ...l, y, hh: h };
  });
  const top = y;
  const wave = (frame * 1.6) % 40;
  const lidX = (1 - lid) * 122, lidY = (1 - lid) * 150, lidR = (1 - lid) * 6;
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ overflow: "visible", transform: `rotate(${tilt}deg)`, transformOrigin: "50% 90%", ...style }}>
      <defs>
        <clipPath id={`${id}-clip`}><path d={POT_PATH} /></clipPath>
      </defs>
      {glow > 0 && <circle cx="100" cy="115" r="105" fill={C.gold} opacity={0.18 * glow} />}
      <ellipse cx="100" cy="192" rx="70" ry="9" fill="rgba(0,0,0,0.18)" />
      <path d={POT_PATH} fill={C.potClay} />
      <g clipPath={`url(#${id}-clip)`}>
        {rects.map((r, i) => <rect key={i} x="0" y={r.y} width="200" height={r.hh + 1} fill={r.color} />)}
        {rects.length > 0 && top < 186 && (
          <path transform={`translate(${-wave} ${top - 3})`} d="M-40 3 Q-30 -1 -20 3 T0 3 T20 3 T40 3 T60 3 T80 3 T100 3 T120 3 T140 3 T160 3 T180 3 T200 3 T220 3 T240 3 V6 H-40 Z" fill={rects[rects.length - 1].color} />
        )}
        <path d="M40 76 L50 82 L60 76 L70 82 L80 76 L90 82 L100 76 L110 82 L120 76 L130 82 L140 76 L150 82 L160 76" fill="none" stroke={C.ink} strokeWidth="3" opacity="0.28" />
        <ellipse cx="62" cy="110" rx="9" ry="30" fill="#fff" opacity="0.18" />
      </g>
      <path d={POT_PATH} fill="none" stroke={C.ink} strokeWidth="5.5" strokeLinejoin="round" />
      <g transform={`translate(${lidX} ${lidY}) rotate(${lidR} 100 36)`}>
        <rect x="62" y="29" width="76" height="14" rx="7" fill={C.lid} stroke={C.ink} strokeWidth="5.5" />
        <rect x="92" y="20" width="16" height="11" rx="4" fill={C.lid} stroke={C.ink} strokeWidth="4.5" />
      </g>
      {lock > 0 && (
        <g transform={`translate(100 58) scale(${lock})`}>
          <rect x="-21" y="-21" width="42" height="42" rx="10" fill={C.clay} stroke={C.ink} strokeWidth="4" />
          <rect x="-9" y="-3" width="18" height="14" rx="3" fill={C.white} />
          <path d="M-5.5 -3 V-8 a5.5 5.5 0 0 1 11 0 V-3" fill="none" stroke={C.white} strokeWidth="3.5" />
        </g>
      )}
    </svg>
  );
}

/** The NivPay mark (brand/nivpay-mark.svg): the family's pot, and a lid that is a padlock. */
export function Mark({ size, id = "mark", outline = C.ink, style }: { size: number; id?: string; outline?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ overflow: "visible", ...style }}>
      <defs><clipPath id={`${id}-pot`}><path d={POT_PATH} /></clipPath></defs>
      <path d="M82 33 V21 a18 18 0 0 1 36 0 V33" fill="none" stroke={outline} strokeWidth="9" strokeLinecap="round" />
      <path d={POT_PATH} fill={C.potClay} />
      <g clipPath={`url(#${id}-pot)`}>
        <rect x="0" y="150" width="200" height="40" fill={C.clay} />
        <rect x="0" y="122" width="200" height="29" fill={C.teal} />
        <path d="M0 103 Q12.5 96 25 103 T50 103 T75 103 T100 103 T125 103 T150 103 T175 103 T200 103 V123 H0 Z" fill={C.saffron} />
        <ellipse cx="60" cy="96" rx="8" ry="22" fill="#fff" opacity="0.28" />
      </g>
      <path d={POT_PATH} fill="none" stroke={outline} strokeWidth="7" strokeLinejoin="round" />
      <rect x="58" y="28" width="84" height="16" rx="8" fill={C.lid} stroke={outline} strokeWidth="7" />
      <circle cx="100" cy="135" r="8.5" fill={C.cream} />
      <path d="M95 139 L105 139 L108.5 160 L91.5 160 Z" fill={C.cream} />
    </svg>
  );
}

// ---------- coins, routes, pins ----------

export type Pt = { x: number; y: number };
export const qAt = (p0: Pt, c: Pt, p1: Pt, t: number): Pt => ({
  x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c.x + t ** 2 * p1.x,
  y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * c.y + t ** 2 * p1.y,
});
/** The part of a quadratic curve from 0 to t, as a path. */
export function qPart(p0: Pt, c: Pt, p1: Pt, t: number) {
  const c1 = { x: p0.x + (c.x - p0.x) * t, y: p0.y + (c.y - p0.y) * t };
  const e = qAt(p0, c, p1, t);
  return `M${p0.x} ${p0.y} Q${c1.x} ${c1.y} ${e.x} ${e.y}`;
}
/** A control point that bows the line between two points. */
export const bow = (a: Pt, b: Pt, k = 0.25): Pt => ({ x: (a.x + b.x) / 2 + (b.y - a.y) * k, y: (a.y + b.y) / 2 - (b.x - a.x) * k });

/**
 * Money in flight: a banknote, not a coin. A glyph inside a ring reads as
 * "@" to OCR, and the privacy check refuses an "@"; a note never does.
 */
export function Coin({ x, y, size = 46, spin = 0, label = "", bg = C.gold }: { x: number; y: number; size?: number; spin?: number; label?: string; bg?: string }) {
  const w = size * 1.6, h = size * 0.95;
  return (
    <div style={{ position: "absolute", left: x - w / 2, top: y - h / 2, width: w, height: h, borderRadius: size * 0.16, background: bg, border: `${size * 0.08}px solid ${C.clayDeep}`, boxShadow: "0 6px 14px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONEY, fontWeight: 600, fontSize: size * (label.length > 1 ? 0.36 : 0.6), color: C.clayDeep, transform: `rotate(${Math.sin(spin) * 12}deg) scaleY(${0.8 + 0.2 * Math.abs(Math.cos(spin))})` }}>
      {label}
    </div>
  );
}

/** A route that marches, and a coin flying along it from at for dur frames. */
export function Route({ a, b, c, color, at, dur = 27, width = 8, coin = true, march = true, back = false, coinLabel, solidUntil }: { a: Pt; b: Pt; c?: Pt; color: string; at: number; dur?: number; width?: number; coin?: boolean; march?: boolean; back?: boolean; coinLabel?: string; solidUntil?: number }) {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const ctrl = c ?? bow(a, b);
  const t = prog(frame, at, at + dur, easeInOut);
  const p = qAt(a, ctrl, b, back ? 1 - t : t);
  const flying = frame >= at && frame <= at + dur;
  const solid = solidUntil === undefined || frame < solidUntil;
  return (
    <>
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <path d={`M${a.x} ${a.y} Q${ctrl.x} ${ctrl.y} ${b.x} ${b.y}`} fill="none" stroke={color} strokeOpacity={march ? 0.3 + 0.15 * Math.sin(frame / 6) : 0.35} strokeWidth={width} strokeLinecap="round" />
        {t > 0 && solid && <path d={qPart(a, ctrl, b, t)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />}
      </svg>
      {coin && flying && <Coin x={p.x} y={p.y} spin={frame / 3} label={coinLabel} />}
    </>
  );
}

/**
 * A place on the map: a solid dot, and a card with its name beside it. No
 * glyph inside a shape anywhere: OCR reads those as "@", which the privacy
 * check refuses. A check is a coloured tick in the card's text.
 */
export function Pin({ x, y, at, label, sub, color, size = 1, labelSide = "below", check = -1 }: { x: number; y: number; at: number; label: string; sub?: string; color: string; emoji?: string; size?: number; labelSide?: "below" | "right" | "left" | "above"; check?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = pop(frame, fps, at, 10);
  const cs = check >= 0 ? pop(frame, fps, check, 9) : 0;
  const T = 14 * size; // the pointer
  const place: CSSProperties =
    labelSide === "below" ? { top: T, left: 0, transform: "translateX(-50%)" }
    : labelSide === "above" ? { bottom: T, left: 0, transform: "translateX(-50%)" }
    : labelSide === "right" ? { left: T, top: 0, transform: "translateY(-50%)" }
    : { right: T, top: 0, transform: "translateY(-50%)" };
  // A solid triangle from the card to the spot, drawn with borders.
  const tri: CSSProperties =
    labelSide === "below" ? { left: -T, top: 0, borderLeft: `${T}px solid transparent`, borderRight: `${T}px solid transparent`, borderBottom: `${T}px solid ${color}` }
    : labelSide === "above" ? { left: -T, top: -T, borderLeft: `${T}px solid transparent`, borderRight: `${T}px solid transparent`, borderTop: `${T}px solid ${color}` }
    : labelSide === "right" ? { left: 0, top: -T, borderTop: `${T}px solid transparent`, borderBottom: `${T}px solid transparent`, borderRight: `${T}px solid ${color}` }
    : { left: -T, top: -T, borderTop: `${T}px solid transparent`, borderBottom: `${T}px solid transparent`, borderLeft: `${T}px solid ${color}` };
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `translateY(${(1 - s) * -40}px) scale(${s})`, opacity: Math.min(1, s * 2) }}>
      <div style={{ position: "absolute", width: 0, height: 0, ...tri }} />
      <div style={{ position: "absolute", whiteSpace: "nowrap", fontFamily: DISPLAY, background: C.paper, borderRadius: 14 * size, border: `${5 * size}px solid ${color}`, padding: `${4 * size}px ${16 * size}px`, boxShadow: "0 6px 0 rgba(0,0,0,0.15)", textAlign: "center", ...place }}>
        <div style={{ fontWeight: 900, fontSize: 30 * size, color: C.ink }}>
          {label}
          {cs > 0 && <span style={{ color, marginLeft: 10 * size, display: "inline-block", transform: `scale(${cs})` }}>✓</span>}
        </div>
        {sub && <div style={{ fontWeight: 800, fontSize: 24 * size, color }}>{sub}</div>}
      </div>
    </div>
  );
}

/**
 * A person: their initial on a rounded tile in their colour, or below 100 px
 * their name in their colour. A small letter or pill reads as "@" to OCR.
 */
export function Face({ name, color, size = 90, ring = 0 }: { name: string; color: string; size?: number; ring?: number }) {
  if (size < 100) {
    return (
      <span style={{ display: "inline-block", color, fontFamily: DISPLAY, fontWeight: 900, fontSize: size * 0.5, whiteSpace: "nowrap", textDecoration: ring ? "underline" : undefined, textDecorationThickness: ring ? 5 : undefined }}>
        {name}
      </span>
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.3, background: color, color: C.white, fontFamily: DISPLAY, fontWeight: 900, fontSize: size * 0.48, display: "flex", alignItems: "center", justifyContent: "center", border: `${size * 0.07}px solid ${C.paper}`, boxShadow: `0 0 0 ${ring}px ${C.gold}, 0 8px 0 rgba(0,0,0,0.18)` }}>
      {name[0]}
    </div>
  );
}

/**
 * Confirm with a fingerprint: a finger on a rounded tile, a scan bar across.
 * No rings and no circles: OCR reads a ringed circle as "@", which the
 * privacy check rightly refuses.
 */
export function Fingerprint({ size = 120, color = C.clay, scan = 0 }: { size?: number; color?: string; scan?: number }) {
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {scan > 0 && <div style={{ position: "absolute", inset: -size * 0.25 * scan, borderRadius: size * 0.3, border: `${size * 0.04}px solid ${color}`, opacity: 1 - scan }} />}
      <div style={{ position: "absolute", inset: 0, borderRadius: size * 0.24, background: C.paper, border: `${size * 0.05}px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.58, overflow: "hidden" }}>
        👆🏾
        {scan > 0 && <div style={{ position: "absolute", left: 0, right: 0, top: `${10 + scan * 75}%`, height: size * 0.05, background: C.gold, opacity: 1 - Math.abs(scan - 0.5) * 2 }} />}
      </div>
    </div>
  );
}

// ---------- the world ----------

/** Flat continents in a 1600x900 space: just enough to read as the world. */
export const LAND = [
  // North America
  "M120 170 C180 110 300 90 400 110 C470 120 560 100 620 150 C660 190 600 230 580 270 C560 320 600 350 560 400 C530 440 500 470 470 520 C450 560 400 560 380 520 C350 470 300 440 250 420 C200 400 190 340 160 300 C130 260 90 220 120 170 Z",
  // South America
  "M520 600 C570 570 640 590 690 630 C730 670 720 730 690 790 C660 850 620 900 590 920 L540 920 C550 860 540 800 520 750 C500 700 490 640 520 600 Z",
  // Europe
  "M880 150 C920 110 1000 100 1060 120 C1130 140 1210 130 1260 170 C1290 200 1250 240 1200 250 C1150 260 1120 290 1060 300 C1010 310 960 300 930 270 C900 240 850 200 880 150 Z",
  // Africa
  "M900 360 C960 330 1060 330 1130 350 C1200 370 1260 380 1300 430 C1330 480 1290 530 1270 580 C1250 650 1220 720 1170 780 C1130 830 1080 850 1060 800 C1040 740 1030 680 980 640 C930 600 880 560 870 500 C860 440 860 390 900 360 Z",
  // a slice of Asia at the edge
  "M1300 140 C1380 110 1500 120 1600 130 L1600 520 C1540 500 1480 470 1430 430 C1380 390 1360 330 1320 280 C1290 240 1260 170 1300 140 Z",
];

export const CITIES = {
  london: { x: 960, y: 205 },
  houston: { x: 455, y: 470 },
  nairobi: { x: 1215, y: 585 },
  lagos: { x: 985, y: 520 },
};

/** The world map at a scale, with gentle sea lines. */
export function World({ scale = 1, x = 0, y = 0, children }: { scale?: number; x?: number; y?: number; children?: ReactNode }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 1600, height: 900, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
      <svg width={1600} height={900} style={{ position: "absolute", left: 0, top: 0 }}>
        <rect width="1600" height="900" fill={C.sea} />
        {Array.from({ length: 9 }, (_, i) => (
          <path key={i} d={`M0 ${60 + i * 100} Q400 ${40 + i * 100 + Math.sin(frame / 20 + i) * 8} 800 ${60 + i * 100} T1600 ${60 + i * 100}`} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="3" strokeDasharray="14 18" />
        ))}
        {LAND.map((d, i) => (
          <g key={i}>
            <path d={d} fill={C.landEdge} transform="translate(0 10)" />
            <path d={d} fill={C.land} stroke={C.landEdge} strokeWidth="4" />
          </g>
        ))}
      </svg>
      {children}
    </div>
  );
}

// ---------- the drawn phone ----------

/** A flat phone, drawn, holding a screen drawn in code. Designed at 400x820. */
export function FlatPhone({ x, y, width = 400, tilt = 0, children, screenBg = C.cream, style }: { x: number; y: number; width?: number; tilt?: number; children?: ReactNode; screenBg?: string; style?: CSSProperties }) {
  const k = width / 400;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 400, height: 820, transform: `scale(${k}) rotate(${tilt}deg)`, transformOrigin: "0 0", ...style }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 62, background: C.night, boxShadow: "0 40px 80px rgba(0,0,0,0.35), 0 16px 0 rgba(0,0,0,0.2)" }} />
      <div style={{ position: "absolute", left: 14, top: 14, right: 14, bottom: 14, borderRadius: 50, background: screenBg, overflow: "hidden", fontFamily: DISPLAY, color: C.ink }}>
        {children}
      </div>
      <div style={{ position: "absolute", left: 160, top: 26, width: 80, height: 22, borderRadius: 12, background: C.night }} />
    </div>
  );
}

/** The app's header inside a drawn phone. */
export function AppBar({ title = "NivPay" }: { title?: string }) {
  return (
    <div style={{ position: "absolute", left: 24, right: 24, top: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: MONEY, fontWeight: 600, fontSize: 26 }}>{title}</span>
      </div>
      <span style={{ fontSize: 15, fontWeight: 800, background: C.saffron, color: C.white, padding: "4px 12px", borderRadius: 99 }}>Test mode</span>
    </div>
  );
}

export function AppButton({ children, at = -1, press = -1, bg = C.clay, style }: { children: ReactNode; at?: number; press?: number; bg?: string; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const pressed = press >= 0 && frame >= press && frame < press + 6;
  return (
    <div style={{ background: pressed ? C.clayDeep : bg, color: C.white, borderRadius: 18, padding: "18px 0", textAlign: "center", fontWeight: 800, fontSize: 24, transform: pressed ? "scale(0.96)" : undefined, opacity: at >= 0 ? prog(frame, at, at + 8) : 1, ...style }}>
      {children}
      {press >= 0 && <Sfx at={press} name="pop" vol={0.4} />}
    </div>
  );
}

/** A finger tap: a ring that grows and fades at a point. */
export function Tap({ x, y, at }: { x: number; y: number; at: number }) {
  const frame = useCurrentFrame();
  const t = prog(frame, at, at + 14);
  if (frame < at - 6 || frame > at + 16) return null;
  const pre = prog(frame, at - 6, at);
  return (
    <div style={{ position: "absolute", left: x - 40, top: y - 40, width: 80, height: 80, borderRadius: "50%", border: `6px solid ${C.gold}`, opacity: frame < at ? pre * 0.9 : 1 - t, transform: `scale(${frame < at ? 0.6 : 0.6 + t * 0.9})` }} />
  );
}

// ---------- colour cards ----------

export function ColorCard({ bg, emoji, title, sub, bar, barLabel, barValue, at = 0 }: { bg: string; emoji: string; title: string; sub: string; bar?: number; barLabel?: string; barValue?: string; at?: number }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const s = pop(frame, fps, at, 10);
  const b = prog(frame, at + 4, at + 22);
  const k = width / 1920;
  const square = width < 1500;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 30% 50%, rgba(255,255,255,0.18), transparent 60%), ${bg}`, alignItems: "center", justifyContent: "center", flexDirection: square ? "column" : "row", gap: 60 * (square ? 1 : k) }}>
      <div style={{ fontSize: (square ? 220 : 260) * (square ? 1 : k), transform: `scale(${s}) rotate(${(1 - s) * -30}deg)`, filter: "drop-shadow(0 18px 0 rgba(0,0,0,0.18))" }}>{emoji}</div>
      <div style={{ color: C.white, fontFamily: DISPLAY, minWidth: 560 * (square ? 1 : k), textAlign: square ? "center" : "left" }}>
        <div style={{ fontWeight: 900, fontSize: (square ? 110 : 150) * (square ? 1 : k), lineHeight: 1, transform: `translateX(${(1 - s) * 80}px)`, opacity: s }}>{title}</div>
        <div style={{ fontWeight: 800, fontSize: (square ? 40 : 54) * (square ? 1 : k), opacity: 0.92 * prog(frame, at + 6, at + 14), marginTop: 10 }}>{sub}</div>
        {bar !== undefined && (
          <div style={{ marginTop: 30 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 30 * (square ? 1 : k) }}>
              <span>{barLabel}</span>
              <span>{barValue}</span>
            </div>
            <div style={{ marginTop: 10, height: 18, borderRadius: 99, background: "rgba(255,255,255,0.3)" }}>
              <div style={{ width: `${Math.max(2, bar * 100 * b)}%`, height: "100%", borderRadius: 99, background: C.white }} />
            </div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

// ---------- Monad's block strip ----------

export const BLOCK_FRAMES = 9.3; // a block every 0.31 s, measured on testnet (docs/APP-CONTRACT-MAP.md 6)

/** The block a request sent at a frame lands in, and the frame that block is Finalized (two blocks on). */
export function landing(sentAt: number, ribbonFrom = 0) {
  const k = Math.ceil((sentAt - ribbonFrom) / BLOCK_FRAMES);
  return { block: k, finalAt: ribbonFrom + k * BLOCK_FRAMES + 2 * BLOCK_FRAMES };
}

/**
 * Blocks born on the right every 0.31 s and sliding left: Proposed (outline),
 * Voted (half), Finalized (solid, a check). marks puts a coin in the block a
 * request landed in.
 */
export function BlockStrip({ y, from = 0, marks = [], height = 120 }: { y: number; from?: number; marks?: { sentAt: number; label: string; color: string }[]; height?: number }) {
  const frame = useCurrentFrame() - from;
  const { width } = useVideoConfig();
  const step = 128;
  const bw = 108;
  const head = Math.floor(frame / BLOCK_FRAMES);
  const sub = (frame / BLOCK_FRAMES) % 1;
  const anchor = width - 260;
  const blocks = [];
  for (let k = head; k > head - 16 && k >= -20; k--) {
    const age = (frame - k * BLOCK_FRAMES) / BLOCK_FRAMES;
    const x = anchor - (head - k + sub) * step + step;
    if (x < -step) break;
    const state = age < 1 ? 0 : age < 2 ? 1 : 2;
    const mark = marks.find((m) => landing(m.sentAt, from).block === k && frame >= m.sentAt - from);
    const born = Math.min(1, age * 3);
    blocks.push(
      <div key={k} style={{ position: "absolute", left: x, top: 0, width: bw, height: height - 30, borderRadius: 16, background: state === 2 ? C.teal : state === 1 ? C.gold : "rgba(255,255,255,0.22)", transform: `scale(${0.6 + 0.4 * born})`, opacity: born, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4 }}>
        {mark ? (
          <>
            <div style={{ width: 40, height: 28, borderRadius: 6, background: mark.color }} />
            <div style={{ color: C.white, fontWeight: 900, fontSize: 16 }}>{mark.label}</div>
          </>
        ) : null}
      </div>,
    );
  }
  return (
    <div style={{ position: "absolute", left: 0, top: y, width, height }}>
      <div style={{ position: "absolute", left: 0, top: -6, width, height: height + 12, background: "rgba(27,15,10,0.92)" }} />
      <div style={{ position: "absolute", left: 0, top: 10, width, height }}>{blocks}</div>
      <div style={{ position: "absolute", left: 26, top: 14, padding: "10px 18px", borderRadius: 14, background: C.night, color: C.white, fontFamily: DISPLAY, zIndex: 2 }}>
        <div style={{ fontWeight: 900, fontSize: 26 }}>Monad</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: C.gold }}>a block every 0.31 s</div>
      </div>
      <div style={{ position: "absolute", right: 24, top: 18, display: "flex", flexDirection: "column", gap: 6, fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, color: C.white, zIndex: 2 }}>
        <span><span style={{ display: "inline-block", width: 16, height: 16, background: "rgba(255,255,255,0.25)", borderRadius: 4, marginRight: 8 }} />Proposed</span>
        <span><span style={{ display: "inline-block", width: 16, height: 16, background: C.gold, borderRadius: 4, marginRight: 8 }} />Voted</span>
        <span><span style={{ display: "inline-block", width: 16, height: 16, background: C.teal, borderRadius: 4, marginRight: 8 }} />Finalized</span>
      </div>
    </div>
  );
}
