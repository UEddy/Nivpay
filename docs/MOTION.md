# NivPay motion rules

The map and the pot are how people see where their money is. Every animation stands for something that really happened on chain, and nothing moves that hasn't. Reference screens: the "Chosen direction" page of the NivPay UI Concepts canvas.

## 1. The moments

| Moment | Real trigger | What moves | Time |
|---|---|---|---|
| Pot created | create tx finalized and the pot's number read from its PotCreated event | lid drops, lock pops onto the pot, invites fly out to each city. Until then the lid sits open beside the pot, there is no lock, and the screen says "Draft, not made yet" (`app/src/lib/createStage.ts`) | about 1.8s |
| Someone chips in | their deposit event | coin flies from their city to the pot, a layer in their colour rises, the counter ticks up | 0.9s flight, then 0.75s fill |
| Payment asked | proposal event, finalized | the vendor's route marches (dotted) and the vendor ring pulses until it is decided. Meanwhile the live badge stops its ping, so there are still two loops at most | loop |
| Payment approved and paid | payout event, finalized; for your own yes, its finalized receipt | pot tilts, a stream runs down the vendor route, every layer drops by the same share, vendor fills with a check (`PAID_MOTION` in `app/src/lib/payout.ts`) | about 2.2s |
| Pot closed | close event, finalized, or the pot found closed at its date | dotted streams run from the pot to each city, each person's amount appears, 150ms apart (`app/src/screens/Close.tsx`) | about 1.2s |
| Share taken | your own: from the fingerprint, landing on the finalized receipt of the exit or claim | coin flies from the pot to that city and waits there pulsing until final, then the city gets a check; it flies back if it fails | 0.9s |
| Story replay | tap Replay | the whole history in about 7s, list rows light up in step | about 7s |

## 2. Live, but honest

What the Monad docs say (checked 27 Sep 2026):

- Over WebSocket, `logs` and `newHeads` fire when a block is Proposed, before it is final.
- `monadLogs` and `monadNewHeads` add a `commitState` field (Proposed, Voted, Finalized, Verified) and send an update each time the block moves on.
- Proposed and Voted blocks can in theory be dropped. Finalized blocks cannot be reverted without a hard fork. The JSON-RPC `finalized` tag means Finalized.

Rules:

1. Start a flight at Proposed. Land it (layer rises, counter settles, check appears) only at Finalized.
2. If a Proposed block never finalizes, fly the coin back and say "That didn't go through. Nothing moved."
3. Never show "paid", "in the pot" or "in your balance" before Finalized.
4. Your own actions: the flight starts when you confirm with your fingerprint and lands on the finalized receipt.
5. Monad's own figures are blocks every ~300ms and finality in about 600ms. The flight (0.9s) is a little longer than that, so on a good connection the block is final before the coin lands. If finality is slower, hold the coin at the rim of the pot with a gentle pulse until it comes.
6. One event feed, two sources. Mainnet has public WebSocket endpoints (for example `wss://rpc.monad.xyz`). I could not find a public testnet WebSocket URL, and Alchemy's testnet WebSocket needs a free API key. So: WebSocket when available, otherwise poll `eth_getLogs` up to the `finalized` block every second. The animations never know which source fed them.
7. Any key shipped inside a web app is public. Use one with no billing attached and rotate it after the hackathon.

## 3. Timing and easing

| Token | Duration | Easing | Used for |
|---|---|---|---|
| press | none | | button darkens on press, at once: a background colour is a paint property, so it does not transition |
| swap | 240ms | cubic-bezier(0.2, 0.8, 0.2, 1) | sheets and text arriving (by opacity and transform); colours change at once |
| enter | 500ms, 60 to 100ms stagger | cubic-bezier(0.2, 0.8, 0.2, 1) | screen content arriving |
| flight | 900ms | cubic-bezier(0.65, 0, 0.35, 1) | coins and streams along routes |
| fill | 750ms | cubic-bezier(0.34, 1.35, 0.64, 1) | a new layer rising (the small overshoot is the slosh) |
| drain | 1,100ms | cubic-bezier(0.65, 0, 0.35, 1) | the pot level dropping after a payment |
| pop | 420ms | cubic-bezier(0.34, 1.56, 0.64, 1) | checks, the lock badge |
| ambient | 1.2s to 2.4s loop | linear or ease-out | live dot, pending routes; no more than two loops on screen |

## 4. Smooth on cheap Android phones

- Animate only `transform`, `opacity` and SVG `stroke-dashoffset`. Never width, height, top, left or a path's `d`, and never a colour (`background`, `fill`, `stroke`, `color`, `border-color`): a colour that has to fade is its own layer whose opacity moves, as the payee's fill at Paid and the tint behind a payment that just arrived. Every transition names its properties; a bare duration would transition all of them. `app/src/motion.test.ts` checks every stylesheet and the screens' inline transitions.
- Draw the map as one inline SVG with fewer than about 60 elements. No blur or drop-shadow filters on anything that moves.
- The coin is a 0.1px dash with a round cap, moved along the route by `stroke-dashoffset`. The trail is the same path with its dash array set to the path length. Measure each route once on mount with `getTotalLength()`.
- Pot layers are stacked rects inside a `clipPath`, scaled with `transform: scaleY()` from the bottom (`transform-box: fill-box; transform-origin: 50% 100%`). A payment scales the whole stack, so every layer shrinks by the same share, which is exactly how the contract splits a payment.
- Counters update with `requestAnimationFrame` only while they move. Show whole dollars in flight and exact cents at rest.
- Pause loops when the page is hidden (`visibilitychange`) or the map is off screen (`IntersectionObserver`).
- Respect `prefers-reduced-motion`: no flights and no loops; values cross-fade in 150ms.
- Target 60fps and no task longer than 50ms during a flight, measured in Chrome DevTools on a real low-end Android phone, not on a laptop.
- No animation library is needed for the map and the pot; the prototype uses plain CSS and one small counter. Add Motion (`npm install motion`, `import { motion } from "motion/react"`) only if a sheet or gesture needs springs. Every dependency is supply chain risk.

## 5. Between screens

- Use the View Transitions API so the map card stays put while the rest of the screen changes. Chrome supports it, and the Android app runs in Chrome. Where it is not supported, swap instantly.

## 6. Accessibility

- The map carries a text summary (`aria-label`) that updates with the pot.
- Announce landed money in a polite live region: "Ubong added $400. The pot has $900."
- Colour is never the only signal: every route and layer also has a name and an amount.
