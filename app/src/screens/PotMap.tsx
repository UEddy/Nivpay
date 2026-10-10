import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { copy } from "../copy.ts";
import { loopsOn } from "../lib/loops.ts";
import { useOnline } from "./ui.tsx";
import { PERSON_COLORS, payeeSpots, personSpots, reverseRoute, VIEW } from "../lib/potmap.ts";

/**
 * The Three Cities map with the clay pot (docs/design, docs/MOTION.md).
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
  city: string;
  sub: string;
  /** "You": the sub line in the person's colour, bold. */
  subStrong?: boolean;
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
const GRID = ["M57 0 V232", "M114 0 V232", "M171 0 V232", "M228 0 V232", "M285 0 V232", "M0 46 H342", "M0 92 H342", "M0 138 H342", "M0 184 H342"];
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
  const spots = personSpots(people.length);
  const payeeAt = payeeSpots(payees.length);
  const routes = useRef<(SVGPathElement | null)[]>([]);
  const [lengths, setLengths] = useState<number[]>([]);
  const payeeRoutes = useRef<(SVGPathElement | null)[]>([]);
  const [payeeLengths, setPayeeLengths] = useState<number[]>([]);

  useLayoutEffect(() => {
    setLengths(routes.current.map((c) => (c ? Math.ceil(c.getTotalLength()) : 0)));
  }, [spots.length]);
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
    <div ref={card} className="map-card" data-paused={paused || undefined}>
      <svg className="map" viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} role="img" aria-label={props.label}>
        <g className="map-grid">
          {GRID.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>

        <g className="map-fade">
          {spots.map((s, i) => {
            const p = people[i]!;
            const color = PERSON_COLORS[i]!.route;
            return (
              <g key={`route-${s.route}`}>
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

        {spots.map((s, i) => {
          const p = people[i]!;
          const color = PERSON_COLORS[i]!;
          return (
            <g key={`city-${s.route}`} className="pop-in" style={{ animationDelay: `${250 + i * 100}ms` }}>
              <circle cx={s.x} cy={s.y} r="11" className={`ping-ring${p.ping ? " pinging" : ""}`} style={{ stroke: color.route }} />
              <circle
                cx={s.x}
                cy={s.y}
                r="11"
                className={`city-ring${p.ring === "solid" ? "" : " dashed"}`}
                style={{ stroke: p.ring === "pencil" ? "var(--route-empty)" : color.route }}
              />
              <circle cx={s.x} cy={s.y} r="5" className={`city-dot${p.dim ? " dim" : ""}`} />
              <g className={`city-check${p.check ? " on" : ""}`}>
                <circle cx={s.x + 9} cy={s.y - 9} r="6.5" style={{ fill: color.route }} />
                <path d={`M${s.x + 6} ${s.y - 9} l2 2 l3.5 -4`} />
              </g>
            </g>
          );
        })}

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
          {spots.map((s, i) => {
            const p = people[i]!;
            return (
              <g key={`label-${s.route}`}>
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
      {props.children}
    </div>
  );
}
