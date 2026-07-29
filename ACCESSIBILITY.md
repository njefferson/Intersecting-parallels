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

---

## Part 1 — What the gate enforces

- **Pages** — `public/index.html` (every deployed page joins this list in the
  same commit that adds it)
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

`index.html` — `h1` `.tag` `.lead` `.status` `.links a` `.foot` `.foot a`

**Adding a new foreground/background pair? Add it here and to the registry in
the same commit that introduces it** (§4).

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

### Gate verification (Doctrine §6: made to fail once before it is trusted)

**2026-07-29** — before the first commit, `--muted` was deliberately darkened
below AA in the dark theme; the gate exited **1** naming four failing pairs at
1.57:1 in the dark theme only (light untouched — correct). Reverted; the same
run also surfaced F-01 above, so the gate has caught a real defect and a
planted one. The failure paths for a missing registry selector were inherited
already proven from the hub.
