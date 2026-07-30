# INTERACTIONS.md — every drag and gesture, and its non-drag path

Doctrine §4 requires this, in its own words: *"DECLARE IT, so it is a gate and not
an intention. Each app declares its drag and gesture interactions alongside the
non-drag control satisfying each one. A declared interaction with no declared
alternative FAILS the build, and a declaration that matches nothing FAILS rather
than being skipped."*

It did not exist until 1.1.0, and its absence is exactly why Noah found two of
these missing on the shipped V1: a box corner could not be dragged at all, and a
selected corner answered no keys. **Tremor is a supported condition** — a
drag-only interaction is a broken interaction (WCAG 2.2 SC 2.5.7), and a
multi-point gesture with no single-pointer alternative is another (SC 2.5.1).

The machine-readable copy lives in `interactions.mjs` and
[`check-interactions.mjs`](check-interactions.mjs) (`npm run interactions`)
enforces it: every entry needs at least one alternative, every selector named must
exist in the built page, and every alternative must be reachable by keyboard.

---

## Drags

- **Drag a vanishing point** (canvas, and its off-screen marker)
  → arrow keys on the point's panel button or on its marker (Shift for 20px),
    and exact `x` / `y` number fields in the Vanishing points panel.
- **Drag ANY corner** — 1.1.0 for anchors and guide-riding corners, 1.2.0 for
  corners where two guides cross
  → arrow keys once it is selected (the canvas takes focus on selection), and the
    inspector's number fields: `x` / `y` for an anchored corner, a signed distance
    along the guide for a corner riding one, and for a crossing corner the
    distances it is built from.
    All three paths go through one `manipulate()` in the solver. They were three
    code paths and had already drifted apart once — a corner that could not be
    dragged also could not be nudged, and neither gap could see the other
    (ACCESSIBILITY F-05, then F-06).
- **Draw a line** (drag on the canvas)
  → not yet keyboard-drawable. **Declared gap, stated rather than hidden:** the
    guide system means a line is fully described by an origin, a guide and a
    length, so a keyboard path is possible and is the next accessibility item.
    Recorded in ACCESSIBILITY.md as an open finding, not as a pass.
- **Draw a box** — FIRST drag (height, and depth toward the point you drag toward)
  → same gap as drawing a line, same entry (F-04).
- **Finish a box** — SECOND step, D31. The remaining depth is live the moment the
  first drag releases: drag anywhere, with no handle to find and no mode to pick.
  → the corner is pre-selected, so the arrow keys set that depth with no drag;
    its distance is also a number field in the Points panel; and Done, Escape or
    switching tools all end the step, always KEEPING the box.
    Nothing about it is timed (§4), and it never commits anything by itself.

## Multi-point gestures

- **Pinch to zoom** → the zoom controls in the toolbar (`−`, `+`, `Fit`), each a
  44px button, each keyboard reachable.
- **Two-finger pan** → the same zoom controls plus `Fit`, which frames the whole
  drawing; and with the panel open, moving a point by number scrolls nothing —
  the view follows the geometry rather than the finger.

## Rules that apply to all of them

- **Nothing commits on pointer-down** (SC 2.5.2). Every gesture above acts on
  pointer-up, and a pointer that leaves before release cancels it.
- **No timed gestures** (SC 2.2.1). Nothing requires a double-tap or a press-and-
  hold. The one timed thing in the app — the armed Clear expiring after six
  seconds — expires INTO SAFETY: it cancels, it never commits.
- **Snapping is an accessibility feature.** `SNAP_RADIUS` and the 44px handle
  radius absorb wobble, and the guide set is chosen to always catch a stroke
  rather than to require accuracy (D18).
