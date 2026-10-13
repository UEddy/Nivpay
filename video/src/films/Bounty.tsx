/**
 * The Agora bounty film, 1920x1080, about 88 s, from real recordings of the
 * live app. The three things judged, each well before 90 s: passkey
 * onboarding (from 8 s), an AUSD balance (from 25 s), a send and its
 * receipt settled at once on two phones (from 40 s). Then the chain's own
 * receipt, Agora's quote for paying in another currency, the business.
 */
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { FACTS } from "../facts.ts";
import { Business, Hook, ReceiptCard } from "./Agora.tsx";
import receiptsFile from "../receipts.json" with { type: "json" };
import { segFrames } from "./clips.ts";
import { Film } from "./Film.tsx";
import { C, CITIES, Confetti, Mark, NightSky, Pill, Pin, pop, PopIn, prog, Rays, Rise, Route, Scene, Sfx, Skyline, Words, World, PEOPLE, type Enter } from "./kit.tsx";
import { ClipPhone, FootageScene, phoneWidth, Stopwatch } from "./Real.tsx";

const B = FACTS.bounty;
const M = FACTS.measured;
const CAST = FACTS.cast;
const SEND_S = parseFloat(M.sendSettle ?? "0");

export function BrandTitle({ bg, line, chips }: { bg: string; line: string; chips: string[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = pop(frame, fps, 2, 9);
  return (
    <Scene bg={bg} enter="circle">
      <Rays />
      <Skyline />
      <Confetti count={30} from={6} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: `translateY(${(1 - drop) * -500}px)` }}>
          <Mark size={240} id="title" />
        </div>
        <Words text="Niv*Pay*" at={8} size={180} align="center" stagger={0} />
        <Words text={line} at={18} size={54} weight={800} align="center" style={{ marginTop: 6 }} />
        <PopIn at={32} style={{ marginTop: 30 }}>
          <div style={{ display: "flex", gap: 18 }}>
            {chips.map((c) => <Pill key={c} bg={C.night} size={28}>{c}</Pill>)}
          </div>
        </PopIn>
      </AbsoluteFill>
      <Sfx at={6} name="thunk" vol={0.6} />
      <Sfx at={0} name="whoosh" vol={0.4} />
    </Scene>
  );
}

function Title() {
  return <BrandTitle bg={C.teal} line="Send dollars abroad like a text." chips={["Agora's AUSD", "on Monad", "the real app, recorded on a phone"]} />;
}

function Passkey() {
  return (
    <FootageScene
      step="STEP 1 · PASSKEY"
      title={"No password.\nJust *your fingerprint.*"}
      lines={["A passkey for nivpay.vercel.app, saved by the phone", "The key is made on the phone, only while signing (Mera)", "Nothing to write down, nothing to lose"]}
      segs={["passkey"]}
    />
  );
}

function Balance() {
  return (
    <FootageScene
      step="STEP 2 · AUSD BALANCE"
      color={C.teal}
      title={"A real\n*dollar balance.*"}
      lines={["Held as AUSD, Agora's digital dollar", `${B.testDollars} test dollars from Agora's faucet, not real money`, `Settled in ${M.claimSettle}, timed on the phone`]}
      segs={["claim"]}
      enter="push"
    />
  );
}

/** Two phones over the map: Eddy's send in London, Maya's balance in Houston, recorded at once. */
export function SendReceive({ enter = "circle" }: { enter?: Enter }) {
  const frame = useCurrentFrame();
  const W = 1.2;
  const london = { x: CITIES.london.x * W, y: CITIES.london.y * W };
  const houston = { x: CITIES.houston.x * W, y: CITIES.houston.y * W };
  // In sendFinal, "Sending" shows at 2 s and "Sent" at 4.5 s; Maya's $25.00 shows at the same moment.
  const t0 = 6;
  const finalAt = t0 + 135;
  const sendAt = finalAt - Math.round(SEND_S * 30);
  const H = 800;
  return (
    <Scene bg={C.sea} enter={enter}>
      <World scale={W} />
      <Route a={london} b={houston} c={{ x: 820, y: 60 }} color={C.gold} at={sendAt} dur={finalAt - sendAt} width={12} />
      <Pin x={london.x} y={london.y} at={4} label={CAST.eddy.city} sub={`${CAST.eddy.name} sends`} color={PEOPLE[0]} labelSide="left" />
      <Pin x={houston.x} y={houston.y} at={8} label={CAST.maya.city} sub={`${CAST.maya.name} receives`} color={PEOPLE[1]} labelSide="right" check={finalAt} />
      <ClipPhone segs={["sendFinal"]} x={1920 - phoneWidth("sendFinal", H) - 60} y={150} height={H} at={t0} label={`${CAST.eddy.name}'s phone`} />
      <ClipPhone segs={["mayaReceive"]} x={60} y={150} height={H} at={t0} label={`${CAST.maya.name}'s phone`} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 30, display: "flex", justifyContent: "center" }}>
        <div style={{ background: C.night, color: C.white, borderRadius: 30, padding: "12px 36px", display: "flex", alignItems: "center", gap: 26, boxShadow: "0 10px 0 rgba(0,0,0,0.2)" }}>
          <span style={{ fontWeight: 900, fontSize: 44 }}>{CAST.eddy.city} ✈︎ {CAST.maya.city}</span>
          {frame >= sendAt - 4 && <Stopwatch from={sendAt} secs={SEND_S} size={50} />}
        </div>
      </div>
      {frame >= finalAt && <Confetti count={30} from={finalAt} />}
      {frame >= finalAt + 10 && (
        <PopIn at={finalAt + 10} style={{ position: "absolute", left: 560, right: 560, top: 860, display: "flex", justifyContent: "center" }}>
          <div style={{ background: C.paper, borderRadius: 26, padding: "16px 34px", boxShadow: "0 10px 0 rgba(0,0,0,0.2)", textAlign: "center" }}>
            <Words text={`Sent and received. *Settled in ${M.sendSettle}.*`} at={finalAt + 10} size={44} color={C.ink} accent={C.clay} />
          </div>
        </PopIn>
      )}
      <Sfx at={sendAt} name="whoosh" vol={0.4} />
      <Sfx at={finalAt} name="coin" vol={0.7} />
      <Sfx at={finalAt} name="chime" vol={0.5} />
    </Scene>
  );
}

function Send() {
  const typing = segFrames("sendTyping") + 6;
  return (
    <>
      <Sequence durationInFrames={typing + 9} layout="none">
        <FootageScene
          step="STEP 3 · SEND AND RECEIVE"
          color={C.plum}
          title={`Send *${B.send}* from London\nto Houston.`}
          lines={[`Paste the account, type its last four to be sure: ${M.recipientLastFour}`, "Fee: none. NivPay covers it", "One fingerprint sends it"]}
          segs={["sendTyping"]}
          enter="wipe"
        />
      </Sequence>
      <Sequence from={typing} layout="none">
        <SendReceive />
      </Sequence>
    </>
  );
}

/** A receipt twice over: on the phone, on MonadVision; and read straight from Monad. */
function ChainReceipt({ seg, hash, title, label }: { seg: "explorer48" | "ctkExplorer"; hash: string; title: string; label: string }) {
  const H = 900;
  const pw = phoneWidth(seg, H);
  return (
    <Scene bg={C.night2} enter="up">
      <Rays color="rgba(242,179,61,0.06)" cx="30%" cy="50%" />
      <ClipPhone segs={[seg]} x={110} y={90} height={H} at={4} tilt={-1.5} label={label} />
      <div style={{ position: "absolute", left: 110 + pw + 90, top: 70, width: 1000 }}>
        <Words text={title} at={2} size={66} />
      </div>
      <div style={{ position: "absolute", left: 110 + pw + 160, top: 190 }}>
        <ReceiptCard hash={hash} at={10} width={680} />
      </div>
    </Scene>
  );
}

function Receipt() {
  return <ChainReceipt seg="explorer48" hash={FACTS.hashes.take.send!} title="The receipt, *read from Monad.*" label="View receipt, on the phone" />;
}

function Currency() {
  return (
    <FootageScene
      step="STEP 4 · ANOTHER CURRENCY"
      color={C.saffron}
      title={"Paid in another currency,\n*through Agora.*"}
      lines={[`Maya receives CTK: ${M.otherCurrencyRate}, fixed by Agora, fee 0.00`, "One fingerprint. Three steps, each final before the next", `They received ${M.otherCurrencyReceived}. Settled in ${M.otherCurrencySettle}`]}
      segs={["ctkReview", "ctkSheet", "ctkSteps"]}
      enter="circle"
    />
  );
}

function SwapReceipt() {
  return <ChainReceipt seg="ctkExplorer" hash={FACTS.hashes.take.swap!} title="Agora's swap, *on Monad.*" label="View receipt: SwapExactTokensForTokens" />;
}

export function EndCard({ line, pills, small }: { line: string; pills: string[]; small: string }) {
  const frame = useCurrentFrame();
  const bar = prog(frame, 22, 36);
  return (
    <Scene bg={C.night} enter="iris">
      <NightSky glowAt="50% 30%" />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 100 }}>
        <div style={{ transform: `translateY(${Math.sin(frame / 10) * 6}px)` }}>
          <Mark size={230} id="end" outline={C.cream} />
        </div>
        <Words text="Niv*Pay*" at={6} size={160} align="center" stagger={0} />
        <div style={{ width: 170 * bar, height: 12, borderRadius: 9, background: C.teal, marginTop: 4 }} />
        <Words text={line} at={16} size={54} weight={800} align="center" style={{ marginTop: 22 }} />
        <PopIn at={30} style={{ marginTop: 40, display: "flex", gap: 20 }}>
          {pills.map((p, i) => <Pill key={p} bg={i ? C.night2 : C.teal} size={44}>{p}</Pill>)}
        </PopIn>
        <Words text={small} at={40} size={30} weight={700} color="rgba(255,255,255,0.7)" align="center" style={{ marginTop: 26 }} />
      </AbsoluteFill>
      <Sfx at={6} name="ding" vol={0.4} />
    </Scene>
  );
}

function End() {
  return <EndCard line="Send dollars abroad like a text." pills={[FACTS.app.host]} small="Live on Monad testnet, with Agora's AUSD. Test mode." />;
}

export function BountyFilm() {
  return <Film id="bounty" scenes={{ hook: Hook, title: Title, passkey: Passkey, balance: Balance, send: Send, receipt: Receipt, currency: Currency, swapReceipt: SwapReceipt, business: Business, end: End }} />;
}
