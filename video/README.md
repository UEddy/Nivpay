# NivPay demo video

Remotion, pinned, with a redaction step that fails closed. Raw phone footage
stays on the recording PC: `footage/`, `reference/`, `out/`, `.render/`,
`.cache/` and `privacy-denylist.txt` are git-ignored.

## The redaction map

`footage/redactions.json` (git-ignored, next to the footage) lists, per clip,
categories, times and rectangles only:

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
(`footage/_frames/<clip>.scan.json`), and every private thing the scan found
in the stretch is cropped, cut or under a region.

## Commands

```
npm run video:render -- <clip> <from s> <to s> <name>
npm run video:privacy-check -- [file.mp4 ...]
npm run video:check
```

`video:render` renders to `.render/`, runs the privacy check, and moves the
file to `out/` only when it passes. `video:privacy-check` samples every
0.25 s, reads each frame with OCR on this PC (tesseract.js and its English
data, pinned, nothing fetched), and fails on any "@", any phone-number-like
run, or any line of `privacy-denylist.txt`. It prints PASS or FAIL with
timestamps only: never the denylist, the text read or what matched.
`video:check` typechecks, tests, checks the map against every scan, and runs
the privacy check on `out/` and `.render/`.

Only files in `out/` are ever uploaded.

Review tools, local only: `scripts/scan-frames.ts` (OCR a clip's extracted
frames into a scan of categories and boxes), `scripts/summarise-scan.ts`, and
`scripts/sheets.sh` (contact sheets of the changing frames). Frames go under
`footage/_frames/` and are deleted after a review.
