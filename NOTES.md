# NOTES.md — Intersecting Parallels

The repo's source of truth (Doctrine §12): thesis, settled decisions, Project
facts, and what is waiting on Noah. Read it first, every session. The design
below was decided in the session of 2026-07-29 and committed here as this
file's first content, per the handoff.

---

## Status — updated 2026-07-29 (bootstrap session)

**Done by the bootstrap session:**
- Repo bootstrapped per Doctrine §13: `CLAUDE.md`, `LICENSE.md` (PolyForm
  Noncommercial 1.0.0), this file, `ACCESSIBILITY.md`, branches `staging` and
  `main`.
- Accessibility gate ported from the hub (`a11y-gate.mjs` +
  `.github/workflows/a11y.yml`), registry seeded for the placeholder page,
  broken once to prove it fails (Doctrine §6) — record in ACCESSIBILITY.md.
- Cloudflare Pages deploys wired (`.github/workflows/deploy.yml`): `main` →
  production, `staging` → preview. Secrets were already in the repo.
- An honest placeholder page at `public/index.html` — name, tagline, "in
  design, nothing to use yet", links back to the hub and the shared
  accessibility statement.

**BLOCKER CLEARED 2026-07-29:** Noah uploaded `vpdrawingappspec.md` later the
same day (it had never reached the bootstrap session's uploads — a Drive and
repo search confirmed no other copy existed anywhere reachable). Committed here
verbatim, next to this file. Every section the D1–D10 amendments cite is where
they said it was. Read the spec WITH the amendments; where they disagree, the
amendments win.

**BUILD ORDER STEPS 1–10 ALL DONE (2026-07-29).** The full product is built
and on `staging`, awaiting Noah's single aggregate pass. What each step became:

1. Scene schema + solver + unit tests — `public/app/solver.mjs`,
   `test/solver.test.mjs`.
2. Canvas render + pan/zoom transform — `public/app/render.mjs`.
3. VP placement, drag, off-canvas handles, horizon — `render.mjs` + `ui.mjs`.
4. Click-to-place edges with vertex merging — `public/app/snap.mjs` (D2's
   endpoint precedence lives here).
5. VP drag → live re-solve. **The proof of concept.** It works; the aggregate
   handoff below is the "stop and validate" this step asks for.
6. Assisted freehand with ghost ray and threshold fallback — `snap.mjs` +
   `ui.mjs`.
7. Undo/redo, one gesture one step — `public/app/state.mjs` (D7).
8. SVG then PNG export — `public/app/export.mjs` (D9's namespace and ceiling).
9. IndexedDB persistence + JSON project file — `state.mjs`.
10. Manifest + service worker + install — `manifest.webmanifest`, `sw.js`.

**Gates, all three green, all three run by CI on the same entry points a
session runs locally:**
- `npm test` — 38 tests (solver, snapping and D2 precedence, export, project
  validation, undo). Made to fail twice against broken solvers before trusted.
- `npm run a11y` — the app in four surfaces (canvas + three dialogs), both
  themes, two viewports. It now SERVES `public/` over HTTP, because ES modules
  cannot load from `file://` and the old file:// scan would have measured a
  blank page.
- `npm run walk` — 33 checks driving the real app: draw, drag, undo, keyboard
  nudge, export, reload, offline cold launch, 2,000 edges under drag, and an
  assertion that no request ever leaves the origin.

**What the gates caught before anything shipped** (recorded because a green
tree that never went red proves nothing — hub LESSONS 7d): an unlabelled file
input; a registry selector matching nothing; arrow-key nudge working exactly
once because the panel rebuilt the DOM under the reader's focus (ACCESSIBILITY
F-02); an off-screen VP marker covering the panel (F-03); and a real
performance failure — 37.2ms per solve+frame at 2,000 edges against a 33ms
bar. The performance fix was the algorithm, not the threshold (Doctrine §14):
the topological solve was O(n²) with a linear id lookup inside it and is now
Kahn's algorithm over an index built once, the renderer batches edges by style
into one path per style instead of 2,000 draw calls, and VP drags apply on rAF
rather than per pointer event (§4's own instruction). Median went 37.2ms →
21.3ms, worst 65.2ms → 29.4ms.

**Deliberate decisions a later session should not "clean up":**
- `window.__ip` ships. It is the hook `walk.mjs` uses to drive the REAL page
  rather than a rebuilt approximation of it. The app holds no secrets and
  talks to no server, so it exposes nothing a reader could not already read.
- The CSP in `public/_headers` was widened DELIBERATELY when the app replaced
  the placeholder — `script-src 'self'` with no `'unsafe-inline'`, because
  every line of script is in a file. The reasoning is in the file itself.
- `.empty` is not in the a11y registry; its colour pair is covered by `.hint`.
  See ACCESSIBILITY.md for why registering it would make the gate flaky.

**Name checks: ALL CLEAR.** The App Store and USPTO checks are done — Noah ran
them himself and reported the name checked (2026-07-29, "I already checked the
name"). With pages.dev settled by the first deploy, nothing about the name
remains open.

**Working agreement (Noah, 2026-07-29):** build the FULL product without
stopping at each staging promote; only stop when a decision is needed from him.
He tests the AGGREGATE once, on staging on his iPad, before it becomes V1.
Until that pass: all app work lands on `staging`; `main` keeps the placeholder
(docs may still land on `main`). The single staging handoff at the end IS the
Doctrine §7 gate for this build — one gate, his call, not skipped.

**Waiting on Noah — the aggregate pass, on staging, on his iPad.** This is the
one decision point of the build, and the Doctrine §7 gate for all of it.
https://staging.intersecting-parallels.pages.dev

UNTESTED until he does it, and labelled so honestly (Doctrine §5) — every one
of these needs his hands and none can be checked from this sandbox:
- Apple Pencil feel, and whether `SNAP_THRESHOLD` at 15° is right (§12 says
  tune it against real stylus input; nothing here can).
- Palm rejection in practice with the touch-draws toggle both off and on.
- Two-finger pan and pinch on real glass.
- PNG export opened in Procreate (transparent background, aspect ratio) and the
  real iOS canvas ceiling — the app probes it at runtime, but that probe has
  only ever run in headless Chromium.
- SVG opened in Inkscape: layer names present, strokes not fills.
- Add to Home Screen, then airplane-mode cold launch on the device itself.
- Whether the drawing surface is legible in daylight, and the panel usable at
  his text size.

**SETTLED 2026-07-29: `intersecting-parallels.pages.dev` was free.** The first
deploy run created the Pages project ("Successfully created the
'intersecting-parallels' project", staging deploy log, 17:27 UTC) — creation
would have failed had anyone held the name. It is now Noah's. Of the three
device-blocked name checks in the handoff, only App Store and USPTO remain.

**Repo metadata (Doctrine §10, Noah's manual GitHub-UI step, unconfirmed):**
- Description: `Where you stand and what you see.`
- Website: `https://intersecting-parallels.pages.dev`
- Topics (suggested): `perspective` · `drawing-tool` · `vanishing-points` ·
  `pwa` · `offline-first`
- Social preview: none yet — it comes with the app's real artwork, not before.

**Hub link:** lands only once the app is actually live (bootstrap step 5). The
placeholder linking back to the hub is fine; the hub does not link out yet.

---

## Project facts

- Cloudflare Pages project `intersecting-parallels`, production branch `main`.
  Production: https://intersecting-parallels.pages.dev — staging previews:
  https://staging.intersecting-parallels.pages.dev. A Pages project with no
  production deployment serves broken previews (hub LESSONS 7c), so production
  deployed first.
- Repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. The deploy
  workflow strips whitespace and masks before use (Cloudflare 6111), and routes
  cleaned values through job env, never step outputs (Doctrine §16.4).
- KNOWN MISLEADING INSTRUMENT: the workflow's "Verify cleaned token" step
  reports `Invalid API Token` from `/client/v4/user/tokens/verify` for this
  token, while every real Pages call succeeds — that endpoint validates
  user-level tokens and this one is account-scoped. The deploy succeeding is
  the proof; do not "fix" the token because of that step (both deploys of
  2026-07-29 show exactly this pattern).
- First deploys, 2026-07-29, both verified in Actions logs: production
  deployment `ea46953e` on `main`, preview `ddf242fd` aliased to
  `staging.intersecting-parallels.pages.dev`. The a11y gate ran green in CI on
  both branches the same day.
- Branches: `staging` and `main` only; harness `claude/*` designations ignored
  (Doctrine §11).
- Gate: `a11y-gate.mjs` — locally `npm run a11y`, in CI the same file. New
  fg/bg pair → registry, same commit. Register: `ACCESSIBILITY.md`.
- Persistence (D7, so no later session assumes otherwise): **drawing state
  persists across sessions; undo history does not.**

---

# The design as decided — handoff of 2026-07-29

Everything below is the resolved design, not code. Nothing has been built
beyond the bootstrap above.

## The name

**Intersecting Parallels.** Decided by Noah, 2026-07-29.

Clean on GitHub (zero repos), npm (`intersecting-parallels` free), and every
company and software search. Still to run on Noah's own device, since the
sandbox gateway refuses CONNECT to them: App Store, USPTO, and whether
`intersecting-parallels.pages.dev` is free.

Known and accepted: Hadi Hosri's photography book *Intersecting Parallels* uses
the phrase for the same phenomenon. Not a mark in software, different class, and
the shared meaning is the point — the phrase is the true description, which is
why two people reached it independently. Also accepted: no short form, and the
initialism IP is unusable. Noah's call, made knowingly.

### Graveyard, with causes of death

Kept so a candidate can be reconsidered and so the causes stay available as
design constraints — they are not a proof the space is empty.

- Moving Perspective — available; "perspective" is the spec's own vocabulary.
- Block-in — `blockin.app` is a figure-drawing toolkit. Same audience.
- Sightline — SightLine Applications, Sightline by Consilio.
- Linework — Linework tattoo studio software, plus a fintech.
- Underdraw — registry-clear; reads aloud as *insufficiently drawn*.
- POV-preview — POV-Ray trademark, hyphenated `POV-` construction, adjacent field.
- Point of Vanishing — free; reads as Bag of Holding.
- Horizon Lines / Bring Me the Horizon — `horizon` is spec vocabulary, collides
  with Clear Horizons, and the second is a multi-platinum band.
- Perspective Tester / Verifier — QA-software register; the app doesn't test.
- Pinching Lines — `pinch` is spec vocabulary (§3.3 two-finger zoom).
- Converging Lines — Converging Lines Corp. Grep-clean otherwise.
- Where Does It All Go / See What You See — free; a question and a tautology.
- Swysh — Swysh Tech Pty Ltd ships two apps under that exact spelling; and
  aloud it is Swish, Sweden's dominant payment app.
- Vantage + Viewer / Construction / Set / Tool / Mover — five failures in the
  same class. Vantage is the only distinctive element and it is claimed
  repeatedly (Trimble's registered mark, Lenovo, VantageScore, vantage.sh);
  every second word was either a pure generic or handed the name to another
  industry. Doctrine §14: the frame was the bug, not the noun.
- Artist Mover — Artists Movers, a real removals company.
- Unparallel / Unparallel Lines — Unparallel Sports (climbing shoes),
  unparallel.com (an agency doing apps), Unparalleled Apps LLC.
- Drawing Construct — Construct 3 by Scirra, browser-based creative tool.
- WyS-a-WyS — unheld, but unpronounceable on sight; the WYSIWYG family points
  at document editors.
- Reality Grid — RealityGrid holds the GitHub org outright.
- Parallax — the precise word for the phenomenon, and thoroughly taken.
- Mopar — Chrysler.
- Spicy Parallels — free; *neurospicy* is majority-disliked inside the ND
  community (Tumblr poll, 1,456 responses: 3/5 negative, 1/5 positive) and
  would signal an ND tool this isn't, against goodwill ND Toolbox earned.
- Tangential Parallels — free, and structurally sound. Live alternative.

### The tagline, worth keeping regardless

**"Where you stand and what you see."** Says what the app IS in seven words,
uses none of the spec's claimed vocabulary, and stays true as features change —
which is exactly what Doctrine §10 wants from a repo description.

---

## Resolved spec — amendments to `vpdrawingappspec.md`

The spec is sound. These are the contradictions and gaps found reading it
against DOCTRINE.md and LESSONS.md.

### D1. `Vertex` becomes a discriminated union

§2.3.4 requires a vertex "solved with two parents", but §2.1 gives singular
`parentVpId` / `parentVertexId` and one scalar `t`, and no field for the
`degenerate` flag it also requires. The schema cannot represent what the solver
is told to do.

```
Binding = { vpId: string } | "vertical" | "horizontal"
RayDef  = { origin: vertexId, binding: Binding }

Vertex =
  | { id, kind: "anchor",    x, y }
  | { id, kind: "ray",       x, y, origin: vertexId, binding: Binding, t, degenerate }
  | { id, kind: "intersect", x, y, defs: [RayDef, RayDef], degenerate }
```

`Binding` is the same vocabulary as `Edge.binding`. Today's `parentVpId` can only
name a VP, which makes "drop a vertical from a receding edge" — the commonest
move in 2-point — unrepresentable. That is a functional gap, not a tidy-up.

`t` exists only on `ray`, signed (see D3). No `lastValid` field: on a failed
solve the solver leaves `x,y` untouched and sets `degenerate`, and `x,y` is
already the last-valid cache §2.3.4 asks to fall back to. Cycle rejection walks
`origin` and `defs[].origin`, rejects at creation with a surfaced reason.

### D2. Keep normalized `t`; add the intersect-on-snap rule

The standard for a construction tool (SolveSpace, FreeCAD Sketcher) is that
constructed points are determined by their constraints, not parameterized. The
spec has both mechanisms and never says which the drawing flow produces. As
written every corner is a `ray` vertex riding a circle of radius `|t|` about its
origin, so segment lengths lock and a VP drag only re-aims — connected, but
rigid.

Endpoint precedence at placement, applied at build-order step 4:

1. Merge into an existing vertex within `SNAP_RADIUS` (§2.4).
2. Otherwise intersect an existing bound edge within `SNAP_RADIUS`.
3. Otherwise create a `ray` vertex.

The box in acceptance test 1 then becomes mostly intersection-defined, so VP drag
reads as perspective rather than rotation, while a free endpoint keeps its
authored length.

### D3. A binding is a line, not a ray; side resolved by continuity

`normalize(VP − origin)` flips 180° the moment a VP crosses an origin — the
discontinuity behind "geometry inverts predictably" (§11) having no statable pass
condition. Every drawing app's perspective guide (Illustrator, Clip Studio,
Procreate) is a full line through the VP, with no direction.

`position = origin + s · |t| · unit(VP − origin)`, with `s ∈ {+1, −1}` chosen to
minimise displacement from the previous solve. Cold load uses `sign(t)`, so `t`
is stored signed and reload is deterministic. The crossing becomes continuous.

### D4. Degeneracy guards — the "no NaN" acceptance test

- Coincident: `|VP − origin| ≤ EPS_LEN`, `EPS_LEN = 1e-6 × canvas diagonal`.
  Relative, so it survives any document size.
- Parallel: `|cross(u₁, u₂)| ≤ 1e-9` on unit vectors — scale-invariant.
- Divergent is **not** degenerate. An intersection behind both origins is
  legitimate geometry (a VP behind the viewer). Flag only coincident and
  parallel, or the canvas fills with false markers.
- Property test fuzzes VP positions across the plane including exactly onto
  anchors, asserting finite output always — and is made to fail once before it
  is trusted (Doctrine §6).

### D5. Touch-draws toggle — in

Default matches §3.3 unchanged: pen draws, touch pans and zooms. Toggle on:
touch draws, and navigation becomes two-finger only (pinch to zoom, two-finger
drag to pan) — the Procreate and Clip Studio convention. Standing mode indicator
with an obvious exit (Doctrine §3). This is accessibility as much as preference:
without it the app is unusable on any iPad without a Pencil.

### D6. The accessibility surface exists by design, not retrofit

Every interactive object in the spec lives inside a canvas: untabbable, no focus
ring, no target size, invisible to axe. Default state is a hard fail of §4.

- The VP list (already in spec §9) becomes the real control surface: a `<button>`
  per VP with focus-visible, arrow-key nudge, numeric x/y entry. Same for a
  selected vertex or edge inspector.
- 44px hit radii on handles and off-canvas markers; the drawn dot stays small,
  the hit area does not.
- Type in `rem`. Panels measured against the space they have at the moment they
  open, never a constant, and no floor that can exceed its container.
- Guides and committed lines differ by weight and dash, not hue.
- Port hub `a11y-gate.mjs`: exits non-zero, every deployed page, both themes,
  ≥2 viewports including narrow-phone-at-200%-text. Broken once to prove it fails.
  *(Done in bootstrap — see Status above and ACCESSIBILITY.md.)*

### D7. Undo granularity

One gesture, one undo step (Doctrine §3): a VP drag coalesces to a single entry
on pointerup, not one per rAF sample. Stack is 100 constraint-graph mutations.
**State persists across sessions; history does not** — stated here so no later
session assumes otherwise.

### D8. Spec §12 open items — REVISED

`SNAP_THRESHOLD` 15°, tunable once Noah has stylus time. No curves in v1.

**Arbitrary VPs are exposed in the UI.** §12 left this open and the first pass
defaulted it off; Noah corrected that on 2026-07-29. `vanishingPoints` is already
an uncapped array and §2.1 already allows coordinates far outside canvas bounds,
so the schema needs nothing. No cap at three: a VP can be added wherever one is
wanted, including non-orthogonal ones (a road running off at its own angle). The
off-canvas edge markers of §4 carry labels, which is what keeps many off-screen
VPs legible.

### D9. Export corrections

- Declare `xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"` on the
  root `<svg>`, or `inkscape:label` is invalid and silently ignored — which reads
  as the layer-name acceptance test failing for no visible reason.
- PNG: probe the real canvas ceiling on Noah's iPad before offering dimensions,
  and clamp with an honest message rather than emitting the blank image iOS
  produces past the limit (Doctrine §5).

### D10. Family conventions the spec doesn't know about

PolyForm Noncommercial 1.0.0. `staging` and `main` only, harness `claude/*`
branch ignored. `version.capability.iteration` carried by the service-worker
cache name and the changelog together; releases have no names. `_headers`
security headers. Actions pinned by commit SHA. `npm ci` with a committed
lockfile. No `innerHTML` concatenation. Service-worker updates never touch
IndexedDB.

**Deploy from build-order step 2, not step 10.** Step 5 ("stop and validate") is
a staging handoff onto Noah's iPad, so the app must be reachable at a preview URL
long before the manifest exists. *(Deploy pipeline already live from bootstrap.)*

---

## Verified vs needs Noah's hands

Machine-verifiable, headless: solver unit tests (projection, intersection,
topological order, cycle rejection, D3 continuity, D4 degeneracy), acceptance
tests 1 and 2 driven against the solver, SVG structure, the a11y gate, and the
2,000-edge framerate once a renderer exists.

Needs his device, and must be labelled UNTESTED until then: Procreate PNG import,
Inkscape open, iPad standalone airplane-mode cold launch, real stylus
`SNAP_THRESHOLD` feel, and the iOS canvas ceiling in D9.

---

## Bootstrap order (Doctrine §13) — as run

1. ~~Noah creates the repo~~ — done (as `njefferson/Intersecting-parallels`;
   capital I, which changes nothing — GitHub URLs are case-insensitive and the
   Pages project is lowercase).
2. ~~Session with both repos selected~~ — this session, 2026-07-29.
3. ~~CLAUDE.md, LICENSE, NOTES.md, ACCESSIBILITY.md, `staging` and `main`~~ —
   done, and the spec landed later the same day, so build-order step 1 is
   done too (see Status).
4. Repo metadata — Noah's manual GitHub-UI step, values in Status, unconfirmed.
5. The hub link lands only once the app is actually live. Not yet.
