# NivPay demo videos

Three videos, made with Remotion (pinned) from real footage of the live app,
with a redaction step that fails closed. Raw phone footage stays on the
recording PC: `footage/`, `reference/`, `out/`, `.render/`, `.cache/` and
`privacy-denylist.txt` are git-ignored.

| Composition | Format | Length | For |
| --- | --- | --- | --- |
| `agora-bounty` | 1920x1080, 30 fps | cap 120 s, aim 105 to 115 | the Agora bounty: passkey onboarding, an AUSD balance, a send and a receive settled at once, each shown before 90 s |
| `technical-demo` | 1920x1080, 30 fps | cap 120 s, aim 90 to 120 | the app working, the settlement, receipts read from the chain, and how a pot works in the README's words |
| `x-launch` | 1080x1080, 30 fps | 30 to 40 s | X, consumer words only, ending on https://nivpay.vercel.app |

## The films

Three animated films, drawn in code from start to finish with no footage,
in `src/films/`. They take the same facts, receipts and fonts, on a groove
and sound effects synthesized by `scripts/make-sound.ts`.

| Composition | Format | Length | Story |
| --- | --- | --- | --- |
| `film-x` | 1080x1080 | 36 s | "Who's holding the family money?": the family group chat, then the pot that answers it. No crypto words |
| `film-agora` | 1920x1080 | 92 s | Passkey, an AUSD balance, London to Houston settled in the measured time, the chain's own receipt, another currency through Agora, the business |
| `film-demo` | 1920x1080 | 138 s | The life of Mama's 60th, with Monad's block strip: each coin lands only when its block is Finalized. Then a rogue sibling, the ledger, the live record on testnet |

The films bundle with `films-public/` as their only public folder, never
`footage/`, so no raw footage is copied into a render bundle; each run
deletes its bundle when it ends.

Scene lengths are in bars of the music (120 bpm) in `src/films/sound.ts`, so
the cuts land on the beat and the music is arranged from the same plan.

```
npm run film:sound               # once: writes films-public/sound/
npm run film:sheet -- film-x 1.5 # a contact sheet in .render/, for review
npm run film:render:x            # also :agora, :demo; privacy-checked into out/
```

What is where:

* `timelines/<id>.json`: the only thing to edit to change a video. Per
  segment: the shot, the clip id with its in and out seconds, the caption,
  the callout, the speed. A clip of `null` is a watermarked placeholder.
* `src/facts.ts`: every number, amount, name and hash a caption may show.
  Captions name them as `{pot.caterer.fee}`; a caption with a digit typed in
  is refused. `src/facts.test.ts` checks the amounts and fees against the
  app's own arithmetic, and the addresses and hashes against the README.
* [STYLE-NOTES.md](STYLE-NOTES.md): what the two style references measured,
  and the look chosen for each video.
* [SHOTLIST.md](SHOTLIST.md): what to record, in recording order, with what
  each retake costs. [STORYBOARD.md](STORYBOARD.md): each video beat by beat,
  generated from the timelines.
* [CREDITS.md](CREDITS.md): fonts, software, and any music (none).

## Render steps

From `video/`, in PowerShell:

```
npm ci
npm run video:check
```

1. **Look at it while editing:** `npm run video:studio`. It does not open a
   browser; it prints a local URL (http://localhost:3000 by default) to open
   yourself.
2. **Draft with placeholders:** `npm run video:render:agora -- --draft` (or
   `:demo`, `:x`). Placeholders and facts not measured yet are marked on
   screen, every frame carries "DRAFT, NOT FOR UPLOAD", and the file stays in
   `.render/<id>.draft.mp4`. It never reaches `out/`.
3. **Put real footage in:** record from [SHOTLIST.md](SHOTLIST.md), copy the
   files to `footage/final/`, review each one into `footage/redactions.json`
   with its frame scan, then set `take.clip`, `in` and `out` in the timeline.
   Then `npm run video:screens`: it renders each phone take redacted, at its
   segment's speed, privacy-checks it, and only then puts it in
   `footage/_screens/` for the 3D phone (see The phone frame below). Run it
   again after any change to the map or a take; a render refuses until you do.
4. **Fill the measured facts** in `src/facts.ts` from the footage (the table at
   the end of SHOTLIST.md), and the two hashes into the README too.
5. **Final:** `npm run video:render:agora` (`:demo`, `:x`). It refuses while
   anything below is wrong; otherwise it renders to `.render/`, runs the
   privacy check, and moves the file to `out/` only when that passes. For
   `x-launch` it also checks X's limits (2 min 20 s, 512 MB).
6. `npm run video:check` passes, then upload from `out/` only.
7. After any timeline change: `node scripts/storyboard.ts` to rewrite
   STORYBOARD.md (a test fails until you do).

## The phone frame

All three videos show phone footage in a 3D phone built in code
(`src/phone/`), rendered with WebGL. One setting, `PHONE_FRAME` in
`src/phone/frame.ts`, switches all three back to the flat frame: set it to
`"flat"` and render again. PC recordings keep the flat PC frame either way.

- **What the screen shows:** only files in `footage/_screens/`, which
  `video:screens` puts there after redacting and privacy-checking them, or a
  placeholder card. Blur and black holds are in the pixels before they reach
  the phone. The phone refuses any other path, and a render refuses a take
  whose screen file is missing or was made from an older redaction map.
- **When it holds still:** face-on and motionless for the whole shot when it
  is the settle moment, proves something for the judges, has an amount or
  "Settled in" in its plan (at any speed), or is marked `"still": true`.
  Otherwise it floats and tilts slowly, face-on at both ends of the shot.
  There is no setting that makes a shot with an amount move.
- **Push-ins** crop the screen exactly as the flat frame's zoom does.
- **The final render** is privacy-checked as before, and `video:check` also
  checks every file in `footage/_screens/`.

## What refuses a render

Every render, draft or final, refuses when a caption, callout, label or card:

* holds an en or em dash;
* holds a digit typed in, not taken from facts.ts;
* names a fact facts.ts doesn't have;
* uses a crypto word (wallet, token, gas, blockchain, crypto and the like) in
  any video; Monad, AUSD, CTK or transaction hash in `x-launch`; or a chain
  word (block, contract, explorer, transaction, hash) outside an explorer
  segment;

or when a video is over its cap or under its minimum, the "Settled in"
moment is sped up, two phones side by side run different lengths, or, in
`agora-bounty`, one of the three proofs ends after 90 s.

A final render also refuses while any placeholder is left, any fact a
caption uses is still null, or any clip isn't covered by its reviewed
redaction entry and scan. `video:check` fails on all of that, on any null left
in facts.ts, on any en or em dash in a committed file here, and on a privacy
check failure in `out/` or `.render/`.

A sped-up segment always carries a "Sped up" tag; no setting turns it off.
A take with `"hold": <seconds>` shows its one recorded frame at `in`,
unchanged, for at most 4 s, and always carries a "Frame held" tag (on a
pair, it says which phone). A held frame is never sped up, never taken from
inside a cut or a blackout, and never stands in for the "Settled in" moment
itself: that plays as recorded, and its frame may be held in a segment of
its own.

A `"kind": "receipt"` segment draws a receipt card from `src/receipts.json`:
status, block, whether the block is finalized, and each Transfer with its
amount and the recipient's last four, labelled "Read from Monad testnet".
`node scripts/read-receipts.ts` reads those, read only, from the public RPC
for every hash a receipt segment names (a fact path such as
`hashes.take.send`). Receipt cards are for the technical videos only.
Captions sit beside the footage (16:9) or above it (1:1), never on it, so
they can't cover an amount.

## The redaction map

`footage/redactions.json` (git-ignored, next to the footage) lists, per clip,
categories, times and rectangles only:

* `sideBars`, optional: the fraction cropped off each side, for a recorder
  that pillarboxed the screen (black bars left and right).
* `statusBar` and `bottomBar`: fractions cropped off the top and bottom of
  every frame, always (status bar, notification area, browser toolbars).
* `regions`: blurred (48 px) under an 85 percent tint for their whole time
  range, padded half a second either side and a tenth of the box on every
  side.
* `cuts`: taken out of the timeline, replaced by a black hold of at most
  2.5 s with a true caption ("Confirm with your screen lock"). Any PIN or
  password entry, or tap circles on a lock keypad, is a cut, never a blur.
* `holds`: the phone's own short blackout while the fingerprint prompt is up,
  kept, at most 2.5 s, captioned "Confirm with fingerprint".

A clip renders only if it has an entry marked `reviewed`, a frame scan
(`footage/_scans/<clip>.scan.json`, categories and boxes only), and every
private thing the scan found in the stretch is cropped, cut or under a
region.

## Commands

```
npm run video:studio
npm run video:render:agora -- [--draft]
npm run video:render:demo -- [--draft]
npm run video:render:x -- [--draft]
npm run video:render -- <clip> <from s> <to s> <name>
npm run video:screens -- [timeline id ...]
npm run video:privacy-check -- [file.mp4 ...]
npm run video:denylist-lint
npm run video:check
node scripts/read-receipts.ts
```

`video:render` renders one redacted stretch of one clip, for review.
`video:denylist-lint` reads `privacy-denylist.txt` and reports, by line
number and reason only, lines that would not match as meant: under 4
characters, a label ("something: value"), a `;` list, a cast name, a
duplicate; and how many blank lines there are. `video:check` runs it.
`video:privacy-check` samples every 0.25 s, reads each frame with OCR on this
PC (tesseract.js and its English data, pinned, nothing fetched), and fails on
any "@", any phone-number-like run, or any line of `privacy-denylist.txt`. It
prints PASS or FAIL with timestamps only: never the denylist, the text read or
what matched. Each line of the denylist is matched whole, so put one name,
address or number per line with nothing before it.

Only files in `out/` are ever uploaded.

Review tools, local only: `scripts/scan-frames.ts` (OCR a clip's extracted
frames into a scan of categories and boxes), `scripts/summarise-scan.ts`, and
`scripts/sheets.sh` (contact sheets of the changing frames). Frames go under
`footage/_frames/` and are deleted after a review; the scans in
`footage/_scans/` stay, as the render needs them.
