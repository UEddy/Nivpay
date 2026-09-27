# NivPay design comps

These five files are the design for the app's core screens, taken from the "Chosen direction" page of the NivPay UI Concepts canvas: the Clay Pot look with the Three Cities map. They are HTML comps, not app code. Rebuild them as real components; don't copy the template syntax.

## How to read them

- Inline styles are the spec: colours, sizes, spacing, radii, fonts.
- `{{name}}` marks a value that changes with state. The `<script type="text/x-dc">` block at the bottom (`class Component`) computes those values and runs a demo timeline. Its timings are a reference; `docs/MOTION.md` is the rule.
- `<sc-if>` is a conditional, `<sc-for>` a loop, `<helmet>` holds the page head (fonts and keyframes).
- Names and numbers are the Mama's 60th demo story. In the app they come from the chain and from the pot's labels.

## Screens, in story order

1. `Live-Create.dc.html`: make a pot (Idara, London)
2. `Live-ChipIn.dc.html`: pour in your share (Ubong, Houston)
3. `Live-Approve.dc.html`: approve a pour (Ubong)
4. `Live-Timeline.dc.html`: the pot's story, with a Replay button (Idara)
5. `Live-Close.dc.html`: close and split (Idara)

## Tokens

- Background `#FAF1E4`, ink `#3A2317`, muted text `#6E5243`
- Primary `#A5451F`, pressed `#7F3316`, primary text on light `#8C3A1A`
- Card `#FFFBF5` with border `#EAD6BD`, chip `#F6E6D2`, divider `#EFE0CC`
- Map paper `#F4E3CB`, grid lines `#EBD4B5`, empty route `#C9AD8C`
- Pot clay `#E7C29C`, lid `#C8744A`
- People: first `#A5451F`, second `#245C5A`, third `#D99A2B` (route line `#B07A1E`, text `#8A5A0E`). Assign by join order. For more people, add colours from the same earthy family that also differ in lightness.
- Fonts: Besley 600 (and italic 400) for headlines and amounts. Work Sans 400, 500 and 600 for everything else.

## Map geometry (viewBox 342 x 232)

- Pot: a nested svg at x 118, y 66, size 96 x 96, viewBox 0 0 200 200. The pot path is in every file.
- Cities: Houston (38, 96), London (236, 30), Uyo (214, 204). Vendors: Caterer (304, 92), Event hall (304, 160), radius 14.
- Routes are quadratic curves:
  - Houston `M38 96 Q80 52 131 112`
  - London `M236 30 Q224 58 180 78`
  - Uyo `M214 204 Q206 170 182 153`
  - Caterer `M201 114 Q248 80 290 92`
  - Event hall `M199 131 Q246 158 290 160`
- These positions fit three people and two vendors. The app needs a small layout function for other counts: people in slots around the pot, vendors on the right.
- Liquid: one rect per person, stacked from the bottom of the pot (y 186.5 in pot units), clipped to the pot, scaled with `scaleY` from the bottom. Full height (128.5 units) stands for the total of the pot's payment limits, the most it can ever pay out. If a pot holds more than that, draw it full and show the extra as a number.
