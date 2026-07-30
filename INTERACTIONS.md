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
- **Drag a box corner or any selected point** — added in 1.1.0
  → arrow keys once it is selected (the canvas takes focus on selection), and the
    inspector's number field: `x` / `y` for an anchored corner, a signed distance
    along the guide for a corner riding one.
- **Draw a line** (drag on the canvas)
  → not yet keyboard-drawable. **Declared gap, stated rather than hidden:** the
    guide system means a line is fully described by an origin, a guide and a
    length, so a keyboard path is possible and is the next accessibility item.
    Recorded in ACCESSIBILITY.md as an open finding, not as a pass.
- **Draw a box** (one drag)
  → same gap, same entry.

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
