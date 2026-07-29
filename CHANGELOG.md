# Changelog

What changed, written for the person using the app (Doctrine §5). Numbers are
`version.capability.iteration`; every entry says which kind it is. The service
worker's cache name carries the same triplet.

Noah decides what counts as a version — the first slot, what the app IS.

---

## 0.2.0 — CAPABILITY · 2026-07-29

**Only vanishing points, vertical and horizontal touch your lines now.**

Your endpoints were being pulled onto whatever you had already drawn — any
existing point or line within 12px grabbed them. That was never asked for, and
it is what dragged a line off the guide it was drawn along. It is gone.

- The only things that can catch a stroke: each vanishing point, true vertical,
  true horizontal. Nothing else. Ever.
- **45°** is a new toggle in the toolbar, off until you turn it on.
- Where you lift your finger is where the line ends. Nothing snaps it to
  anything.
- A consequence worth knowing: lines are no longer welded to each other at
  shared corners, so moving a vanishing point swings each line about its own
  start rather than holding a shape together. Say the word if you want the
  welding back as its own toggle.
- The guides you can follow are drawn from the moment your finger lands —
  faint dotted lines through the point you started from, for every vanishing
  point plus vertical and horizontal. No aiming at a marker on the edge of the
  screen that was never on your line to begin with.
- The version number now sits next to the app name, so a screenshot says which
  build it came from.

---

## 0.1.2 — ITERATION · 2026-07-29

**A line only claims a guide when it really follows one.**

Found by auditing the 0.1.1 fix rather than waiting for it to be reported.
When both ends of a stroke land on points that already exist — which is what
happens constantly once a drawing gets busy — the line runs between those two
points, and nothing makes it pass through the guide you asked for. It was
being recorded as bound anyway. Measured: a line stored as bound to VP1 whose
path missed VP1 by 1,866px. It would not converge, and it would not move when
you moved that point.

- A guide is now only recorded when the line actually follows it. If it
  cannot, you get the line exactly as you drew it and the app says why.
- Nothing is ever nudged to make a claim come true. Where you put a point is
  where it stays.
- If a line lined up with a point only by coincidence and you later move that
  point, the app stops describing it as bound — in the inspector and in
  exported layer names — without editing your drawing.

---

## 0.1.1 — ITERATION · 2026-07-29

**Lines drawn to a vanishing point now actually meet there.**

Noah drew four lines at a vanishing point on his iPad and they fanned out
instead of converging. They had been captured by the *horizontal* guide, which
sits within a degree of a vanishing point that is far away and near the
horizon — and horizontal lines are parallel, so they meet nowhere.

- A vanishing point now wins any close call against the horizontal and vertical
  guides. If you want one of those, pick it in the Guide menu and it is yours.
- When two vanishing points are almost the same line from where you started —
  which is what happens near the horizon — the one you are drawing *toward*
  wins, instead of a hand tremor deciding.
- Drawing with a finger gets a wider aim than drawing with a pencil, because a
  fingertip is blunter than a nib.
- If nothing catches your stroke, the app now says so on screen rather than
  only to a screen reader. That line is plain, and it will not move when you
  move a vanishing point.

---

## 0.1.0 — CAPABILITY · 2026-07-29

The first working app. Everything below is new, because before this there was
a page holding the address.

**Drawing**
- Place vanishing points anywhere, including far outside the drawing. There is
  no cap and no requirement that they be square to each other — a road running
  off at its own angle gets its own point.
- Draw freehand and the stroke follows whichever guide it is nearest, or stays
  exactly as drawn when it is close to none. Or tap two points instead.
- An endpoint that lands on an existing point joins it; one that lands on an
  existing bound line becomes the corner those two lines define. That is what
  makes a drawn box stay a box when you move a point.
- Move a vanishing point and every line bound to it re-solves live.
- A point whose guides have become impossible — parallel, or sitting exactly on
  its own origin — holds its last good position and shows a ringed cross rather
  than vanishing or going haywire.

**Reaching things**
- A vanishing point off the edge of the screen pins a labelled marker to the
  edge. Drag the marker; you never have to zoom out to reach the point.
- The vanishing points panel is a real control surface, not a readout: arrow
  keys nudge a focused point, Shift makes larger steps, and every point has
  exact x and y boxes. Lock a point to stop it moving; keep one on the horizon
  and it follows the horizon.
- Guides and committed lines differ in weight and dash, not just colour, so the
  drawing stays readable in greyscale and to anyone who cannot separate the
  hues.

**Touch**
- Pencil draws, touch pans and zooms — and a toggle swaps that, so touch draws
  and two fingers navigate. Without it the app would be unusable on an iPad
  with no Pencil. It says plainly when it is on, and turns off in one press.

**Keeping the work**
- Drawings autosave on this device and reopen where you left them, including
  after an offline cold launch from the home screen. Undo history deliberately
  does not survive a restart.
- One gesture is one undo step: dragging a point across the canvas undoes in
  one press, not fifty.
- Save and open project files for your own backup. A file that is damaged or
  from a newer version is refused with the reason, before anything you have
  open is touched.

**Getting it out**
- SVG export with real layer names that Inkscape, Illustrator and Affinity all
  read, stroked and never filled, with an optional hairline mode.
- PNG export on a transparent background at whatever size you choose, for
  Procreate, which does not read SVG. If you ask for more than the device can
  actually render it says so and scales down, rather than handing you a blank
  image.

**Under it**
- Works entirely offline and makes no network requests once loaded. No account,
  no analytics, nothing uploaded.
