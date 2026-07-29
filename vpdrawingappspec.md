# Perspective Construction Tool — Build Spec

Handoff document for Claude Code. Target: installable PWA, static hosting, no backend.

---

## 1. Product definition

A perspective construction tool. The user places or draws lines that are **bound to vanishing points**. Moving a vanishing point re-solves and repositions every bound line. Output is a vector outline exported for finishing in another application (Procreate, Clip Studio Paint, Illustrator, Affinity, Blender).

This is **not** a paint app. No brush engine, no pressure, no raster layers, no color.

---

## 2. Locked architectural decisions

### 2.1 Storage model
Scene is a **constraint graph**, not a stroke list. Screen coordinates are derived output, recomputed on every VP change.

```
Scene {
  id, name, createdAt, modifiedAt
  canvas: { width, height }          // document px, locked at creation
  horizon: { y }                      // canvas-space
  vanishingPoints: VP[]
  vertices: Vertex[]
  edges: Edge[]
}

VP {
  id, label            // "VP1" | "VP2" | "VP3" | user string
  x, y                 // canvas-space; may lie far outside canvas bounds
  axis                 // "x" | "y" | "z" — semantic only in v1
  locked: bool         // locked VPs do not move
  onHorizon: bool      // if true, y is slaved to horizon.y
}

Vertex {
  id
  kind: "anchor" | "solved"
  x, y                 // anchor: authoritative. solved: cache, overwritten each solve
  t                    // solved only: scalar position along its defining ray
  parentVpId           // solved only: the VP whose ray defines it
  parentVertexId       // solved only: ray origin
}

Edge {
  id
  a, b                 // vertex ids
  binding              // vpId | "vertical" | "horizontal" | "free"
  style: { weight, dash }
  role: "construction" | "committed"
}
```

### 2.2 Invariant on VP move — **anchor-pinned**
When a VP moves:
- Anchor vertices do not move.
- Solved vertices are recomputed as `parentVertex + t * normalize(VP - parentVertex)`.
- Edges re-render along the new rays.

Result: geometry pivots about its anchors and stays connected, because edges share vertex IDs. `t` is stored in **normalized ray units** so length behaviour stays predictable.

Ratio-preserved mode and 3D lifting are explicitly **out of scope for v1**. Do not build hooks for them; do not let them shape the v1 data model beyond what is written above.

### 2.3 Solve order
1. Anchors are fixed.
2. Solved vertices resolve in topological order from their `parentVertexId` chain.
3. Cycles are rejected at creation time — a vertex may not be its own ancestor. Reject the operation and surface the reason; do not silently break the cycle.
4. A vertex defined by the intersection of two bound edges is stored as **solved with two parents**: position = ray/ray intersection. If the rays become parallel or divergent after a VP move, fall back to the last valid position and flag the vertex as `degenerate` in the UI (visible marker, not a modal).

### 2.4 Shared vertices are mandatory
Endpoint snapping within `SNAP_RADIUS` (default 12 canvas px, scaled by zoom) **merges into the existing vertex ID**. This is the mechanism that keeps a drawn box coherent when a VP moves. Without it, the core feature does not work.

---

## 3. Input modes

Both required. Toggle in the toolbar, remembered per project.

### 3.1 Click-to-place
Tap vertex A, tap vertex B. Live preview shows the candidate edge and its snapped ray. Simplest path to correct geometry; make it the default mode.

### 3.2 Assisted freehand (Procreate-style)
Behaviour to match:

- User drags. On pointer-down, capture the origin point.
- After the first ~10 canvas px of travel, compute the drag direction vector.
- Build the candidate set: for each unlocked VP, the ray from that VP through the origin point; plus vertical; plus horizontal.
- Score each candidate by absolute angular difference from the drag direction. Select the minimum.
- If the winning angular error exceeds `SNAP_THRESHOLD` (default 15°), fall back to `binding: "free"` — a plain straight segment.
- From the moment of selection, project every subsequent pointer position onto the chosen ray. The rendered line follows the ray, not the finger.
- Render a faint full-length ghost ray during the drag so the user sees which guide captured the stroke.
- On pointer-up, store as an `Edge` with that binding and the two endpoint vertices. **Store the binding, not the projected coordinates.**

Overrides:
- A toolbar control forces a specific VP or `free` for the next stroke, bypassing scoring.
- Assist can be switched off entirely; strokes then store as `free`.

### 3.3 Pointer handling
Use Pointer Events.
- `pointerType === "pen"` → draw.
- `pointerType === "touch"` → pan/zoom (two-finger pinch-zoom, one-finger pan). This is palm rejection.
- `pointerType === "mouse"` → draw; space-drag or middle-drag to pan.
- Ignore pressure and tilt entirely.

---

## 4. Vanishing point handling

- v1 supports **1, 2, and 3-point** setups. A project declares its count at creation and can add a third VP later.
- VPs are draggable. Dragging one triggers a full re-solve; target 60fps at 2,000 edges. If the solve exceeds one frame, decouple: solve on rAF, not on pointermove.
- VPs frequently sit far outside the canvas. Provide an **off-canvas VP handle**: when a VP is outside the viewport, pin a labelled marker to the viewport edge along the direction to that VP; dragging the marker moves the VP. Do not require the user to zoom out to reach it.
- `onHorizon: true` VPs slave their `y` to the horizon line; dragging the horizon moves them together.
- Locked VPs render differently and reject drags.

---

## 5. Export

Two artifacts, both client-side, no upload.

### 5.1 SVG (primary)
- Stroked paths, never filled.
- `viewBox` = canvas dimensions.
- Group structure, with both `id` and `inkscape:label` set on each group so importers surface readable layer names:
  - `committed`
  - `construction` (horizon, VP rays, grid) — omitted unless the user opts in
  - Optional sub-grouping of `committed` by binding: `axis-x`, `axis-y`, `vertical`, `free`
- Stroke weight from project settings; offer a hairline option (`vector-effect="non-scaling-stroke"`).

### 5.2 PNG (fallback)
Transparent background, rendered at user-selected pixel dimensions. **Required** — Procreate does not import SVG. Render via an offscreen canvas at export resolution; do not upscale the display canvas.

### 5.3 Delivery
- `Blob` + `<a download>` as the baseline path. Works everywhere including iOS Safari.
- File System Access API where available (`showSaveFilePicker`) for desktop Chromium.
- Web Share API as an additional path on iPadOS so output lands in Procreate via the share sheet.

### 5.4 Project file
`.json` matching the Scene schema in §2.1, plus a `schemaVersion` integer. This is the only reopenable artifact. **Do not implement import of the app's own SVG.**

---

## 6. Persistence

- **IndexedDB** for the project list and scene data. Not localStorage — size and synchronous blocking both disqualify it.
- Autosave on a debounced timer (2s idle) and on `visibilitychange`.
- Undo/redo as a bounded stack of constraint-graph mutations (not pixel snapshots). 100 steps.
- Explicit JSON export/import for user-controlled backup, independent of IndexedDB.

---

## 7. PWA requirements

- `manifest.webmanifest`: name, short_name, icons (192/512 + maskable), `display: standalone`, `orientation: any`, theme/background color.
- Service worker: precache the full app shell; cache-first for static assets. The app is fully offline-capable — there is nothing to fetch at runtime.
- No backend, no auth, no analytics.
- Static host (Cloudflare Pages or equivalent).
- Must be usable on iPad in standalone mode, since that is where Procreate lives.

---

## 8. Rendering

- Canvas 2D for the drawing surface. SVG DOM will not hold 60fps under VP drag with thousands of nodes; SVG is generated at export time only.
- Maintain a canvas-space ↔ screen-space transform (pan + zoom) applied at render; all stored geometry stays in canvas space.
- Redraw on: VP move, pan, zoom, edit, selection change. Not on every pointermove during a pan — coalesce with rAF.
- Draw order: grid → horizon → construction rays → committed edges → vertices → active ghost ray → handles.

---

## 9. UI surface (v1)

Minimum viable controls. Resist adding more.

- Canvas, full-bleed.
- Mode toggle: click-to-place / assisted freehand / select.
- Assist toggle: on / off, plus forced-binding picker.
- VP list: label, lock, on-horizon toggle, delete, focus.
- Horizon drag handle.
- Undo / redo.
- Export panel: SVG / PNG, include-construction checkbox, stroke weight, PNG dimensions.
- Project menu: new, open, save JSON, load JSON.

Design constraints: high-contrast line work on a neutral ground; the drawing is the interface, so chrome stays out of the way and collapses on small viewports. Guides and committed lines must be visually distinguishable at a glance without color being the only differentiator.

---

## 10. Build order

1. Scene schema + solver + unit tests on the solver (ray projection, intersection, topological solve, cycle rejection).
2. Canvas render + pan/zoom transform.
3. VP placement, drag, off-canvas handles, horizon.
4. Click-to-place edges with vertex merging.
5. VP drag → live re-solve. **This is the proof of concept. Stop and validate here before continuing.**
6. Assisted freehand with ghost ray and threshold fallback.
7. Undo/redo.
8. SVG export, then PNG export.
9. IndexedDB persistence + JSON project file.
10. Manifest + service worker + install.

---

## 11. Acceptance tests

- Draw a six-edge box in 2-point. Drag VP1 across the canvas. All shared corners remain connected; no edge detaches; no vertex jumps.
- Drag a VP to the far side of the horizon. Geometry inverts predictably; no NaN, no vanished edges.
- Freehand a stroke at 5° off a VP ray → binds to that VP. Freehand at 40° off every candidate → stores as `free`.
- Export SVG, open in Inkscape: layer names present, strokes not fills, no fill artifacts.
- Export PNG at 4000px, open in Procreate: transparent background, correct aspect ratio.
- Airplane mode, cold launch from home screen: app loads, last project opens.
- 2,000 edges: VP drag holds interactive framerate.

---

## 12. Open items for the operator

Not blocking the build. Defaults are set above; change them here if wrong.

- `SNAP_THRESHOLD` at 15° — tune against real stylus input.
- Whether curves are ever needed in-app, or always drawn downstream.
- Whether a fourth+ arbitrary VP (non-orthogonal, e.g. for a road at an angle) is wanted; the schema already permits it, the UI does not expose it.
