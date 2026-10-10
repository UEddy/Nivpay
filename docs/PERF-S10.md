# Measuring 60fps on the Galaxy S10

A 15 minute procedure for checking the five pot motions in
`docs/MOTION.md` on the Galaxy S10 over USB, with Chrome's remote debugging.
The target, from MOTION.md: 60 frames a second, which is 16.7 ms a frame on
the S10's 60 Hz screen, and no task over 50 ms while something flies.

Two motions cost nothing to record: the story's Replay and the close and
split screen of a pot that is closed. The other three only run when a real
request lands at Finalized, so record them during a rehearsal take of
`docs/DEMO.md` on fresh accounts, at the step named below; they send nothing
extra.

## 1. The phone, once (3 minutes)

1. Settings, About phone, Software information. Tap **Build number** seven
   times and enter the PIN. "Developer mode has been turned on."
2. Settings, Developer options: turn on **USB debugging**. Also turn on
   **Stay awake**, so the screen doesn't lock mid recording.
3. In Developer options, check that **Window animation scale**, **Transition
   animation scale** and **Animator duration scale** are all **1x**.
4. Settings, Accessibility, Visibility enhancements: **Remove animations**
   must be **off**. Chrome reads it as reduced motion, and then nothing
   flies (by design, MOTION.md).
5. Turn off Power saving mode, and charge above 50 percent. Power saving
   lowers the CPU and the frame rate, and the result would mean nothing.

## 2. The PC, once (5 minutes)

1. Install Samsung's Android USB driver for Windows from
   https://developer.samsung.com/android-usb-driver, then restart Windows if
   it asks.
2. Connect the S10 with a cable that carries data (the one in the box does;
   some charging cables don't). On the phone, allow USB debugging for this
   computer, and tick **Always allow from this computer**.
3. On the PC, in Chrome, open `chrome://inspect/#devices` and tick
   **Discover USB devices**. The S10 appears as SM-G973F (or similar) after a
   few seconds. If it doesn't: unplug and replug, and accept the prompt on
   the phone again.

## 3. Recording (7 minutes)

1. On the phone, open https://nivpay.vercel.app in Chrome and get to the
   screen before the motion.
2. On the PC, under the S10 in `chrome://inspect`, click **inspect** under
   the nivpay.vercel.app tab. DevTools opens with the phone's screen in it;
   leave the screencast off (the screen icon at the top left), since it
   costs the phone frames.
3. Open the **Performance** panel. Click the gear at its top right:
   * CPU: **No throttling**, Network: **No throttling**: this is the real
     phone.
   * **Screenshots** on. **Enable advanced paint instrumentation** off; it
     slows the phone down.
4. Click **Record** (the circle), do the motion on the phone, wait until it
   has finished plus about one second, click **Stop**. Keep each recording
   under 10 seconds.
5. Save each one: the down arrow at the top, **Save trace**, named after the
   motion, for example `s10-replay.json`.

| Motion | Where, and what to tap | Starts | Runs about | Costs |
| --- | --- | --- | --- | --- |
| Timeline Replay | Any pot with a few entries (pot 0 works once its history has loaded), See the pot's story, wait until "Loading earlier history" is gone, start recording, tap the circular arrow on the map | at the tap | 7 s | nothing |
| Close | A closed pot (the take's, after step 5.3): on the pot screen, start recording, then tap See the split | as it opens | 1.2 s | nothing |
| Create | DEMO.md step 2.10: start recording, tap Make the pot and confirm with the fingerprint | at Finalized, a few seconds after the fingerprint: the lid drops, the lock pops, the invites fly | 1.8 s | the take's own request |
| ChipIn | DEMO.md step 3.1 or 3.2: start recording, tap Pour in and confirm | at the fingerprint: the coin flies, holds at the rim, lands at Finalized, the layer rises | 0.9 s flight, 0.75 s fill | the take's own request |
| Approve | DEMO.md step 4.4 or 4.7: start recording, tap Say yes and pay, confirm | at Finalized: the pot tips, the stream runs, the level drains, the payee is checked | 2.2 s | the take's own request |

For the three that wait on Finalized, record from the fingerprint and stop
two seconds after the check appears; the recording then holds both the wait
and the motion.

## 4. Reading the frame chart

In the saved recording:

1. Drag across the motion in the overview at the top, from the first frame
   that moves to the last, to zoom to it. The screenshots strip shows where
   that is.
2. **Frames** track. Each block is one frame; hover for its time.
   * Green: presented on time.
   * Yellow or striped (partially presented): some of the screen was late.
   * Red (dropped): a frame the screen never got.
   At 60 Hz every frame should be about 16.7 ms. Count the yellow and red
   blocks inside the motion: **0 is the target**; one at the very start, as
   the screen changes, is acceptable and worth noting.
3. **Main** track. A red corner on a task means it ran over 50 ms. Inside
   the motion there should be **none**. Click one to see what it was in the
   Summary tab below (Scripting, Rendering or Painting) and its call tree.
4. **GPU** and **Raster** tracks: tall bars lined up with dropped frames
   point at painting, not script. Only transform, opacity and
   stroke-dashoffset should move (MOTION.md), so long Paint or Layout
   blocks inside a motion are worth reporting with the trace.
5. A quick check without a recording: DevTools, the three dots, More tools,
   **Rendering**, tick **Frame Rendering Stats**. A meter appears on the
   phone with the frame rate and dropped frames while you run the motion.

## 5. What to send back

| Motion | Frames in the motion | Yellow or red | Longest task in the motion | Trace file |
| --- | ---: | ---: | ---: | --- |
| Timeline Replay | | | | |
| Close | | | | |
| Create | | | | |
| ChipIn | | | | |
| Approve | | | | |

Also note the Chrome version (`chrome://version` on the phone) and the
battery level.

## For comparison: a laptop, not the phone

Measured on 10 Oct 2026 on a Windows laptop, headless Chrome with a
throwaway profile, 4x CPU slowdown, a 412 by 915 mobile viewport, the
production build served locally, cold (no cache, no service worker), median
of five runs (three under slow 4G). "Ready" is when Home's balance or
Welcome's button is on screen; total blocking time is the sum of each long
task's time over 50 ms.

| Screen, network | Build | First paint | Ready | Long tasks | Longest | Total blocking |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Welcome, local | one bundle | 436 ms | 427 ms | 2 | 153 ms | 174 ms |
| Welcome, local | split | 420 ms | 408 ms | 2 | 126 ms | 139 ms |
| Home, local | one bundle | 432 ms | 1,409 ms | 2 | 150 ms | 173 ms |
| Home, local | split | 436 ms | 1,390 ms | 2 | 127 ms | 147 ms |
| Welcome, slow 4G | one bundle | 2,072 ms | 2,057 ms | 2 | 146 ms | 165 ms |
| Welcome, slow 4G | split | 1,740 ms | 1,724 ms | 2 | 127 ms | 139 ms |
| Home, slow 4G | one bundle | 2,092 ms | 3,240 ms | 2 | 152 ms | 176 ms |
| Home, slow 4G | split | 1,728 ms | 2,817 ms | 2 | 129 ms | 150 ms |

Slow 4G is Lighthouse's: 150 ms latency, 1.6 Mbit/s down. Home's ready time
includes reading the balance from the public RPC at the finalized block.
Both long tasks are at start up, evaluating the script and the first
render; none came after the screen was up. A slowed laptop is not an S10,
which is why the phone's numbers above are the ones that count.
