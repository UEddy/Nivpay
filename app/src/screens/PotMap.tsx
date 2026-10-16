import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { copy } from "../copy.ts";
import { loopsOn } from "../lib/loops.ts";
import { prefersReducedMotion } from "../lib/reduced.ts";
import { useOnline } from "./ui.tsx";
import { PERSON_COLORS, payeeSpots, reverseRoute, VIEW, type PersonSpot } from "../lib/potmap.ts";
import {
  between,
  canZoom,
  labelOffsets,
  landCopies,
  movedLayout,
  placeOf,
  settleView,
  worldLayout,
  zoomAt,
  ZOOM_MAX,
  ZOOM_MIN,
  type CityRow,
  type LabelOffset,
  type WorldView,
  type Zones,
} from "../lib/worldmap.ts";
import world from "../data/world-land.json";
import { reloadOnce } from "../lib/reloadOnce.ts";

/**
 * The Three Cities map with the clay pot (docs/design, docs/MOTION.md), on
 * a map of the world: each person at their city, where it is known
 * (lib/worldmap.ts), with their city and name in a label beside them.
 *
 * The map draws a state; the screens decide when it changes, because only
 * they know when something is final. Only transform, opacity and
 * stroke-dashoffset ever move. A coin is a 0.1px dash with a round cap,
 * carried along its route by stroke-dashoffset; each route is measured once
 * with getTotalLength. Layers are full-height rects scaled with scaleY from
 * the bottom and lifted with translateY, so a layer rising, and every layer
 * above it moving up, is all transform. Loops pause when the page is hidden
 * or the map is off screen. At most two loops run at once, counting one off
 * the map (lib/loops.ts): while a payment is asked, its marching route and
 * pulsing ring take the place of the live badge's ping, and a coin of yours
 * waiting at the rim stops the pings.
 */

export type MapPerson = {
  name: string;
  /** With photos set up: the photo to draw in the ring, and the initials under it if there is none. */
  face?: { photo: string | null; initials: string };
  city: string;
  sub: string;
  /** "You": the sub line in the person's colour, bold. */
  subStrong?: boolean;
  /** Where they are, for their place on the world: the city in the pot's link or the one they shared, and their phone's time zone. */
  where?: { city?: string; timeZone?: string };
  /** solid: the person's colour. dashed: their colour, dashed. pencil: not there yet. */
  ring: "solid" | "dashed" | "pencil";
  dim?: boolean;
  check?: boolean;
  ping?: boolean;
  route: "pencil" | "march" | "solid" | "none";
  /**
   * The pot is closed: a dotted stream runs from the pot back to this city,
   * and `share` (their amount) appears beside it, a little after the one
   * before (docs/MOTION.md, "Pot closed").
   */
  split?: boolean;
  share?: string;
};

/**
 * asked: a payment to it is waiting for a yes, so its route marches and its
 * ring pulses until it is decided. paying: final, and the stream is on its
 * way. paid: the stream has arrived, so it is filled and checked.
 */
export type MapPayee = { name: string; sub: string; state?: "asked" | "paying" | "paid" };

/** Money running from the pot down a payee's route. "start": not yet left. "end": arrived. */
export type Stream = { payee: number; at: "start" | "end" };

/**
 * A coin on a person's route. "start": not yet left (hidden). "end": arrived.
 * "hold": at the rim, pulsing, waiting for finality. "back": flying back to
 * where it started, because it didn't go through.
 */
export type Coin = { person: number; to: "pot" | "city"; at: "start" | "end" | "hold" | "back"; delayMs?: number; label?: string };

/** A layer of the pot, bottom first. `fraction` of the pot's full height. Unknown funders have no person. */
export type Layer = { person: number | null; fraction: number };

const POT_PATH =
  "M72 38 C72 50 60 54 50 63 C28 82 23 118 35 146 C47 173 76 186 100 186 C124 186 153 173 165 146 C177 118 172 82 150 63 C140 54 128 50 128 38 Z";
const LAND = (world as { land: string[] }).land;
const ZONES = (world as unknown as { zones: Zones }).zones;
// Made once, so moving the world redraws only the groups that hold them.
const LAND_EDGES = LAND.map((d, i) => <path key={`edge-${i}`} d={d} className="map-land-edge" />);
const LAND_SHAPES = LAND.map((d, i) => <path key={`land-${i}`} d={d} className="map-land" />);
/** Gentle lines on the sea, as on the film's map. */
const SEA_LINES = [30, 80, 130, 180, 222].map((y) => `M0 ${y} Q85 ${y - 5} 171 ${y} T342 ${y}`);

/** The bigger city list, loaded once, the first time a map needs it. Until then, places come from time zones. */
let citiesLoad: Promise<CityRow[] | null> | null = null;
function loadMapCities(): Promise<CityRow[] | null> {
  citiesLoad ??= reloadOnce(() => import("../data/world-cities.json"))
    .then((m) => m.default as CityRow[])
    .catch(() => null);
  return citiesLoad;
}
function useMapCities(): CityRow[] | null {
  const [list, setList] = useState<CityRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadMapCities().then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/** A label's width, from its longest line: near enough for Work Sans at the map's sizes. */
function labelWidth(lines: string[]): number {
  return Math.ceil(Math.max(...lines.map((l) => Array.from(l).length * 6.6), 24)) + 14;
}
/** Full height of the liquid in pot units: the most the pot can ever pay out. */
const FULL = 128.5;
const BOTTOM = 186.5;

/** Picks a payee's icon from its name. Anything unrecognised gets a shop. */
function payeeIcon(name: string): ReactNode {
  const n = name.toLowerCase();
  if (/cater|food|chef|cook|restaurant|kitchen|cake|bak|drink|bar\b/.test(n)) {
    return (
      <>
        <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
        <path d="M7 2v20" />
        <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
      </>
    );
  }
  if (/hall|venue|hotel|church|centre|center|school|rent|landlord|house|home/.test(n)) {
    return (
      <>
        <path d="M3 22h18" />
        <path d="M6 18v-7" />
        <path d="M10 18v-7" />
        <path d="M14 18v-7" />
        <path d="M18 18v-7" />
        <path d="M12 2l8 5H4z" />
      </>
    );
  }
  return (
    <>
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" />
      <path d="M5 13v8h14v-8" />
    </>
  );
}

function usePausedLoops(ref: React.RefObject<HTMLElement | null>): boolean {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let visible = true;
    const update = () => setPaused(document.hidden || !visible);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      update();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref]);
  return paused;
}

type Pt = { x: number; y: number };
const centre = (pts: readonly Pt[]): Pt => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
const spread = (pts: readonly Pt[]): number => (pts.length < 2 ? 0 : Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y));
/** The point under the pot, which zooming by the buttons keeps still. */
const POT_AT = { x: 166, y: 114 };

/**
 * The world moved by hand under the pot, which stays put: dragged with a
 * finger or the mouse, zoomed with two fingers, a double tap, Ctrl and the
 * wheel (a laptop's pinch) or the buttons. `own` is the view the person
 * chose, null while the map frames everyone by itself. While `moving`,
 * labels ride with their people and are placed again when it stops.
 */
function useMovableWorld(svg: React.RefObject<SVGSVGElement | null>, auto: WorldView) {
  const [own, setOwn] = useState<WorldView | null>(null);
  const [moving, setMoving] = useState(false);
  const view = own ?? auto;
  const now = useRef(view);
  now.current = view;
  const autoNow = useRef(auto);
  autoNow.current = auto;

  const glideFrame = useRef(0);
  const stopGlide = () => {
    cancelAnimationFrame(glideFrame.current);
    glideFrame.current = 0;
  };
  const glide = useCallback((to: (t: number) => WorldView, done?: () => void) => {
    stopGlide();
    const end = () => {
      setMoving(false);
      done?.();
    };
    if (prefersReducedMotion()) {
      setOwn(to(1));
      return end();
    }
    const t0 = performance.now();
    setMoving(true);
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 300);
      setOwn(to(1 - (1 - p) ** 3));
      if (p < 1) glideFrame.current = requestAnimationFrame(step);
      else {
        glideFrame.current = 0;
        end();
      }
    };
    glideFrame.current = requestAnimationFrame(step);
  }, []);
  const zoom = useCallback(
    (f: number, at: Pt = POT_AT) => {
      const from = now.current;
      glide((t) => zoomAt(from, f ** t, at.x, at.y));
    },
    [glide],
  );
  const showEveryone = useCallback(() => {
    const from = now.current;
    glide(
      (t) => between(from, autoNow.current, t),
      () => setOwn(null),
    );
  }, [glide]);

  // Pointers on the map, in map units.
  const pts = useRef(new Map<number, Pt>());
  const anchor = useRef<{ view: WorldView; pts: Map<number, Pt> } | null>(null);
  const gesture = useRef({ moved: false, at: 0 });
  const lastTap = useRef<{ at: number; p: Pt } | null>(null);
  const pending = useRef<WorldView | null>(null);
  const frame = useRef(0);
  const toMap = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * VIEW.width, y: ((e.clientY - r.top) / r.height) * VIEW.height };
  };
  const reanchor = () => {
    anchor.current = { view: pending.current ?? now.current, pts: new Map(pts.current) };
  };
  const flush = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (pending.current) setOwn(pending.current);
    pending.current = null;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stopGlide();
    if (pts.current.size === 0) gesture.current = { moved: false, at: performance.now() };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, toMap(e));
    reanchor();
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const a = anchor.current;
    if (!a || !pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, toMap(e));
    const ids = [...a.pts.keys()].filter((id) => pts.current.has(id)).slice(0, 2);
    const from = ids.map((id) => a.pts.get(id)!);
    const to = ids.map((id) => pts.current.get(id)!);
    const c0 = centre(from);
    const c1 = centre(to);
    const f = ids.length > 1 ? spread(to) / Math.max(spread(from), 1) : 1;
    // A tap that wobbles a little is still a tap.
    if (!gesture.current.moved && Math.hypot(c1.x - c0.x, c1.y - c0.y) < 4 && Math.abs(spread(to) - spread(from)) < 4) return;
    gesture.current.moved = true;
    const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, a.view.k * f));
    const g = k / a.view.k;
    pending.current = settleView({ k, tx: c1.x - (c0.x - a.view.tx) * g, ty: c1.y - (c0.y - a.view.ty) * g });
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (pending.current) setOwn(pending.current);
        setMoving(true);
      });
  };
  const onPointerEnd = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    const p = pts.current.get(e.pointerId)!;
    pts.current.delete(e.pointerId);
    if (pts.current.size > 0) return reanchor();
    flush();
    anchor.current = null;
    setMoving(false);
    if (gesture.current.moved || e.type !== "pointerup" || performance.now() - gesture.current.at > 300) return;
    // Two taps in one place: zoom in there.
    const last = lastTap.current;
    if (last && performance.now() - last.at < 320 && Math.hypot(last.p.x - p.x, last.p.y - p.y) < 24) {
      lastTap.current = null;
      zoom(2, p);
    } else lastTap.current = { at: performance.now(), p };
  };

  // Ctrl and the wheel, as a laptop's pinch sends: zoom where the pointer is. The wheel alone scrolls the page.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      stopGlide();
      const p = toMap(e);
      setOwn(zoomAt(now.current, Math.exp(-e.deltaY * 0.01), p.x, p.y));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
      stopGlide();
      cancelAnimationFrame(frame.current);
    };
  }, [svg]);

  return {
    view,
    own,
    moving,
    zoom,
    showEveryone,
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
  };
}

let landIds = 0;

export function PotMap(props: {
  people: MapPerson[];
  payees: MapPayee[];
  payeeRoutes: "pencil" | "dotted";
  lid: "open" | "shut";
  lock: boolean;
  layers?: Layer[];
  coins?: Coin[];
  /** Tilts the pot once, when a layer lands. Changing the key replays it. */
  sloshKey?: number;
  /** Tips the pot towards the payees while a payment pours out. */
  tilt?: boolean;
  /** The pot level drops on the slower drain curve, as after a payment. */
  draining?: boolean;
  stream?: Stream | null;
  potText: string;
  badge: "draft" | "live";
  /** Replaces the badge's word while the story replays; its dot stops pinging. */
  badgeText?: string;
  label: string;
  /** Laid over the map, such as the Replay button. */
  children?: ReactNode;
  /** A loop runs on the screen off the map, such as a yes pulsing while it lands: the map keeps to one. */
  outsideLoop?: boolean;
}) {
  const { people, payees } = props;
  const card = useRef<HTMLDivElement>(null);
  const paused = usePausedLoops(card);
  // Offline, nothing on the map is live: the badge says so and stops its ping.
  const online = useOnline();
  const live = props.badge === "live" && online;
  const cities = useMapCities();
  const placesKey = people.map((p) => `${p.where?.city ?? ""}|${p.where?.timeZone ?? ""}`).join(";");
  const labelsKey = people.map((p) => `${p.city}|${p.sub}`).join(";");
  // Where people are, and their labels' widths: they change only with these keys.
  const places = useMemo(() => people.map((p) => (p.where ? placeOf({ cities, zones: ZONES }, p.where) : null)), [placesKey, cities]);
  const widths = useMemo(() => people.map((p) => labelWidth([p.city, p.sub])), [labelsKey]);
  const framed = useMemo(() => worldLayout(places, payees.length, widths), [places, payees.length, widths]);
  const svg = useRef<SVGSVGElement>(null);
  const world = useMovableWorld(svg, framed.view);
  const { view, own, moving } = world;
  // While the world moves, labels ride along with their people; they are placed again when it stops.
  const offsets = useRef<LabelOffset[]>([]);
  const spots: (PersonSpot & { under?: boolean })[] = useMemo(
    () => (own ? movedLayout(own, places, payees.length, widths, moving ? offsets.current : undefined) : framed.spots),
    [own, moving, places, payees.length, widths, framed],
  );
  if (!moving) offsets.current = labelOffsets(spots);
  const copies = landCopies(view);
  const [landId] = useState(() => `map-land-${++landIds}`);
  const land = (
    <g id={landId}>
      <g style={{ transform: `translateY(${(25 / view.k).toFixed(2)}px)` }}>{LAND_EDGES}</g>
      {LAND_SHAPES}
    </g>
  );
  const payeeAt = payeeSpots(payees.length);
  const routes = useRef<(SVGPathElement | null)[]>([]);
  const [lengths, setLengths] = useState<number[]>([]);
  const payeeRoutes = useRef<(SVGPathElement | null)[]>([]);
  const [payeeLengths, setPayeeLengths] = useState<number[]>([]);

  const routeKey = spots.map((s) => s.route).join(";");
  // Measured once the world is still, not on every frame of a drag.
  useLayoutEffect(() => {
    if (!moving) setLengths(routes.current.map((c) => (c ? Math.ceil(c.getTotalLength()) : 0)));
  }, [routeKey, moving]);
  useLayoutEffect(() => {
    setPayeeLengths(payeeRoutes.current.map((c) => (c ? Math.ceil(c.getTotalLength()) : 0)));
  }, [payeeAt.length]);
  const asked = payees.some((p, i) => i < payeeAt.length && p.state === "asked");
  const loops = loopsOn({
    coinHolding: (props.coins ?? []).some((c) => c.at === "hold" && c.person < spots.length),
    outside: Boolean(props.outsideLoop),
    asked,
    peopleMarch: people.some((p, i) => i < spots.length && p.route === "march"),
    badgeLive: live && !props.badgeText,
  });
  const stream = props.stream && props.stream.payee < payeeAt.length ? props.stream : null;
  const streamLength = stream ? (payeeLengths[stream.payee] ?? 0) : 0;

  const layers = props.layers ?? [];
  let below = 0;
  const stacked = layers.map((l) => {
    const fraction = Math.max(0, Math.min(l.fraction, 1 - below));
    const out = { ...l, fraction, offset: below };
    below += fraction;
    return out;
  });
  const hiddenPeople = people.length - spots.length;
  const hiddenPayees = payees.length - payeeAt.length;

  return (
    <div ref={card} className="map-card" data-paused={paused || undefined} data-moving={moving || undefined}>
      <svg
        ref={svg}
        // Zoomed in, a finger drags the map every way; otherwise an up-and-down drag still scrolls the page.
        className={`map${view.k > framed.view.k * 1.05 ? " zoomed" : ""}`}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label={props.label}
        {...world.handlers}
      >
        <g className="map-world" aria-hidden="true">
          {SEA_LINES.map((d) => (
            <path key={d} d={d} className="map-sea-line" />
          ))}
          <g
            className={`map-land-at${own ? " held" : ""}`}
            style={{ transform: `translate(${view.tx.toFixed(1)}px, ${view.ty.toFixed(1)}px) scale(${(view.k / 10).toFixed(4)})` }}
          >
            {land}
            {/* East and west wrap round: the same land a world along, where the map shows past 180 degrees. */}
            {copies.west && <use href={`#${landId}`} x="-3600" />}
            {copies.east && <use href={`#${landId}`} x="3600" />}
          </g>
        </g>

        <g className="map-fade">
          {spots.map((s, i) => {
            const p = people[i]!;
            const color = PERSON_COLORS[i]!.route;
            return (
              <g key={`route-${i}`}>
                <path d={s.route} className={`route pencil${p.route === "pencil" ? "" : " gone"}`} />
                <path
                  ref={(el) => {
                    routes.current[i] = el;
                  }}
                  d={s.route}
                  className={`route ${p.route === "solid" ? "solid" : "dots"}${p.route === "march" && loops.peopleMarch ? " march" : ""}${
                    p.route === "march" || p.route === "solid" ? " shown" : ""
                  }${p.split ? " faded" : ""}`}
                  style={{ stroke: color }}
                />
                {p.split && <path d={reverseRoute(s.route)} className="route split" style={{ stroke: color, animationDelay: `${i * 150}ms` }} />}
              </g>
            );
          })}
          {payeeAt.map((s, i) => {
            const state = payees[i]!.state;
            const look = props.payeeRoutes === "pencil" ? "pencil" : `payee shown${state === "asked" && loops.payeeMarch ? " march" : ""}${state === "paid" || state === "paying" ? " gone" : ""}`;
            return (
              <g key={s.route}>
                <path
                  ref={(el) => {
                    payeeRoutes.current[i] = el;
                  }}
                  d={s.route}
                  className={`route ${look}`}
                />
                {state === "paid" && stream?.payee !== i && <path d={s.route} className="route payee-paid" />}
              </g>
            );
          })}
        </g>

        {stream && (
          <g key={`stream-${stream.payee}`}>
            <path
              d={payeeAt[stream.payee]!.route}
              className="trail payee-trail"
              style={{
                strokeDasharray: `${streamLength}px ${streamLength}px`,
                strokeDashoffset: stream.at === "start" ? streamLength : 0,
                transitionProperty: stream.at === "start" ? "none" : "stroke-dashoffset",
              }}
            />
            <path
              d={payeeAt[stream.payee]!.route}
              className="coin payee-coin"
              style={{
                strokeDashoffset: stream.at === "start" ? 6 : -streamLength,
                opacity: stream.at === "start" ? 0 : 1,
                transitionProperty: stream.at === "start" ? "none" : "stroke-dashoffset",
              }}
            />
          </g>
        )}

        {(props.coins ?? []).map((c) => {
          const s = spots[c.person];
          if (!s) return null;
          const len = lengths[c.person] ?? 0;
          const color = PERSON_COLORS[c.person]!.route;
          const offset = c.at === "start" || c.at === "back" ? 6 : c.at === "hold" ? -(len - 7) : -len;
          return (
            <g key={`coin-${c.person}-${c.to}`}>
              {c.to === "pot" && (
                <path
                  d={s.route}
                  className="trail"
                  style={{
                    stroke: color,
                    strokeDasharray: `${len}px ${len}px`,
                    strokeDashoffset: c.at === "start" || c.at === "back" ? len : 0,
                    transitionProperty: c.at === "start" ? "none" : "stroke-dashoffset",
                    transitionDelay: `${c.delayMs ?? 0}ms`,
                  }}
                />
              )}
              <path
                d={c.to === "pot" ? s.route : reverseRoute(s.route)}
                className={`coin${c.at === "hold" ? " holding" : ""}`}
                style={{
                  stroke: color,
                  strokeDashoffset: offset,
                  opacity: c.at === "start" ? 0 : 1,
                  transitionProperty: c.at === "start" ? "none" : "stroke-dashoffset",
                  transitionDelay: `${c.delayMs ?? 0}ms`,
                }}
              />
              {c.label && c.at !== "start" && (
                <text x={(s.x + 166) / 2} y={Math.min(s.y, 114) - 12} className="coin-label" textAnchor="middle" style={{ fill: PERSON_COLORS[c.person]!.text }}>
                  {c.label}
                </text>
              )}
            </g>
          );
        })}

        {/* People under the pot, which covers them as the world moves beneath it. */}
        {spots.map((s, i) => {
          const p = people[i]!;
          const color = PERSON_COLORS[i]!;
          return (
            <g key={`city-${i}`} className={`map-person${s.under ? " under" : ""}`}>
              <g className="pop-in" style={{ animationDelay: `${250 + i * 100}ms` }}>
                <circle cx={s.x} cy={s.y} r="11" className={`ping-ring${p.ping ? " pinging" : ""}`} style={{ stroke: color.route }} />
                <circle
                  cx={s.x}
                  cy={s.y}
                  r="11"
                  className={`city-ring${p.ring === "solid" ? "" : " dashed"}`}
                  style={{ stroke: p.ring === "pencil" ? "var(--route-empty)" : color.route }}
                />
                {p.face ? (
                  <g className={`map-face${p.dim ? " dim" : ""}`}>
                    <clipPath id={`face-${i}`}>
                      <circle cx={s.x} cy={s.y} r="9.5" />
                    </clipPath>
                    <circle cx={s.x} cy={s.y} r="9.5" className="map-face-bg" />
                    <text x={s.x} y={s.y + 3} textAnchor="middle" className="map-initials">
                      {p.face.initials}
                    </text>
                    {p.face.photo && <image href={p.face.photo} x={s.x - 9.5} y={s.y - 9.5} width="19" height="19" clipPath={`url(#face-${i})`} preserveAspectRatio="xMidYMid slice" />}
                  </g>
                ) : (
                  <circle cx={s.x} cy={s.y} r="5" className={`city-dot${p.dim ? " dim" : ""}`} />
                )}
                <g className={`city-check${p.check ? " on" : ""}`}>
                  <circle cx={s.x + 9} cy={s.y - 9} r="6.5" style={{ fill: color.route }} />
                  <path d={`M${s.x + 6} ${s.y - 9} l2 2 l3.5 -4`} />
                </g>
              </g>
            </g>
          );
        })}
        <g className="map-labels">
          {spots.map((s, i) => {
            const p = people[i]!;
            // A label in a box, as on the film's map: the city, then the name, in the person's colour.
            const w = labelWidth([p.city, p.sub]);
            const left = s.label.anchor === "middle" ? s.label.x - w / 2 : s.label.x - 6;
            return (
              <g key={`label-${i}`} className={`map-person${s.under ? " under" : ""}`}>
                <rect x={left} y={s.label.y - 12} width={w} height={p.sub ? 30 : 17} rx="5" className="map-tag" style={{ stroke: PERSON_COLORS[i]!.route }} />
                <text x={s.label.x} y={s.label.y} className="map-city" textAnchor={s.label.anchor}>
                  {p.city}
                </text>
                {p.share && (
                  <text
                    // Under the label, or left of the dot where that would leave the map.
                    x={s.label.y + 29 <= VIEW.height - 4 ? s.label.x : s.x - 16}
                    y={s.label.y + 29 <= VIEW.height - 4 ? s.label.y + 29 : s.y + 4}
                    className="map-share"
                    textAnchor={s.label.y + 29 <= VIEW.height - 4 ? s.label.anchor : "end"}
                    style={{ fill: PERSON_COLORS[i]!.text, animationDelay: `${300 + i * 150}ms` }}
                  >
                    {p.share}
                  </text>
                )}
                <text
                  x={s.label.x}
                  y={s.label.y + 13}
                  className={`map-sub${p.subStrong ? " strong" : ""}`}
                  textAnchor={s.label.anchor}
                  style={p.subStrong ? { fill: PERSON_COLORS[i]!.text } : undefined}
                >
                  {p.sub}
                </text>
              </g>
            );
          })}
        </g>

        <g className="pot-in">
          {/* Two identical animations, alternated, so a new slosh replays without remounting the layers. */}
          <g className={`slosh${props.sloshKey ? (props.sloshKey % 2 ? " odd" : " even") : ""}`}>
            <g className={`tilt${props.tilt ? " on" : ""}`}>
            <svg x="118" y="66" width="96" height="96" viewBox="0 0 200 200" overflow="visible">
              <defs>
                <clipPath id="pot-clip">
                  <path d={POT_PATH} />
                </clipPath>
              </defs>
              <path d={POT_PATH} className="pot-fill" />
              <g clipPath="url(#pot-clip)" className={props.draining ? "draining" : undefined}>
                {stacked.map((l, i) => (
                  <rect
                    key={i}
                    x="0"
                    y={BOTTOM - FULL}
                    width="200"
                    height={FULL}
                    className="layer"
                    style={{
                      fill: l.person === null ? "var(--route-empty)" : PERSON_COLORS[l.person]!.fill,
                      transform: `translateY(${-(l.offset * FULL).toFixed(2)}px) scaleY(${l.fraction.toFixed(4)})`,
                    }}
                  />
                ))}
                <path d="M40 76 L50 82 L60 76 L70 82 L80 76 L90 82 L100 76 L110 82 L120 76 L130 82 L140 76 L150 82 L160 76" className="pot-band" />
              </g>
              <path d={POT_PATH} className="pot-outline" />
              <g className={`pot-lid${props.lid === "shut" ? " shut" : ""}`}>
                <rect x="62" y="26" width="76" height="14" rx="7" />
              </g>
            </svg>
            </g>
          </g>
        </g>

        <g className={`pot-lock${props.lock ? " on" : ""}`}>
          <circle cx="166" cy="124" r="13" />
          <svg x="158" y="116" width="16" height="16" viewBox="0 0 24 24">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </g>


        {payeeAt.map((s, i) => {
          const state = payees[i]!.state;
          return (
            <g key={`payee-${s.route}`} className="pop-in" style={{ animationDelay: `${600 + i * 100}ms` }}>
              <circle cx={s.x} cy={s.y} r="14" className={`payee-ping${state === "asked" && loops.payeePing ? " on" : ""}`} />
              <circle cx={s.x} cy={s.y} r="14" className={`payee-ring${state === "paid" ? " paid" : ""}`} />
              <circle cx={s.x} cy={s.y} r="13.25" className={`payee-fill${state === "paid" ? " on" : ""}`} />
              <svg x={s.x - 8} y={s.y - 8} width="16" height="16" viewBox="0 0 24 24" className={`payee-icon${state === "paid" ? " paid" : ""}`}>
                {payeeIcon(payees[i]!.name)}
              </svg>
              <g className={`city-check payee-check${state === "paid" ? " on" : ""}`}>
                <circle cx={s.x + 11} cy={s.y - 11} r="6.5" />
                <path d={`M${s.x + 8} ${s.y - 11} l2 2 l3.5 -4`} />
              </g>
            </g>
          );
        })}

        <g className="map-labels">
          {payeeAt.map((s, i) => (
            <g key={`plabel-${s.route}`}>
              <text x={s.label.x} y={s.label.y} className="map-payee" textAnchor="middle">
                {payees[i]!.name}
              </text>
              <text x={s.label.x} y={s.label.y + 13} className="map-sub" textAnchor="middle">
                {payees[i]!.sub}
              </text>
            </g>
          ))}
          <text x="166" y="178" className="map-amount" textAnchor="middle">
            {props.potText}
          </text>
          <text x="166" y="191" className="map-sub" textAnchor="middle">
            {copy.inThePot}
          </text>
          {hiddenPeople > 0 && (
            <text x="10" y="224" className="map-sub">
              {copy.morePeople(hiddenPeople)}
            </text>
          )}
          {hiddenPayees > 0 && (
            <text x="332" y="226" className="map-sub" textAnchor="end">
              {copy.morePayees(hiddenPayees)}
            </text>
          )}
        </g>
      </svg>
      <div className={`map-badge${live ? " live" : ""}${loops.badgePing ? "" : " quiet"}`}>
        <span className="dot">
          <span />
          <span className="ping" />
        </span>
        {props.badgeText ?? (live ? copy.live : props.badge === "live" ? copy.notUpToDate : copy.draft)}
      </div>
      {/* Under the pot's amount: zoom out and in, and, once the world was moved, back to everyone. */}
      <div className="map-zoom">
        <button type="button" className={`map-zoom-btn map-zoom-back${own ? " on" : ""}`} aria-label={copy.mapShowEveryone} aria-hidden={!own} tabIndex={own ? 0 : -1} onClick={world.showEveryone}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
        <button type="button" className="map-zoom-btn" aria-label={copy.mapZoomOut} disabled={!canZoom(view, 0.5)} onClick={() => world.zoom(0.5)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 12h12" />
          </svg>
        </button>
        <button type="button" className="map-zoom-btn" aria-label={copy.mapZoomIn} disabled={!canZoom(view, 2)} onClick={() => world.zoom(2)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 12h12M12 6v12" />
          </svg>
        </button>
      </div>
      {props.children}
    </div>
  );
}
