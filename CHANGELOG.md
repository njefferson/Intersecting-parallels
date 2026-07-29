# Changelog

What changed, written for the person using the app (Doctrine §5). Numbers are
`version.capability.iteration`; every entry says which kind it is. The service
worker's cache name carries the same triplet.

Noah decides what counts as a version — the first slot, what the app IS.

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
