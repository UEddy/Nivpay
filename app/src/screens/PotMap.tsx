import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { copy } from "../copy.ts";
import { PERSON_COLORS, payeeSpots, personSpots, reverseRoute, VIEW } from "../lib/potmap.ts";

/**
 * The Three Cities map with the clay pot (docs/design, docs/MOTION.md).
 *
 * Only transform, opacity and stroke-dashoffset ever move. A coin is a 0.1px
 * dash with a round cap, carried along its route by stroke-dashoffset; each
 * route is measured once with getTotalLength. Loops pause when the page is
 * hidden or the map is off screen, and reduced motion drops flights and loops.
 */

export type MapPerson = { name: string; city: string; you: boolean };
export type MapPayee = { name: string; sub: string };

/**
 * draft: the rules aren't locked; routes are pencilled in.
 * live: the pot is made. If `celebrate` is set when it turns live, the lid
 * drops, the lock pops and an invite flies out to each other person.
 */
export type MapState = "draft" | "live";

const POT_PATH =
  "M72 38 C72 50 60 54 50 63 C28 82 23 118 35 146 C47 173 76 186 100 186 C124 186 153 173 165 146 C177 118 172 82 150 63 C140 54 128 50 128 38 Z";
const GRID = ["M57 0 V232", "M114 0 V232", "M171 0 V232", "M228 0 V232", "M285 0 V232", "M0 46 H342", "M0 92 H342", "M0 138 H342", "M0 184 H342"];
const FLIGHT_MS = 900;
const STAGGER_MS = 140;

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
  potText: string;
  state: MapState;
  celebrate: boolean;
  label: string;
}) {
  const { people, payees, state, celebrate } = props;
  const card = useRef<HTMLDivElement>(null);
  const paused = usePausedLoops(card);
  const spots = personSpots(people.length);
  const payeeAt = payeeSpots(payees.length);
  const live = state === "live";

  // Invites fly only when the pot turns live while this screen watches.
  // A pot that was already live when opened shows its settled state.
  const [flight, setFlight] = useState<"none" | "ready" | "flying" | "landed">(live ? "landed" : "none");
  const coins = useRef<(SVGPathElement | null)[]>([]);
  const [lengths, setLengths] = useState<number[]>([]);

  useLayoutEffect(() => {
    setLengths(coins.current.map((c) => (c ? Math.ceil(c.getTotalLength()) : 0)));
  }, [people.length]);

  useEffect(() => {
    if (!live) {
      setFlight("none");
      return;
    }
    if (!celebrate) {
      setFlight("landed");
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setFlight("landed");
      return;
    }
    // The lid drops and the lock pops first; then the invites leave.
    setFlight("ready");
    const others = Math.max(0, spots.length - 1);
    const t1 = setTimeout(() => setFlight("flying"), 380);
    const t2 = setTimeout(() => setFlight("landed"), 380 + FLIGHT_MS + STAGGER_MS * Math.max(0, others - 1));
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [live, celebrate, spots.length]);

  const arrived = flight === "landed";
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
          <g className={`routes-pencil${live ? " gone" : ""}`}>
            {spots.map((s) => (
              <path key={s.route} d={s.route} />
            ))}
            {payeeAt.map((s) => (
              <path key={s.route} d={s.route} />
            ))}
          </g>
          <g className={`routes-live${live ? " shown" : ""}`}>
            {spots.map((s, i) => (
              <path key={s.route} d={s.route} className="march" style={{ stroke: PERSON_COLORS[i]!.route }} />
            ))}
            {payeeAt.map((s) => (
              <path key={s.route} d={s.route} className="payee-route" />
            ))}
          </g>
        </g>

        {spots.map((s, i) =>
          people[i]!.you ? null : (
            <path
              key={`coin-${s.route}`}
              ref={(el) => {
                coins.current[i] = el;
              }}
              d={reverseRoute(s.route)}
              className="coin"
              style={{
                stroke: PERSON_COLORS[i]!.route,
                strokeDashoffset: flight === "flying" || flight === "landed" ? -(lengths[i] ?? 0) : 6,
                opacity: flight === "flying" ? 1 : 0,
                transitionDelay: flight === "flying" ? `${STAGGER_MS * Math.max(0, i - 1)}ms` : "0ms",
                transitionProperty: flight === "flying" ? "stroke-dashoffset" : "none",
              }}
            />
          ),
        )}

        <g className="pot-in">
          <svg x="118" y="66" width="96" height="96" viewBox="0 0 200 200" overflow="visible">
            <path d={POT_PATH} className="pot-body" />
            <path d="M40 76 L50 82 L60 76 L70 82 L80 76 L90 82 L100 76 L110 82 L120 76 L130 82 L140 76 L150 82 L160 76" className="pot-band" />
            <g className={`pot-lid${live ? " shut" : ""}`}>
              <rect x="62" y="26" width="76" height="14" rx="7" />
            </g>
          </svg>
        </g>

        <g className={`pot-lock${live ? " on" : ""}`}>
          <circle cx="166" cy="124" r="13" />
          <svg x="158" y="116" width="16" height="16" viewBox="0 0 24 24">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </g>

        {spots.map((s, i) => {
          const p = people[i]!;
          const color = PERSON_COLORS[i]!;
          const lit = p.you || (live && arrived);
          return (
            <g key={`city-${s.route}`} className="pop-in" style={{ animationDelay: `${250 + i * 100}ms` }}>
              {!p.you && <circle cx={s.x} cy={s.y} r="11" className={`ping-ring${celebrate && live && arrived ? " pinging" : ""}`} style={{ stroke: color.route }} />}
              <circle
                cx={s.x}
                cy={s.y}
                r="11"
                className={p.you ? "city-ring" : "city-ring dashed"}
                style={{ stroke: lit ? color.route : "var(--route-empty)" }}
              />
              <circle cx={s.x} cy={s.y} r="5" className="city-dot" />
            </g>
          );
        })}

        {payeeAt.map((s, i) => (
          <g key={`payee-${s.route}`} className="pop-in" style={{ animationDelay: `${600 + i * 100}ms` }}>
            <circle cx={s.x} cy={s.y} r="14" className="payee-ring" />
            <svg x={s.x - 8} y={s.y - 8} width="16" height="16" viewBox="0 0 24 24" className="payee-icon">
              {payeeIcon(payees[i]!.name)}
            </svg>
          </g>
        ))}

        <g className="map-labels">
          {spots.map((s, i) => {
            const p = people[i]!;
            return (
              <g key={`label-${s.route}`}>
                <text x={s.label.x} y={s.label.y} className="map-city" textAnchor={s.label.anchor}>
                  {p.city}
                </text>
                <text x={s.label.x} y={s.label.y + 13} className="map-sub" textAnchor={s.label.anchor}>
                  {p.you ? copy.personYou(p.name) : live && arrived ? copy.personDecides(p.name) : p.name}
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
      <div className={`map-badge${live ? " live" : ""}`}>
        <span className="dot">
          <span />
          <span className="ping" />
        </span>
        {live ? copy.live : copy.draft}
      </div>
    </div>
  );
}
