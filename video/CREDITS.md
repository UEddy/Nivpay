# Credits and licenses for the videos

## Music and sound

None. The videos render silent (`muted: true`). Music may be added only if it
is CC0 or royalty free, with its title, author, source link and license
recorded here before the render that uses it.

## Voice

None. No AI voiceover is used.

## Footage

All phone footage is recorded by the author on the author's own phones from the live
app at https://nivpay.vercel.app, in test mode. The explorer footage is
recorded from MonadVision's public pages. Nothing on screen is mocked up:
no app screen, transaction, amount or settle time is drawn or made up.
Until real footage is in, a watermarked placeholder stands in, and a final
render refuses while one is left.

## Style references

`reference/` (git-ignored) holds two videos used only to study pacing and
layout ([STYLE-NOTES.md](STYLE-NOTES.md)). No music, footage, logo or text
from them is used.

## Fonts

| Font | Package | License |
| --- | --- | --- |
| Besley | `@fontsource/besley` 5.3.0 | SIL Open Font License 1.1 |
| Work Sans | `@fontsource/work-sans` 5.3.0 | SIL Open Font License 1.1 |

The same fonts and versions as the app.

## Software

| Tool | Version | License |
| --- | --- | --- |
| Remotion (`remotion`, `@remotion/cli`, `@remotion/bundler`, `@remotion/renderer`) | 4.0.534 | Remotion License, Free License tier: free for an individual, including commercial use (`node_modules/remotion/LICENSE.md`) |
| tesseract.js and its English data | 7.0.0, 1.0.0 | Apache 2.0, used for the privacy check on this PC only |
| FFmpeg | 9.0.2 (Gyan.FFmpeg build) | LGPL and GPL, used as a tool on this PC, not shipped |
