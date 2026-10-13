/**
 * X launch, 1080x1080, 36 s. "Who's holding the family money?"
 * The awkward family group chat, then the pot that answers it. Consumer
 * words only: no crypto word anywhere.
 */
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { FACTS } from "../facts.ts";
import { Film } from "./Film.tsx";
import { C, CITIES, ColorCard, Confetti, Counter, Face, Fingerprint, MONEY, NightSky, Pill, Pin, pop, PopIn, Pot, prog, Rays, Route, Scene, Sfx, Skyline, TypeOn, Words, World, easeInOut, PEOPLE } from "./kit.tsx";

const P = FACTS.pot;
const CAST = FACTS.cast;

function Hook() {
  const frame = useCurrentFrame();
  const bar = prog(frame, 70, 86);
  return (
    <Scene bg={C.night} enter="cut">
      <NightSky />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 170 }}>
        <div style={{ transform: `translateY(${Math.sin(frame / 10) * 6}px)` }}>
          <Pot size={170} layers={[{ color: C.clay, h: 0.5 }, { color: C.teal, h: 0.3 }]} lid={1} lock={1} glow={1} id="hook" />
        </div>
        <div style={{ marginTop: 60, textAlign: "center" }}>
          <TypeOn text="Who's holding" at={8} size={96} caret={false} />
          <TypeOn text="the family money?" at={30} size={96} accentFrom={11} />
        </div>
        <div style={{ marginTop: 22, width: 300 * bar, height: 12, borderRadius: 9, background: C.teal }} />
      </AbsoluteFill>
    </Scene>
  );
}

const CHAT: { who: string; color: string; text: string; me?: boolean; at: number }[] = [
  { who: "Aunty Ime", color: C.plum, text: "Mama turns 60!! 🎉 Let's do it BIG", at: 6 },
  { who: CAST.maya.name, color: C.teal, text: "I'm in 🙌🏾", me: true, at: 26 },
  { who: "Cousin Tunde", color: C.olive, text: "Send everything to my account 👍🏾 I'll sort it", at: 44 },
  { who: CAST.daniel.name, color: C.saffron, text: "...your account? 👀", me: true, at: 66 },
  { who: CAST.eddy.name, color: C.clay, text: "Remember the wedding money? 😬", me: true, at: 84 },
];

function Chat() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dim = prog(frame, 104, 118);
  return (
    <Scene bg={C.cream} enter="up">
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(${C.sand} 2px, transparent 2px)`, backgroundSize: "34px 34px" }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 130, background: C.teal, display: "flex", alignItems: "center", gap: 22, padding: "0 46px", color: C.white }}>
        <div style={{ fontSize: 60 }}>👨🏾‍👩🏾‍👧🏾‍👦🏾</div>
        <div>
          <div style={{ fontWeight: 900, fontSize: 40 }}>The Family 💛</div>
          <div style={{ fontWeight: 700, fontSize: 24, opacity: 0.85 }}>Aunty Ime, Cousin Tunde, {CAST.eddy.name}, {CAST.maya.name}, {CAST.daniel.name}</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 40, right: 40, top: 170, display: "flex", flexDirection: "column", gap: 24 }}>
        {CHAT.map((m, i) => {
          const s = pop(frame, fps, m.at, 12);
          if (frame < m.at) return null;
          return (
            <div key={i} style={{ alignSelf: m.me ? "flex-end" : "flex-start", maxWidth: 860, transform: `scale(${0.6 + 0.4 * s})`, transformOrigin: m.me ? "100% 100%" : "0 100%", opacity: Math.min(1, s * 2) }}>
              <div style={{ background: m.me ? "#FBE3CF" : C.paper, borderRadius: 30, borderBottomLeftRadius: m.me ? 30 : 6, borderBottomRightRadius: m.me ? 6 : 30, padding: "16px 26px", boxShadow: "0 6px 0 rgba(58,35,23,0.1)" }}>
                <div style={{ fontWeight: 900, fontSize: 30, color: m.color }}>{m.who}</div>
                <div style={{ fontWeight: 800, fontSize: 50, color: C.ink, lineHeight: 1.15 }}>{m.text}</div>
              </div>
              <Sfx at={m.at} name="pop" vol={0.35} />
            </div>
          );
        })}
      </div>
      <AbsoluteFill style={{ background: C.night, opacity: dim * 0.6 }} />
    </Scene>
  );
}

function Meet() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = pop(frame, fps, 4, 9);
  return (
    <Scene bg={C.clay} enter="circle">
      <Rays />
      <Skyline />
      <Confetti count={50} from={6} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: `translateY(${(1 - drop) * -500}px)` }}>
          <Pot size={300} layers={[]} lid={1} lock={1} id="meet" />
        </div>
        <Words text="Meet *NivPay*" at={12} size={130} align="center" stagger={4} />
        <Words text="A pot nobody can pocket." at={24} size={52} weight={800} align="center" style={{ marginTop: 10 }} />
      </AbsoluteFill>
      <Sfx at={8} name="thunk" vol={0.7} />
      <Sfx at={0} name="whoosh" vol={0.4} />
    </Scene>
  );
}

const MAPX = -118, MAPY = 250, MAPK = 0.82;
const at = (p: { x: number; y: number }) => ({ x: MAPX + p.x * MAPK, y: MAPY + p.y * MAPK });
const POT = { x: 735, y: 360 };

function Pour() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pot = at(POT);
  const flights = [
    { who: CAST.eddy, from: CITIES.london, color: PEOPLE[0], at: 24, h: 0.5, emoji: "💂🏾" },
    { who: CAST.maya, from: CITIES.houston, color: PEOPLE[1], at: 54, h: 0.4, emoji: "🤠" },
    { who: CAST.daniel, from: CITIES.nairobi, color: PEOPLE[2], at: 84, h: 0.1, emoji: "🦒" },
  ];
  const layers = flights.map((f) => ({ color: f.color, h: f.h * pop(frame, fps, f.at + 27, 12) }));
  const total = [0, 500, 900, 1000];
  const landed = flights.filter((f) => frame >= f.at + 27).length;
  return (
    <Scene bg={C.sea} enter="wipe">
      <World x={MAPX} y={MAPY} scale={MAPK} />
      {flights.map((f) => {
        const p = at(f.from);
        return (
          <div key={f.who.name}>
            <Route a={p} b={{ x: pot.x, y: pot.y - 20 }} color={f.color} at={f.at} width={9} />
            <Pin x={p.x} y={p.y} at={4 + flights.indexOf(f) * 6} label={f.who.city} sub={f.who.name} color={f.color} emoji={f.emoji} size={1.25} labelSide={f.from === CITIES.london ? "right" : "below"} check={f.at + 27} />
            <Sfx at={f.at} name="whoosh" vol={0.25} />
            <Sfx at={f.at + 27} name="coin" vol={0.6} />
          </div>
        );
      })}
      <div style={{ position: "absolute", left: pot.x - 110, top: pot.y - 120 }}>
        <Pot size={220} layers={layers} lid={0} id="pour" />
      </div>
      <div style={{ position: "absolute", left: pot.x - 150, top: pot.y + 110, width: 300, textAlign: "center", opacity: landed ? 1 : 0 }}>
        <div style={{ display: "inline-block", background: C.paper, borderRadius: 20, padding: "6px 24px", boxShadow: "0 6px 0 rgba(0,0,0,0.15)" }}>
          <Counter from={total[Math.max(0, landed - 1)]} to={total[landed]} at={landed ? flights[landed - 1].at + 27 : 0} dur={18} size={52} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 50, top: 50, right: 50 }}>
        <Words text="Everyone chips in." at={4} size={84} color={C.white} />
        <Words text="From *anywhere.*" at={70} size={84} color={C.white} />
      </div>
    </Scene>
  );
}

function Lock() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lid = pop(frame, fps, 10, 9);
  const lock = pop(frame, fps, 24, 8);
  const chips = [
    { at: 40, text: `🧑🏾‍🍳 ${CAST.caterer.name}  🏛️ ${CAST.eventHall.name}`, label: "Pays only" },
    { at: 54, text: `✋🏾 ${P.rule} must say yes`, label: "Who decides" },
    { at: 68, text: `🗓️ ${P.closesOn}`, label: "Closes" },
  ];
  return (
    <Scene bg={C.cream} enter="push">
      <Rays color="rgba(165,69,31,0.06)" cy="55%" />
      <div style={{ position: "absolute", left: 50, top: 50, right: 50 }}>
        <Words text="Locked the moment" at={2} size={80} color={C.ink} />
        <Words text="it's *made.*" at={10} size={80} color={C.ink} accent={C.clay} />
      </div>
      <div style={{ position: "absolute", left: 300, top: 290, transform: `scale(${1 + lock * 0.03})` }}>
        <Pot size={480} layers={[{ color: PEOPLE[0], h: 0.5 }, { color: PEOPLE[1], h: 0.4 }, { color: PEOPLE[2], h: 0.1 }]} lid={lid} lock={lock} id="lock" />
      </div>
      <div style={{ position: "absolute", left: 50, right: 50, bottom: 60, display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
        {chips.map((c) => (
          <PopIn key={c.at} at={c.at}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", background: C.paper, border: `4px solid ${C.ink}`, borderRadius: 999, padding: "10px 28px", fontWeight: 900, fontSize: 36, color: C.ink, boxShadow: "0 6px 0 rgba(58,35,23,0.2)" }}>
              <span style={{ color: C.clay, fontSize: 26, textTransform: "uppercase", letterSpacing: 1 }}>{c.label}</span>
              {c.text}
            </div>
            <Sfx at={c.at} name="pop" vol={0.3} />
          </PopIn>
        ))}
      </div>
      <Sfx at={14} name="thunk" vol={0.8} />
      <Sfx at={26} name="lock" vol={0.8} />
    </Scene>
  );
}

function Pocket() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const grow = prog(frame, 14, 46, easeInOut);
  const hit = 46;
  const x = pop(frame, fps, hit, 8);
  const shake = frame > hit && frame < hit + 14 ? Math.sin(frame * 3) * 12 * (1 - (frame - hit) / 14) : 0;
  const fade = 1 - prog(frame, hit + 4, hit + 18);
  const a = { x: 400, y: 600 }, b = { x: 860, y: 600 };
  const end = { x: a.x + (b.x - a.x) * grow, y: a.y - Math.sin(grow * Math.PI) * 90 };
  return (
    <Scene bg={C.night2} enter="wipe">
      <Rays color="rgba(200,55,45,0.10)" cy="60%" />
      <div style={{ position: "absolute", left: 50, top: 50, right: 50 }}>
        <Words text="Nobody can" at={2} size={92} />
        <Words text="pocket it." at={8} size={92} />
        <Words text="*Not even you.*" at={64} size={92} accent={C.gold} />
      </div>
      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0 }}>
        <path d={`M${a.x} ${a.y} Q${(a.x + end.x) / 2} ${a.y - 120 * grow} ${end.x} ${end.y}`} fill="none" stroke={C.gold} strokeWidth={10} strokeLinecap="round" strokeDasharray="2 22" opacity={fade} />
      </svg>
      <div style={{ position: "absolute", left: 210, top: 470 }}>
        <Pot size={260} layers={[{ color: PEOPLE[0], h: 0.5 }, { color: PEOPLE[1], h: 0.4 }, { color: PEOPLE[2], h: 0.1 }]} lid={1} lock={1} id="pocket" />
      </div>
      <div style={{ position: "absolute", left: 800, top: 560, transform: `translateX(${shake}px)` }}>
        <div style={{ width: 150, height: 150, borderRadius: 44, background: C.paper, border: `8px solid ${C.red}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 84 }}>😏</div>
        <div style={{ textAlign: "center", color: C.white, fontWeight: 900, fontSize: 32, marginTop: 10 }}>"My account"</div>
      </div>
      <div style={{ position: "absolute", left: 720, top: 470, fontSize: 300, fontWeight: 900, color: C.red, transform: `scale(${x}) rotate(${(1 - x) * 40}deg)`, opacity: x, lineHeight: 1 }}>✕</div>
      <Sfx at={12} name="rise" vol={0.3} />
      <Sfx at={hit} name="buzz" vol={0.6} />
      <Sfx at={hit} name="stamp" vol={0.6} />
    </Scene>
  );
}

function Yes() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const yes = [8, 30];
  const count = yes.filter((y) => frame >= y + 10).length;
  const payAt = 46;
  const tilt = Math.sin(prog(frame, payAt, payAt + 40) * Math.PI) * 14;
  const level = 1 - 0.6 * prog(frame, payAt + 6, payAt + 40, easeInOut);
  const paid = pop(frame, fps, payAt + 34, 9);
  return (
    <Scene bg={C.teal} enter="circle">
      <Rays />
      <div style={{ position: "absolute", left: 50, top: 46, right: 50 }}>
        <Words text={`*${P.yesNeeded}* yeses. Paid.`} at={2} size={88} />
      </div>
      <div style={{ position: "absolute", left: 60, top: 190, display: "flex", gap: 34 }}>
        {[CAST.eddy, CAST.maya, CAST.daniel].map((p, i) => {
          const y = i === 0 ? -1 : yes[i - 1];
          const on = y >= 0 && frame >= y + 10;
          return (
            <div key={p.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <Face name={p.name} color={PEOPLE[i]} size={92} ring={on ? 6 : 0} />
              
              {y >= 0 && (
                <PopIn at={y}>
                  <Fingerprint size={90} color={PEOPLE[i]} scan={prog(frame, y, y + 12)} />
                  <Sfx at={y} name="scan" vol={0.4} />
                </PopIn>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", right: 70, top: 220, background: C.paper, borderRadius: 26, padding: "14px 30px", fontWeight: 900, fontSize: 54, color: C.ink, transform: `scale(${1 + 0.1 * pop(frame, fps, 40, 8) - 0.1 * Math.min(1, frame / 40)})` }}>
        {count} of {P.yesNeeded} {count >= 2 ? "✅" : "⏳"}
      </div>
      <div style={{ position: "absolute", left: 120, top: 560 }}>
        <Pot size={300} layers={[{ color: PEOPLE[0], h: 0.5 * level }, { color: PEOPLE[1], h: 0.4 * level }, { color: PEOPLE[2], h: 0.1 * level }]} lid={1} lock={1} tilt={tilt} id="yes" />
      </div>
      <Route a={{ x: 360, y: 640 }} b={{ x: 780, y: 720 }} c={{ x: 580, y: 520 }} color={C.gold} at={payAt} dur={34} width={14} coinLabel="$" />
      <div style={{ position: "absolute", left: 740, top: 640 }}>
        <div style={{ width: 170, height: 170, borderRadius: 44, background: C.paper, border: `8px solid ${C.gold}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 92 }}>🧑🏾‍🍳</div>
        <div style={{ position: "absolute", left: 110, top: -20, width: 70, height: 70, borderRadius: 18, background: C.gold, color: C.white, fontWeight: 900, fontSize: 44, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${paid})` }}>✓</div>
        <div style={{ textAlign: "center", color: C.white, fontWeight: 900, fontSize: 34, marginTop: 8 }}>{CAST.caterer.name}</div>
        <div style={{ textAlign: "center", fontFamily: MONEY, color: C.gold, fontSize: 44, opacity: paid }}>{P.caterer.amount}</div>
      </div>
      <Sfx at={payAt} name="pour" vol={0.5} />
      <Sfx at={payAt + 34} name="chime" vol={0.5} />
    </Scene>
  );
}

function Uses() {
  const cards = [
    { bg: C.clay, emoji: "🎂", title: "Birthdays", sub: `${P.name}, sorted` },
    { bg: C.plum, emoji: "💍", title: "Weddings", sub: "Aso ebi to the DJ" },
    { bg: C.teal, emoji: "🎓", title: "School fees", sub: "Term after term" },
    { bg: C.olive, emoji: "🕊️", title: "Burials", sub: "Dignity, shared" },
  ];
  const frame = useCurrentFrame();
  const i = Math.min(3, Math.floor(frame / 30));
  const c = cards[i];
  return (
    <Scene bg={c.bg} enter="push">
      <Sequence key={i} from={i * 30} layout="none">
        <ColorCard {...c} />
      </Sequence>
      {cards.map((_, k) => <Sfx key={k} at={k * 30} name="whoosh" vol={0.3} />)}
    </Scene>
  );
}

function End() {
  const frame = useCurrentFrame();
  const bar = prog(frame, 22, 36);
  return (
    <Scene bg={C.night} enter="iris">
      <NightSky glowAt="50% 32%" />
      <Confetti count={30} from={0} />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 140 }}>
        <div style={{ transform: `translateY(${Math.sin(frame / 10) * 6}px)` }}>
          <Pot size={210} layers={[{ color: PEOPLE[0], h: 0.5 }, { color: PEOPLE[1], h: 0.4 }, { color: PEOPLE[2], h: 0.1 }]} lid={1} lock={1} glow={1} id="end" />
        </div>
        <Words text="Niv*Pay*" at={6} size={150} align="center" stagger={0} style={{ marginTop: 20 }} />
        <div style={{ width: 160 * bar, height: 12, borderRadius: 9, background: C.teal, marginTop: 6 }} />
        <Words text="A pot nobody can pocket." at={16} size={50} weight={800} align="center" style={{ marginTop: 22 }} />
        <PopIn at={30} style={{ marginTop: 40 }}>
          <Pill bg={C.teal} size={44}>{FACTS.app.host}</Pill>
        </PopIn>
        <Words text="In test mode. Opens in your browser." at={40} size={28} weight={700} color="rgba(255,255,255,0.7)" align="center" style={{ marginTop: 26 }} />
      </AbsoluteFill>
      <Sfx at={6} name="ding" vol={0.4} />
    </Scene>
  );
}

export function XLaunch() {
  return <Film id="x" scenes={{ hook: Hook, chat: Chat, meet: Meet, pour: Pour, lock: Lock, pocket: Pocket, yes: Yes, uses: Uses, end: End }} />;
}

