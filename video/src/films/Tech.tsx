/**
 * The technical demo, 1920x1080, about 2.5 min, from real recordings of the
 * live app on Monad testnet: a passkey account and test dollars, a pot made
 * and locked, money poured in, a payment asked for, the second yes paying
 * it on two phones at once, a send landing on another phone, the receipt on
 * MonadVision, and Agora's quote for paying in another currency.
 *
 * The pot scenes are the 11 Oct test run ("Birthday", Eddy and Leader); the
 * amounts below are read off that footage.
 */
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { FACTS } from "../facts.ts";
import { BrandTitle, EndCard, SendReceive } from "./Bounty.tsx";
import { Proof } from "./Demo.tsx";
import { Film } from "./Film.tsx";
import { C, Mark, NightSky, PopIn, Rays, Rise, Scene, Sfx, TypeOn, Words, prog } from "./kit.tsx";
import { ClipPhone, FootageScene, phoneWidth } from "./Real.tsx";

/** Read off the 11 Oct footage. */
const RUN = { pot: "Birthday", pour: "$200", ask: "$50", fee: "$0.25", left: "$249.75", payee: "Event Center" };

function Hook() {
  const frame = useCurrentFrame();
  const bar = prog(frame, 70, 86);
  return (
    <Scene bg={C.night} enter="cut">
      <NightSky />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 130 }}>
        <div style={{ transform: `translateY(${Math.sin(frame / 10) * 6}px)` }}>
          <Mark size={190} id="hook" outline={C.cream} />
        </div>
        <div style={{ marginTop: 50, textAlign: "center" }}>
          <TypeOn text="Every family has a pot." at={6} size={88} caret={false} cps={30} />
          <TypeOn text="Somebody always holds it." at={36} size={88} accentFrom={16} cps={30} />
        </div>
        <div style={{ marginTop: 22, width: 300 * bar, height: 12, borderRadius: 9, background: C.teal }} />
      </AbsoluteFill>
    </Scene>
  );
}

function Title() {
  return <BrandTitle bg={C.clay} line="A pot nobody can pocket." chips={["Built on Monad", "Everything next is the real app, recorded on a phone"]} />;
}

function Onboard() {
  return (
    <FootageScene
      step="1 · AN ACCOUNT"
      title={"A passkey account,\nand *test dollars.*"}
      lines={["The passkey's secret becomes the account key, in memory, only while signing", `Agora's faucet, claimed by the account itself: ${FACTS.bounty.testDollars} AUSD`, `Success is shown only at Finalized: settled in ${FACTS.measured.claimSettle}`]}
      segs={["passkeyFast", "claimShort"]}
    />
  );
}

function Make() {
  return (
    <FootageScene
      step="2 · MAKE A POT"
      color={C.teal}
      title={"Rules that *nobody\ncan change.*"}
      lines={["Who decides, and how many must agree", "The only places it can pay, and the most each may get", "When it closes. Then the lid locks at Finalized"]}
      segs={["potDraft", "potCheck", "potMade"]}
      enter="push"
    />
  );
}

function Pour() {
  return (
    <FootageScene
      step="3 · POUR IN"
      color={C.saffron}
      title={`Pour in *${RUN.pour}.*`}
      lines={["One fingerprint: Agora's permit and the deposit in one request", "The coin flies at once, and lands only when Monad finalizes it", "Each person's layer, in their own colour"]}
      segs={["pour"]}
      enter="circle"
    />
  );
}

function Ask() {
  return (
    <FootageScene
      step="4 · ASK TO PAY"
      color={C.plum}
      title={`Ask to pay the\n*${RUN.payee} ${RUN.ask}.*`}
      lines={["Only to a payee named when the pot was made", `NivPay's fee, ${RUN.fee}, is shown before anyone says yes`, "Asking counts as your own yes: 1 of 2"]}
      segs={["askLeader", "askWaiting"]}
      enter="wipe"
    />
  );
}

function Yes() {
  const frame = useCurrentFrame();
  const H = 880;
  const at = 6;
  const paid = at + 13 * 30;
  const wE = phoneWidth("yesEddy", H);
  return (
    <Scene bg={C.teal} enter="push">
      <Rays />
      <div style={{ position: "absolute", left: 100, top: 130, width: 760 }}>
        <PopIn at={0}><span style={{ background: C.gold, color: C.night, fontWeight: 900, fontSize: 30, padding: "8px 20px", borderRadius: 999 }}>5 · THE SECOND YES</span></PopIn>
        <Words text={"The second yes\n*pays it.*"} at={4} size={96} style={{ marginTop: 28 }} />
        <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 20 }}>
          {["Eddy says yes with a fingerprint", "2 of 2: it pays in that same request", `Leader's phone sees it paid. The pot holds ${RUN.left}`].map((l, i) => (
            <Rise key={l} at={40 + i * 24}>
              <div style={{ color: C.white, fontWeight: 800, fontSize: 40, lineHeight: 1.25 }}>● {l}</div>
            </Rise>
          ))}
        </div>
        <Rise at={30} style={{ marginTop: 40 }}>
          <span style={{ color: "rgba(255,255,255,0.75)", fontWeight: 800, fontSize: 24 }}>● Two phones, recorded at the same time, the 11 Oct test run</span>
        </Rise>
      </div>
      <ClipPhone segs={["yesEddy"]} x={900} y={60} height={H} at={at} label="Eddy's phone" />
      <ClipPhone segs={["yesLeader"]} x={900 + wE + 50} y={60} height={H} at={at} label="Leader's phone" />
      <Sfx at={paid} name="chime" vol={0.5} />
      {frame >= paid && <Sfx at={paid} name="coin" vol={0.5} />}
    </Scene>
  );
}

function Send() {
  return <SendReceive enter="wipe" />;
}

function Explorer() {
  return (
    <FootageScene
      step="7 · THE RECEIPT"
      color={C.plum}
      title={"Every receipt opens\non *MonadVision.*"}
      lines={["View receipt, straight from the app", "Success, a single AUSD transfer, in a finalized block", "Monad testnet, chain 10143"]}
      segs={["explorer013"]}
      bg={C.night2}
      dark
      enter="up"
    />
  );
}

function Currency() {
  const M = FACTS.measured;
  return (
    <FootageScene
      step="8 · ANOTHER CURRENCY"
      color={C.saffron}
      title={"Paid in another currency,\n*through Agora.*"}
      lines={[`Agora's Instant Settlement: ${M.otherCurrencyRate}, its fee shown before signing`, "Setup, allowance and exchange: one fingerprint, each final before the next", `They received ${M.otherCurrencyReceived}. Settled in ${M.otherCurrencySettle}`]}
      segs={["ctkReview", "ctkSheet", "ctkSteps"]}
      enter="circle"
    />
  );
}

function End() {
  return <EndCard line="A pot nobody can pocket." pills={[FACTS.app.host, "github.com/UEddy/Nivpay"]} small="Live on Monad testnet, with Agora's AUSD. Open source, MIT." />;
}

export function TechFilm() {
  return <Film id="tech" scenes={{ hook: Hook, title: Title, onboard: Onboard, make: Make, pour: Pour, ask: Ask, yes: Yes, send: Send, explorer: Explorer, currency: Currency, proof: Proof, end: End }} />;
}

