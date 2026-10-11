# Style notes

Read from the two references in `reference/` (git-ignored) with ffprobe,
ffmpeg's `scdet` cut detection, `silencedetect` and `volumedetect`, and
timestamped frame grids at 4 fps (sample vid 1) and 2 fps (Sample Vid 2).
Six contact frames per reference are saved locally in `reference/contact/`
(git-ignored with the references). Style only: no music, footage, logo or
text from either is reused.

## Sample vid 1 (style for the X launch video)

| | Measured |
| --- | --- |
| Duration | 11.05 s |
| Frame size and rate | 1080x1080, 1:1, 60 fps constant |
| Bitrate, size | 3.5 Mb/s, 4.9 MB |
| Hard cuts | 1 (scdet score 6.2 at about 1.3 s). Everything else is one continuous camera move |
| Shot holds | about 1.3 s on the device establishing shot, then about 9.7 s of one push-in, interact, pull-out move |
| Audio | stereo AAC, no silence over 0.3 s anywhere, mean -16 dB, peak -1.6 dB: a continuous music or sound-design bed with no gaps that speech would leave. No voiceover |
| Captions | none. The only text is the product's own UI text, shown huge by the camera move |

Shape:

* **First 3 seconds.** A floating phone on a near-black background with a
  soft purple glow, then a fast push-in straight into one control: within 2
  seconds the one thing the video is about fills the frame.
* **Middle.** A single interaction (a toggle, a menu, a tap with a ripple)
  seen up close at 2 to 3 times scale, with a slight 3D tilt and depth of
  field. The tap itself gets a glow ripple; the state change gets a colour
  change (grey to blue). No cuts: the camera carries it.
* **Ending.** A pull-out back to the whole device screen, darkening to the
  bottom, with a small wordmark in the bottom centre held about 2 seconds.
* **Look.** One dark brand colour, glassy UI, motion eased in and out, no
  on-screen narration text.

**Recommendation for x-launch.** 1080x1080, 1:1. Keep its shape: a hook
that fills the frame in under 2 seconds, then real phone footage pushed in
close on the one moment that matters (the second yes paying out, "nobody
can pocket it"), then a pull-out to the full screen and an end frame with
https://nivpay.vercel.app. Unlike the reference it needs a few short
captions, since X autoplays muted: at most 6 words each, large, in the
upper third, never over an amount. Render at 30 fps (the phone footage is
30 fps or lower; 60 fps would only duplicate frames), H.264, well under 15
MB. Phone footage in a clean, plain device frame on a dark warm background
(the app's own clay palette, not purple), scaled and moved by Remotion, never
redrawn. Target 30 to 45 s, so the move is slowed into three or four beats
rather than one.

## Sample Vid 2 (style for the demo videos)

| | Measured |
| --- | --- |
| Duration | 21.14 s |
| Frame size and rate | 1280x720, 16:9, 30 fps (average 30.0) |
| Bitrate, size | 2.4 Mb/s, 6.4 MB |
| Hard cuts | 5 by scdet (about 2.2, 10.5, 11.2, 11.7, 12.7 s); the rest of the scene changes are wipes and pushes |
| Shot holds | title 2 s, logo card about 4 s, map about 4.5 s, then a fast run of three colour cards at about 0.5 s each, then 2 s scenes, then an end card held about 3.5 s |
| Audio | stereo AAC, no silence over 0.3 s, mean -15.5 dB, peak -0.6 dB: a continuous music bed. No voiceover |
| Captions | large heavy rounded sans, two lines, white or dark with the key word in an accent colour ("Real players. / Real gist."). Left-aligned on the left third when a device or map is on the right; centred on title and end cards. Roughly 6 to 9 percent of frame height per line |

Shape:

* **First 3 seconds.** A question typed on word by word over a dark card
  with a small mark above it, the last word in the accent colour and
  underlined. It poses the problem before showing anything.
* **Middle.** One idea per scene, each with a two-to-four word caption on
  the left and the thing itself on the right (a map that fills with pins, a
  phone mockup with a chat). Transitions are directional wipes and slides,
  each about 0.3 to 0.5 s. Captions build in word by word.
* **Ending.** The opening card again: mark, name, one-line tagline, then a
  pill-shaped button with the URL and a small line under it. Held about 3.5 s.

**Recommendation for agora-bounty and technical-demo.** 1920x1080, 16:9,
30 fps. Take its structure, not its look: a one-line question card in the
first 3 seconds; then one idea per scene with a short caption on the left
third and the real phone footage on the right (or two phones side by side
for settlement); word-by-word caption builds and short directional wipes
between beats; an end card that repeats the opening with the URL in a pill.
Captions in the app's own fonts (Besley for the key word, Work Sans for the
rest), white on the dark warm background, at least 54 px at 1080p so they
read on a phone. Phone footage in a clean device frame, never full-bleed at
16:9 (a 1080x2340 phone fills under half the width). The demos run 105 to
175 s, far longer than the reference, so its 0.5 s card runs do not carry
over: hold each beat for as long as the real footage needs, and keep the
quick wipes only between beats. No music unless one is cleared in
`CREDITS.md`; the reference relies on a music bed, so without one the cut
leans on caption timing.
