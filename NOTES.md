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
4. Click-to-place edges — `public/app/snap.mjs`. D2's endpoint precedence lives
   here but is now OFF at Noah's instruction: see D16.
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
- `npm test` — 61 tests (solver, snapping, D11 guide ranking, D12 binding
  honesty, D16 the closed guide set and no endpoint anchoring, export, project
  validation, undo). Every new block was made to fail against the unfixed code
  before it was trusted.
- `npm run a11y` — the app in four surfaces (canvas + three dialogs), both
  themes, two viewports. It now SERVES `public/` over HTTP, because ES modules
  cannot load from `file://` and the old file:// scan would have measured a
  blank page.
- `npm run walk` — 43 checks driving the real app: draw, drag, undo, keyboard
  nudge, export, reload, offline cold launch, 2,000 edges under drag, an
  assertion that no request ever leaves the origin, and — since 0.1.1 — that a
  finger aimed at a vanishing point produces lines that MEASURABLY converge on
  it (0.000px), drawn with real touch events.

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

**Post-report audit, 2026-07-29 (Doctrine §14).** Noah found the D11 defect on
his device, which makes the next handoff require an exhaustive adversarial pass
first — "Noah is never the test bench". That pass found D12 by measurement
before it was ever reported, and separately confirmed by probe that SVG layer
grouping and cold-reload determinism (D3) both still hold. Two defects of one
class — a stored label diverging from the geometry — are now both closed, and
the walk asserts the geometry rather than the label.

**PROMOTED TO PRODUCTION 2026-07-30 — 1.0.0. THIS IS V1.** Fifth and final promote
of the build. Noah asked for Clear in the toolbar (D25), then said *"This is now
version 1"*, then *"Promote"*. `main` fast-forwarded to `staging` at `b300903` — no
merge commit, the identical tree.

All four workflows verified green on that exact SHA on `staging` BEFORE the merge,
and all four re-ran green on `main` after it: Deploy, Accessibility gate, Solver
tests, App walk (runs 30515691985 / 30515691988 / 30515691986 / 30515691975). The
production deploy was watched to `completed / success`, and then — the part that
needed patience — this record was held until the a11y and walk runs on `main` had
finished too, because a push to `main` starts fresh runs and the concurrency group
would have cancelled the ones still in flight. That is the hub lesson about a
watched run being killed by your own next push, applied instead of re-learned.

Gates at 1.0.0: 89 unit tests, a11y PASS (four surfaces × two themes × two
viewports), walk 65 checks including offline cold launch.

Standing caveat, unchanged and worth keeping in the record: this sandbox cannot read
pages.dev (the agent proxy returns `CONNECT tunnel failed, response 403`), so the
evidence is a successful wrangler deploy of this tree rather than a page anyone
fetched. The on-screen stamp reading 1.0.0 on Noah's iPad is what closes that gap,
which is why §7b puts it there.

**V1 DECLARED BY NOAH, 2026-07-30.** *"This is now version 1."* The first slot of
the triplet is his to set (Doctrine §7) and he set it: this build is
**1.0.0**, and it is 0.6.1 plus D25 — nothing was added to earn the number. What
the app is at 1.0.0: vanishing points, lines that stay locked to them, a box in one
drag with both depths, welding as a choice, any corner settable exactly, undo per
gesture, clear the screen, SVG and PNG export, no account and no network.

**PROMOTED TO PRODUCTION 2026-07-30 — 0.6.1.** Fourth promote, carrying two
releases: 0.6.0 (the Weld toggle D22, two depths from one box drag and editable
corners D23) and 0.6.1 (clearing the screen, D24). Noah said **"Promote"** and
`main` fast-forwarded to `staging` at `312f648` — no merge commit, the identical
tree. All four workflows verified green on that exact SHA before the merge: Deploy,
Accessibility gate, Solver tests, App walk. Gates at that SHA: 89 tests, a11y PASS,
walk 59 checks. The production deploy (run 30514949074) was watched to
`completed / success` before this record was pushed.

Both of the roadmap's open product items are now closed, and both were closed with
a correction attached rather than quietly: the welding item was stale (D20 had
already restored joining — what was missing was the choice), and D21's claim that
box corners were "adjustable afterwards" was true of the data model and false of
the app until D23 made it true.

**PROMOTED TO PRODUCTION 2026-07-30 — 0.5.2.** Third promote. New icon and social
tile, both drawn through a real three-point camera rather than generated (see "The
artwork is computed" above). Noah chose the shifted-right tile and the wider icon
window, said **"Promote"**, and `main` fast-forwarded to `staging` at `d144f58` —
no merge commit, the identical tree he looked at. All four workflows verified green
on that exact SHA before the merge: Deploy, Accessibility gate, Solver tests, App
walk. The production deploy (run 30512606936) was watched to `completed / success`
before this record was pushed — the hub LESSONS rule about not pushing again
between "pushed" and "green".

The deploy run IS the evidence here, because this sandbox cannot read the deployed
site: the agent proxy answers `CONNECT tunnel failed, response 403` for
pages.dev. So "production serves 0.5.2" is a claim about a successful wrangler
deploy of this tree, not about a page anyone fetched. Noah's own screenshot of the
version stamp is the only thing that closes that gap, which is exactly why the
stamp is on screen (Doctrine §7b).

**PROMOTED TO PRODUCTION 2026-07-29 — 0.5.0.** Second promote of the day. Noah
drew a cube on 0.3.0, watched it come apart under a VP drag, and asked for two
things: boxes as a tool, and line ends that connect. Both landed as 0.5.0 (with
0.4.0's no-plain-lines and mid-stroke guide switching in between), all four
workflows green on `0328e85` before the merge, and he said **"Promote"**.
`main` fast-forwarded — no merge commit, the identical tree he tested.

**Shipped since 0.3.0:**
- 0.4.0 — no stroke ever comes back unguided (D18); the guide can be switched
  mid-stroke with hysteresis instead of a lock (D19).
- 0.5.0 — line ends join again, along the guide and never off it (D20); Box
  mode builds a fully constrained twelve-edge box from one drag (D21).

**The earlier 0.3.0 promote, kept for the record:** Noah tested the aggregate on his
iPad, reported two defects (D11's non-converging lines, then D16's unasked-for
anchoring, then D17's undeletable lines and points), each was fixed and
re-staged, and he said **"Promote"**. `main` fast-forwarded to `staging` at
`c4bd5b4`, all four workflows green on that SHA before the merge. Live at
https://intersecting-parallels.pages.dev

**Shipped in 0.3.0 (the aggregate of the whole build):** the solver and its
constraint graph; canvas render with pan and zoom; VP placement, drag,
off-canvas markers and horizon; click-to-place and assisted freehand drawing;
undo/redo one step per gesture; SVG and PNG export; IndexedDB persistence and
JSON project files; installable PWA that cold-launches offline. Plus everything
his device found: the closed guide set (D16), guides drawn to follow rather
than aimed at (D15), a trustworthy direction sample (D13), honest bindings
(D12), guide ranking that prefers a vanishing point (D11), deletion that works
and never moves the drawing (D17), and the on-screen build stamp.

**Hub link: DONE.** The hub tile and its noscript fallback both link out, with
the icon Noah drew (hub commit `69294bc`). That was the last item of the
bootstrap order.

**Next candidate work — nothing is staged, the roadmap is honestly empty.** What
is known to be open, in his words, not invented:
- ~~The welding toggle.~~ **DONE 2026-07-30 as D22** — and note the item was
  stale: D20 had already restored joining, so what was actually missing was the
  CHOICE. It is a toolbar button now, default on.
- ~~The icon's white rounded corners.~~ **DONE 2026-07-30** — fixed as a side
  effect of 0.5.2: the maskable icon is a wider window on the same scene instead
  of the art shrunk onto a flat pad, so there is no pad left to show white.
- `SNAP_THRESHOLD` against a real Apple Pencil (§12 asks for exactly this and
  nothing in this sandbox can do it).

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

**Artwork, supplied by Noah 2026-07-29.** Two wordless images (Doctrine §3 —
no lettering inside generated imagery): a designed rounded app icon and a
full-bleed banner. Both live in the upload; the derived files are committed.
The icon drives `icon-192`, `icon-512` and `apple-touch-icon`; the BANNER drives
`icon-maskable-512` and `og.png`, because a maskable icon a launcher crops into
must not have white corners. Every crop is cover-fit and centred, never
stretched. Open question for Noah, cosmetic: his icon's rounded corners are
white, and iOS rounds again on top of that, so a hair of white can show at the
home-screen corners — say the word and the navy gets bled out to the edge.

**Repo metadata (Doctrine §10) — COMPLETE, confirmed by Noah 2026-07-30.**
He set the fields himself and said "Metadata complete". Three of the four were then
read back from the GitHub API rather than taken on trust, and are recorded here as
what is actually live:

- Description: `Free perspective drawing — set vanishing points, draw lines that stay locked to them. Offline, no account.`
  (verified via API). This replaced `Where you stand and what you see.`, which he
  rejected — *"That description sucks"* — correctly: that line is the tagline, and it
  was already in `<title>`, `og:title`, `twitter:title`, the About panel and the
  README's first line, while the description is read in search results where the
  only question is what this is. A candidate naming Box mode was dropped before it
  reached him, because §10 says the description is what the app IS, never the
  current feature.
- Website: `https://intersecting-parallels.pages.dev` (verified via API).
- Topics: `drawing-tool` `offline-first` `perspective` `pwa` `vanishing-points`
  — all five, verified via API.
- Social preview: `public/og.png`, the 0.5.2 city tile. **Noah's word only** — the
  social-preview image is not exposed by the repository API, so unlike the other
  three this one is not independently verified here. It is not in doubt; it is
  simply a different kind of evidence, and the difference is worth keeping straight.

Nothing about repo metadata is outstanding. If the tile is ever regenerated, the
upload is a fresh manual step — GitHub keeps its own copy and does not follow the
file in the repo.

### The artwork is computed, not generated (2026-07-30, 0.5.2)

Noah redid the icon and tile himself, then hit the wall: *"It CANNOT draw in 3
point perspective."* Three rounds of prompting an image model produced pictures
with both horizon points drawn, a third point drawn, and every vertical edge
PARALLEL — so the third point was decoration. Then: *"I want what I have now, but
with proper lines following the 3rd vp."*

So the art is now solved rather than described. `art/scene.mjs` +
[`render-art.mjs`](render-art.mjs) (`npm run render:art`):

- **The camera is derived from the three vanishing points.** The principal point
  is the ORTHOCENTRE of their triangle and f² = -(A-P)·(B-P). Every line drawn is
  a projected 3D edge, so convergence is a consequence, not an aim.
- **His wide layout was impossible and the tool says so.** Horizon points 1076px
  apart with the third point 502px below gives f² = -43,002. The condition is
  d > s: the third point must be farther out than half the horizon spread. His own
  hand-drawn reference sits just inside it, d=835 to s=795. `cameraFrom()` refuses
  the impossible case and names both exits ("44px closer together, or 44px farther
  out") rather than drawing something inconsistent.
- **Two numbers are printed per point, every run**: worst perpendicular miss
  (~1e-13px) and the family's angular SPREAD (27-77°). Both are needed — parallel
  lines miss a distant point by very little, which is exactly how the generated
  art would have passed. Proven by reinstating the bug: 208.16px and 0.00°.
- **The icon IS the tile**, seen through a square window in scene coordinates
  (Noah: *"Could the icon not just be a crop of the social review tile?"*). Not a
  crop of the pixels — the horizon points are 662px apart and the tile is 630px
  tall, so no square region of the raster holds both. Same camera, same numbers,
  more sky. Two separately framed scenes had disagreed about the perspective,
  which is what he spotted.
- **Chosen 2026-07-30:** the shifted-right tile (nadir in frame at 556, horizon
  points 431/1093, f=234px) and the WIDER icon window (both horizon points inside
  the middle 80%, so a launcher's maskable crop keeps them). The maskable icon is
  a third, wider window rather than a shrunk copy on a flat pad — which is also
  the fix for the white corners the old icon had.
- **Composition is tuned against printed measurements**, not impressions: the
  tallest tower's top in screen pixels (flagged when it leaves the frame — caught
  at -95px and again at 440px above the horizon), which lots paint outside a given
  window and by how much, and a point-in-polygon test for whether a building is
  hiding the third vanishing point (it was: lot -1,-2).
- **Noah's standing note on it:** *"Extreme perspective is FINE! It's the
  point!"* Do not soften the lens or push the city back to tame the foreground.
  Buy composure with LAYOUT — empty lots, narrower footprints, height that runs
  with distance — never by making the perspective milder.

**Known flake (2026-07-30):** one `npm run a11y` run failed with "the app did not
finish booting within 10s" on the export surface, and the immediately following
run passed clean. Nothing in that commit touches boot. Most likely the 10s budget
under a sandbox busy with several Chromium instances. Worth a look if it recurs —
a gate that flakes is a gate that gets ignored.

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

### D20. Line ends join again — along the guide, never off it

**Noah, 2026-07-29, with two screenshots of a cube coming apart under a VP
drag:** *"Being unable to connect line ends means everything breaks when you do
adjustments."* He is right, and it is the consequence flagged when D16 took
joining out wholesale.

D16 and this only look contradictory until the two things it conflated are
separated:
- a **guide** decides a line's **DIRECTION** — still only a vanishing point,
  vertical, horizontal or the optional 45° pair, exactly as D16 says;
- **joining** decides only **WHERE ALONG** that direction the line ends.

The old behaviour broke that: it merged an end into any nearby point even when
the point was nowhere near the guide, which dragged the line off its direction —
the non-converging fan of D11/D12. The rule now, in `resolveStrokeEnd`:
1. merge into an existing end only if that end lies ON this stroke's guide;
2. otherwise stop where a guide-bound line CROSSES this guide — a true
   two-constraint corner, which is what makes a shape hold under a VP drag;
3. otherwise end on the guide where the finger left it.
A stroke's START may always merge, because the guide is computed THROUGH the
start point, so joining there cannot change any direction.

`u` is recomputed at commit rather than read from the gesture: a stroke short
enough to be decided only at release has no cached direction, and without one
the end would fall back to merging with ANY nearby point — the exact off-guide
join this exists to prevent.

### D21. A box in one gesture, constrained so it stays a box

**Noah, 2026-07-29:** *"Add drawing boxes/rectangles."* — after building a cube
from nine strokes and watching it come apart.

`buildBox` emits the twelve edges of a two-point box where every vertex but one
is defined by CONSTRAINTS, not coordinates: one anchor at the near bottom
corner, the near edge vertical, the base edges bound to the two points, and all
six remaining corners intersections of two guides. So a VP drag moves the whole
box and it stays a box — asserted over five different VP positions in the unit
tests and once more through the real UI in the walk.

One drag: start at the near bottom corner, vertical extent is the height,
horizontal extent is the depth along each point. A square plan was the default
because one drag cannot state two depths.

**Superseded by D23 on 2026-07-30, including a correction.** The sentence that
used to end this amendment — "the corners are adjustable afterwards precisely
because they are constrained" — was true of the data model and false of the app:
there was no way to move a corner at all, only to delete it. D23 makes it true. It refuses with a plain reason when
fewer than two points are available, and leaves nothing half-built.

### ULTRACODE ASSESSMENT, 2026-07-30 — the box interaction, and the plan for 1.2.0

Noah, on the shipped 1.1.0: *"There is now no method to draw a box - it's really
two connected squares because you have no way of reading the third dimension with
a simple drag. The circled corners ... are the only corners that do anything when
I drag on them."* Assessed under Fable 5 Ultracode: six investigators, three
adversarial verifiers, one completeness critic; every load-bearing number below
was reproduced by an independent implementation before being recorded. The
IMPLEMENTING SESSION STARTS HERE.

**Diagnosis, verified twice:**
- Four of eight box corners — the intersect vertices leftTop, rightTop,
  backBottom, backTop — are inert in EVERY path: the drag handler has branches
  only for anchor and ray (ui.mjs vertex branch), the nudge dead-ends in a
  sentence, the inspector offers nothing. Worse: dragging one silently pushes an
  EMPTY undo step and announces "Corner at x, y" as if it moved — the UI lies.
- The 1.1.0 regression is mine and is measured: splitBoxDepths' floor is a fixed
  19.8px and toward() feeds only the dragged-toward side, so a straight-up drag
  yields a slab whose near-to-back separation is 6.8px against a 200px height
  (ratio 0.034 — "two connected squares" is literal), and NO single drag can
  produce two substantial depths. 1.0.0's floor (height/2) had the mirror
  failure (tall-thin impossible). Root cause: a 2-DOF drag cannot state three
  numbers. Each floor choice fixes one report by causing the other.
- Why Noah found 3 live corners when 4 respond in code (hypothesis, needs his
  confirmation): nearTop keeps only the vertical component of a drag, so an
  off-axis grab on it looks dead — and nothing visually distinguishes a
  draggable corner from a derived one, which is the real discoverability defect.

**The fix, measured (prototype scripts in the session scratchpad):**
1. `manipulate(scene, vertexId, target)` in the solver — ONE entry for drag,
   arrow keys and inspector fields. anchor → move; ray → project onto guide, set
   t (STRICTLY single-parameter — the walk pins that the other side must not
   move); intersect → damped Gauss-Newton over the RAY ANCESTORS found by
   walking defs/origins (generic; handles the depth-2 backTop), minimum-norm
   step when underdetermined, warm-started per frame.
   Measured on the real solver: every reachable target converges in 1–3
   iterations to sub-pixel error, the box stays a box (VP perpendicular miss
   ~1e-13px), cost 1–4% of a 60Hz frame; independently reimplemented and
   reproduced to 0.05. Straight-up on backTop moves mostly height with the two
   depths symmetric — the min-norm step decomposes the gesture naturally, so it
   FEELS like direct manipulation.
   DECISION RECORDED: minimum-norm Gauss-Newton ships for all intersects; the
   closed forms (leftTop↔(h,dL), rightTop↔(h,dR), backBottom↔(dL,dR), exact)
   become TEST ORACLES, not the runtime path. The losing option — closed-form
   with backTop's horizontal discarded — is rejected because it makes one corner
   behave unlike its siblings.
   NON-NEGOTIABLE GUARDS (adversarial findings): refuse to start a drag on any
   corner with non-finite position or degenerate flag — a drag on a born-
   degenerate corner NaN-POISONS the parameters irrecoverably (measured);
   abort any iteration with non-finite residual/Jacobian/step; clamp every ray
   |t| ≥ 1 AND ≤ ~0.95 of the origin-to-VP distance (kills the t=0 fold, which
   is a permanent wall not a transient stall, and blocks corners converging
   ONTO a vanishing point); on non-convergence keep the best theta (pin at the
   reachable boundary). Consider tightening buildBox to refuse born-degenerate
   boxes at birth.
2. The BOX GESTURE becomes two-stage (D-amendment to write: base-then-height).
   Stage 1: the drag lays the BASE — decompose the drag vector into components
   along the two receding VP directions (2×2 solve, measured det 0.882 at a
   typical start; straight-up gives a SQUARE plan by geometry, not by floor;
   refuse near the horizon where det → 0, clamp negative components). One drag
   states BOTH depths because the base is genuinely 2-DOF. Release commits
   NOTHING: walls rise as a ghost, a standing strip appears (§3 mode rules)
   with a live height FIELD, a Place button and a spaced 44px Cancel — the
   typed path closes the box half of F-04. Stage 2: a drag anywhere sets height
   from vertical travel; release ≥ ~6px commits the whole box in ONE
   beginGesture through the existing buildBox({at, height, depthL, depthR}).
   FIVE AMENDMENTS from adversarial review, all part of the design: (a)
   pointercancel must NEVER commit — today ui.mjs routes pointercancel into the
   committing endPointer, which is a live bug; (b) Esc and the Cancel button
   both exit, announced via the live region; (c) the pending state NEVER
   expires — anything that ends it, ends it by discarding; (d) stage-2 commit
   requires the travel floor (tremor jitter must not commit); (e) the pending
   base lives in its OWN state variable, never in gesture/ghost — the pinch
   handler overwrites both and would silently destroy the base mid-navigation.
   splitBoxDepths is SUPERSEDED by the stage-1 decomposition; the walk's D23
   check (plan.right > plan.left*1.2) passes on the broken build and must be
   replaced, not extended.
3. HISTORY: open beginGesture at the moved=true transition of a vertex drag and
   delete the restore/reapply dance — the current pattern is provably incomplete
   for intersects and already produces EMPTY undo steps (tap a VP without
   moving; drag a dead corner).
4. AFFORDANCE, same commit as the drags (the F-05 rule — shipping the drag
   without the visual/keyboard half recreates this exact report): draw
   draggable corners as open square handles and derived corners differently
   (shape, not hue, §4), hover/selected states, and keys+inspector parity for
   intersects through the same manipulate() path.

**Handoff checklist — same commits as the code, none of it optional:**
- interactions.mjs + INTERACTIONS.md: corner-drag entry extended to intersects
  with the keyboard/inspector alternative; box entry flips from declared gap to
  declared alternative; check-interactions.mjs updated.
- walk.mjs: drive a REAL intersect drag (backBottom: both depths change, box
  stays sound, ONE undo restores); the two-stage flow (stage-1 release leaves 0
  new edges and history unchanged; full flow yields 12 edges/8 verts; the
  regression killer: a between-the-VPs base drag gives BOTH depths > 60px; the
  previously-impossible tall-thin box and its mirror). Today the walk never
  drags any vertex of any kind — the reported defect class is invisible to
  every gate.
- a11y-gate: registry entries for the standing strip; ghost styling passes the
  hue-alone rule.
- Welcome panel and Box-mode hint re-truthed (the panel currently makes THREE
  false claims — intersect corners and selected lines do not answer arrow keys,
  drawing has no keyboard path); CHANGELOG 1.2.0 CAPABILITY entry; sw.js cache
  name bumped in the SAME commit or Noah's installed PWA keeps serving 1.1.0
  and the whole fix reads as a no-op.
- Staging only; Noah's iPad pass; no pushes while a deploy is in flight.

**Full-app audit beyond the box (priority order):**
P1 — F-04: drawing a line is still drag-only (the box half closes with stage
2's typed path; the line half remains open). SC 1.4.11: canvas mark colours
still undeclared and ungated — the GRID measures 1.38:1 against its background
today. Snap radius is a hardcoded constant (§4 says ADJUSTABLE, never tuned to
a steady hand) and there is no input smoothing. Clear sits 4px from Points and
Export — §4 says a destructive control never sits beside a routine one, and the
gate checks size, never spacing. The armed-Clear promise "anything else you
touch cancels" is false for 8+ controls and the canvas. In Select mode a FINGER
cannot select anything under default settings (touch pans; only pen selects) —
the owner-facing report "dragging with my finger" may partly be THIS.
P2 — Weld preference desyncs from its button on reload (restored pref, button
shows pressed). The a11y gate never tests the 200%-text case (only the welcome
walk block does). `.btn.danger` is not actually in the contrast registry while
a CSS comment claims it is. rebindVertex silently accepts an intersect and
writes a meaningless t. The canvas's accessible label is static rather than
describing the drawing. One-finger pan has no alternative with touch-draws on.
Stale NOTES claims ("nothing is staged").
DEVICE CAVEAT: every number above is node-on-desktop; iPad Safari is unmeasured
— the 60Hz margin (25x) makes feasibility safe, but feel needs Noah's hands.

### D26–D28, and the audit that should have come first

**Noah, 2026-07-30, on the shipped 1.0.0:** five reports at once — off-screen VP
markers being mistaken for the points, arrow keys moving nothing, a box corner that
would not drag, a straight-up box drag changing all three axes, and no first-run
explanation — ending with *"I don't know how you missed all those design things
that are part of my doctrine."*

**The honest answer, recorded because the next session needs it more than I do:**
this app was built against the spec and the D-amendments, and §4 was treated as
satisfied because the a11y gate had been ported from the hub. §4's own text
contains requirements that were never turned into gates, and every one of his five
sits inside one of them. Nothing here was a surprise the doctrine had not already
named:

- *"EVERY DRAG HAS A NON-DRAG PATH ... DECLARE IT, so it is a gate and not an
  intention. A declared interaction with no declared alternative FAILS the
  build."* There was no declaration and no gate. A corner that could be neither
  dragged nor nudged was invisible to every check the app had.
- *"Pinch-zoom needs zoom controls. Two-finger pan needs another way to pan."*
  Neither existed.
- *"Interrupting surfaces are EXPECTED"* — first-run panels are named explicitly,
  with six requirements for the way out. There was no first-run surface at all.
- *"A canvas app's marks are graphical objects ... the app DECLARES their colours
  and the gate computes them."* Still outstanding — see the open items.

Measured on the shipped build before any fix, so the reports are recorded as
numbers rather than impressions: arrow keys moved a selected corner from
(805.3, 645.1) to (805.3, 645.1); dragging it moved it the same distance; a
straight-up box drag of 141 gave depths of 70.7, and one of 636 gave 318.1.

**D26 — a selection answers the keys, and can be dragged.** The canvas takes focus
when a tap selects. Arrow keys nudge (Shift for 20), an anchor freely and a
guide-riding corner along its guide; the drag obeys the same rule through the same
code path, so the two cannot disagree about what a corner may do. One undo step per
drag, opened at release so a tap that only selects leaves no empty step.

**D27 — an off-screen marker is a compass, not the point.** It carries an arrowhead
rotated toward the point, the distance, a squared badge rather than a round dot, and
an accessible name that says OFF SCREEN first. Shape and text, never hue.

**D28 — the first-run explanation**, built to §4's six dismiss requirements and
gated against all six, at 1194×834 and at 320×568 with 200% text: close visible in
the first frame (measured in-viewport), hit-testing its centre returns the close
itself, a second way out at the bottom, still reachable after scrolling to the very
end, genuinely gone afterwards with focus on a real control, and the panel bounded
(584px in an 834px viewport; 520px in a 568px one). Re-openable from About.

**The gate that was missing** is now [`INTERACTIONS.md`](INTERACTIONS.md) +
`interactions.mjs` + [`check-interactions.mjs`](check-interactions.mjs)
(`npm run interactions`, and in CI). Every drag and gesture declares its non-drag
path; an alternative whose selector matches nothing fails; a gap must cite a
finding in ACCESSIBILITY.md. It failed on its first run with seven failures, which
is the point of it.

**Still open and declared rather than hidden:** drawing a line or a box is
drag-only (F-04), and canvas mark colours are not yet declared for computed 3:1
contrast (SC 1.4.11). Both are findings with numbers now.

### D25. Clear belongs in the toolbar

**Noah, 2026-07-30, having read D24:** *"Where is clear"* — then *"Add to toolbar
then promote"*. The verdict on D24's placement is his, and it is the honest one: a
thing called "clear the screen" is not findable one level down inside a panel about
files. It scrolled below the fold on a narrower iPad too.

`Clear` sits in the toolbar's right-hand group, next to Points, and it is the
keep-the-points action — the one that gets reached for. Wiping the vanishing points
as well stays in Project, because that one should cost a level.

Deliberately NOT beside Undo: a destructive tap does not belong next to the control
someone reaches for after a mistake.

Two differences from the dialog buttons, both forced by a toolbar rather than
chosen:
- **The label does not change when armed.** A toolbar that reflows on arming moves
  every neighbouring control under the finger. The count goes to the toast and to
  the button's accessible name instead, and it is still read from the drawing.
- **An arm expires after six seconds.** In a panel an armed button is in front of
  you; in a toolbar it can sit there while attention moves on, and an armed
  destructive control that outlives your attention is a trap. Any other toolbar tap
  also cancels it.

Both of those are asserted in the walk, and both were proven by deleting them: the
cross-disarm and the expiry each red their own check.

### D24. Clearing the screen, as two named actions

**Noah, 2026-07-30:** *"Create a way to clear the screen."* Two actions rather
than one, because in a perspective tool "clear" means two different things and
guessing would be wrong half the time: **clear the drawing and keep the points**
(the setup survives) or **clear everything**. Both live in the Project panel, and
neither is a reset — the horizon and the canvas size stay, because those are the
sheet of paper rather than the drawing on it, and nothing is re-added to replace
what was removed.

`clearDrawing` and `clearAll` in the solver, both returning what they removed.
Each is one `beginGesture`, so **one undo restores the whole thing** (D7) — which
is also why this does not use Quietkeep's typed-word guard: that guard exists for
the irreversible, and a two-tap arm is proportionate to something undo covers.

Three properties the guard has to have, all asserted through the real dialog in
the walk:
- **The count is read from the scene**, not written into a sentence. The button
  says "clear 2 lines and keep 2 points" because it counted them.
- **It is computed before the confirm goes live**, so there is never a frame where
  an armed button sits above a stale number (hub LESSONS).
- **Arming one cannot arm the other.** Two guarded actions sharing a satisfied
  confirmation is how a safe tap ends up authorising a different target, so
  touching the other button — or anything else in the panel, or closing it —
  disarms.

### D22. Welding is a toggle, not a verdict

**Noah, 2026-07-30:** *"Add those two things"* — the two items this file listed as
open. The first was recorded as "restore endpoint joining as a toggle", which was
stale: D20 had already restored joining. What was missing was the CHOICE between
0.2.0's behaviour (an end stops exactly where you lift) and 0.5.0's (an end that
lands on its guide joins the corner it finds there, which is what holds a shape
together under a VP drag).

`Weld` in the toolbar, `aria-pressed`, default ON. It threads through
`resolveEndpoint`'s `join` and a new `weld` option on `resolveStrokeEnd`. The
property that makes it safe to offer: **welding decides only WHERE a line stops,
never what it follows** — D18 holds with welding off, so the toggle can never
hand back a line that belongs to nothing. Both directions are asserted, in the
unit tests and through the real button in the walk; the walk's D16-era check that
strokes do NOT share a vertex has now been inverted a third time, and this time
both behaviours are checked rather than one being the app's opinion.

### D23. Two depths from one drag, and corners you can actually set

**The second of the two.** A box needs three numbers — height and two depths —
and a drag carries two. So the drag sets the height and the SHARE between the
axes: `splitBoxDepths` gives the axis you drag toward the sideways distance and
the other a floor proportional to the height. Straight up is still a square plan,
now the special case rather than the only case. Monotone in the drag, so further
right is always deeper right, which is what makes it learnable.

Then each depth is settable exactly, because the inspector now offers the control
that matches what holds a corner:
- anchor → `x` and `y`, via a new `moveAnchor` in the solver. `rebindVertex`
  refuses anchors and `moveVp` only takes vanishing points, so a box's one
  anchored corner previously could not be moved at all.
- ray → a signed DISTANCE along its guide. On a base corner that distance IS
  that side's depth, and changing one leaves the other alone.
- intersect → no control, and it says why: it is wherever two guides meet, so
  offering coordinates would mean moving something else behind the user's back
  (Doctrine §14).

This is also the fix for a claim this file had been making since D21 — that box
corners were "adjustable afterwards". They were adjustable in the data model and
unreachable in the app. Corrected at D21 as well, where it was written.

### D18. There is no plain line

**Noah, 2026-07-29:** *"No 'drawn as plain line.'"* §3.2's angular threshold is
deleted. A stroke that missed every guide by more than the band used to fall
through to `free` — the one outcome that is never useful in a perspective tool,
because it silently returns a line belonging to nothing that will not move when
a point does. Whatever the angle, the nearest guide takes it. `SNAP_THRESHOLD`
and the per-instrument band D13 added for touch are both gone from the code
rather than left lying around claiming to do something.

Deliberate escapes are untouched: Assist off and "Guide: none" are his choices.
The change is that the app no longer makes that choice for him.

### D19. The guide can be switched mid-stroke

**Noah, 2026-07-29:** *"Allow switching targets mid line?"* Yes. The choice used
to lock 28 screen px into the drag (D13) and never move, so a stroke aimed
wrongly had to be lifted, undone and redrawn. The guide is now re-picked on
every pointer move for the whole stroke, and swinging the finger toward another
guide moves the line onto it — verified in the real app in one continuous touch
drag: the live region read "Following VP1" then "Following VP2", one line, 0px
off VP2.

The lock existed because of jitter. **Hysteresis replaces it:** a rival guide
must beat the one in hand by `SWITCH_MARGIN` (6°) to take over, so a tremor
cannot flap the line while a deliberate swing crosses the margin at once.

**A limit, measured and worth knowing rather than discovering:** two vanishing
points that are within the switch margin of each other from a given origin —
which is exactly what happens near the horizon, where both were ~3° apart in a
real scene — cannot be swung between, because there is no angular gap to swing
through. The forced Guide picker is the way to change between them there. That
is geometry, not a defect, and the test for mid-stroke switching says so where
it picks its origin.

### D17. Deleting is always possible, and deleting a guide moves nothing

**Noah, 2026-07-29:** *"I could not delete lines earlier, and VPs said they
could not be deleted without destroying existing lines."* Two separate faults.

**A line could not be selected, so it could not be deleted.** Selection used
`SNAP_RADIUS` — 12px, a DRAWING tolerance — as a TAP target. Doctrine §4 has
required 44px the whole time and the canvas was quietly exempt from its own
rule. Selection now uses `HANDLE_HIT` (22px radius) like every other handle,
and a tap that finds nothing says so in a toast instead of a live region
nobody sees. Tapping near a line's END selected the point, which offered
nothing at all — a dead end. A point now deletes too, naming how many lines
will go with it.

**A vanishing point refused to be deleted.** The refusal was honest about the
problem — the lines leaning on it would be stranded — and the wrong answer to
it: his own drawing held his tool hostage. Deleting a point now FREEZES
everything that depended on it exactly where it sits: a constructed point
becomes a plain anchor at its current coordinates, and a line bound to that
point keeps its geometry and loses only its guide. Not one pixel moves, which
the walk asserts by comparing every vertex before and after. A dependent that
never solved has no position to freeze, so it is removed and the count is
reported rather than left as a mystery.

Both are gated in the walk through the real UI, by touch: select-and-delete a
line, then delete a point and prove 0 of N vertices moved.

### D16. The guide set is exactly VPs + vertical + horizontal. Nothing else anchors a line.

**Noah, 2026-07-29, in anger and correctly:** *"WHY is there ANYTHING besides
VPs, and perfect vertical and horizontal lines acting as ANCHORS FOR MY LINES?!
I DIDN'T ASK FOR THAT!!! 45 degrees may be a toggle."*

He is the owner and this OVERRIDES spec §2.4 and the D2 endpoint precedence,
both of which a session adopted from the handoff without his asking.

- **The guide set is closed:** every unlocked vanishing point, true vertical,
  true horizontal. Optionally the 45°/135° pair, behind a toolbar toggle that
  starts OFF. A property test sweeps 360° of stroke directions and asserts that
  nothing outside that set is ever even offered.
- **Endpoint anchoring is OFF.** §2.4's "shared vertices are mandatory" merge
  and D2's snap-onto-an-existing-edge were silently moving the ends of his
  strokes onto earlier geometry — which is exactly what pulled a line off the
  guide it was drawn along. `resolveEndpoint` still supports joining, and the
  app passes `join: false`.
- **The consequence, stated plainly rather than discovered:** lines no longer
  share corner vertices, so a VP drag swings each line about its own start
  instead of holding a box together. That is what he asked for. If he wants
  welding back it is one toggle, not a rebuild — the machinery is intact and
  tested.
- **What this replaced in the gates:** the walk's check that "strokes starting
  at the same point share one vertex (§2.4)" now asserts the OPPOSITE. It was
  inverted deliberately, and says so where it lives.

### D15. Guides are followed, not aimed at

An off-screen vanishing point had only an edge marker to aim at, and that marker
sits on the ray from the VIEWPORT CENTRE to the point — a compass, not a target.
Measured on Noah's own scene: VP2's marker drawn at screen x=834 while the
point's true direction from a stroke's origin left the viewport at x=1819.
Aiming at the marker was therefore aiming several degrees off the guide, from
every origin, and no scoring rule can recover an intent the gesture never
contained. So the moment a stroke begins, every candidate guide line through
that exact origin is drawn across the canvas. The line to follow is visible
instead of inferred.

### D13. The guide is decided from a sample worth trusting

§3.2 takes the stroke direction after ~10 CANVAS px. At a fit-to-screen zoom
that is about five SCREEN pixels, which on a fingertip is the finger settling,
not an aim. The sample is now measured in screen px, the choice is re-picked as
the stroke grows, and it locks at 28 screen px so the line stops moving under
the hand. A stroke that never reaches the lock is decided from the whole
gesture at commit.

### D12. A binding is a fact about the line, never an aspiration

Added 2026-07-29, from the adversarial audit Doctrine §14 requires once a
regression has reached Noah's device. It is the same defect class as D11
wearing a second costume, and it was found by measurement, not by report.

§2.4 makes endpoint merging mandatory — it is what keeps a box coherent when a
VP moves. But when BOTH ends of a stroke merge into points that already exist,
the edge's geometry is fully determined by those two points, and nothing makes
it pass through the guide the stroke asked for. The binding was stored anyway.
Measured on a plain two-point scene: an edge recorded as bound to VP1 whose
line missed VP1 by **1,866px**. It draws as a line that does not converge and
does not move when that point moves.

- **At commit**, the binding is checked against the geometry. An unsatisfied
  one is demoted to `free` and the caller is told, so the user is told.
- **Nothing is moved to make the claim true.** Silently repositioning a point
  the user already placed is what Doctrine §14 forbids; the honest answer is to
  keep their line and drop the false label.
- **On read**, `effectiveBinding()` derives the binding from the geometry. A
  binding can go stale later — two anchors that lined up with a point only by
  coincidence stop lining up when it moves — so the inspector and the SVG layer
  grouping ask the drawing rather than trusting the stored label. The stored
  file is left alone: a drag must not silently edit the user's work.

The invariant now has a property test over a messy 60-stroke drawing, asserted
again after three VP drags.

### D11. Guide ranking — a vanishing point outranks an axis, and the drag picks between VPs

Added 2026-07-29 after Noah drew on his iPad and reported **"the lines do not
converge on the vanishing point."** He was right, and the cause was in the
scoring of §3.2, not in the solver.

Reproduced headlessly before anything was changed: strokes aimed straight at
VP1 were binding to `horizontal`. Two separate ambiguities, one under the
other.

**First — an axis guide steals a near-horizontal VP.** The default VPs sit far
outside the document on the horizon, so the guide toward VP1 is within about a
degree of horizontal across the whole canvas. `horizontal` was competing on
equal terms and winning on measurement noise. It is a PARALLEL family: lines
bound to it converge nowhere, which is exactly the fan he saw. The rule now: an
axis guide only beats the best VP guide if it beats it by more than
`AXIS_MARGIN` (4°). Inside that band the two lines are visually identical over
a stroke, and the VP is the constraint the user aimed at — the axes are
available everywhere. Anyone who wants an axis can force it in the toolbar.

**Second — two VPs on the horizon are nearly the same LINE.** Measured from a
point near the horizon, with a 3° hand tremor: `VP2 0.87° | horizontal 1.99° |
VP1 3.00°`. Angle alone cannot say which vanishing point was meant, and a
tremor flips the answer between two guides that converge in OPPOSITE
directions. D3 made a binding a direction-less line for solving; the drag still
carries which way the hand was reaching. So among VPs within `VP_TIE` (4°) of
each other, the one being drawn TOWARD wins.

**And the band depends on the instrument.** §12 left `SNAP_THRESHOLD` to be
tuned against real input. A fingertip aims coarser than a stylus and the
direction is taken over ~10 canvas px, so touch gets 22° where pen and mouse
keep the spec's 15°. Same rule, different instrument.

**The silent case is now audible.** When assist is on and nothing catches the
stroke, the line is plain and will not move when a VP does — a fact that had
been announced only to a screen reader. It is a toast now.

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
