/**
 * Agora bounty, 1920x1080, 92 s. "Send dollars abroad like a text."
 * The three things judged, each before 90 s: passkey onboarding (Step 1,
 * from 8 s), an AUSD balance (Step 2, from 20 s), a send and its receipt
 * settled at once (London to Houston, from 30 s). Then the chain's own
 * receipt, another currency through Agora, the business and the stack.
 * Every amount and time comes from facts.ts or receipts.json.
 */
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { FACTS, shortHex } from "../facts.ts";
import receiptsFile from "../receipts.json" with { type: "json" };
import { Film } from "./Film.tsx";
import { AppBar, AppButton, C, Face, CITIES, Coin, ColorCard, Confetti, Counter, Fingerprint, FlatPhone, MONEY, NightSky, Pill, Pin, pop, PopIn, Pot, prog, Rays, Rise, Route, Scene, Sfx, Skyline, Tap, TypeOn, Words, World, easeInOut, PEOPLE } from "./kit.tsx";

const B = FACTS.bounty;
const M = FACTS.measured;
const CAST = FACTS.cast;
const SEND_S = parseFloat(M.sendSettle ?? "0");
const CLAIM_S = parseFloat(M.claimSettle ?? "0");
type Receipt = { status: string; block: number; finalized: boolean; transfers: { token: string; amount: string; toLastFour: string }[] };
const RECEIPTS = receiptsFile.receipts as Record<string, Receipt>;

export function Step({ n, title, lines, at = 0, color = C.clay }: { n: number; title: string; lines: string[]; at?: number; color?: string }) {
  return (
    <div style={{ position: "absolute", left: 120, top: 170, width: 900 }}>
      <PopIn at={at}>
        <Pill bg={color} size={30}>STEP {n}</Pill>
      </PopIn>
      <Words text={title} at={at + 6} size={104} color={C.ink} accent={color} style={{ marginTop: 30 }} />
      <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 22 }}>
        {lines.map((l, i) => (
          <Rise key={i} at={at + 40 + i * 22}>
            <div style={{ fontWeight: 800, fontSize: 48, color: C.ink, display: "flex", gap: 18, alignItems: "center" }}>{l}</div>
            <Sfx at={at + 40 + i * 22} name="pop" vol={0.25} />
          </Rise>
        ))}
      </div>
    </div>
  );
}

/** Where the phone sits in Steps 1 and 2. */
const PX = 1180, PY = 100, PW = 460, PK = PW / 400;

export function Hook() {
  const frame = useCurrentFrame();
  const bar = prog(frame, 76, 92);
  return (
    <Scene bg={C.night} enter="cut">
      <NightSky />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 150 }}>
        <div style={{ fontSize: 130, transform: `translateY(${Math.sin(frame / 10) * 8}px) rotate(${Math.sin(frame / 16) * 6}deg)` }}>💸</div>
        <div style={{ marginTop: 40, textAlign: "center" }}>
          <TypeOn text="What if sending dollars abroad" at={6} size={92} caret={false} cps={30} />
          <TypeOn text="felt like sending a text?" at={38} size={92} accentFrom={19} cps={30} />
        </div>
        <div style={{ marginTop: 22, width: 280 * bar, height: 12, borderRadius: 9, background: C.teal }} />
      </AbsoluteFill>
    </Scene>
  );
}

function Title() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = pop(frame, fps, 2, 9);
  return (
    <Scene bg={C.teal} enter="circle">
      <Rays />
      <Skyline />
      <Confetti count={40} from={4} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: `translateY(${(1 - drop) * -500}px)` }}>
          <Pot size={230} lid={1} lock={1} id="title" />
        </div>
        <Words text="Niv*Pay*" at={8} size={190} align="center" stagger={0} />
        <Words text="Dollars that cross borders in seconds." at={18} size={56} weight={800} align="center" style={{ marginTop: 6 }} />
        <PopIn at={34} style={{ marginTop: 34 }}>
          <div style={{ display: "flex", gap: 18 }}>
            <Pill bg={C.night} size={30}>💵 Agora's AUSD</Pill>
            <Pill bg={C.night} size={30}>⚡ on Monad</Pill>
          </div>
        </PopIn>
      </AbsoluteFill>
      <Sfx at={6} name="thunk" vol={0.6} />
      <Sfx at={0} name="whoosh" vol={0.4} />
    </Scene>
  );
}

// ---------- drawn app screens, in the app's own words ----------

function Welcome({ typeAt, pressAt }: { typeAt: number; pressAt: number }) {
  return (
    <>
      <div style={{ position: "absolute", top: 150, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontFamily: MONEY, fontWeight: 600, fontSize: 64, marginTop: 40 }}>NivPay</div>
        <div style={{ fontWeight: 700, fontSize: 20, color: C.muted }}>Group money nobody can pocket</div>
      </div>
      <div style={{ position: "absolute", left: 28, right: 28, top: 470 }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: C.muted, marginBottom: 8 }}>Your name</div>
        <div style={{ background: C.paper, border: `3px solid ${C.ink}`, borderRadius: 16, padding: "12px 16px", minHeight: 34 }}>
          <TypeOn text={CAST.eddy.name} at={typeAt} size={28} color={C.ink} accent={C.clay} weight={800} cps={8} />
        </div>
        <AppButton press={pressAt} style={{ marginTop: 22 }}>Create your account</AppButton>
      </div>
    </>
  );
}

function PasskeySheet({ at, scanAt }: { at: number; scanAt: number }) {
  const frame = useCurrentFrame();
  const up = prog(frame, at, at + 12);
  const done = frame >= scanAt + 18;
  return (
    <>
      <AbsoluteFill style={{ background: "rgba(27,15,10,0.45)", opacity: up }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 430, background: C.paper, borderTopLeftRadius: 34, borderTopRightRadius: 34, transform: `translateY(${(1 - up) * 440}px)`, padding: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ width: 60, height: 6, borderRadius: 9, background: C.sand }} />
        <div style={{ fontWeight: 900, fontSize: 26, textAlign: "center" }}>{done ? "Passkey saved ✓" : "Save a passkey"}</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: C.muted, textAlign: "center" }}>for {FACTS.app.host}</div>
        <Fingerprint size={150} color={done ? C.teal : C.clay} scan={prog(frame, scanAt, scanAt + 16)} />
        <div style={{ fontWeight: 800, fontSize: 18, color: C.muted }}>Touch the sensor</div>
      </div>
      <Sfx at={scanAt} name="scan" vol={0.5} />
      <Sfx at={scanAt + 18} name="ding" vol={0.4} />
    </>
  );
}

function Home({ balance, at = 0, from = 0, to = 0, countAt = -1, addPress = -1, adding = [-1, -1], settled = -1 }: { balance?: string; at?: number; from?: number; to?: number; countAt?: number; addPress?: number; adding?: [number, number]; settled?: number }) {
  const frame = useCurrentFrame();
  const t = prog(frame, at, at + 12);
  const busy = frame >= adding[0] && frame < adding[1];
  return (
    <div style={{ position: "absolute", inset: 0, opacity: t, transform: `translateX(${(1 - t) * 60}px)` }}>
      <AppBar />
      <div style={{ position: "absolute", left: 28, right: 28, top: 150 }}>
        <div style={{ fontWeight: 800, fontSize: 22 }}>Hi {CAST.eddy.name}</div>
        <div style={{ marginTop: 18, background: C.paper, border: `2px solid #EAD6BD`, borderRadius: 24, padding: 22 }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: C.muted }}>Your balance</div>
          <div style={{ fontWeight: 800, fontSize: 20, marginTop: 8 }}>Dollars</div>
          {countAt >= 0 ? <Counter from={from} to={to} at={countAt} dur={22} size={56} /> : <span style={{ fontFamily: MONEY, fontWeight: 600, fontSize: 56 }}>{balance}</span>}
          <div style={{ fontWeight: 700, fontSize: 16, color: C.muted, marginTop: 6 }}>Held as AUSD, a digital dollar issued by Agora.</div>
          {settled >= 0 && frame >= settled && (
            <PopIn at={settled}>
              <div style={{ marginTop: 12, display: "inline-block", background: C.teal, color: C.white, fontWeight: 900, fontSize: 20, padding: "6px 14px", borderRadius: 99 }}>Settled in {M.claimSettle}</div>
            </PopIn>
          )}
        </div>
        <AppButton press={addPress} bg={busy ? C.muted : C.clay} style={{ marginTop: 22 }}>
          {busy ? "Adding test dollars..." : "Add test dollars"}
        </AppButton>
        <div style={{ display: "flex", gap: 14, marginTop: 14 }}>
          <AppButton bg={C.teal} style={{ flex: 1 }}>Send</AppButton>
          <AppButton bg={C.teal} style={{ flex: 1 }}>Receive</AppButton>
        </div>
      </div>
    </div>
  );
}

function Passkey() {
  return (
    <Scene bg={C.cream} enter="wipe">
      <Step n={1} title={"No password.\nJust *your fingerprint.*"} lines={["🔑 A passkey, made on your phone", "🙈 Nothing to write down or lose", "🛡️ The key never leaves the phone"]} />
      <FlatPhone x={PX} y={PY} width={PW} tilt={2}>
        <Sequence durationInFrames={200} layout="none">
          <Welcome typeAt={30} pressAt={80} />
          <PasskeySheet at={92} scanAt={130} />
        </Sequence>
        <Sequence from={200} layout="none">
          <Home balance="$0.00" />
        </Sequence>
      </FlatPhone>
      <Tap x={PX + 200 * PK} y={PY + 600 * PK} at={80} />
      <PopIn at={150} style={{ position: "absolute", left: PX - 200, top: 860 }}>
        <Pill bg={C.night} size={28}>🔐 Mera passkey</Pill>
      </PopIn>
      <PopIn at={226} style={{ position: "absolute", left: PX - 150, top: 200 }}>
        <Pill bg={C.teal} size={30}>✓ Account ready</Pill>
        <Sfx at={226} name="chime" vol={0.4} />
      </PopIn>
    </Scene>
  );
}

function Balance() {
  const frame = useCurrentFrame();
  const press = 40, landed = 40 + Math.round(CLAIM_S * 30) + 6;
  const raining = frame > landed - 20 && frame < landed + 30;
  return (
    <Scene bg={C.cream} enter="push">
      <Step n={2} title={"A real\n*dollar balance.*"} color={C.teal} lines={["💵 Held as AUSD, Agora's digital dollar", "🧪 Test dollars from Agora's faucet", `⚡ Settled in ${M.claimSettle}, timed on the phone`]} />
      <FlatPhone x={PX} y={PY} width={PW} tilt={-2}>
        <Home countAt={landed} from={0} to={10000} addPress={press} adding={[press + 4, landed]} settled={landed + 24} />
        {raining && Array.from({ length: 10 }, (_, i) => {
          const t = (frame - (landed - 20) - i * 2) / 30;
          return t > 0 && t < 1 ? <Coin key={i} x={40 + ((i * 71) % 300)} y={-40 + t * 420} size={44} spin={frame / 3 + i} /> : null;
        })}
      </FlatPhone>
      <Tap x={PX + 200 * PK} y={PY + 505 * PK} at={press} />
      <Sfx at={landed} name="coin" vol={0.6} />
      <Sfx at={landed + 6} name="coin" vol={0.4} />
      <Sfx at={landed + 24} name="stamp" vol={0.4} />
      <PopIn at={landed + 30} style={{ position: "absolute", left: PX - 260, top: 900 }}>
        <Pill bg={C.saffron} size={26}>Test dollars, not real money</Pill>
      </PopIn>
    </Scene>
  );
}

function SendScreen({ pressAt, scanAt, finalAt }: { pressAt: number; scanAt: number; finalAt: number }) {
  const frame = useCurrentFrame();
  const confirming = frame >= scanAt + 14 && frame < finalAt;
  const final = frame >= finalAt;
  return (
    <>
      <AppBar title="Send dollars" />
      <div style={{ position: "absolute", left: 24, right: 24, top: 140 }}>
        {!final ? (
          <>
            <div style={{ fontWeight: 800, fontSize: 19, color: C.muted }}>Sending to account ending</div>
            <div style={{ fontWeight: 900, fontSize: 34, letterSpacing: 2 }}>{M.recipientLastFour}</div>
            <div style={{ fontWeight: 800, fontSize: 19, color: C.muted, marginTop: 18 }}>How much</div>
            <div style={{ fontFamily: MONEY, fontWeight: 600, fontSize: 70 }}>{B.send}</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 19, marginTop: 10, background: C.paper, borderRadius: 14, padding: 12 }}>
              <span>Fee</span>
              <span style={{ color: C.teal }}>None. NivPay covers it.</span>
            </div>
            <AppButton press={pressAt} bg={confirming ? C.muted : C.clay} style={{ marginTop: 22 }}>{confirming ? "Confirming..." : `Send ${B.send}`}</AppButton>
          </>
        ) : (
          <PopIn at={finalAt}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginTop: 40 }}>
              <div style={{ width: 120, height: 120, borderRadius: 30, background: C.teal, color: C.white, fontSize: 70, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</div>
              <div style={{ fontWeight: 900, fontSize: 32, marginTop: 18 }}>Payment final</div>
              <div style={{ fontWeight: 800, fontSize: 22, color: C.muted, marginTop: 8 }}>Sent {B.send} to {CAST.maya.name}.</div>
              <div style={{ marginTop: 16, background: C.teal, color: C.white, fontWeight: 900, fontSize: 24, padding: "8px 18px", borderRadius: 99 }}>Settled in {M.sendSettle}</div>
            </div>
          </PopIn>
        )}
      </div>
      {frame >= scanAt - 4 && frame < scanAt + 16 && (
        <AbsoluteFill style={{ background: "rgba(27,15,10,0.5)", alignItems: "center", justifyContent: "center" }}>
          <Fingerprint size={170} scan={prog(frame, scanAt, scanAt + 14)} />
        </AbsoluteFill>
      )}
    </>
  );
}

function ReceiveScreen({ arriveAt }: { arriveAt: number }) {
  const frame = useCurrentFrame();
  const got = frame >= arriveAt;
  return (
    <>
      <AppBar title="Receive" />
      <div style={{ position: "absolute", left: 24, right: 24, top: 150 }}>
        <div style={{ fontWeight: 800, fontSize: 22 }}>Hi {CAST.maya.name}</div>
        <div style={{ marginTop: 18, background: C.paper, borderRadius: 24, padding: 22, border: "2px solid #EAD6BD" }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: C.muted }}>Your balance</div>
          <Counter from={0} to={25} at={arriveAt} dur={14} size={54} />
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, color: C.muted, marginTop: 24 }}>Payments in</div>
        {got ? (
          <PopIn at={arriveAt}>
            <div style={{ marginTop: 10, background: "#E3EFEC", borderRadius: 18, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 22 }}>From {CAST.eddy.name}</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: C.teal }}>Just arrived</div>
              </div>
              <div style={{ fontFamily: MONEY, fontWeight: 600, fontSize: 34, color: C.teal }}>+{B.received}</div>
            </div>
          </PopIn>
        ) : (
          <div style={{ marginTop: 10, fontWeight: 700, fontSize: 18, color: C.muted }}>Nothing yet</div>
        )}
      </div>
    </>
  );
}

function Send() {
  const frame = useCurrentFrame();
  const W = 1.2; // the 1600x900 world fills 1920x1080
  const london = { x: CITIES.london.x * W, y: CITIES.london.y * W };
  const houston = { x: CITIES.houston.x * W, y: CITIES.houston.y * W };
  const press = 110, scan = 122, sent = 136;
  const finalAt = sent + Math.round(SEND_S * 30);
  const clock = Math.min(SEND_S, Math.max(0, (frame - sent) / 30));
  const showClock = frame >= sent - 6;
  return (
    <Scene bg={C.sea} enter="circle">
      <World scale={W} />
      <Route a={london} b={houston} c={{ x: 820, y: 80 }} color={C.gold} at={sent} dur={finalAt - sent} width={12} />
      <Pin x={london.x} y={london.y} at={6} label={CAST.eddy.city} sub={`${CAST.eddy.name} sends`} color={PEOPLE[0]} emoji="💂🏾" labelSide="right" />
      <Pin x={houston.x} y={houston.y} at={12} label={CAST.maya.city} sub={`${CAST.maya.name} receives`} color={PEOPLE[1]} emoji="🤠" labelSide="below" check={finalAt} />
      <FlatPhone x={1500} y={270} width={370}>
        <SendScreen pressAt={press} scanAt={scan} finalAt={finalAt} />
      </FlatPhone>
      <FlatPhone x={50} y={270} width={370}>
        <ReceiveScreen arriveAt={finalAt} />
      </FlatPhone>
      <Tap x={1500 + 200 * 0.925} y={270 + 560 * 0.925} at={press} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 36, display: "flex", justifyContent: "center" }}>
        <div style={{ background: C.night, color: C.white, borderRadius: 30, padding: "14px 40px", display: "flex", alignItems: "center", gap: 30, boxShadow: "0 10px 0 rgba(0,0,0,0.2)" }}>
          <span style={{ fontWeight: 900, fontSize: 50 }}>{CAST.eddy.city} ✈︎ {CAST.maya.city}</span>
          {showClock && <span style={{ fontFamily: MONEY, fontSize: 56, color: frame >= finalAt ? C.gold : C.white, fontVariantNumeric: "tabular-nums" }}>{clock.toFixed(1)}s</span>}
        </div>
      </div>
      {frame >= finalAt && <Confetti count={45} from={finalAt} />}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 50, display: "flex", justifyContent: "center" }}>
        {frame >= finalAt + 12 && (
          <PopIn at={finalAt + 12}>
            <div style={{ background: C.paper, borderRadius: 30, padding: "18px 44px", boxShadow: "0 10px 0 rgba(0,0,0,0.2)" }}>
              <Words text={`Sent and received. *Settled in ${M.sendSettle}.*`} at={finalAt + 12} size={60} color={C.ink} accent={C.clay} />
            </div>
          </PopIn>
        )}
      </div>
      <Sfx at={scan} name="scan" vol={0.5} />
      <Sfx at={sent} name="whoosh" vol={0.4} />
      <Sfx at={finalAt} name="coin" vol={0.7} />
      <Sfx at={finalAt} name="chime" vol={0.5} />
      <Sfx at={finalAt + 12} name="stamp" vol={0.4} />
    </Scene>
  );
}

/** The receipt of a transaction, as read from Monad testnet (src/receipts.json), unrolling. */
export function ReceiptCard({ hash, at = 6, width = 700 }: { hash: string; at?: number; width?: number }) {
  const frame = useCurrentFrame();
  const r = RECEIPTS[hash];
  const unroll = prog(frame, at, at + 44, easeInOut);
  const stamp = pop(frame, useVideoConfig().fps, at + 64, 8);
  const rows: [string, string][] = [
    ["Status", r.status === "success" ? "✓ Success" : r.status],
    ["Block", `#${r.block.toLocaleString("en-US")}`],
    ["Finalized", r.finalized ? "✓ Yes" : "No"],
    ...r.transfers.map((t) => ["Transfer", `${t.amount} ${t.token} to ...${t.toLastFour}`] as [string, string]),
    ["Transaction", shortHex(hash)],
  ];
  return (
    <div style={{ width, height: 900 * unroll, overflow: "hidden" }}>
      <div style={{ background: C.paper, borderRadius: "18px 18px 0 0", padding: "40px 50px 60px", fontFamily: "Consolas, monospace", color: C.ink, position: "relative" }}>
        <div style={{ fontFamily: MONEY, fontSize: 46, textAlign: "center" }}>Receipt</div>
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: 22, color: C.muted, fontFamily: "Nunito" }}>Read from Monad testnet</div>
        <div style={{ borderTop: `4px dashed ${C.sand}`, margin: "26px 0" }} />
        {rows.map(([k, v], i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 28, padding: "12px 0", opacity: prog(frame, at + 14 + i * 6, at + 24 + i * 6) }}>
            <span style={{ color: C.muted }}>{k}</span>
            <span style={{ fontWeight: 700 }}>{v}</span>
          </div>
        ))}
        <div style={{ borderTop: `4px dashed ${C.sand}`, margin: "26px 0" }} />
        <div style={{ textAlign: "center", fontSize: 24, color: C.muted }}>eth_getTransactionReceipt</div>
        <div style={{ position: "absolute", right: 30, top: 30, transform: `rotate(12deg) scale(${2 - stamp})`, opacity: stamp, border: `8px solid ${C.teal}`, color: C.teal, borderRadius: 16, padding: "8px 22px", fontFamily: "Nunito", fontWeight: 900, fontSize: 44 }}>FINAL</div>
      </div>
      <svg width={width} height="30" viewBox={`0 0 ${width} 30`} style={{ display: "block" }}>
        <path d={`M0 0 ${Array.from({ length: Math.ceil(width / 20) }, (_, i) => `L${i * 20 + 10} 22 L${i * 20 + 20} 0`).join(" ")} Z`} fill={C.paper} />
      </svg>
      <Sfx at={at} name="rise" vol={0.3} />
      <Sfx at={at + 64} name="stamp" vol={0.7} />
    </div>
  );
}

function Receipt() {
  return (
    <Scene bg={C.night2} enter="up">
      <Rays color="rgba(242,179,61,0.06)" cx="70%" cy="50%" />
      <div style={{ position: "absolute", left: 120, top: 260, width: 760 }}>
        <Words text={"Don't take\nour word *for it.*"} at={2} size={100} />
        <Rise at={30}>
          <div style={{ color: "rgba(255,255,255,0.8)", fontWeight: 800, fontSize: 40, marginTop: 30 }}>The {B.send} send, read back from Monad testnet itself.</div>
        </Rise>
      </div>
      <div style={{ position: "absolute", left: 1060, top: 90 }}>
        <ReceiptCard hash={FACTS.hashes.take.send!} />
      </div>
    </Scene>
  );
}

function Currency() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const steps = ["One-time setup", `Allow exactly ${B.otherCurrencySend}`, "The exchange"];
  const first = 150;
  const swap = RECEIPTS[FACTS.hashes.showcase.swap];
  const gear = frame * 3;
  return (
    <Scene bg={C.plum} enter="wipe">
      <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 60%, rgba(255,255,255,0.14), transparent 60%)" }} />
      <div style={{ position: "absolute", left: 100, top: 70, width: 1720 }}>
        <PopIn at={0}><Pill bg={C.gold} color={C.night} size={30}>STEP 4</Pill></PopIn>
        <Words text={`She'd rather receive *${B.otherCurrency}?*`} at={6} size={92} style={{ marginTop: 20 }} />
        <Rise at={24}>
          <div style={{ color: "rgba(255,255,255,0.85)", fontWeight: 800, fontSize: 38, marginTop: 10 }}>Agora's Instant Settlement swaps it on the way. One fingerprint.</div>
        </Rise>
      </div>
      {/* the machine */}
      <div style={{ position: "absolute", left: 700, top: 400, width: 520, height: 330, borderRadius: 50, background: C.night, border: `8px solid ${C.gold}`, boxShadow: "0 18px 0 rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: C.white }}>
        <div style={{ display: "flex", gap: 20, fontSize: 70 }}>
          <span style={{ display: "inline-block", transform: `rotate(${gear}deg)` }}>⚙️</span>
          <span style={{ display: "inline-block", transform: `rotate(${-gear}deg)` }}>⚙️</span>
        </div>
        <div style={{ fontWeight: 900, fontSize: 40, marginTop: 8 }}>Agora</div>
        <div style={{ fontWeight: 800, fontSize: 26, color: C.gold }}>Instant Settlement</div>
        <div style={{ marginTop: 14, background: C.gold, color: C.night, fontWeight: 900, fontSize: 30, padding: "6px 22px", borderRadius: 99 }}>{M.otherCurrencyRate}</div>
      </div>
      {/* coins in and out, on a loop after the fingerprint */}
      {Array.from({ length: 4 }, (_, i) => {
        const s = first + i * 40;
        const tIn = prog(frame, s, s + 30, easeInOut);
        const tOut = prog(frame, s + 34, s + 64, easeInOut);
        return (
          <div key={i}>
            {tIn > 0 && tIn < 1 && <Coin x={260 + tIn * 460} y={565} size={80} spin={frame / 3} />}
            {tOut > 0 && tOut < 1 && <Coin x={1200 + tOut * 460} y={565} size={80} spin={frame / 3} label={B.otherCurrency} bg="#9BD0C9" />}
            <Sfx at={s + 30} name="tick" vol={0.4} />
            <Sfx at={s + 64} name="coin" vol={0.35} />
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 100, top: 470, textAlign: "center", color: C.white }}>
        <div style={{ display: "flex", justifyContent: "center" }}><Face name={CAST.eddy.name} color={PEOPLE[0]} size={120} /></div>
        <div style={{ fontWeight: 900, fontSize: 32 }}>{CAST.eddy.name} sends</div>
        <div style={{ fontFamily: MONEY, fontSize: 44, color: C.gold }}>{B.otherCurrencySend}</div>
      </div>
      <div style={{ position: "absolute", left: 1640, top: 470, textAlign: "center", color: C.white }}>
        <div style={{ display: "flex", justifyContent: "center" }}><Face name={CAST.maya.name} color={PEOPLE[1]} size={120} /></div>
        <div style={{ fontWeight: 900, fontSize: 32 }}>{CAST.maya.name} gets</div>
        <div style={{ fontFamily: MONEY, fontSize: 44, color: "#9BD0C9" }}>{B.otherCurrency}</div>
      </div>
      <div style={{ position: "absolute", left: 400, top: 330 }}>
        <PopIn at={110}>
          <Fingerprint size={120} color={C.gold} scan={prog(frame, 116, 132)} />
        </PopIn>
        <Sfx at={116} name="scan" vol={0.5} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 800, display: "flex", justifyContent: "center", gap: 26 }}>
        {steps.map((s, i) => {
          const on = first + i * 50;
          const ok = pop(frame, fps, on + 30, 9);
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 14, background: frame >= on + 30 ? C.teal : "rgba(0,0,0,0.3)", color: C.white, padding: "16px 30px", borderRadius: 99, fontWeight: 900, fontSize: 32, opacity: prog(frame, on, on + 10) }}>
              <span style={{ display: "inline-block", width: 44, height: 44, borderRadius: 12, background: C.white, color: C.teal, textAlign: "center", lineHeight: "44px", transform: `scale(${ok})` }}>✓</span>
              {s}
              <Sfx at={on + 30} name="pop" vol={0.35} />
            </div>
          );
        })}
      </div>
      <Rise at={330} style={{ position: "absolute", left: 0, right: 0, top: 920, textAlign: "center" }}>
        <div style={{ color: C.white, fontWeight: 800, fontSize: 32 }}>
          Each step final before the next. Proved on Monad testnet: {swap.transfers[0].amount} {swap.transfers[0].token} in, {swap.transfers[1].amount} {swap.transfers[1].token} out, block #{swap.block.toLocaleString("en-US")}.
        </div>
      </Rise>
    </Scene>
  );
}

export function Business() {
  const frame = useCurrentFrame();
  const cards = [
    { bg: C.teal, emoji: "🎁", title: "Sending", sub: "Free. NivPay covers the fee.", bar: 0, barLabel: "Fee", barValue: "None" },
    { bg: C.clay, emoji: "🏺", title: "Group pots", sub: `${FACTS.pot.feeRate} of each payout, never over ${FACTS.pot.feeCap}`, bar: 0.05, barLabel: "Fee", barValue: FACTS.pot.feeRate },
    { bg: C.saffron, emoji: "👀", title: "No surprises", sub: "Every fee shown before you say yes", bar: 1, barLabel: "Shown up front", barValue: "Always" },
    { bg: C.olive, emoji: "🌍", title: "Who it's for", sub: "Families abroad, paying for home together", bar: 0.8, barLabel: "Sending home", barValue: "Every month" },
  ];
  const i = Math.min(3, Math.floor(frame / 60));
  return (
    <Scene bg={cards[i].bg} enter="push">
      <Sequence key={i} from={i * 60} layout="none">
        <ColorCard {...cards[i]} />
      </Sequence>
      {cards.map((_, k) => <Sfx key={k} at={k * 60} name="whoosh" vol={0.3} />)}
      <div style={{ position: "absolute", left: 60, top: 50 }}>
        <Pill bg="rgba(0,0,0,0.25)" size={28}>💼 The business</Pill>
      </div>
    </Scene>
  );
}

function Stack() {
  const tiles = [
    { e: "🔐", t: "Mera passkeys", s: "The key is made on the phone", c: C.clay },
    { e: "💵", t: "Agora's AUSD", s: "A digital dollar, with permit", c: C.teal },
    { e: "⚡", t: "Monad", s: `Final ${FACTS.chain.finalizedBehind} behind the newest block`, c: C.plum },
    { e: "🔁", t: "Instant Settlement", s: "Paid in another currency", c: C.olive },
  ];
  return (
    <Scene bg={C.saffron} enter="circle">
      <Rays />
      <div style={{ position: "absolute", left: 0, right: 0, top: 80, textAlign: "center" }}>
        <Words text="Under *the hood*" at={2} size={100} align="center" accent={C.night} />
        <Rise at={14}><div style={{ fontWeight: 800, fontSize: 36, color: C.night, marginTop: 6 }}>People see dollars and names. Never keys, fees or addresses.</div></Rise>
      </div>
      <div style={{ position: "absolute", left: 110, right: 110, top: 400, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 30 }}>
        {tiles.map((t, i) => (
          <PopIn key={t.t} at={20 + i * 12}>
            <div style={{ background: C.paper, borderRadius: 34, padding: "40px 28px", height: 380, boxShadow: "0 14px 0 rgba(0,0,0,0.18)", borderTop: `16px solid ${t.c}`, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              <div style={{ fontSize: 110 }}>{t.e}</div>
              <div style={{ fontWeight: 900, fontSize: 44, color: C.ink, marginTop: 10 }}>{t.t}</div>
              <div style={{ fontWeight: 800, fontSize: 28, color: C.muted, marginTop: 10 }}>{t.s}</div>
            </div>
            <Sfx at={20 + i * 12} name="pop" vol={0.3} />
          </PopIn>
        ))}
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
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 110 }}>
        <div style={{ transform: `translateY(${Math.sin(frame / 10) * 6}px)` }}>
          <Pot size={220} layers={[{ color: PEOPLE[0], h: 0.5 }, { color: PEOPLE[1], h: 0.4 }, { color: PEOPLE[2], h: 0.1 }]} lid={1} lock={0} glow={1} id="end" />
        </div>
        <Words text="Niv*Pay*" at={6} size={160} align="center" stagger={0} />
        <div style={{ width: 170 * bar, height: 12, borderRadius: 9, background: C.teal, marginTop: 4 }} />
        <Words text="Send dollars abroad like a text." at={16} size={54} weight={800} align="center" style={{ marginTop: 22 }} />
        <PopIn at={30} style={{ marginTop: 40 }}>
          <Pill bg={C.teal} size={46}>{FACTS.app.host}</Pill>
        </PopIn>
        <Words text="In test mode on Monad testnet, with Agora's AUSD." at={40} size={30} weight={700} color="rgba(255,255,255,0.7)" align="center" style={{ marginTop: 26 }} />
      </AbsoluteFill>
      <Sfx at={6} name="ding" vol={0.4} />
    </Scene>
  );
}

export function AgoraFilm() {
  return <Film id="agora" scenes={{ hook: Hook, title: Title, passkey: Passkey, balance: Balance, send: Send, receipt: Receipt, currency: Currency, business: Business, stack: Stack, end: End }} />;
}

