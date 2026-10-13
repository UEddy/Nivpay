# Credits and licenses for the videos

## Music and sound

**The films** (`src/films/`, rendered by `scripts/render-film.ts`): every
sound is synthesized from nothing by `scripts/make-sound.ts`, an original
Afrobeats style groove at 120 bpm and the effects (coins, the lid, the lock,
pops, whooshes). No sample, loop or recording by anyone else, so there is
nothing to clear. The files land in `films-public/sound/` (git-ignored) and are
rebuilt the same every run.

**The footage cuts** (`timelines/`) render silent (`muted: true`). Music may be added only if it
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

## The films are animation, not footage

The three films in `src/films/` are drawn in code from start to finish: the
pot, the map, the drawn phone and its screens are illustrations of the app,
in the app's own words. Their amounts come from `src/facts.ts` (the story of
docs/DEMO.md), their settle times are the ones measured on the phone, and
every block number and transaction shown is real, from `src/receipts.json`
or the README. The footage rule above is for the footage cuts.

## Style references

`reference/` (git-ignored) holds two videos used only to study pacing and
layout ([STYLE-NOTES.md](STYLE-NOTES.md)). No music, footage, logo or text
from them is used.

## The phone frame

Built in code (`src/phone/`): a generic rounded slab with plain side buttons,
from three's own geometry, lit by three's procedural `RoomEnvironment`. No
model file, no texture file, no brand, logo or real phone design. Its screen
shows only redacted renders of the author's footage.

## Fonts

| Font | Package | License |
| --- | --- | --- |
| Besley | `@fontsource/besley` 5.3.0 | SIL Open Font License 1.1 |
| Work Sans | `@fontsource/work-sans` 5.3.0 | SIL Open Font License 1.1 |
| Nunito | `@fontsource/nunito` 5.3.0 | SIL Open Font License 1.1, the films' headline type |

Besley and Work Sans are the same fonts and versions as the app.

## Software

| Tool | Version | License |
| --- | --- | --- |
| Remotion (`remotion`, `@remotion/cli`, `@remotion/bundler`, `@remotion/renderer`) | 4.0.534 | Remotion License, Free License tier: free for an individual, including commercial use (`node_modules/remotion/LICENSE.md`) |
| `@remotion/three` | 4.0.534 | MIT |
| `@remotion/media` | 4.0.534 | no license field in its package and no license file; part of the Remotion monorepo, whose license is the Remotion License above. Not yet confirmed for this package |
| three | 0.186.1 | MIT |
| `@react-three/fiber` | 9.8.1 | MIT |
| tesseract.js and its English data | 7.0.0, 1.0.0 | Apache 2.0, used for the privacy check on this PC only |
| FFmpeg | 9.0.2 (Gyan.FFmpeg build) | LGPL and GPL, used as a tool on this PC, not shipped |
