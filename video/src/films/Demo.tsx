/**
 * Technical demo, 1920x1080, 138 s. "The life of a pot."
 * Mama's 60th from first coin to last share, in the amounts of docs/DEMO.md,
 * with Monad's block strip running underneath: every coin lands only when
 * the block holding it is Finalized, as the app does (docs/MOTION.md).
 * Then what a rogue sibling can't do, the ledger, the live record on Monad
 * testnet, and the stack.
 */
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { FACTS, shortHex } from "../facts.ts";
import receiptsFile from "../receipts.json" with { type: "json" };
import { Film } from "./Film.tsx";
import { BlockStrip, C, CITIES, ColorCard, Confetti, Counter, Face, Fingerprint, MONEY, NightSky, Pill, Pin, pop, PopIn, Pot, prog, Rays, Rise, Route, Scene, Sfx, Skyline, TypeOn, Words, World, easeInOut, landing, PEOPLE, type Pt } from "./kit.tsx";

const P = FACTS.pot;
const CAST = FACTS.cast;
const SIBS = [
  { ...CAST.eddy, color: PEOPLE[0], emoji: "💂🏾", city0: CITIES.london, pour: P.pours.eddy, share: P.shares.eddy, h: 0.5 },
  { ...CAST.maya, color: PEOPLE[1], emoji: "🤠", city0: CITIES.houston, pour: P.pours.maya, share: P.shares.maya, h: 0.4 },
  { ...CAST.daniel, color: PEOPLE[2], emoji: "🦒", city0: CITIES.nairobi, pour: P.pours.daniel, share: P.shares.daniel, h: 0.1 },
];
const dollars = (s: string) => Number(s.replace(/[$,]/g, ""));
const W = 1.2; // the 1600x900 world fills 1920x1080
const w = (p: Pt) => ({ x: p.x * W, y: p.y * W });
const POT = w({ x: 735, y: 370 });
const LAGOS = w(CITIES.lagos);
const CATERER = { x: LAGOS.x - 70, y: LAGOS.y + 40 };
const HALL = { x: LAGOS.x + 120, y: LAGOS.y + 120 };
const STRIP_Y = 920;

/** The pot on the map, at its spot. */
function MapPot({ layers, lid = 1, lock = 0, tilt = 0, size = 230 }: { layers: { color: string; h: number }[]; lid?: number; lock?: number; tilt?: number; size?: number }) {
  return (
    <div style={{ position: "absolute", left: POT.x - size / 2, top: POT.y - size * 0.6 }}>
      <Pot size={size} layers={layers} lid={lid} lock={lock} tilt={tilt} id="mappot" />
    </div>
  );
}

function Caption({ children, at = 0 }: { children: string; at?: number }) {
  return (
    <div style={{ position: "absolute", left: 70, top: 50, background: "rgba(27,15,10,0.88)", borderRadius: 30, padding: "20px 34px", maxWidth: 1100 }}>
      <Words text={children} at={at} size={66} />
    </div>
  );
}

function Hook() {
  const frame = useCurrentFrame();
  const bar = prog(frame, 120, 136);
  return (
    <Scene bg={C.night} enter="cut">
      <NightSky />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 140 }}>
        <div style={{ display: "flex", gap: 50 }}>
          {SIBS.map((s, i) => (
            <PopIn key={s.name} at={6 + i * 8}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <Face name={s.name} color={s.color} size={130} />
                <div style={{ color: C.white, fontWeight: 900, fontSize: 32 }}>{s.city}</div>
              </div>
              <Sfx at={6 + i * 8} name="pop" vol={0.3} />
            </PopIn>
          ))}
        </div>
        <div style={{ marginTop: 70, textAlign: "center" }}>
          <TypeOn text="Three siblings. Three cities." at={40} size={84} caret={false} cps={30} />
          <TypeOn text={`Who holds the money for ${P.name}?`} at={78} size={84} accentFrom={24} cps={30} />
        </div>
        <div style={{ marginTop: 22, width: 300 * bar, height: 12, borderRadius: 9, background: C.teal }} />
      </AbsoluteFill>
    </Scene>
  );
}

function Title() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = pop(frame, fps, 2, 9);
  return (
    <Scene bg={C.clay} enter="circle">
      <Rays />
      <Skyline />
      <Confetti count={40} from={4} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: `translateY(${(1 - drop) * -500}px)` }}>
          <Pot size={230} lid={1} lock={1} id="title" />
        </div>
        <Words text="Niv*Pay*" at={8} size={190} align="center" stagger={0} />
        <Words text="A pot nobody can pocket." at={18} size={60} weight={800} align="center" style={{ marginTop: 6 }} />
        <PopIn at={32} style={{ marginTop: 30 }}>
          <Pill bg={C.night} size={32}>⚡ Built on Monad</Pill>
        </PopIn>
      </AbsoluteFill>
      <Sfx at={6} name="thunk" vol={0.6} />
      <Sfx at={0} name="whoosh" vol={0.4} />
    </Scene>
  );
}

function Problem() {
  const frame = useCurrentFrame();
  const holder = POT;
  const doubts = [
    { who: 0, text: "Did he pay the caterer?", at: 170 },
    { who: 1, text: "Where's the change?", at: 200 },
    { who: 2, text: "Receipts??", at: 230 },
  ];
  return (
    <Scene bg={C.sea} enter="wipe">
      <World scale={W} />
      {SIBS.map((s, i) => {
        const p = w(s.city0);
        return (
          <div key={s.name}>
            <Route a={p} b={holder} color={s.color} at={40 + i * 26} width={9} />
            <Pin x={p.x} y={p.y} at={4 + i * 5} label={s.city} sub={s.name} color={s.color} emoji={s.emoji} labelSide={i === 0 ? "left" : "below"} />
            <Sfx at={40 + i * 26 + 27} name="coin" vol={0.4} />
          </div>
        );
      })}
      <PopIn at={10} style={{ position: "absolute", left: holder.x - 90, top: holder.y - 110 }}>
        <div style={{ fontSize: 170, lineHeight: 1, transform: `rotate(${Math.sin(frame / 8) * 4}deg)` }}>🤵🏾</div>
        <div style={{ position: "absolute", left: 120, top: 100, fontSize: 80, transform: `scale(${0.6 + 0.4 * prog(frame, 60, 130)})` }}>💰</div>
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 32, color: C.ink, marginTop: 6, textShadow: `0 2px 0 ${C.paper}` }}>Cousin Tunde</div>
      </PopIn>
      {frame >= 130 && (
        <PopIn at={130} style={{ position: "absolute", left: holder.x + 110, top: holder.y - 230 }}>
          <div style={{ background: C.paper, borderRadius: 26, padding: "14px 26px", fontWeight: 900, fontSize: 40, color: C.ink, boxShadow: "0 8px 0 rgba(0,0,0,0.15)" }}>Trust me</div>
          <Sfx at={130} name="pop" vol={0.4} />
        </PopIn>
      )}
      {doubts.map((d) => {
        const p = w(SIBS[d.who].city0);
        return frame >= d.at ? (
          <PopIn key={d.at} at={d.at} style={{ position: "absolute", left: p.x - 150, top: p.y - 170 }}>
            <div style={{ background: C.night, color: C.white, borderRadius: 24, padding: "12px 22px", fontWeight: 800, fontSize: 30, whiteSpace: "nowrap" }}>{d.text}</div>
            <Sfx at={d.at} name="pop" vol={0.3} />
          </PopIn>
        ) : null;
      })}
      <Caption at={4}>{"Today, one person holds it."}</Caption>
      {frame >= 260 && (
        <div style={{ position: "absolute", left: 70, top: 170 }}>
          <div style={{ background: C.red, borderRadius: 26, padding: "12px 30px", transform: `rotate(-3deg) scale(${pop(frame, 30, 260, 9)})` }}>
            <Words text="Everyone else *hopes.*" at={262} size={60} accent={C.gold} />
          </div>
          <Sfx at={260} name="stamp" vol={0.5} />
        </div>
      )}
    </Scene>
  );
}

function Make() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sealAt = 250;
  const lid = pop(frame, fps, sealAt + 16, 9);
  const lock = pop(frame, fps, sealAt + 30, 8);
  const rows = [
    { at: 40, k: "Who decides", v: <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{SIBS.map((s) => <Face key={s.name} name={s.name} color={s.color} size={54} />)}<span style={{ marginLeft: 10 }}>{P.rule} must say yes</span></div> },
    { at: 80, k: "Pays only to", v: <span>{CAST.caterer.name} up to {CAST.caterer.limit}</span> },
    { at: 104, k: "", v: <span>{CAST.eventHall.name} up to {CAST.eventHall.limit}</span> },
    { at: 140, k: "Closes", v: <span>the end of {P.closesOn}</span> },
  ];
  const nevers = ["No owner", "No admin", "No upgrades", "Not even its maker can change it"];
  return (
    <Scene bg={C.cream} enter="push">
      <div style={{ position: "absolute", left: 90, top: 70 }}>
        <Words text={`Make a pot: *${P.name}*`} at={2} size={86} color={C.ink} accent={C.clay} />
      </div>
      <div style={{ position: "absolute", left: 90, top: 220, width: 1000, background: C.paper, border: `5px solid ${C.ink}`, borderRadius: 34, padding: "26px 40px", boxShadow: "0 14px 0 rgba(58,35,23,0.18)" }}>
        {rows.map((r) => (
          <Rise key={r.at} at={r.at} dist={30}>
            <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "16px 0", borderBottom: `3px solid ${C.sand}`, fontWeight: 900, fontSize: 40, color: C.ink, minHeight: 60 }}>
              <span style={{ width: 250, color: C.clay, fontSize: 28, textTransform: "uppercase", letterSpacing: 1 }}>{r.k}</span>
              {r.v}
            </div>
            <Sfx at={r.at} name="pop" vol={0.3} />
          </Rise>
        ))}
        <Rise at={190} dist={20}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 20 }}>
            <PopIn at={210}><Fingerprint size={100} scan={prog(frame, 214, 230)} /></PopIn>
            <div style={{ fontWeight: 900, fontSize: 38, color: C.ink }}>{frame >= sealAt ? "Made. Locked for good. 🔒" : "Make the pot"}</div>
          </div>
          <Sfx at={214} name="scan" vol={0.4} />
        </Rise>
      </div>
      <div style={{ position: "absolute", left: 1150, top: 230, transform: `scale(${1 + 0.04 * lock})` }}>
        <Pot size={560} layers={[]} lid={lid} lock={lock} id="make" glow={lock} />
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, bottom: 60, display: "flex", gap: 20, flexWrap: "wrap" }}>
        {nevers.map((n, i) => (
          <PopIn key={n} at={sealAt + 50 + i * 10}>
            <Pill bg={i === 3 ? C.clay : C.night} size={34}>{i === 3 ? "🔒" : "✕"} {n}</Pill>
            <Sfx at={sealAt + 50 + i * 10} name="pop" vol={0.3} />
          </PopIn>
        ))}
      </div>
      <Sfx at={sealAt + 18} name="thunk" vol={0.8} />
      <Sfx at={sealAt + 30} name="lock" vol={0.8} />
    </Scene>
  );
}

function ChipIn() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sends = [60, 200, 340];
  const flights = SIBS.map((s, i) => {
    const sent = sends[i];
    const land = Math.max(sent + 27, Math.round(landing(sent).finalAt));
    return { ...s, sent, land };
  });
  const layers = flights.map((f) => ({ color: f.color, h: f.h * pop(frame, fps, f.land, 12) }));
  const landed = flights.filter((f) => frame >= f.land).length;
  const totals = [0, 500, 900, 1000];
  return (
    <Scene bg={C.sea} enter="wipe">
      <World scale={W} />
      {flights.map((f, i) => {
        const p = w(f.city0);
        return (
          <div key={f.name}>
            <Route a={p} b={{ x: POT.x, y: POT.y - 60 }} color={f.color} at={f.sent} dur={f.land - f.sent} width={10} />
            <Pin x={p.x} y={p.y} at={4 + i * 5} label={f.city} sub={`${f.name} · ${f.pour}`} color={f.color} emoji={f.emoji} labelSide={i === 0 ? "left" : "below"} check={f.land} />
            <Sfx at={f.sent} name="scan" vol={0.3} />
            <Sfx at={f.land} name="coin" vol={0.6} />
          </div>
        );
      })}
      <MapPot layers={layers} lid={1} />
      <div style={{ position: "absolute", left: POT.x - 140, top: POT.y + 120, width: 280, textAlign: "center" }}>
        <div style={{ display: "inline-block", background: C.paper, borderRadius: 20, padding: "6px 24px", boxShadow: "0 6px 0 rgba(0,0,0,0.15)" }}>
          <Counter from={totals[Math.max(0, landed - 1)]} to={totals[landed]} at={landed ? flights[landed - 1].land : 0} dur={18} size={54} />
        </div>
      </div>
      <Caption at={4}>{"Everyone *chips in.*"}</Caption>
      {frame >= 110 && (
        <PopIn at={110} style={{ position: "absolute", right: 60, top: 60, width: 640 }}>
          <div style={{ background: C.paper, borderRadius: 26, padding: "20px 28px", boxShadow: "0 8px 0 rgba(0,0,0,0.18)", fontWeight: 900, fontSize: 36, color: C.ink, lineHeight: 1.2 }}>
            A coin lands only when its block is <span style={{ color: C.teal }}>Finalized</span>: on Monad, {FACTS.chain.finalizedBehind} behind the newest block.
          </div>
        </PopIn>
      )}
      {frame >= 250 && (
        <PopIn at={250} style={{ position: "absolute", right: 60, top: 270, width: 640 }}>
          <div style={{ background: C.night, borderRadius: 26, padding: "20px 28px", fontWeight: 900, fontSize: 34, color: C.white, lineHeight: 1.2 }}>
            ✍🏾 One signature: Agora's permit and the deposit, in one request.
          </div>
        </PopIn>
      )}
      <BlockStrip y={STRIP_Y} marks={flights.map((f) => ({ sentAt: f.sent, label: `+${f.pour}`, color: f.color }))} />
    </Scene>
  );
}

function Yes() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const askAt = 40, yesAt = 200, hallAt = 400;
  const payLand = Math.max(yesAt + 34, Math.round(landing(yesAt).finalAt));
  const hallLand = Math.max(hallAt + 34, Math.round(landing(hallAt).finalAt));
  const after1 = dollars(P.caterer.after) / 1000, after2 = dollars(P.eventHall.after) / 1000;
  const level = 1 - (1 - after1) * prog(frame, payLand - 10, payLand + 20, easeInOut) - (after1 - after2) * prog(frame, hallLand - 10, hallLand + 20, easeInOut);
  const tilt = Math.sin(prog(frame, yesAt, payLand + 20) * Math.PI) * 10 + Math.sin(prog(frame, hallAt, hallLand + 20) * Math.PI) * 8;
  const count = frame >= yesAt + 14 ? 2 : frame >= askAt + 10 ? 1 : 0;
  const shown = frame < hallLand + 20 ? Math.round(1000 - (1000 - after1 * 1000) * prog(frame, payLand - 10, payLand + 20, easeInOut)) : null;
  return (
    <Scene bg={C.sea} enter="push">
      <World scale={W} />
      {SIBS.map((s, i) => {
        const p = w(s.city0);
        return <Pin key={s.name} x={p.x} y={p.y} at={0} label={s.city} sub={s.name} color={s.color} emoji={s.emoji} labelSide={i === 0 ? "left" : "below"} size={0.8} />;
      })}
      <div style={{ position: "absolute", left: LAGOS.x - 60, top: LAGOS.y - 90, fontWeight: 900, fontSize: 30, color: C.ink, textShadow: `0 2px 0 ${C.paper}` }}>Lagos</div>
      <Route a={{ x: POT.x + 60, y: POT.y - 10 }} b={CATERER} color={C.gold} at={yesAt + 4} dur={payLand - yesAt - 4} width={14} march={frame < payLand} />
      <Route a={{ x: POT.x + 60, y: POT.y + 10 }} b={HALL} color={C.gold} at={hallAt + 4} dur={hallLand - hallAt - 4} width={14} coin={frame >= hallAt} />
      <Pin x={CATERER.x} y={CATERER.y} at={8} label={CAST.caterer.name} sub={frame >= payLand ? `+${P.caterer.amount}` : `up to ${CAST.caterer.limit}`} color={C.gold} emoji="🧑🏾‍🍳" labelSide="below" check={payLand} />
      <Pin x={HALL.x} y={HALL.y} at={12} label={CAST.eventHall.name} sub={frame >= hallLand ? `+${P.eventHall.amount}` : `up to ${CAST.eventHall.limit}`} color={C.gold} emoji="🏛️" labelSide="right" check={hallLand} />
      <MapPot layers={SIBS.map((s) => ({ color: s.color, h: s.h * level }))} tilt={tilt} />
      <div style={{ position: "absolute", left: POT.x - 140, top: POT.y + 120, width: 280, textAlign: "center" }}>
        <div style={{ display: "inline-block", background: C.paper, borderRadius: 20, padding: "6px 24px", boxShadow: "0 6px 0 rgba(0,0,0,0.15)", fontFamily: MONEY, fontSize: 54, color: C.ink }}>
          {shown !== null ? `$${shown.toLocaleString("en-US")}` : P.left}
        </div>
      </div>
      <Caption at={4}>{"The second yes *pays.*"}</Caption>
      {/* the request card */}
      <PopIn at={askAt} style={{ position: "absolute", right: 60, top: 60, width: 620 }}>
        <div style={{ background: C.paper, borderRadius: 30, padding: "24px 30px", boxShadow: "0 10px 0 rgba(0,0,0,0.18)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Face name={CAST.daniel.name} color={PEOPLE[2]} size={70} />
            <div style={{ fontWeight: 900, fontSize: 32, color: C.ink }}>{CAST.daniel.name} asks to pay {CAST.caterer.name} <span style={{ fontFamily: MONEY }}>{P.caterer.amount}</span></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18 }}>
            <div style={{ fontWeight: 900, fontSize: 40, color: count >= 2 ? C.teal : C.clay }}>{count} of {P.yesNeeded} yes {count >= 2 ? "✅" : "⏳"}</div>
            {frame >= yesAt - 10 && (
              <PopIn at={yesAt - 10}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Face name={CAST.maya.name} color={PEOPLE[1]} size={60} ring={frame >= yesAt + 14 ? 5 : 0} />
                  <Fingerprint size={70} color={PEOPLE[1]} scan={prog(frame, yesAt, yesAt + 14)} />
                </div>
              </PopIn>
            )}
          </div>
          <div style={{ fontWeight: 800, fontSize: 24, color: C.muted, marginTop: 10 }}>Asking counts as {CAST.daniel.name}'s own yes.</div>
          {frame >= payLand && (
            <Rise at={payLand}>
              <div style={{ marginTop: 14, fontWeight: 900, fontSize: 28, color: C.teal }}>Paid in the same request. Fee {P.caterer.fee}, the business.</div>
            </Rise>
          )}
        </div>
      </PopIn>
      {frame >= hallAt - 20 && (
        <PopIn at={hallAt - 20} style={{ position: "absolute", right: 60, top: 440, width: 620 }}>
          <div style={{ background: C.night, color: C.white, borderRadius: 26, padding: "18px 26px", fontWeight: 900, fontSize: 32 }}>
            {CAST.eddy.name}'s yes pays the {CAST.eventHall.name} {P.eventHall.amount}. Fee {P.eventHall.fee}.
          </div>
        </PopIn>
      )}
      <Sfx at={askAt} name="pop" vol={0.4} />
      <Sfx at={yesAt} name="scan" vol={0.5} />
      <Sfx at={yesAt + 4} name="pour" vol={0.5} />
      <Sfx at={payLand} name="chime" vol={0.5} />
      <Sfx at={hallAt} name="scan" vol={0.4} />
      <Sfx at={hallAt + 4} name="pour" vol={0.4} />
      <Sfx at={hallLand} name="ding" vol={0.4} />
      <BlockStrip y={STRIP_Y} marks={[{ sentAt: askAt, label: "ask", color: PEOPLE[2] }, { sentAt: yesAt, label: `-${P.caterer.amount}`, color: C.gold }, { sentAt: hallAt, label: `-${P.eventHall.amount}`, color: C.gold }]} />
    </Scene>
  );
}

function Rogue() {
  const frame = useCurrentFrame();
  const cards = [
    { at: 40, e: "🧊", t: "A decider freezes the pot", r: "Payments stop. Everyone can still take their share out.", test: "test_hostileApprover_cannotTrapFunds" },
    { at: 170, e: "🔑", t: "Everyone loses their keys", r: "No payment ever again. Every share is still reachable.", test: "test_lostKeys_moneyIsStillReachable" },
    { at: 300, e: "😏", t: "\"Pay my cousin instead\"", r: "There is no such route. Only the payees named at the start, within their caps.", test: "_executePayout: listed payee, within its cap" },
  ];
  const pulse = 0.5 + 0.5 * Math.sin(frame / 6);
  return (
    <Scene bg="#2A0E0B" enter="circle">
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 120%, rgba(200,55,45,${0.25 + 0.15 * pulse}), transparent 60%)` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 60, textAlign: "center" }}>
        <Words text="What if someone *goes rogue?*" at={2} size={96} align="center" accent="#FF7A5C" />
      </div>
      <div style={{ position: "absolute", left: 80, right: 80, top: 260, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 36 }}>
        {cards.map((c) => {
          const s = pop(frame, 30, c.at, 10);
          const ok = pop(frame, 30, c.at + 60, 8);
          return (
            <div key={c.at} style={{ opacity: Math.min(1, s * 2), transform: `translateY(${(1 - s) * 120}px) rotate(${(1 - s) * -6}deg)` }}>
              <div style={{ background: C.paper, borderRadius: 34, padding: "34px 30px", height: 560, boxShadow: "0 16px 0 rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", gap: 18, position: "relative" }}>
                <div style={{ fontSize: 110 }}>{c.e}</div>
                <div style={{ fontWeight: 900, fontSize: 42, color: C.red, lineHeight: 1.1 }}>{c.t}</div>
                <div style={{ fontWeight: 800, fontSize: 32, color: C.ink, lineHeight: 1.25, opacity: prog(frame, c.at + 40, c.at + 54) }}>{c.r}</div>
                <div style={{ marginTop: "auto", background: C.teal, color: C.white, borderRadius: 16, padding: "12px 16px", fontFamily: "Consolas, monospace", fontSize: 21, transform: `scale(${ok})`, transformOrigin: "0 100%" }}>✓ {c.test}</div>
              </div>
              <Sfx at={c.at} name="whoosh" vol={0.35} />
              <Sfx at={c.at + 60} name="lock" vol={0.5} />
            </div>
          );
        })}
      </div>
      {frame >= 440 && (
        <PopIn at={440} style={{ position: "absolute", left: 0, right: 0, bottom: 50, display: "flex", justifyContent: "center" }}>
          <div style={{ background: C.gold, color: C.night, borderRadius: 999, padding: "18px 48px", fontWeight: 900, fontSize: 50, boxShadow: "0 10px 0 rgba(0,0,0,0.3)" }}>Safety of funds beats liveness of payouts.</div>
          <Sfx at={440} name="stamp" vol={0.6} />
        </PopIn>
      )}
    </Scene>
  );
}

function Close() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = 60;
  const left = dollars(P.left) / 1000;
  const drain = prog(frame, at + 40, at + 120, easeInOut);
  return (
    <Scene bg={C.sea} enter="wipe">
      <World scale={W} />
      {SIBS.map((s, i) => {
        const p = w(s.city0);
        const go = at + i * 5;
        const gotIt = pop(frame, fps, go + 40, 9);
        return (
          <div key={s.name}>
            <Route a={{ x: POT.x, y: POT.y - 40 }} b={p} color={s.color} at={go + 10} dur={30} width={10} />
            <Pin x={p.x} y={p.y} at={0} label={s.city} sub={s.name} color={s.color} emoji={s.emoji} labelSide={i === 0 ? "left" : "below"} check={go + 40} />
            <div style={{ position: "absolute", left: p.x - 90, top: p.y - 150, width: 180, textAlign: "center", transform: `scale(${gotIt})` }}>
              <span style={{ background: s.color, color: C.white, borderRadius: 18, padding: "6px 18px", fontFamily: MONEY, fontSize: 44 }}>{s.share}</span>
            </div>
            <Sfx at={go + 40} name="coin" vol={0.5} />
          </div>
        );
      })}
      <MapPot layers={SIBS.map((s) => ({ color: s.color, h: s.h * left * (1 - drain) }))} />
      <Caption at={4}>{"Close it, and split *by share.*"}</Caption>
      <Rise at={170} style={{ position: "absolute", left: 70, bottom: 60 }}>
        <div style={{ background: C.paper, borderRadius: 26, padding: "18px 30px", fontWeight: 900, fontSize: 36, color: C.ink, maxWidth: 1000 }}>
          Nobody is sent anything. Each takes their own share, whenever they like.
        </div>
      </Rise>
      <Sfx at={at} name="lock" vol={0.5} />
    </Scene>
  );
}

function Ledger() {
  const terms = [
    { v: P.total, l: "went in", c: C.ink, at: 6 },
    { v: "=", l: "", c: C.clay, at: 26 },
    { v: P.paidOut, l: "paid out", c: C.teal, at: 40 },
    { v: "+", l: "", c: C.clay, at: 54 },
    { v: P.fees, l: "in fees", c: C.saffron, at: 64 },
    { v: "+", l: "", c: C.clay, at: 78 },
    { v: P.left, l: "back by share", c: C.plum, at: 88 },
  ];
  const frame = useCurrentFrame();
  return (
    <Scene bg={C.cream} enter="up">
      <Rays color="rgba(165,69,31,0.05)" />
      <div style={{ position: "absolute", left: 0, right: 0, top: 130, textAlign: "center" }}>
        <Words text="Every cent *accounted for.*" at={2} size={90} color={C.ink} accent={C.clay} align="center" />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 420, display: "flex", justifyContent: "center", alignItems: "flex-start", gap: 36 }}>
        {terms.map((t, i) => (
          <PopIn key={i} at={t.at}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: t.l ? MONEY : "Nunito", fontWeight: t.l ? 600 : 900, fontSize: t.l ? 104 : 110, color: t.c, lineHeight: 1 }}>{t.v}</div>
              {t.l && <div style={{ fontWeight: 900, fontSize: 32, color: C.muted, marginTop: 14 }}>{t.l}</div>}
            </div>
            <Sfx at={t.at} name="pop" vol={0.35} />
          </PopIn>
        ))}
      </div>
      {frame >= 120 && (
        <PopIn at={120} style={{ position: "absolute", left: 0, right: 0, top: 720, display: "flex", justifyContent: "center" }}>
          <Pill bg={C.teal} size={36}>✓ Asserted to the unit in test/Mama60.t.sol</Pill>
          <Sfx at={120} name="chime" vol={0.4} />
        </PopIn>
      )}
    </Scene>
  );
}

/** Real transactions from the app, as listed in the README under Monad integration, and the take's send. */
const LIVE: { what: string; hash: string; block: number }[] = [
  { what: "A pot made", hash: FACTS.hashes.showcase.createPot, block: 69610359 },
  { what: "Money in, one signature", hash: FACTS.hashes.showcase.fundWithPermit, block: 69611378 },
  { what: "Dollars sent", hash: FACTS.hashes.showcase.send, block: (receiptsFile.receipts as Record<string, { block: number }>)[FACTS.hashes.showcase.send].block },
  { what: "Paid in another currency", hash: FACTS.hashes.showcase.swap, block: (receiptsFile.receipts as Record<string, { block: number }>)[FACTS.hashes.showcase.swap].block },
];

export function Proof() {
  return (
    <Scene bg={C.night} enter="push">
      <NightSky glowAt="80% 20%" glow="rgba(47,143,138,0.25)" />
      <div style={{ position: "absolute", left: 100, top: 90 }}>
        <Words text="Live on *Monad testnet.*" at={2} size={92} />
        <Rise at={14}>
          <div style={{ marginTop: 18, display: "flex", gap: 16 }}>
            <Pill bg={C.teal} size={28}>NivPayPots {shortHex(FACTS.contracts.potsAusd)}</Pill>
            <Pill bg={C.clay} size={28}>✓ Verified, exact Sourcify match</Pill>
          </div>
        </Rise>
      </div>
      <div style={{ position: "absolute", left: 100, right: 100, top: 400, display: "flex", flexDirection: "column", gap: 20 }}>
        {LIVE.map((r, i) => (
          <Rise key={r.hash} at={30 + i * 14} dist={40}>
            <div style={{ display: "flex", alignItems: "center", gap: 30, background: "rgba(255,255,255,0.07)", border: "3px solid rgba(255,255,255,0.12)", borderRadius: 24, padding: "18px 30px", color: C.white }}>
              <span style={{ color: C.tealBright, fontWeight: 900, fontSize: 40 }}>✓</span>
              <span style={{ fontWeight: 900, fontSize: 38, width: 560 }}>{r.what}</span>
              <span style={{ fontFamily: "Consolas, monospace", fontSize: 32, color: C.gold, width: 380 }}>{shortHex(r.hash)}</span>
              <span style={{ fontWeight: 800, fontSize: 32, opacity: 0.85 }}>block #{r.block.toLocaleString("en-US")}</span>
              <span style={{ marginLeft: "auto", background: C.teal, borderRadius: 99, padding: "6px 18px", fontWeight: 900, fontSize: 26 }}>Finalized</span>
            </div>
            <Sfx at={30 + i * 14} name="tick" vol={0.4} />
          </Rise>
        ))}
      </div>
    </Scene>
  );
}

function Stack() {
  const frame = useCurrentFrame();
  const cards = [
    { bg: C.plum, emoji: "⚡", title: "0.31 s blocks", sub: "Measured on Monad testnet. Final about two blocks later." },
    { bg: C.teal, emoji: "✅", title: "Final, or nothing", sub: "The app never says paid before the block is Finalized" },
    { bg: C.clay, emoji: "🔐", title: "Passkey accounts", sub: "Mera: the key exists only while signing, on the phone" },
    { bg: C.olive, emoji: "🧪", title: "Tested hard", sub: "Unit, fuzz, invariant and fork tests in Foundry" },
  ];
  const each = 105;
  const i = Math.min(3, Math.floor(frame / each));
  return (
    <Scene bg={cards[i].bg} enter="push">
      <Sequence key={i} from={i * each} layout="none">
        <ColorCard {...cards[i]} />
      </Sequence>
      {cards.map((_, k) => <Sfx key={k} at={k * each} name="whoosh" vol={0.3} />)}
      <div style={{ position: "absolute", left: 60, top: 50 }}>
        <Pill bg="rgba(0,0,0,0.25)" size={28}>🛠️ How it's built</Pill>
      </div>
    </Scene>
  );
}

function End() {
  const frame = useCurrentFrame();
  const bar = prog(frame, 22, 36);
  return (
    <Scene bg={C.night} enter="iris">
      <NightSky glowAt="50% 30%" />
      <Confetti count={26} />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 100 }}>
        <div style={{ transform: `translateY(${Math.sin(frame / 10) * 6}px)` }}>
          <Pot size={220} layers={SIBS.map((s) => ({ color: s.color, h: s.h }))} lid={1} lock={0} glow={1} id="end" />
        </div>
        <Words text="Niv*Pay*" at={6} size={160} align="center" stagger={0} />
        <div style={{ width: 170 * bar, height: 12, borderRadius: 9, background: C.teal, marginTop: 4 }} />
        <Words text="A pot nobody can pocket." at={16} size={56} weight={800} align="center" style={{ marginTop: 22 }} />
        <PopIn at={30} style={{ marginTop: 40, display: "flex", gap: 20 }}>
          <Pill bg={C.teal} size={44}>{FACTS.app.host}</Pill>
          <Pill bg={C.night2} size={44}>github.com/UEddy/Nivpay</Pill>
        </PopIn>
        <Words text="On Monad testnet, with Agora's AUSD. Open source, MIT." at={40} size={30} weight={700} color="rgba(255,255,255,0.7)" align="center" style={{ marginTop: 26 }} />
      </AbsoluteFill>
      <Sfx at={6} name="ding" vol={0.4} />
    </Scene>
  );
}

export function DemoFilm() {
  return <Film id="demo" scenes={{ hook: Hook, title: Title, problem: Problem, make: Make, chipin: ChipIn, yes: Yes, rogue: Rogue, close: Close, ledger: Ledger, proof: Proof, stack: Stack, end: End }} />;
}
