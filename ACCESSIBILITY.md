# ACCESSIBILITY.md — Intersecting Parallels

Append-only register (Doctrine §4, §12). Rows are **never deleted and never
silently edited**. A fixed row keeps its original number and gains a resolution
line naming the release that fixed it.

Target: **WCAG 2.2 AA**. The shared public statement lives on the hub at
[/accessibility](https://noahjefferson.pages.dev/accessibility); this app's
About surface links to it once the app exists.

**Enforcement:** [`a11y-gate.mjs`](a11y-gate.mjs), run by
[`.github/workflows/a11y.yml`](.github/workflows/a11y.yml) on every push to
`main` or `staging` and every pull request. It exits non-zero. Locally it is
`npm run a11y` — the same file CI runs, so "green locally" and "green in CI"
are claims about the same bytes (hub LESSONS 7b).

Beside it, [`walk.mjs`](walk.mjs) (`npm run walk`, workflow
[`walk.yml`](.github/workflows/walk.yml)) drives the real app with real
pointer and keyboard events. It is listed here because two of its checks are
accessibility claims that no static scan can make: that arrow keys actually
move a focused point, and that focus survives the move.

---

## Part 1 — What the gate enforces

- **Surfaces** — the app at `/`, in each of its four reachable states: the
  canvas, and the export, project and about dialogs. A dialog that is closed at
  load is invisible to axe, so scanning only the default state would have
  reported the app clean while three of its four surfaces went unchecked. The
  gate serves `public/` over HTTP and opens each one by clicking its real
  control (every new surface joins this list in the commit that adds it)
- **Themes** — light and dark, both, every run
- **Viewports** — 390×844 and 320×568 (narrow-phone; §4's
  small-phone-at-200%-text case is why 320 exists)
- **axe** — wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice; any violation
  fails
- **Contrast** — computed per registered selector; AA thresholds (4.5:1, or
  3:1 for large text). Against a gradient, the **worst** colour stop is used
- **Targets** — ≥44px, except inline-in-a-sentence (WCAG 2.2 SC 2.5.8), which
  is exempted **and printed**
- **Also** — `lang` present, exactly one `<h1>`, no `<img>` missing `alt`, no
  unnamed interactive element, no page errors

### The contrast registry

Selectors live in `PAGES[].registry` in `a11y-gate.mjs`. **A registered
selector that matches nothing fails the build** — it is never skipped, because
a renamed class must not silently drop out of coverage.

Always present: `h1.title` `.btn` `.hint` `.vp-name` `.coord label`
`.panel-head h2`
Export dialog: `.dlg-head h2` `.dlg-body` `.dlg-body label` `.hint`
Project dialog: `.dlg-head h2` `.dlg-body label` `.dlg-body h3`
About dialog: `.dlg-head h2` `.dlg-body` `.dlg-body a` `.dlg-body li`

### What the DOM gate cannot see: the canvas

A canvas is one opaque element to a DOM walker, so every mark drawn on the
drawing surface sits outside the registry above. `test/canvas-contrast.test.mjs`
does that arithmetic instead, on `themeColors` from `render.mjs`, and runs with
`npm test`. It covers **all eight** palette marks — ink, guide, grid, vp,
vpLocked, bad, sel, ghost — against paper at a 3:1 floor (SC 1.4.11), in both
themes, and a completeness test asserts the palette contains exactly the entries
this file checks, so adding a colour without deciding what it must clear fails the
build rather than passing unnoticed.

Since 1.5.0 the palette splits in two, and the split is about DRAW ORDER rather
than importance. **Marks** are lines and dots, held to 3:1 against what is behind
them. **Surfaces** are the four D37 face fills, which other things get drawn ON
TOP OF; holding a surface to 3:1 against paper would be meaningless, so what is
asserted instead is that every mark that can land on one stays at 3:1 there. The
grid is the single exception, and only because it is drawn UNDER the fills and so
never sits on one. A further test requires each step of the shading ramp to be
visible — shading that all reads the same is decoration pretending to be
information. The selection colour, which carries the selected corner, the selected
edge and D33's extrude arrow, measures **8.68:1 dark / 5.83:1 light**.

**Nothing is carved out.** The first version of this file exempted the grid
because it measured 1.38:1 and could be called decorative. Noah's ruling on
2026-07-30 — *"There is NO reason that any color be protected right now. That was
the WRONG call."* — was correct, and the exemption is gone. A drawing app's grid
is not decoration: it is how scale and position are read off the paper. Exempting
the single thing that failed is how a gate becomes a formality.

The grid was raised instead: **#26304F → #636A80** (1.33:1 → 3.21:1) dark, and
**#D5DCEA → #8A8F98** (1.38:1 → 3.25:1) light, each keeping its own r:g:b ratio
so it is the same hue, only louder. A further test asserts the hierarchy survived
— grid quieter than guides, guides quieter than committed ink — because raising
the quietest thing on the paper could have inverted the ordering that weight and
dash also carry.

`.empty` is deliberately NOT registered: whether the saved-projects list is
empty depends on whether autosave has fired, and a selector that matches only
sometimes is a flaky gate. Its pair (`--muted` on `--surface`) is the one
`.hint` already registers, so the colours are covered without the flake.

**Adding a new foreground/background pair? Add it here and to the registry in
the same commit that introduces it** (§4).

### Text baked into an image — the social tile

`public/og.png` carries the wordmark, so it has foreground/background pairs
that no DOM-based gate can see: the background is a photograph-like gradient
with a sun in it, and the "background colour" of a letter is whatever pixel
happens to be under it. Its gate is
[`render-og.mjs`](render-og.mjs) (`npm run render:og`), which renders the tile
twice — once with the text hidden — samples the real backdrop inside each
line's tight rect, takes the **lightest pixel found** (worst case for light
text) and computes the WCAG ratio against the real text colour. It exits
non-zero below 4.5:1 and prints the offending pixel's rgb and coordinates.
4.5 is required although every line is large text (3:1 would pass): the tile is
displayed at roughly a third of its size in a link card.

Measured 2026-07-30, at the first composition:
- wordmark `#F7EEDC` 72px — **9.97:1** (lightest backdrop pixel rgb(61,57,49))
- tagline `#F4CE93` 31px — **8.44:1** (rgb(50,52,48) — the left vanishing
  point's glow, showing through the wash)
- plain line `#CBD4EA` 24px — **5.10:1** (rgb(97,82,56))

Re-measured 2026-07-30 against the computed three-point city (0.5.2), which is a
darker backdrop on the left than the sunset it replaced:
- wordmark `#F7EEDC` 72px — **13.71:1** (rgb(40,33,32))
- tagline `#F4CE93` 31px — **11.15:1** (rgb(15,32,45))
- plain line `#CBD4EA` 24px — **4.96:1** (rgb(41,92,110) — a road)

The three vanishing points are drawn ON TOP of the wash, from coordinates the art
generator writes to `art/og-base.json`. The wash has to be deep enough to carry
72px type, and at that depth it took the LEFT vanishing point from 6.59:1 against
its own sky down to **1.60:1** — erased. A tile whose subject is three vanishing
points cannot lose one to its own caption, so the point (and a faint length of
horizon, so it is not a dot floating in nothing) is composited over the wash, and
the wordmark moved down 36px to clear it. That move was not a judgement call: the
restored point put an rgb(242,166,90) pixel inside the wordmark's first line and
the gate failed at 1.76:1 on the very next run.

Alt text carries the words, not just the picture: an image containing text is
inaccessible if its alt describes only the scene, so `og:image:alt` and
`twitter:image:alt` both quote the tile's wording before describing the art.

### Design-time bindings for the app itself (from NOTES.md D5/D6)

The spec's interactive objects live inside a canvas — untabbable, no focus
ring, invisible to axe. These bindings exist so the app is accessible by
design, not retrofit:

- The VP list is the real control surface: a `<button>` per VP with
  focus-visible, arrow-key nudge, numeric x/y entry; same for a selected
  vertex or edge inspector.
- 44px hit radii on handles and off-canvas markers; the drawn dot stays small,
  the hit area does not.
- Guides and committed lines differ by weight and dash, not hue; meaning must
  survive a grayscale render.
- Type in `rem`; panels measured against the space they have at the moment
  they open; no floor that can exceed its container.
- The touch-draws toggle (D5) is an accessibility feature: without it the app
  is unusable on any iPad without a Pencil. Standing mode indicator, obvious
  exit.

---

## Part 2 — Findings register

### F-01 · Footer "source" link was 43.2×44px
**Found:** 2026-07-29 · first-ever run of the ported gate, before the first
commit
**Rule:** Doctrine §4 (targets ≥44px)
**Detail:** `public/index.html` `.foot a` measured **43.2 × 44 px** — the
`min-height:44px` pattern inherited from the hub's F-01 fixed the height and
nothing constrained the width, which came out 0.8px short. Both themes, both
viewports.
**Fix:** `min-width:44px` with `justify-content:center` and horizontal padding.
**Status:** FIXED 2026-07-29, same session, before the page ever deployed.
Verified: gate re-run, 0 failures, `--verbose` shows all seven registered pairs
at ≥5.24:1.

### F-02 · Arrow-key nudge worked exactly once, then focus was destroyed
**Found:** 2026-07-29 · first-ever run of `walk.mjs`, before the app shipped
**Rule:** Doctrine §4 (keyboard always) / WCAG 2.4.3 Focus Order
**Detail:** Pressing ArrowRight on a focused vanishing point moved it 1px and
then nothing moved again: every edit called `afterEdit`, which rebuilt the
whole panel, so the focused `<button>` was destroyed and replaced. A second
press went to `<body>`. The keyboard surface D6 exists to provide was, in
practice, a single keystroke — and the app's own unit tests all passed, because
none of them has a focus.
**Fix:** rows are rebuilt only when the SET of points changes; a nudge, drag or
typed coordinate updates the existing nodes in place. Restoring focus by id
afterwards was the first fix considered and was rejected — it patches the
symptom, and the frame (rebuilding the DOM under a reader's hands) was the bug
(Doctrine §14).
**Status:** FIXED 2026-07-29, before any deploy. Verified: the walk's three
keyboard checks pass — 2px for two presses, 20px for Shift, and
`document.activeElement` still inside the panel afterwards.

### F-03 · An off-screen VP marker could sit on top of the panel
**Found:** 2026-07-29 · reading the walk's screenshots
**Rule:** Doctrine §4 (targets reachable) — a control covering another control
**Detail:** The edge-pinned marker for an off-screen vanishing point is
positioned against the viewport, so at some pan positions it landed on top of
the panel row that controls the same point, covering it.
**Fix:** a marker whose position falls inside the panel's rect steps to the
left of it. Both controls stay visible and hittable.
**Status:** FIXED 2026-07-29, before any deploy. Verified by re-reading the
screenshots at the same view.

### F-04 · Drawing a line or a box is drag-only — no keyboard path
**Found:** 2026-07-30 · by Noah, on the shipped 1.0.0, and by the interaction
declaration written the same day
**Rule:** Doctrine §4 (tremor is a supported condition) / WCAG 2.2 SC 2.5.7
**Detail:** Every other manipulation in the app has a non-drag path — points,
corners, depths, the horizon. Drawing itself does not: a line and a box can only
be made by dragging on the canvas. This is declared in
[`INTERACTIONS.md`](INTERACTIONS.md) as a GAP rather than left silent, and
[`check-interactions.mjs`](check-interactions.mjs) fails the build if this finding
is ever removed from this register while the gap remains.
**Why it is a finding and not a shrug:** the guide system means a line is fully
described by an origin, a guide and a length — all three of which already have
numeric controls elsewhere in the app — so a keyboard path is buildable, not
theoretical.
**Fix (1.4.0, D34):** two toolbar buttons, **Add line** and **Add box**. Neither
invents a way to specify geometry: the line goes through the same `commitStroke` a
drag uses and arrives with its far end selected and the canvas focused; the box
goes through the same `buildBox` and lands in D31's second step, whose keyboard
path already existed. Both put the shape at the middle of the current view,
clamped into the paper, and each is one undo like any other edit.
**Gated:** a walk block that never touches the mouse — buttons activated with
Enter, lengths and depths set with arrow keys — and which counts `pointerdown`
events on the canvas and asserts **0**. It presses the arrow key that LENGTHENS
rather than a fixed direction, after an earlier version of the check drove the
distance from 200 down to its floor of 1 and passed anyway because it only
asserted that the number had changed.
**Status:** CLOSED 2026-07-30, in 1.4.0.

### F-05 · A selected corner answered no keys, and could not be dragged
**Found:** 2026-07-30 · by Noah, on the shipped 1.0.0
**Rule:** Doctrine §3 (direct manipulation) and §4 (keyboard always, SC 2.5.7)
**Detail:** Tapping a corner filled the inspector but left focus on `<body>`, and
arrow keys moved nothing — measured at `(805.3, 645.1)` before and after three
presses. Dragging it moved nothing either. So the one object the box release was
about had neither of the two paths §4 requires, and the app's own gates could not
see it: the a11y gate audits the DOM, and nothing declared that a corner was
draggable at all.
**Fix (1.1.0):** the canvas takes focus when a tap selects, arrow keys nudge the
selection (an anchor freely, a guide-riding corner along its guide, with Shift for
20px), and the same corner can be dragged with the same rule. The two paths share
one code path so they cannot disagree.
**Status:** FIXED 1.1.0. Verified: the walk drives both, and the interaction
declaration now fails the build if either disappears.

### F-06 · Half a box's corners could not be moved by any means
**Found:** 2026-07-30 · by Noah, on the shipped 1.1.0, with a screenshot
**Rule:** Doctrine §3 (direct manipulation) and §4 (keyboard always, SC 2.5.7)
**Detail:** A box's eight corners are one anchor, three that ride a guide, and
FOUR that are the crossing of two guide lines. The drag handler had branches for
the first two kinds and fell through for the third, so those four moved for no
pointer, no key and no number field. Worse than inert: the drag pushed an empty
undo step and announced "Corner at x, y" as if something had happened, so the app
reported success while doing nothing. Noah: *"The circled corners in this image
are the only corners that do anything when I drag on them ... the rest do
nothing."* He circled three of the four live ones — the fourth keeps only the
vertical part of a drag, so an off-axis grab on it also looks dead.
**Fix (1.2.0):** `manipulate()` in the solver, one entry for drag, arrow keys and
numeric fields. A crossing corner has no parameters of its own, so its position is
inverted onto the distances behind it (damped Gauss-Newton over its ray ancestors,
minimum-norm step when underdetermined). Corners are drawn as SQUARE handles now,
so what is grabbable reads at a glance rather than by scrubbing.
**Status:** FIXED 1.2.0. Verified: unit tests drive all eight corners and check
the inverse against closed-form oracles; the walk drags one of every kind through
the real UI and asserts the box survives, that ONE undo restores it, and that the
arrow keys reach the same corners by the same path.

### F-07 · The gates could not see any of this
**Found:** 2026-07-30 · while fixing F-06
**Rule:** Doctrine §6 (a gate, not an intention)
**Detail:** Before 1.2.0 `walk.mjs` never dragged a vertex of any kind — only
vanishing points. So the entire class of defect Noah reported was invisible to
every gate the app had, which is why it shipped twice.
**Fix (1.2.0):** the walk drags an anchor, a guide-riding corner and a crossing
corner through real pointer events, and asserts the geometry afterwards.
**Status:** FIXED 1.2.0. It found a real regression on its first run — a deleted
box-release branch that produced 0 edges — before that reached staging.

### F-08 · A long press started an iOS text selection on the drawing surface
**Found:** 2026-07-30 · by Noah, on 1.3.0
**Rule:** Doctrine §4 (tremor is a supported condition; no gesture may require
speed) / WCAG 2.5.2
**Detail:** `touch-action: none` stopped scrolling and pinch-zoom on the canvas,
but text selection and the callout menu are a separate mechanism and were never
disabled. A press held longer than iOS's selection delay produced a highlight and
a menu over the drawing — and a slow press is exactly how a hand that does not
move quickly begins a stroke.
**Fix (1.3.1):** `-webkit-user-select`/`user-select: none` and
`-webkit-touch-callout: none` on the app surface. Gated in the walk by asserting
the computed values, which is what the browser acts on, rather than trying to
reproduce a platform gesture headlessly.
**Status:** FIXED 1.3.1.

### F-09 · A destructive confirmation appeared far from the control it was about
**Found:** 2026-07-30 · by Noah, on 1.3.0
**Rule:** Doctrine §4 (a control's meaning must be findable) and §3 (modes
announce themselves where they are)
**Detail:** Arming the toolbar Clear put its confirmation — "Tap Clear again to
clear 2 lines and keep 2 points" — in the toast at the BOTTOM of the screen,
several hundred pixels from the button that had just changed state. The eye has
to hunt for the answer to a question it just asked, and on a wide iPad that is a
long way to hunt.
**Fix (1.3.1):** an anchored prompt positioned under the button itself, clamped to
stay on screen. Colours are the pair `.btn` already registers, so no new
foreground/background pair enters the app. Gated: the walk asserts the prompt
overlaps the button horizontally, sits within 60px below it, and is more than
200px clear of the bottom of the screen.
**Status:** FIXED 1.3.1.

### Gate verification (Doctrine §6: made to fail once before it is trusted)

**2026-07-29** — before the first commit, `--muted` was deliberately darkened
below AA in the dark theme; the gate exited **1** naming four failing pairs at
1.57:1 in the dark theme only (light untouched — correct). Reverted; the same
run also surfaced F-01 above, so the gate has caught a real defect and a
planted one. The failure paths for a missing registry selector were inherited
already proven from the hub.

**2026-07-29, the app build** — neither gate needed a planted failure to be
believed this time: both failed on real defects on their first run against the
app. The a11y gate caught an unlabelled file input (axe `label`, critical) and
a registry selector that matched nothing; the walk caught F-02 above and a
framerate failure at 2,000 edges (37.2ms per solve+frame against a 33ms bar).
All four were fixed and both gates re-run green. A gate that has failed on
something real is better evidence than one that has failed on something
planted.

**2026-07-30, the social tile** — `render-og.mjs` failed on its first two runs
without anything being planted. Run one failed all three text blocks, and the
failure was in the INSTRUMENT: it sampled each block's element box, which is as
wide as its container, so it was reading backdrop out where the sun is and no
letter is ever drawn. Fixed to sample `Range.getClientRects()` — the tight rect
per rendered line, where the ink actually is. Run two then failed for real: the
tagline, set across a wide column, ran out to x=602 and sat on the horizon glow
at **2.92:1**. Fixed by narrowing the column rather than by deepening the wash,
because a wash deep enough to cover the horizon also covers the building the
picture is of. Both facts came from the printed pixel coordinates, which is why
the script prints them.

**2026-07-30, D33's arrow (1.3.2)** — four new checks, each planted-failed
before being believed. Stubbing the drawing block to `if (false)` took the ring
count from **176 selection-coloured pixels to 0** and reddened the "really
drawn" check alone. Returning a fixed horizontal direction from the hint
reddened the alignment-to-guide check alone (cross 0 → 0.179). Drawing the arrow
**perpendicular** to the guide reddened the "every pixel lies along the guide"
check (176/176 → 0/172) while the presence check stayed green — which is the
point of having both. And dimming the dark theme's selection colour to `#1A2036`
took `npm test` from 109 pass to 108 pass / 1 fail, naming the dark theme only.

**2026-07-30, D34 and the grid (1.4.0)** — the keyboard drawing path was planted
against by returning early from both `addLineWithoutDragging` and
`addBoxWithoutDragging`: **five** checks went red (line drawn, far end selected,
length set by keys, box built and step opened, depth set by keys) and the walk
still ran to completion, because the first version of that block CRASHED on the
planted failure instead of reporting it — a gate that dies cannot tell you how
much is broken. Reverting the two grid colours to their shipped values reddened
exactly the two grid assertions and nothing else.

Two REAL defects came out of that same run, neither planted. The arrow-key check
first pressed `Shift+ArrowRight` blindly, which drove the line's distance from 200
down to its floor of **1** — and passed, because it only asserted the number had
moved by more than 20. It now derives the lengthening direction from which side
the vanishing point is on and asserts the distance GREW. And adding one toolbar
row pushed the canvas down far enough that D17's touch-to-select check missed the
line it was aiming at: that check had been converting canvas-relative coordinates
into a viewport-relative touch without adding the canvas offset, and had been
passing only because the toolbar was short enough to stay inside a 44px radius.
Both are instrument bugs found by changing something unrelated, which is the
argument for a walk that measures rather than watches.

**2026-07-30, D36/D37/D38 (1.5.0)** — planted three ways. Making `horizonLine`
ignore the `onHorizon` flag reddened one unit test and the walk's "the horizon
exists only when two points claim it". Making the top face always visible
reddened two of the three eye-level checks. Stubbing the rays block took the
switched-on pixel count from 692 to 0.

The eye-level checks found a REAL defect before any of that, and the first
instrument for them was wrong twice over. Version one sampled a single pixel at
each face's centroid: it landed on a grid line once and on the box's own ink
twice, so three checks failed against working code. Rewritten to count face
colours as AREAS across the whole canvas — a face is an area, so the honest
measurement is an area — it then showed the underside at 0 pixels at every eye
level. That was not the instrument: the base parallelogram and the two walls
share the near base edges and lie on the same side of them on screen, so painting
the base first hid it completely. The visible horizontal face is painted last now.
A third instrument problem was pure cost: shipping four million pixels across the
Playwright bridge to diff two frames timed the walk out, so the diff is computed
in the page and only the count crosses.
