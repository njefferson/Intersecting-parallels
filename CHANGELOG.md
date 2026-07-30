# Changelog

What changed, written for the person using the app (Doctrine §5). Numbers are
`version.capability.iteration`; every entry says which kind it is. The service
worker's cache name carries the same triplet.

Noah decides what counts as a version — the first slot, what the app IS.

---

## 1.3.2 — ITERATION · 2026-07-30

**The second step now shows you which way to drag.**

- **A double-headed arrow sits on the corner the box is waiting on**, pointing
  both ways along the line that corner travels. The strip at the top said a step
  was happening; the arrow says what to do about it. It is drawn on the corner
  itself, at the same size whatever the zoom, and it turns to follow the guide if
  you move the vanishing point while the step is open.
- It has arrowheads rather than just a colour, so it still reads as an
  instruction in greyscale, and it disappears the moment the step ends — by Done,
  by Escape, by finishing the drag, or by switching tools.

---

## 1.3.1 — ITERATION · 2026-07-30

**Two things that were in the wrong place.**

- **A long press on the canvas no longer starts a text selection.** iOS was
  treating a slow press as "select this", complete with the blue highlight and the
  callout menu. A slow press is a normal way to begin a stroke, so it must not be
  punished.
- **The "tap Clear again" confirmation now appears under the Clear button**, not
  at the bottom of the screen. A question asked in one corner should not be
  answered in another. It still says exactly what it counted, it still disappears
  the moment you touch anything else, and it still expires by itself.

---

## 1.3.0 — CAPABILITY · 2026-07-30

**A box is two steps now, and the second one comes to you.**

- **Drag once, then drag again.** The first drag sets the height and the depth
  toward whichever vanishing point you drag toward. The moment you let go, the
  OTHER depth is live: drag anywhere on the canvas and it follows. No handle to
  find, no mode to choose. A drag carries two numbers and a box needs three —
  this is where the third one comes from.
- The step says it is happening, and it has a **Done** button. Escape does the
  same, so does picking another tool, and every one of them **keeps the box** —
  there is nothing to lose by walking away from it. It never expires on its own.
- If you would rather type it: the corner is already selected, so the arrow keys
  set that depth without any drag, and its distance is a number field in Points.
- Each step is its own undo, so you can take back the depth and keep the box.
- **The anchor corner looks different now.** Three kinds of corner, three shapes:
  the corner you placed is a filled square inside a ring, a corner that slides
  along one guide is a filled square, and a corner where two guides cross is an
  open square. You should not have to drag one to find out what it is.

---

## 1.2.0 — CAPABILITY · 2026-07-30

**Every corner of a box moves now.**

- **The four dead corners work.** A box has eight corners: one you placed, three
  that ride a guide, and four that are where two guides cross. Only the first four
  could be dragged — the other four did nothing, for a finger, the arrow keys or
  the panel. They move now, by working out the distances behind them.
- **The far bottom corner sets both depths at once.** That is the answer to a box
  coming out as two connected squares: draw it, then pull that corner toward the
  horizon and both sides deepen together. Measured on the shipped shape: 20 and
  168 deep becomes 782 and 887 in one drag.
- **Corners are drawn as squares**, so you can see which points are handles
  instead of finding out by trying each one.
- The arrow keys and the number fields reach exactly the same corners by exactly
  the same route, so they can never disagree about what a corner is allowed to do
  again.
- A corner drag that does nothing no longer pretends otherwise: it used to add an
  undo step and announce a move that never happened.

Known and not yet fixed: one drag still cannot state a box's height and both
depths — that is three numbers from two, and the second depth comes from the
corner drag above. A proper two-stage box gesture is designed and next.

---

## 1.1.0 — CAPABILITY · 2026-07-30

**Everything Noah found on V1, and the gates that should have caught it.**

- **A corner moves now.** Tap one and drag it — an anchored corner goes where you
  put it, a corner riding a guide slides along that guide. It could not be dragged
  at all before.
- **Arrow keys work on whatever is selected.** Tapping a corner used to fill the
  panel and then ignore every key. Now the canvas takes focus when you select, and
  arrows nudge by 1, or 20 with Shift — a point, a corner, either.
- **A straight-up box drag makes a tall thin box.** It was changing all three axes
  at once, because the depth floor was tied to the height: dragging 141 tall gave
  70 deep, 636 tall gave 318 deep. Depth now only follows sideways movement.
- **Off-screen vanishing points show an arrow** pointing at where the point really
  is, plus how far away it is, and a squared-off badge instead of a round dot — so
  a marker cannot be mistaken for the point. It never was the point: it sits on
  the edge of the screen, on the line from the middle of your view.
- **A first-run explanation**, with two ways out of it, one at the top and one at
  the bottom, and "Show the introduction again" in About if you want it back.
- **Zoom and Fit buttons**, so pinching is a shortcut rather than the only way.

---

## 1.0.0 — VERSION · 2026-07-30

**Version 1. Noah's call.**

Everything below this line was built and tested in two days, and this is the build
he decided is the thing itself rather than the way there. Nothing was added to earn
the number — the release is 0.6.1 plus the one change he asked for on reading it:

- **Clear is in the toolbar now**, next to Points, not buried in Project. It clears
  the drawing and keeps your vanishing points, which is the one you reach for. The
  first tap arms it and says what it will remove; the second does it; anything else
  you touch cancels; and an arm left alone expires by itself after six seconds.
  Wiping the points too is still in Project, one level down, because it should be.
- It is deliberately NOT beside Undo. A destructive tap does not belong next to the
  control you reach for after a mistake.

What the app is, as of 1.0.0: place vanishing points, draw lines that stay locked
to them, build a box in one drag with both depths, weld corners or not, set any
corner exactly, undo everything one step at a time, clear the screen, export SVG or
PNG, and work with no account and no network at all.

---

## 0.6.1 — ITERATION · 2026-07-30

**A way to clear the screen.**

- Two of them, in **Project**, because "clear" means two different things when
  you have set up vanishing points: **Clear the drawing, keep the points** wipes
  what you have drawn and leaves your setup standing, and **Clear everything,
  points too** takes the points as well.
- Neither touches the horizon or the drawing size — those are the sheet of paper,
  not the drawing on it — and neither invents a default to replace what it
  removed. Your saved projects and project files are untouched.
- **One undo puts it back**, in a single step, both of them.
- The button tells you what it is about to remove, counted from your actual
  drawing — "clear 2 lines and keep 2 points" — and the first tap only arms it.
  Tapping the other clear button, or anything else in the panel, cancels.

---

## 0.6.0 — CAPABILITY · 2026-07-30

**Welding is yours to switch, and a box no longer has to be square.**

- **Weld, in the toolbar.** On, a line end that lands on its guide joins the
  corner it finds there — that is what makes a shape hold together when you move
  a vanishing point, and it stays the default. Off, every end stops exactly where
  you lift and joins nothing, which is what you asked for back in 0.2.0. Both are
  now a switch instead of the app's opinion. Either way the guide still decides
  direction, so turning it off can never hand you back a line that belongs to
  nothing.
- **One box drag now sets both depths.** Drag up and to the right and the box
  runs further to the right; up and to the left, further left. Straight up still
  gives a square plan — that is the one case, not the only case. A box needs three
  numbers and a drag carries two, so the drag sets the height and the share, and
  then:
- **A corner can be set exactly.** Select one and the panel offers the control
  that fits what holds it: an anchored corner gets x and y, a corner riding a
  guide gets its distance along that guide — which on a base corner is that side's
  depth — and a corner where two guides cross says so, because it has no
  coordinates of its own. Changing one depth leaves the other alone. Previously
  a corner could only be deleted; the notes claimed it was adjustable, and it
  was not.

---

## 0.5.2 — ITERATION · 2026-07-30

**New icon and link preview, drawn in real three-point perspective.**

- The app's icon and its link-preview picture are now a wireframe city seen from
  up among the towers: two vanishing points on the horizon, a third below the
  streets, and every edge in the drawing genuinely running to one of them. The
  pictures they replace were generated, and the third point in those was
  decoration — the vertical edges were drawn parallel, which is the one thing
  three-point perspective is not.
- The icon is the same picture as the preview, seen through a square window. They
  used to be two separate drawings and the perspective did not match.
- The icon on your home screen should also stop showing a hair of white at its
  corners: it is drawn edge to edge now instead of being shrunk onto a flat pad.
- Nothing about drawing changed in this release.

---

## 0.5.1 — ITERATION · 2026-07-30

**The link preview says what it is.**

- When you paste the app's link into Messages, Slack or anywhere else that
  shows a preview card, the picture now has the name on it — "Intersecting
  Parallels", the tagline, and one plain line saying it is free perspective
  drawing that works offline. Before, the card was the artwork alone, which is
  pretty and tells a stranger nothing. The same image is the repo's social
  preview.
- The picture's description (what a screen reader announces) now reads the
  words on the tile out loud before describing the drawing behind them.
- Nothing about drawing changed in this release.

---

## 0.5.0 — CAPABILITY · 2026-07-29

**Boxes in one drag, and line ends connect again so adjustments hold.**

- **Box mode.** One drag from the near bottom corner — up for height, sideways
  for depth — draws the whole box: twelve lines, eight corners. Every corner is
  held by two guides rather than by coordinates, so moving a vanishing point
  moves the box and it stays a box. That is the part your hand-drawn cube could
  not do.
- **Line ends connect again.** They stopped in 0.2.0 because you asked for
  nothing but guides to touch your lines, and you were right that it broke
  adjustments. The rule now separates the two things: a **guide** decides a
  line's **direction** — still only a vanishing point, vertical, horizontal or
  45° — and **joining** only decides **where along that direction** the line
  ends. So a line can share a corner without ever being bent off its guide.
- An end joins an existing corner when that corner is on the line's guide, and
  otherwise stops where a guide-bound line crosses it — a real two-constraint
  corner. Starting a new line on an existing corner always joins.

---

## 0.4.0 — CAPABILITY · 2026-07-29

**No more plain lines, and you can change your mind mid-stroke.**

- **Every line lands on a guide.** However far off the angle, a stroke takes the
  nearest vanishing point, vertical or horizontal. The app will never again hand
  back a line that belongs to nothing and tell you it drew a plain line.
- **The guide can be switched while you are still drawing.** Swing your finger
  toward another point and the line goes with it — no lifting, no undo. It says
  which guide has it as you go.
- A tremor cannot flap the line between two guides: a different guide has to
  clearly beat the one in hand before it takes over. A deliberate swing crosses
  that instantly.
- Worth knowing: two points that are almost the same line from where you started
  — which is what happens near the horizon — cannot be swung between, because
  there is nothing to swing through. Use the Guide menu there.
- Turning Assist off, or picking "Guide: none", still gives you exactly what you
  drew. Those are your choices; the difference is the app no longer makes them
  for you.

---

## 0.3.0 — CAPABILITY · 2026-07-29

**You can delete things now.**

- **Deleting a line works.** Selecting one needed a tap within 12 pixels of it,
  which is a drawing tolerance, not something a finger can hit — so tapping a
  line just said "nothing there". The target is 44px now, like everything else.
  Tapping near a line's end used to select the point instead and offer nothing
  at all; a point can be deleted too, and it says how many lines will go with it.
- **A vanishing point can be deleted, and your drawing does not move.** It used
  to refuse, on the grounds that lines were leaning on it. Now the point goes
  and every line it held stays exactly where it is, to the pixel — it simply
  has no guide any more. The message says what happened rather than leaving you
  to check.
- Undo puts any of it back, in one step.

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
- Your artwork is in: the app icon on the home screen, and the picture that
  shows when the link is shared.

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
