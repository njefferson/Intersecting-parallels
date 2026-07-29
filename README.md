# Intersecting Parallels

**Where you stand and what you see.**

A free drawing tool for perspective construction, at
**[intersecting-parallels.pages.dev](https://intersecting-parallels.pages.dev)**.

Draw lines that are *bound* to vanishing points. Move a point and every line
bound to it re-solves, so what you have is a construction that stays coherent
rather than a set of strokes that happen to line up. Export the outline as SVG
or PNG and finish it wherever you like — Procreate, Clip Studio, Illustrator,
Affinity, Inkscape, Blender.

It is not a paint app. No brushes, no pressure, no colour. It builds geometry.

## What it is

- Free, and no account — nothing to sign up for.
- Everything stays on your device. Nothing is uploaded and there is no
  analytics; the app makes no network requests at all once it has loaded.
- Works offline. Add it to your home screen and it launches like an app.
- Built for iPad with a Pencil, and usable without one: a toggle switches
  touch from navigating to drawing, with two fingers to pan and zoom.
- Keyboard-usable throughout. Everything on the canvas is also a real control
  in the vanishing points panel, because a canvas cannot be tabbed into.

## Using it

Place a vanishing point wherever you want one — there is no limit, and they can
sit far outside the drawing; a labelled marker pins itself to the edge of the
screen so you never have to zoom out to reach one.

Draw with **Draw** and a stroke snaps to whichever guide it is closest to, or
stays exactly as you drew it if it is not close to any. Use **Place** to tap two
points instead. An endpoint that lands on an existing point merges with it, and
one that lands on an existing bound line becomes the corner those two lines
define — which is what makes a box behave like a box when you move a point.

## Running it locally

No build step. Serve `public/` with any static server:

```
npx --yes serve public      # or python3 -m http.server -d public
```

Development tooling is npm-only and never ships:

```
npm ci
npm test        # solver, snapping, export and project-file tests
npm run a11y    # the accessibility gate — exits non-zero on any failure
npm run walk    # a headless walk of the built app, start screen to offline
```

All three run in CI on every push and pull request.

## Repository

- `public/` — the deployed site. `public/app/` is the app: `solver.mjs` (the
  constraint graph), `snap.mjs` (snapping and stroke binding), `render.mjs`
  (canvas drawing), `state.mjs` (undo and persistence), `export.mjs` (SVG/PNG),
  `ui.mjs` (input and chrome).
- `NOTES.md` — the source of truth: settled design, the D1–D10 amendments,
  project facts. Read it first.
- `vpdrawingappspec.md` — the original build spec, kept verbatim. Read it
  *with* the amendments; where they disagree, the amendments win.
- `ACCESSIBILITY.md` — the append-only accessibility register.
- `CHANGELOG.md` — what changed, written for the person using the app.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE.md) — use it freely, don't sell it.

Part of [Noah Jefferson's apps](https://noahjefferson.pages.dev) ·
[accessibility statement](https://noahjefferson.pages.dev/accessibility)
