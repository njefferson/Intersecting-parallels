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

Measured 2026-07-30, at the composition that shipped:
- wordmark `#F7EEDC` 72px — **9.97:1** (lightest backdrop pixel rgb(61,57,49))
- tagline `#F4CE93` 31px — **8.44:1** (rgb(50,52,48) — the left vanishing
  point's glow, showing through the wash)
- plain line `#CBD4EA` 24px — **5.10:1** (rgb(97,82,56))

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
