/**
 * Every stretch of real screen recording the films use: which recording,
 * from and to (seconds in the recording), the speed, and how long the last
 * frame is held after it. scripts/cut-clips.ts cuts each one to
 * films-public/clips/<id>.mp4 at a constant 30 fps; the films play them
 * inside a drawn phone. Speed above 1 always shows a "Sped up" tag.
 *
 * Recordings, all of the live app at nivpay.vercel.app in test mode:
 *   1000336948  Eddy's phone: passkey sign-up, test dollars, the $25 send, its receipt
 *   1000336942  Maya's phone: her balance as the $25 arrives
 *   rehearsal/1000335865  Eddy's phone, 11 Oct: a pot made, $200 poured in, the yes that pays
 *   rehearsal/1000335920  Leader's phone, 11 Oct: $100 poured in, asking to pay the Event Center, seeing it paid
 *   rehearsal/1000336013  Eddy's phone, 11 Oct: a $500 send and its receipt
 *   1000337374  Eddy's phone, 13 Oct: $50 sent as CTK through Agora to the account ending 562C, its receipt
 */

/**
 * A magnified moment: from `at` seconds into the segment as played, the box
 * (fractions of the recording's frame) pops out of the phone, larger.
 * side: where it sits against the phone.
 */
export type Focus = { at: number; until?: number; x: number; y: number; w: number; h: number; side?: "left" | "right" | "over"; dy?: number };
export type Seg = { src: string; from: number; to: number; speed?: number; hold?: number; aspect: number; focus?: Focus[] };

const A48 = 1080 / 1920;
const A42 = 1080 / 2280;
const A23 = 1080 / 2340;
const A20 = 606 / 1280;

export const SEGS = {
  // Eddy's phone, the bounty take
  passkey: { src: "1000336948.mp4", from: 0, to: 16.5, aspect: A48 },
  passkeyFast: { src: "1000336948.mp4", from: 0, to: 16.5, speed: 2, aspect: A48 },
  claim: { src: "1000336948.mp4", from: 20.5, to: 32.3, hold: 2.5, aspect: A48, focus: [
    { at: 11, x: 0.12, y: 0.22, w: 0.8, h: 0.08 },
    { at: 11.8, x: 0.1, y: 0.815, w: 0.82, h: 0.05, dy: 0.06 },
  ] },
  claimShort: { src: "1000336948.mp4", from: 27, to: 32.3, hold: 2, aspect: A48, focus: [
    { at: 4.6, x: 0.1, y: 0.815, w: 0.82, h: 0.05 },
  ] },
  sendTyping: { src: "1000336948.mp4", from: 34, to: 54, speed: 2.5, aspect: A48 },
  sendFinal: { src: "1000336948.mp4", from: 54, to: 62, hold: 1, aspect: A48, focus: [
    { at: 4.7, x: 0.12, y: 0.1, w: 0.76, h: 0.19, side: "left" },
  ] },
  explorer48: { src: "1000336948.mp4", from: 67.4, to: 71.3, hold: 4, aspect: A48 },
  // Maya's phone: 51 s behind Eddy's (her $25.00 at 7.5 s is his "Sent" at 58.5 s)
  mayaReceive: { src: "1000336942.mp4", from: 3, to: 11, hold: 1, aspect: A42, focus: [
    { at: 4.7, x: 0.04, y: 0.19, w: 0.92, h: 0.12, side: "right", dy: 0.34 },
  ] },
  // The 11 Oct pot, Eddy's phone
  potDraft: { src: "rehearsal/1000335865.mp4", from: 3, to: 27, speed: 3, aspect: A23 },
  potCheck: { src: "rehearsal/1000335865.mp4", from: 27.5, to: 34, aspect: A23 },
  potMade: { src: "rehearsal/1000335865.mp4", from: 34, to: 53, speed: 2, aspect: A23 },
  pour: { src: "rehearsal/1000335865.mp4", from: 57, to: 77, speed: 1.25, hold: 0.5, aspect: A23 },
  yesEddy: { src: "rehearsal/1000335865.mp4", from: 280, to: 296, hold: 1, aspect: A23, focus: [
    { at: 13.6, x: 0.04, y: 0.1, w: 0.92, h: 0.26, side: "over", dy: -0.02 },
    { at: 14.4, x: 0.05, y: 0.78, w: 0.92, h: 0.05, side: "over" },
  ] },
  // Leader's phone: 117 s behind Eddy's (paid at 176 s is his paid at 293 s)
  askLeader: { src: "rehearsal/1000335920.mp4", from: 111, to: 129, speed: 1.5, aspect: A20 },
  askWaiting: { src: "rehearsal/1000335920.mp4", from: 138, to: 146, hold: 0.5, aspect: A20 },
  yesLeader: { src: "rehearsal/1000335920.mp4", from: 163, to: 179, hold: 1, aspect: A20 },
  // The $500 send's receipt
  explorer013: { src: "rehearsal/1000336013.mp4", from: 48, to: 57, aspect: A23 },
  // $50 sent as CTK through Agora's pair, 13 Oct: the quote, the three steps, the result, the receipt
  ctkReview: { src: "1000337374.mp4", from: 11.5, to: 17.5, speed: 2, aspect: A23 },
  ctkSheet: { src: "1000337374.mp4", from: 17.6, to: 20.2, hold: 1.5, aspect: A23, focus: [
    { at: 0.4, x: 0.03, y: 0.44, w: 0.6, h: 0.2 },
  ] },
  ctkSteps: { src: "1000337374.mp4", from: 20.2, to: 31.5, hold: 1.5, aspect: A23, focus: [
    { at: 4.9, until: 8.7, x: 0.2, y: 0.545, w: 0.6, h: 0.035 },
    { at: 9.0, x: 0.08, y: 0.13, w: 0.84, h: 0.18 },
  ] },
  ctkExplorer: { src: "1000337374.mp4", from: 37.5, to: 41.1, hold: 3.5, aspect: A23, focus: [
    { at: 1.7, x: 0.03, y: 0.52, w: 0.94, h: 0.2 },
  ] },
} satisfies Record<string, Seg>;

export type SegId = keyof typeof SEGS;

/** How long a segment plays in the film, in frames at 30 fps, hold included. */
export function segFrames(id: SegId): number {
  const s: Seg = SEGS[id];
  return Math.round(((s.to - s.from) / (s.speed ?? 1) + (s.hold ?? 0)) * 30);
}

export const segSeconds = (...ids: SegId[]) => ids.reduce((n, id) => n + segFrames(id), 0) / 30;
