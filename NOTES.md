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

**PROMOTED TO PRODUCTION 2026-08-01 — 1.15.0 and 1.16.0.** Fourteenth and
fifteenth promotes, back to back. `main` fast-forwarded `b238b74` -> `8d8acbe`,
then `8d8acbe` -> `b694848`; no merge commits, remote diff against `staging`
empty after each. All four workflows verified `completed / success` on BOTH
commits on `main`, read back from the API.

- **1.14.0** — D62, a circle in perspective. Exact rather than the eight-point
  construction, and stored as four ids and nothing else.
- **1.15.0** — D63, the winding refactor, and the most important change in the
  app so far. Noah's criticism was right and it removed five rules rather than
  adding a sixth.
- **1.16.0** — D64, Fit points.

**Why D63 matters more than its size.** Every visibility rule before it worked
out from screen position something the construction already knew, and each was
correct in the case it was written for and wrong in the next one — D37, D44, D48,
D49, D54, five in a row, each patching its predecessor. Noah stopped the sequence
with a question rather than a bug report: *"why don't you just assign a face a
normal that doesn't change no matter what direction you look at it from and just
cull the reverse normals like any 3-D program."* That is one rule, it is the
standard one, and it made the other five unnecessary. The second half of the same
message — that eye level makes no sense as an input because it is forced by the
two points that make the horizon — fell out for free: nothing consults either line
now.

**The pattern to carry.** Twice this week the fix was to stop deriving and start
storing a fact about the CONSTRUCTION: signed depths in D49, and now windings.
Both times the prompt was Noah asking why the app was recalculating at all. The
smell to watch for is a rule that reads screen positions to answer a question the
builder already knew the answer to.

Gates at 1.16.0: **223 unit tests**, **186 walk checks**, a11y PASS, 7 declared
interactions with no gaps.

**PROMOTED TO PRODUCTION 2026-08-01 — 1.13.0.** Thirteenth promote. `main`
fast-forwarded `b238b74` -> `731a8ed`, no merge commit, remote diff against
`staging` empty afterwards.

- **1.13.0** — D61, the street: buildings down both sides, crossroads, alleys.
  Built entirely out of D50, D51 and D52 pointed at one construction, which is
  the strongest evidence yet that those three were right. Two faults nine green
  unit tests could not see and one screenshot could: the gauge sign inverted (the
  whole city built downward into the ground, every ratio exactly correct because
  `Math.abs` hid the direction) and defaults that were unusable while being
  geometrically perfect.
- Doctrine §4 gained three rules earned this week — a control must not move when
  used, no two controls answer to the same name, and the way in costs what the
  way out costs. Two never-reproduced reports were closed at Noah's instruction,
  and the a11y gate stopped asking a question §4 had already answered on
  2026-07-30.

All four workflows verified `completed / success` on `731a8ed` on `main`, read
back from the API; the record was held until every one finished, for the ninth
promote running.

Gates at 1.13.0: **214 unit tests**, **182 walk checks**, a11y PASS, 7 declared
interactions with no gaps.

**Four empty checks in one day.** The roof shading counting walls; the eye-level
rule measuring two poses and then an off-page fixture; D60's divider loop finding
nothing once the fraction was gone; and D61's crowding test with a tolerance that
admitted equal spacing. Not one was found by running the gates. All four were
found by planting the fault. Two distinct shapes, both worth recognising on
sight: **a filter that matches nothing reports a clean result**, and **a tolerance
wide enough to admit the null hypothesis is the absence of a test.**

**PROMOTED TO PRODUCTION 2026-08-01 — 1.12.5.** Twelfth promote. Noah said
**"Promote - anything left?"** and `main` fast-forwarded `764e80f` -> `c0a2022`,
no merge commit, remote diff against `staging` empty afterwards. Five iterations,
every one of them a defect HE found on his iPad and none of them geometry the
gates could have reasoned about unprompted:

- **1.12.1** — D55, buttons moving when used. The tick appeared on press, so a
  button grew on press, and a wrapping row shoved everything after it under a
  finger already in flight.
- **1.12.2** — D56, one word two meanings: the Human-scale button and the toolbar
  mode both said "Place". Two real SC 2.5.3 failures fell out of writing the gate.
- **1.12.3** — D57, Touch draws out of Setup and onto the bar. Off was one tap and
  on was three, because a different amendment had already got the exit right.
- **1.12.4** — D58/D59, the bar rearranging itself because a `<select>` sizes to
  its longest option and its options are the scene's points; Add cube on the bar,
  Add line into Setup with the interactions gate taught to follow a disclosure.
- **1.12.5** — D60, the house tangling. Three faults: a stored length where a
  fraction belonged (D52's own lesson, six hours old), an unsigned `hypot` that
  destroyed the sign, and a divider that did not depend on what it divides. Plus a
  fourth the gate found: filling faces through corners the solver had marked
  unplaced.

All four workflows verified `completed / success` on `c0a2022` on `main`, read
back from the API; the record was held until every one finished, for the eighth
promote running.

Gates at 1.12.5: **204 unit tests**, **179 walk checks**, a11y PASS, 7 declared
interactions with no gaps.

**The number worth carrying out of this promote is three.** Three checks were
caught passing against the exact fault they existed to catch — the roof shading
counting walls, the eye-level rule measuring two different poses and then an
off-page fixture, and D60's divider loop finding nothing to check once the
fraction was gone. None of them were caught by running the gates; all three were
caught by planting. A fourth unit test was written, planted against, found unable
to fail, and DELETED rather than kept as decoration. Cross-app: hub LESSONS 7g.

**PROMOTED TO PRODUCTION 2026-08-01 — 1.12.0.** Eleventh promote. Noah said
**"Promote"** and `main` fast-forwarded `8179687` -> `9fab6af`, no merge commit;
the remote diff between `main` and `staging` is empty afterwards, checked rather
than assumed. Two commits: the release, and the 1.11.0 record that had been
written on `staging` because `main` is fast-forward-only — so that record reaches
production here, exactly as it said it would.

- **1.12.0** — D53, the roof: the first thing in the app that is neither level
  nor upright. A set of parallel slopes gets a vanishing point of its own on the
  vertical through the point the walls below it run to, which is what makes a
  roof drawable rather than guessable.
- **D54**, which is not a feature. Two defects found only by planting faults, and
  both were sitting behind checks that had been green since the day they were
  written. The roof's planes were never being drawn at all; the check said
  otherwise because it counted total shaded pixels and the walls alone cleared
  its bar. Then the check written to cover the FIX turned out to be empty twice
  in a row. Full account in the D53/D54 amendment, and the cross-app version is
  now hub LESSONS **7g**.
- The toolbar cap held. The roof's button took the bar to 21 against D47's 20,
  and the generators moved into Setup rather than the number moving.

All four workflows verified `completed / success` on `9fab6af` on `main`, read
back from the API; the record was held until every one of them finished, for the
seventh promote running. The sandbox still cannot reach pages.dev, so the deploy
run is the evidence and Noah's on-screen version stamp closes the gap.

Gates at 1.12.0: **201 unit tests**, **174 walk checks**, a11y PASS, 7 declared
interactions with no gaps. Every check added this release was made to fail
against a planted fault before it was believed — which this time was not a
formality, because two of them could not.

**PROMOTED TO PRODUCTION 2026-08-01 — 1.11.0.** Tenth promote, and the largest
by content: `main` fast-forwarded `928f1d7` -> `8179687` in a single push, no
merge commit, carrying **four releases** that had been stacked on `staging`
through the day.

- **1.8.1** — D49, from Noah's *"Why do you recalculate normals at all?"* Four
  amendments had been deriving from screen position a fact the construction
  already held. It reads the stored depth SIGNS now, and the whole run of
  inverted-box reports ends there.
- **1.9.0** — D50, equal intervals in depth. Divide and Repeat, exact against a
  real projection rather than approximated.
- **1.10.0** — D51, the scale figure: a ratio of your own eye height, re-derived
  every solve, so it can never go stale and lie with authority.
- **1.11.0** — D52, the interior room, and the D39 defect that fell out of it.

All four workflows verified `completed / success` on `8179687` on `main`, read
back from the API rather than taken from the deploy alone — the record was held
until every one of them finished, for the sixth promote running. The sandbox
still cannot reach pages.dev (proxy `CONNECT tunnel failed, 403`), so the deploy
run is the evidence and Noah's on-screen version stamp closes the gap.

Gates at 1.11.0: **189 unit tests**, **169 walk checks**, a11y PASS, 7 declared
interactions with no gaps — all four re-run here at that exact commit, not
carried over from memory.

**PROMOTED TO PRODUCTION 2026-07-30 — 1.8.0.** Ninth promote. `main`
fast-forwarded `2c7a42f` -> `8e0f422`, no merge commit, remote diff empty
afterwards. Two releases:

- **1.7.3** — D46, and the most important thing in this promote: production had
  been REFUSING ONE-POINT PERSPECTIVE since 1.7.2 went live an hour earlier. My
  guard forbade a vanishing point on the paper and told the user in a toast that
  it stopped being a vanishing point there. Noah: *"What the fuck do you think a
  train track is?"* The only thing refused now is two points arriving at the same
  place.
- **1.8.0** — D47, the toolbar: 33 controls in four rows became 19 in two, and
  the stage went from about two thirds of the window to **87%**.

All four workflows verified green on `8e0f422` on `staging` BEFORE the merge and
again on `main` after it. The record was held until every run on `main` reached
`completed / success`, for the fifth promote running.

Gates at 1.8.0: **154 unit tests**, a11y PASS (now including the Setup panel as
its own surface), **149 walk checks**, 7 declared interactions with no gaps.

**Worth carrying out of today.** Two classes of defect kept getting through every
gate and being found by Noah in minutes:

1. **A new capability silently invalidating an older amendment's assumption.**
   D39's signed depths broke D37's stored walls; D42's dial broke three of D45's
   assumptions about scale. Every gate stayed green because each amendment was
   gated against itself.
2. **The app stating a FACT about perspective that it had not been taught.**
   D45's guard did not just have the wrong threshold, it asserted something false
   about drawing, in a toast, to the person who knows. A limit is the app's to
   set; a fact about the craft is not.

**PROMOTED TO PRODUCTION 2026-07-30 — 1.7.2.** Eighth promote, and the first one
that is purely defect repair — every line of it came from Noah's photographs of
the build promoted an hour earlier. `main` fast-forwarded `7eff04a` -> `2c7a42f`,
no merge commit, remote diff empty afterwards.

- **1.7.1** — D43, the band of stale pixels along the bottom of the canvas that
  survived a Clear: `draw` cleared the viewport RECTANGLE while `sizeCanvas` sized
  the BACKING STORE, and 1.7.0's nine new toolbar buttons made the toolbar re-wrap
  often enough to expose it. Plus D44, inverted boxes shading the far pair of
  walls — the walls are derived from the two rings now instead of stored.
- **1.7.2** — D45, three defects in the D42 dial shipped the same afternoon: a
  cube sized in fixed units rather than as a fraction of the distance to the
  points; Stronger sliding the horizon off eye level by scaling y as well as x;
  and a guard that measured distance from the paper's CENTRE, which let a point
  settle on the paper and clamp every corner near it.

All four workflows verified green on `2c7a42f` on `staging` BEFORE the merge and
again on `main` after it. The record was held until every run on `main` reached
`completed / success`, for the fourth promote running.

Gates at 1.7.2: **153 unit tests**, a11y PASS, **143 walk checks**, 7 declared
interactions with no gaps.

**The pattern worth naming, because it happened twice today.** D39 made depths
signed, which silently invalidated D37's assumption that the two stored walls are
always the visible ones. D42's dial silently invalidated D45's three assumptions
about scale. In both cases every gate stayed green because each amendment was
gated against ITSELF. Nothing in the harness asks "what did this new capability
just make untrue?" — and Noah found both in minutes on a real device. The cheap
mitigation is to treat any new capability that changes a QUANTITY the renderer
reasons about (a sign, a distance, a position) as a reason to re-read the
amendments that reason about it.

**Still not reproduced:** "only manipulatable with the out-of-sight corners". D45
(3) is the best explanation, not a confirmed one — see the D45 entry for
everything that was tried.

**PROMOTED TO PRODUCTION 2026-07-30 — 1.7.0.** Seventh promote. `main`
fast-forwarded `d32ae72` -> `401877d`, no merge commit, and
`git diff origin/main origin/staging` empty on the remote afterwards. Five
releases, and between them they answered every defect Noah reported this
afternoon plus the two features he asked for:

- **1.4.0** — D34 closed F-04: Add line and Add box, so nothing in the app
  requires a drag. D35 reversed a bad call of mine and raised the grid to 3:1;
  no colour is protected.
- **1.5.0** — D36/D37/D38: eye level split from the horizon (the horizon is
  derived from the points, or absent), solid faces whose top/underside follows
  eye level, rays to every point.
- **1.5.1** — D36a, a defect I shipped: a scene saved by an older build could not
  be opened at all. The migration guarded the file door and not the storage door.
- **1.6.0** — D39 signed depths, so a box can be pushed through zero and invert;
  D40 hidden-line removal and a shading-strength control; D41 the three-point cap
  with the count fixed once anything is drawn.
- **1.7.0** — D42: Add cube, Taller/Shorter, Stronger/Gentler. Forced perspective
  as an artist means it, after Noah clarified he wanted exaggeration rather than a
  measuring-point construction.

All four workflows verified green on `401877d` on `staging` BEFORE the merge and
again on `main` after it: Deploy, Accessibility gate, Solver tests, App walk. The
record was held until every run on `main` reached `completed / success`, for the
third promote running.

Gates at 1.7.0: **149 unit tests** (109 at 1.3.2), a11y PASS, **139 walk checks**
(102 at 1.3.2), 7 declared interactions with **no gaps** — F-04 is closed, so for
the first time every declared drag has a non-drag alternative.

The standing pages.dev caveat is unchanged: this sandbox cannot read the site, so
the evidence is a successful deploy of this exact tree, and the on-screen stamp
reading 1.7.0 on Noah's iPad closes it.

What ships still open: the canvas grid is now a toggle rather than a compromise;
snap radius is still hardcoded where §4 wants it adjustable; target SPACING is
ungated; and the Weld preference still desyncs from its button on reload.

**PROMOTED TO PRODUCTION 2026-07-30 — 1.3.2.** Sixth promote, and the largest
one: `main` fast-forwarded from `e60543b` (1.0.0's record) to `172749c` — no merge
commit, the identical tree, and `git diff origin/main origin/staging` empty on the
remote afterwards. It carries five releases at once, because everything since V1
had been stacking on staging awaiting Noah's device pass:

- **1.1.0** — Noah's five defects, and the §4 gates that should have caught them
  (off-screen markers that say they are markers, arrow keys, draggable corners,
  the first-run panel, and the drag-declaration gate itself)
- **1.2.0** — every corner of a box moves, through one entry point (D29's inverse
  solve). This was the "four corners do nothing" report
- **1.3.0** — the anchor is visibly the anchor (D30), and a box is two steps with
  the second automatic (D31)
- **1.3.1** — no iOS text selection on a long press (F-08); the Clear confirmation
  moved under the Clear button (F-09)
- **1.3.2** — D33's double-headed arrow: the second step now says WHICH WAY

All four workflows were verified green on `172749c` on `staging` BEFORE the merge,
and all four re-ran green on `main` after it: Deploy, Accessibility gate, Solver
tests, App walk. This record was again held until every run on `main` had reached
`completed / success` rather than being written on the strength of the deploy
alone — the same patience the 1.0.0 record describes, applied a second time.

Gates at 1.3.2: **109 unit tests** (89 at 1.0.0), a11y PASS, **102 walk checks**
(65 at 1.0.0), 7 declared interactions with 2 registered gaps (F-04). The standing
caveat below is unchanged: this sandbox cannot read pages.dev, so the evidence is
a successful deploy of this exact tree, and the on-screen stamp reading 1.3.2 on
Noah's iPad is what closes the gap.

Two things carried into production that are worth stating plainly rather than
burying: F-04 is still open — drawing a line or a box is drag-only, with no
keyboard path — and the canvas grid still measures 1.38:1, now recorded as an
explicit non-assertion in ACCESSIBILITY.md rather than a silent omission.

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

### D72 — the diagnostic report (SHIPPED 1.20.0, staging)

Doctrine §7f: **ask Noah for a text report, never for a screenshot.** Built here,
reached from inside What changed — the version stamp already gathers "tell me
about this build", and a second entry point on the toolbar would be a control
nobody presses twice a year.

**It leads with what is WRONG.** That ordering is the whole design. A dump that
opens with an inventory and buries the fault four sections down is a dump; the
first thing under the build line is either the list of faults or the sentence
*nothing the app can detect*. Saying so out loud matters as much as the list —
a report that goes quiet when it finds nothing is indistinguishable from a
report that never looked.

**Every fault carries its reason, not a flag.** `corner v5 could NOT be placed —
its guide has no direction from where it sits (usually a corner dragged onto its
own vanishing point)`. That is the class of fault the report exists for: a
degenerate corner keeps its last valid position on screen (solver.mjs line 390,
`x,y untouched — the last-valid cache`), so it looks *perfectly fine* in a
screenshot. The screenshot is not merely less useful here — it is actively
misleading, and no amount of asking for a better one would help.

**Twelve checks in the walk, all twelve planted against.** Six content faults in
one run (no build line, going quiet when clean, horizon with no reason,
degenerate corner with no reason, no inventory, no privacy statement) → exactly
six failures, one per plant, no cross-talk. Then the ordering moved to the
bottom, Refresh made a no-op, and Copy truncated to one line → exactly three.
Then the entry point removed → the route check fails with `reachable:false`.

The Copy plant is the one worth keeping: it still *announced* "Diagnostic report
copied", and the check caught it because it compares the clipboard to the text
on screen rather than trusting the announcement. A check that reads the app's own
claim of success is not a check.

**The fault planted the way a person would hit it.** Not by writing `degenerate:
true` into the scene — by moving a vanishing point onto a corner's origin through
`moveVp`, the same path the panel uses. `manipulate` cannot produce this state at
all (`clampT` bounds a ray short of its own VP, solver.mjs 614), so dragging the
corner is not the route; dragging the POINT is. Planting through a back door
would have proved the formatter and nothing else.

**And the gate found a real bug the moment it was pointed at the new surface.**
The §7d release-notes list scrolls, and had no keyboard route into it —
`scrollable-region-focusable`, serious, both themes. It shipped in 1.19.0 without
ever being measured, because **adding a surface and adding it to the a11y gate's
`PAGES` are two separate acts and I only did the first.** That is D70's lesson
arriving a second time in three days, from the same blind spot: a gate cannot
fail on a surface it never opens. Both `notes` and `diag` are in `PAGES` now — 8
surfaces, up from 6 — and `open` accepts a *route* rather than one selector, so a
surface reached through another surface can be audited at all. The step
attribution was itself planted: break step 1, it says step 1; break step 2, it
says step 2.

**Still owed from the hub's baseline:** §7e's (i) surface — what the app is and
is not, install instructions with every platform NAMED, data sources with terms,
how to report a problem, licence, and the first-run orientation moved (never
copied) behind it. It is on the Still open list where a reader can see it.

### D71 — patch notes in the app, from one source (SHIPPED 1.19.0, staging)

The hub gained **Doctrine §7d** on 2026-08-03, and its CLAUDE.md names this repo
among those that inherit it: *"each needs the surface built; none has one yet."*
Built here.

Tap the version stamp — that is where a reader looks when they want to know what
changed, so putting the notes anywhere else costs a hunt. Six releases, bounded,
because a list that grows by accumulation eventually becomes the app.

**Still open comes first, above the fixes.** §7d: *an app that lists only its
fixes is an advertisement.* The four things currently on it are real — the snap
radius, ungated target spacing, a reference image never tested against a real
photograph, and the missing §7e/§7f surfaces.

**One source, enforced.** `notes-build.mjs` derives `public/app/notes.mjs` from
CHANGELOG.md; `npm run notes:check` fails if the committed file has fallen behind,
and it runs in CI. That is the difference between "one source" as a rule and as an
intention — planted by editing a version in the generated file, and it fails.

**Three things went wrong building it, all caught by gates I already had.**

1. The parser used `(?=\n## |\n*$)` with the `m` flag, and `\n*$` matches at the
   end of EVERY line under `/m` — so every release body captured empty and the app
   showed six headings with no bullets. It splits on headings now, and REFUSES to
   write rather than emit empty notes: a generator that silently produces nothing
   is worse than one that throws.
2. My own SC 2.5.3 check failed the stamp — it showed "1.18.3" and answered to
   "App version", so saying what is written on it did nothing. The name is built
   from the version at runtime now. A check added yesterday catching today's work
   is the point of adding it.
3. The stamp became a button, which took the toolbar to 21 against D47's cap of
   20. The cap did NOT move. What changed is what it counts: controls inside the
   bar's GROUPS, where the title and the version stamp sit outside any group and
   are not things you reach for. A status readout should not compete with the
   budget for actual controls.

**Still owed from the hub's new baseline:** §7e's (i) surface (what the app is and
is not, install instructions with platforms named, data sources, how to report a
problem, licence) and §7f's text diagnostic. Both are on the Still open list where
a reader can see them.

### D70 — auditing what a gate SELECTS (SHIPPED 1.18.3, staging)

D69 ended with "the way to find more is to audit what each gate selects, not what
it asserts". This is that audit, run rather than promised.

A throwaway script listed every visible control against the a11y gate's own
selector. **Ten it had never had an opinion about**: five `<select>` and five
coordinate `<input>`. Natively focusable, so SC 2.1.1 was never at risk — but
their target size had never once been measured, in any theme or viewport, since
the gate was written.

Widening it found two real failures immediately: the Export checkboxes at
**13x20px**. Fixed by stretching the label — a checkbox's label toggles it, so the
target is the union, and the box stays visually small because inflating it to 44px
would satisfy a number rather than a person. The gate measures that union now,
which is what the criterion actually means.

Widening also broke the naming check, and that is worth recording: it only knew
about text content and `aria-label`, so every correctly `<label for>`-named field
in the app came back as unnamed. **A check that knows one of four legitimate
sources punishes the other three.**

Two things stay deliberately outside the sweep, and they are exclusions rather
than oversights: the canvas, which is a drawing surface with its own labelled
keyboard route rather than a target, and the file input hidden behind Choose
image, which is unreachable by design and reached through a real button.

**The planting, and the bit that was unverified — now resolved.** Shrinking a
`<select>` to 20px is caught. Removing the label stretch was NOT caught, and the
reason turned out to be the fixture rather than the gate: *"Include construction
lines (horizon and guides)"* WRAPS to two lines at 390px, so the label measures
47px tall with the stretch and 47px without it. The plant never produced an
undersized target to catch.

Planted properly — a SHORT label with the stretch removed — it reports
**82.9x23.3px** and fails; the same short label with the stretch restored passes.
So the rule is load-bearing and the check is real.

Worth keeping as its own shape: **a plant that does not change the measured
quantity proves nothing about the check, and looks exactly like a check that
cannot fail.** The tell was that the two states measured identically; the fix was
to measure them rather than to reason about them. A long label is a bad fixture
for a size test precisely because wrapping hides the thing under test.

### D69 — a control the gates could not see (SHIPPED 1.18.2, staging)

Noah, 2026-08-02: **"Where do I load the image?"** Two separate faults behind one
question, and the second is the serious one.

**Findability.** Reference image was the SIXTH section in Setup. It is what you do
at the START of a drawing, so it is the first section now.

**It had no keyboard route at all.** I built Choose image as a `<label class="btn">`
wrapping a hidden file input — the standard trick, and it works under a finger. A
label cannot take focus. So loading an image was pointer-only, and **every gate
passed**: the a11y gate sweeps `a[href], button, [role=button]` and a label is
none of those, so its size was never measured and its reachability was never
asked about.

Two fixes, because widening the sweep was not enough. Adding `label.btn` to the
selector made the gate MEASURE it — and it still passed, because nothing in the
gate ever asked whether a control can take focus. That check exists now (SC
2.1.1), and planting the label back fails it in every theme and viewport.

**The shape worth naming: a gate can only fail on questions it asks.** Every empty
check this week was a question asked of the wrong thing; this was a question never
asked at all, which is quieter and worse. The tell was a control that no gate had
an opinion about — and the way to find more of them is to ask what each gate
SELECTS, not what it asserts.

### D68 — placing the reference image (SHIPPED 1.18.1, staging)

D67 put a photograph under the drawing and left it centred, which is half the
job: an underlay is only useful once the horizon IN the picture sits where you
want your horizon, and its scale matches what you are drawing.

Bigger / Smaller / four arrows / Refit. Steps are a FRACTION of the image rather
than fixed pixels, so a nudge feels the same on a small photo as a large one.
Scaling holds the image's own middle — grow it from a corner and whatever you were
looking at walks off the screen while you resize, which is the kind of thing that
is obvious once and invisible in a changelog.

Every step is a button and the buttons are the ONLY route, not a fallback beside a
pinch. That is deliberate: an accessible path that exists beside a gesture tends to
rot, because nobody uses it. Here there is nothing else to use.

Planted by scaling from the corner instead of the centre — the check watches the
midpoint across a resize, not just the dimensions, so it catches a change that
leaves the size correct and the position wrong.

### D67 — a reference image (SHIPPED 1.18.0, staging)

Noah, 2026-08-01: *"I want to consider importing and drawing over an image
later."* The other half of D65 — the technique is to draw along two edges of a
building in a photo and let their crossing give you its vanishing point.

**The storage decision, made rather than discovered**, which is what NOTES said
to do when this was first raised. The image is a blob in IndexedDB (schema 2),
not base64 in the project JSON: in the JSON it turns a 30KB project into a 4MB
one carried on every save and load. The cost is stated in the changelog rather
than left to be found — a project file copied to another device arrives without
its image, because the image was never in it.

Drawn in CANVAS coordinates, so it pans and zooms with the work. An underlay
fixed to the glass cannot be lined up with anything and is no use. Fitted to the
page keeping its aspect: a stretched photograph makes every angle in it a lie,
and angles are the entire point of the app.

**A check that could not fail, again, and the same shape as always.** "Removing
the image clears it from this device" passed against a build that never stored it
— gone and never-there look identical from the far side. It asserts the image IS
kept while present, before asserting it can be removed. That is the seventh empty
check this week and the second of exactly this kind: an assertion about an absence
with nothing establishing the presence first.

Also caught: the walk opened IndexedDB pinned to version 1, which broke the moment
the schema went to 2. Unpinned — that check is about a scene surviving a reload,
not about which version of the store it lives in.

### D66 — a limit is not an error (SHIPPED 1.17.1, staging)

Noah, 2026-08-02: *"For calculating vanishing points of nearly parallel lines,
perfect calculation is unnecessary. If the difference cannot be discerned on the
screen past a certain level then all past that level can be ignored. Beyond
parallel, the vanishing point simply goes to the other intersection. That only
leaves parallel being the error, and if they draw perfectly parallel lines, you
can simply nudge it just slightly."*

Right on all three counts, and D65 shipped a day earlier with all three wrong.

1. **The refusal floor was over-cautious.** It rejected anything within about a
   degree of parallel — and a degree over 700px crosses 36,000px away, which is a
   real point this app already draws edge markers for and now has Fit points to
   look at. It was throwing away answers it could give.
2. **Past parallel needed no handling at all.** The determinant changes sign and
   the crossing returns from the other side by itself. The only thing that had
   made it look like a case was refusing the neighbourhood around it.
3. **Exactly parallel gets a point, not an error.** `vpReach` is DERIVED rather
   than picked: lines aimed at a point R away land about L²/R from where parallel
   lines would across a page of diagonal L, so half a pixel gives R = 2L² — about
   8 million for a 1600x1200 page. Large, finite, ordinary. Nothing is
   approximated up to there; past it the answer is pinned somewhere that draws
   identically to the one asked for.

**The generalisation worth keeping: a limit is not an error.** The instinct that
produced D65's floor was to refuse near a singularity because the arithmetic gets
delicate. The better move is to find where the difference stops being observable
and stop there, which turns a refusal into an answer and deletes the special case
rather than guarding it.

**And a check that could not fail.** The first version of this asserted the
near-parallel point was "more than 5000px away" — which an UNCLAMPED answer
satisfies just as well, so a plant removing the clamp passed. "Far away" and
"pinned to the reach" are different claims; it asserts the second now, plus a
companion that an ordinary crossing comes back untouched, so the clamp cannot
quietly start acting on everything.

### D65 — a vanishing point from two drawn lines, BOUND (SHIPPED 1.17.0, staging)

Noah, 2026-08-01: *"Maybe creating vanishing points as the intersection of two
drawn lines."* Bound, on his call — move either line and the point follows, and
everything running to that point follows with it.

Stored as two edge ids and nothing else, re-derived at the top of every solve —
the same shape as a slope point (D53), and for the same reason: a derived thing
that stores a position can go stale, and one that stores its definition cannot.

**Three refusals rather than fudges.** Parallel lines meet infinitely far away, so
there is nothing to place. NEARLY parallel is refused on the same grounds and it
is the less obvious half: a hair of divergence puts the crossing tens of thousands
of pixels out and moves it hundreds for a one-pixel nudge, which is a number
rather than a point. And a line that already runs to the point cannot help define
it — that is a cycle, refused when asked rather than found later as a hang.

**The walk fixture was wrong first, and the app was right.** Two `Add line` clicks
in a row lay both strokes along the SAME current guide, so they are parallel by
construction — the app refused the pair correctly and the check read that refusal
as a failure. Fixed by forcing each stroke onto a different point through the
guide picker, which is also a truer exercise of the real controls. Third time this
week a fixture has been the thing at fault, and the tell each time was the app
producing a sensible refusal that the check had no case for.

This is the half of the image-import workflow that needs no image. When a photo
can be placed underneath, drawing along two building edges to recover its
vanishing point is the whole technique.

### D64 — Fit points (SHIPPED 1.16.0, staging)

Noah, 2026-08-01: *"I'd like to be able to zoom out to see VPs on the screen, at
will, and maybe zoom back to the canvas again."*

Points off the paper are the ORDINARY case, not an edge one — D27's edge markers
exist because of it. But a marker pointing off screen gives you a direction, not a
relationship: you cannot see how far apart two points are, or that one has drifted
somewhere silly, without seeing them. `fitAll` frames the paper and every point
together; plain Fit comes back.

Locked points are included, deliberately. A point you cannot drag is still one you
want to look at, and a view that quietly omits something is worse than no view.

Planted by making it ignore the points: it then frames only the paper, no point
comes on screen, and the check fails on the position rather than on the zoom —
which matters, because the zoom level alone changes either way.

### D63 — solids know which way they face (SHIPPED 1.15.0, PROMOTED)

Noah's criticism, and it was the right one: *"assign a face a normal that doesn't
change no matter what direction you look at it from and just cull the reverse
normals like any 3-D program"*, and *"I don't think eye line makes any sense with
a one or 2D or maybe any perspective. It's forced by the two that make the horizon
line."* Both halves right, and the second falls out of the first.

Replaced D37's front-pair rule, D44's stored rings, D48's horizon ordering, D49's
depth signs and D54's roof branch — five rules, each correct in one case and
patched by the next. Visibility is now the sign of the projected polygon's area
and nothing else. Nothing consults eye level or the horizon.

**Three things it taught, all found by measurement:**

1. **The "solver/renderer disagreement" never existed.** The walk poked `vp.y`
   straight onto the scene and never re-solved — fine under the old rule, which
   read the points live at draw time; meaningless under this one, where the box
   simply never moved. That is the third and fourth appearance of that same
   instrument error this week.
2. **A street plot's ring goes round the opposite way to a box's.** Feed it the
   box's face scheme and every face comes out inside out — as an internally
   CONSISTENT set facing the wrong way, which is exactly what `orientSolid` cannot
   detect, since it only chooses between two consistent orientations. Fixed at the
   RING, which is the one place that ends it for every future builder.
3. **Back-face culling needs a CLOSED solid.** A roof was two planes with no ends,
   and an open surface has no inside to be on the far side of: its slopes read
   positive both above and below the horizon, because the ridge is always drawn
   above the eaves so the winding depends on left/right order rather than on
   viewpoint. Closing it with its gable ends and underside makes it a prism, after
   which the one rule works on it unchanged.

### D62 — a circle in perspective (SHIPPED 1.14.0, staging)

The biggest thing the app could not draw. Wheels, arches, domes, cups, manholes —
everything an artist reaches for after boxes.

**A circle is not new geometry.** The tempting design is an object with a centre
and a radius that has to be kept in step with everything else; that object would
have gone stale the first time a vanishing point moved, which is the defect this
file records four separate times. It isn't one: a circle is a FACT ABOUT FOUR
CORNERS — the square it is inscribed in — and those are ordinary vertices the
solver already holds. So a circle stores four ids and nothing else. Its record
has exactly three keys and a test asserts that, because the day it grows a fourth
is the day it can disagree with the drawing.

**The curve is exact, not the eight-point construction.** A circle drawn on a
plane and photographed is a conic, and the map from that plane to the page is the
projective transform taking the unit square to the four corners (Heckbert's
square-to-quad). Send the unit circle through the same transform and you have the
ellipse the camera would have made — tangent to each side at its PERSPECTIVE
midpoint, which is the property the eight-point method approximates. Tested by
fitting a general conic through five of the sampled points and measuring the rest
against it: residual under 1e-9, which is an independent check rather than a
restatement of the code.

**Two fixtures that could not fail, both fixed by planting.**

- *"An unforeshortened square gives a true circle"* asserted something FALSE. I
  put both points 10 million pixels away expecting no foreshortening, but two
  horizon points that far apart give two nearly-parallel directions, so the square
  collapses to a sliver — radius ran 0.01 to 141. A square on the ground in
  two-point perspective is never unforeshortened. Replaced with inscribed-and-
  tangent-to-all-four-sides, which is true and is the property worth holding.
- *"The curve is an exact conic"* had a fixture too gentle to test its own name.
  Its quad was nearly a parallelogram, and on a parallelogram a plain BILINEAR
  blend is very close to the projective answer — so a plant swapping the exact map
  for bilinear passed the test named for exactly that distinction, and was caught
  only by a different test downstream. The fixture is strongly foreshortened now.

Schema 3, because circles are a new array; `migrateScene` gives a v2 file an empty
one and the project loader's version list is written out rather than compared with
`<=`, so a file from a future build is still refused rather than half-read.

### D61 — a street, and the plan on its own (SHIPPED 1.13.0 / 1.13.1, staging)

**1.13.1 adds Plan only.** Noah's own description was two steps — *"draw a grid
of lines that act as streets and then plot them with buildings"* — and I built it
as one action, which is the useful default but is not what he said. The grid is a
thing in its own right: an artist placing buildings by hand wants the lines and
none of the massing. `buildStreet` with no storeys lays the same road, crossroads
and block lines and stands nothing on them; every line is still held by the point,
so the plan turns when it is dragged.

Costs nothing in the solver — the storeys loop simply does not run — which is
worth noting as the shape a good option has: if adding one needs a new code path
rather than an absent argument, the first version probably conflated two things.

### D61 — a street (SHIPPED 1.13.0, staging)

Noah, 2026-08-01: *"buildings on both sides of a road with one point perspective
and alleys/crossroads all sound cool. Maybe draw a grid of lines that act as
streets and then plot them with buildings?"* — and that last sentence is the
design. The grid IS the streets; the plots it makes are what the buildings stand
on.

**Nothing new was invented.** It is three amendments already in the app pointed at
one construction, which is the strongest sign the earlier ones were right:

- **D52's fraction.** Four rails start on the same near line and run to the same
  point, so at a shared fraction of the way there they all reach the same height
  on the page. That is what keeps every crossroad horizontal — the same argument
  that keeps a room's far wall a rectangle, with four rails instead of four
  corners. Nothing is straightened afterwards.
- **D50's interval.** `depthAtInterval` against a unit distance IS the fraction,
  so one formula serves marks along a guide and blocks along a street.
- **D51's gauge.** Every building's height is a multiple of eye height measured to
  the horizon from its own corner, so equal storeys foreshorten correctly at every
  depth, rooflines run to the point without being aimed there, and moving the
  horizon re-measures the city.

**Two things the tests could not see, and a screenshot could.**

1. **The gauge sign was inverted** and the whole city was built downward into the
   ground. Every ratio came out exactly right — a wall of the correct length
   pointing the wrong way is still the correct length — because the tests measured
   height with `Math.abs`. Nine unit tests, all green, all blind to it. Rendering
   it once and looking made it obvious in a second. The tests are signed now and
   assert upward first.
2. **The defaults were unusable even when correct.** Standing in a street, a
   building a few times your own height genuinely fills the sky, so drawn straight
   every near block ran off the top of the page with nothing readable left. That
   is not a geometry bug and there was nothing to fix in the solver; the near kerb
   and the skyline are now ONE decision, scaled by the single factor that lands the
   tallest block inside the paper. The blocks keep their proportions; what changes
   is how far away you are standing.

**And one check that could not fail, caught by planting.** "Blocks crowd toward
the point" was written as `far < near + 1e-9`, which admits `far === near` — and
equal spacing is exactly what naive fractions give, because a fraction of the way
to a point is LINEAR in page height. A plant replacing the interval formula with
`first * j` passed every test in the file. It is `far < near * 0.97` now, plus a
direct assertion that the fractions themselves are sublinear.

That is the fourth empty check this session, and the second whose emptiness came
from a tolerance admitting the degenerate case rather than from a filter matching
nothing. Worth naming as its own shape: **a tolerance wide enough to admit the
null hypothesis is not a tolerance, it is the absence of a test.**

### D60 — a divider holds a FRACTION, and depends on what it divides (SHIPPED 1.12.5, staging)

Noah's IMG_1361/1362: the house pulled into a crossed tangle when a corner was
dragged far. Closed. Three separate faults, each of which alone was enough.

**1. The gable midpoint stored a LENGTH.** Push a box through a vanishing point
and a depth goes negative (D39) — the gable edge flips to the other side of its
origin. A midpoint holding a length stayed behind on the old side, putting the
ridge outside the building. This is exactly D52's lesson, written for the room's
far wall six hours earlier: *"the corners hold a FRACTION, not a length. Store
lengths instead and the wall skews the instant the point moves."* The room got it
right. The roof, written after it, did not. Fixed by `divide: { ofId, f }`,
re-derived every solve like `gauge` (D51) and `recede` (D52).

**2. `t1` was an unsigned `hypot`.** `buildRoof` measured the gable edge with
`Math.hypot`, which cannot be negative, so the sign was destroyed before the
formula ever saw it. Both distances are signed projections onto the guide now.
The interval formula itself (D50) was never wrong — checked against a real
projection with a negative first interval, it is exact. My first hypothesis was
that D50 broke under a negative `t1`; measuring killed it.

**3. The divider did not DEPEND on what it divides.** `depsOf` returned only the
origin, so the topological solve placed the midpoint before the corner it halves
had moved. Correct arithmetic on yesterday's edge — the hardest kind of wrong to
see, because nothing is out of range and nothing is NaN; it is just one solve
behind. `depsOf` includes `divide.ofId` now, and the cycle check walks it too.

**And a fourth thing, found by the gate rather than the report.** A corner dragged
exactly ONTO a vanishing point has no direction to run in; the solver marks the
dependents degenerate and leaves them at their last valid positions, which is the
right thing to store. Rendering then filled faces through those stale points —
drawing a surface nobody constructed. A solid with an unplaced corner draws its
wireframe and no fill now. The drawing does not vanish under the finger; what
stops is the app asserting something it cannot place.

**Four checks, and getting them to fail was most of the work.**

- Three unit tests pin the fraction, the sign and the dependency. Each was planted
  against separately: dropping the dependency fails 3, storing the length fails 3,
  restoring the unsigned `hypot` fails 1.
- A fourth unit test was WRITTEN AND DELETED. It asserted "neither roof plane
  crosses itself" and passed against all three planted faults, because that
  fixture holds the midpoint off its gable without the numbers ever folding into
  a crossing. It is recorded in the file as a comment so nobody adds it back.
- The walk asserts the real thing in the real app: the report's own drag sequence,
  every face tested for a crossing, every divider tested against the edge it
  divides. That check needed three passes before it could fail. First it inherited
  an overhead fixture from the checks above it, which never tangles — rebuilt from
  a clean house. Then it counted crossings only, and a misplaced ridge does not
  always cross — the divider-on-its-edge property was added. Then, with the
  fraction removed, the loop found no dividers at all and reported a clean house:
  the exact fault it exists to catch, passing. It asserts the dividers EXIST now.

That last one is the third time this session an empty check has been caught by
planting, and the second time the emptiness came from a filter matching nothing.
Cross-app lesson is hub LESSONS 7g.

### D58 / D59 — the bar holds still, and it carries a cube (SHIPPED 1.12.4, staging)

**D58 — the toolbar was rearranging itself because the DRAWING changed.** Noah
sent two screenshots seconds apart in which the zoom group had moved from the end
of row one to the start of row two, and Setup/Points/Clear had slid from the left
of that row to the right. Nothing had been touched but the canvas.

The guide picker is a `<select>`, a select is as wide as its longest option, and
its options are the scene's vanishing points. Adding a roof introduced *"Guide:
VP2 roof down"*, the select grew by 25px, and the bar reflowed around it. Fixed
width now; the full text is still in the open list, which is not constrained by it.

The check compares the geometry of EVERY bar control across building a house —
the exact sequence that produced the screenshots — rather than watching the
select alone. That is deliberate: the select was the only scene-dependent width
*today*, and a check written to that fact would go quiet the moment another one
appeared. Same shape as D55: gate the property, not the instance.

**D59 — Noah:** *"I want to see the option to add a cube on the main screen. I
don't think I need a line generator?"* Add cube is on the bar beside Add box; Add
line moved into Setup under Build.

**Add line is not gone, and the reason is worth writing down.** It is the non-drag
route to a line (SC 2.5.1), which is why D34 put it on the bar. What D34 got wrong
was conflating *"an alternative exists"* with *"the alternative is one tap"* — the
criterion asks only for a single-pointer route, and a disclosure is one.

**The interactions gate refused it, correctly, and had to learn something.** It
tested the default page state, so a control inside a closed panel read as "not
keyboard reachable" — true as written, and it would have been a real failure if I
had simply deleted the button. The declaration now carries `behind:`, naming the
disclosure, and the gate proves THAT opener is itself keyboard-reachable before it
believes anything inside. The route is checked end to end rather than assumed,
which is stronger than what was there before the move.

Note the contrast with D57, one release earlier: Touch draws came OUT of Setup and
Add line went IN, and both are right. The question is never "panel or bar", it is
what the control costs against how often it is reached for.

### D57 — the way in must cost what the way out costs (SHIPPED 1.12.3, staging)

Noah, 2026-08-01: **"'Touch draw' shouldn't be buried in menus."**

Touch draws was in Setup, under *While drawing*, beside Assist / 45° / Weld. It
does not belong with them: those change how a stroke behaves, and this decides
whether a finger draws at all. It is the most consequential switch in the app on
the device the app is FOR.

**The sharper version of the defect is the asymmetry.** When it is on, the
standing flag on the canvas carries its own Turn off (D31's rule — a state you are
in says so and carries its own exit). So turning it OFF was one tap, and turning
it ON was three: Setup, scroll, tap. The direction you reach for first was the
expensive one, and the cheap direction existed only because a different amendment
had already got it right. Nothing noticed, because both directions worked.

It is on the bar now, in its own group. That took the bar from 18 controls to 19,
inside D47's cap of 20 — which is what the headroom from D54 was for, and the
reason that cap was not raised when the roof pushed against it.

**The check measures the ROUND TRIP from a clean load with nothing open**, rather
than asserting the button exists. A control that is only cheap once you have
already opened a panel is not cheap, and a check that opens the panel first would
have passed in every version of this. Planted by putting it back in Setup: the
button is still there and still works, both directions still succeed, and the
check fails on `onBar:false` with a zero-sized rect — which is exactly the state
Noah was describing.

### D56 — one word, one meaning (SHIPPED 1.12.2, staging)

Noah, 2026-08-01: **"Person, 'place,' or thing…. Label is confusing."**

The Human-scale row read `[A person ▼] [Place]`. Next to a noun, "Place" reads as
a noun — the row scanned as a list of nouns rather than as a thing and what to do
with it. And the toolbar has had a **Place MODE** since the beginning, for putting
vanishing points down. One word, two controls, two meanings.

The button's id has said `add-figure` since D51. The label now agrees with it, and
with Add line / Add box / Add VP: **Add**.

**The gate that would have caught it is about NAMES, not labels.** Two controls
answering to the same accessible name is ambiguous for anyone driving the app by
voice or moving through a list of controls — "activate Place" had two answers and
nothing in the app noticed. The check is in `a11y-gate.mjs` and it is deliberately
on the accessible NAME rather than the visible text, which is why the two Hide
buttons and the per-point Lock / Delete rows pass: they show the same word and
answer to different names.

**Writing it found two real WCAG failures that had nothing to do with the report.**
SC 2.5.3 Label in Name says the words on a control must appear in its accessible
name, or saying what is written does not activate it. `Add VP` was named "Add a
vanishing point" and `On horizon` was named "Keep VP1 on the horizon line" —
neither contains what the button says. Both fixed, and the criterion is gated now,
added in the same commit as the `aria-label` that made it relevant.

Two false positives had to be cleared out of that check first, and both were the
criterion's own exclusions rather than app defects: an `aria-hidden` arrow glyph
on the off-screen point markers is decoration and not part of the label, and a
button labelled only with a minus sign has no text for the criterion to be about.
A check that reports those trains you to skim its output, which is how a real one
gets skimmed with them.

### D55 — a control must not move when you use it (SHIPPED 1.12.1, staging)

Noah, 2026-08-01, with two screenshots of the same panel: **"Buttons move when
used."**

The selected state is a filled chip WITH a tick, never hue alone (hub LESSONS 6,
Doctrine §4). The tick was drawn by `.btn[aria-pressed="true"]::before`, so it
existed only while the button was on — and a pseudo-element that appears makes
the button WIDER the moment it is pressed. `.setup-row` wraps. Turn on Solid and
Hidden lines is pushed off the first line, Eye level drops a row, and the four
While-drawing toggles move down with them. A finger already travelling toward one
of those lands on a different control.

The fix is to reserve the tick's space on every toggle and change only its
`visibility`. The tick stays — it is the non-colour signal and removing it would
have traded an accessibility rule for a layout one. Its width is set explicitly
rather than left to the glyph, so it cannot drift with the font.

**The check needed two text sizes, and finding that out was the work.** At
default text the panel is 320px and the rows have slack, so pressing a button
changes its own width by 18px and moves NOTHING else. A gate written only there
would have measured the cause and missed the whole reported symptom. At 200% text
the panel is 640px, the rows are full, and the same press moves eight other
controls — `show-hidden` 370px left and 100px down, `eye-level` 280px left, every
While-drawing toggle a row lower. Both cases are asserted now, and both were made
to fail against the exact pre-fix CSS before either was believed.

Two plants were wrong before the third was right, which is itself worth keeping:
`display:none` on the reserved slot removed the tick in BOTH states, so nothing
moved and the check passed while the accessibility signal was gone; and setting
`content:""` left `width:.75em` reserving the space anyway. A plant that does not
reproduce the original defect proves nothing about the check — it has to be the
real thing, and here that meant restoring the exact two lines that shipped.

### D53 / D54 — the roof, and what planting found under it (SHIPPED 1.12.0, staging)

A house needs a roof, and a roof is the first thing in this app that is neither
level nor upright. Everything up to here ran to one of three axis points or
straight up; a slope runs to neither.

**A set of parallel slopes has a vanishing point of its own, and it sits on the
VERTICAL through the point their horizontal projection runs to.** That one fact
is what makes a roof drawable rather than guessable, and it is the whole of D53.
A slope point is stored as `trace: { vpId, rise }` and re-seated at the top of
every `solveScene`, so it can never be stale: drag the wall's point and the roof
turns with it. It is exempt from D41's cap of three, because the cap counts AXES
and a slope is an axis tilted — `axisPointCount` is the count that matters now.

The ridge sits over the perspective middle of the gable, which is `depthAtInterval`
at f = 0.5 (D50) rather than the average of the two ends. The far peak is an
INTERSECT rather than a measured height, so it comes out shorter on the page by
itself; measuring it would have been drawing what you know instead of what you
see.

**D54 is not a feature. It is two defects that only planting found**, and both
were hiding behind checks that passed:

1. **The roof's planes were never drawn at all.** `visibleFaces` derives a
   solid's two visible walls from its `top` and `bottom` faces. A roof has
   neither — a slope is a top face tilted — so the derivation found nothing and
   returned an empty list. The walk said "and Solid shades the roof planes as
   well as the walls — ok" because it was counting the TOTAL shaded area, and
   the walls alone cleared the bar. Deleting a whole roof plane did not move it.
   The check now measures the roof's own contribution as a before-and-after
   difference: 9,081 and 17,944 pixels where it had been reporting 42,939.
2. **The fix needed the eye-level rule, and the check for THAT was empty too.**
   You see a roof when it is below your eye; look up at a gable from the kerb and
   you see the wall and the underside of the eaves, not the roof. The first
   version of that check compared an overhead house against the below-eye-level
   wall count — two different poses, so the difference said nothing — and then,
   once that was fixed, the fixture put the ridge off the top of the page, so
   nothing was painted whichever way the renderer behaved. Two consecutive
   versions of a check that could not fail. It asserts its own fixture now (every
   roof corner above the horizon AND on the page) and drops the horizon instead
   of lifting the house.

**The pattern, third time now.** D39→D37 and D42→D45 were a new capability
silently invalidating an older amendment's assumption. This is the other one: a
check written at the same time as the code it checks, measuring something
adjacent to its claim, and green from the day it was written. The gates cannot
catch that. Only planting the fault can, and the rule from Doctrine §6 —
make it fail before trusting it — earned its place twice in one release.

**One more thing came out of it.** The roof's button took the toolbar to 21
controls against D47's cap of 20. The fix was to take the three GENERATORS off
the bar (Cube, Room, Roof now live in Setup under *Build*), not to raise the cap.
Add line and Add box stay, because they are the non-drag path to Draw mode and
Box mode under SC 2.5.1 — a cube has no drag gesture to be an alternative to.
Raising the number would have been the same move as exempting the grid from the
contrast gate, which Noah has already ruled on once.

### D52 — the interior room (SHIPPED 1.11.0, staging)

Third and last of the three Noah agreed to, and the only one that is a NEW KIND
of thing rather than more of what exists. A room is a box you are INSIDE, and
that inverts what every piece of the box code assumes: you see the far wall, the
floor, the ceiling and both side walls, and the surface nearest you — the opening
you are looking through — is the one you never see.

So a room stores FIVE faces and no near one, and `visibleFaces` short-circuits on
a solid that has a `back`: an interior culls nothing, because there is nothing to
cull. That is simpler than the box path, not harder.

**The far wall stays a rectangle because the corners hold a FRACTION**, not a
length. All four sit the same fraction of the way to the point, which makes the
far wall the near wall scaled about that point — a homothety, so rectangularity
is preserved for free rather than enforced. Store lengths instead and the wall
skews the instant the point moves, because the four corners are different
distances from it. Planting exactly that collapses the room to a single flat
plane: 150,984 pixels of back wall and **zero** of all four sides.

**A defect in D39 fell out of this.** The guide-reversal flip — which negates `t`
when a vanishing point crosses its corner's origin, so the corner holds position —
was firing on DERIVED lengths too. A derived length is recomputed from scratch
every solve, so there is no history to preserve and the negation just threw the
corner to the wrong side; the far wall skewed when the point moved past one of its
corners. The flip is now skipped for anything holding a ratio or a fraction. It
had been latent since D51 shipped an hour earlier.

**A room needs a point you are FACING.** With every point off to the sides — the
default two-point setup — the construction builds a tunnel running past you,
which is honest geometry and is not a room. Rather than draw that, it refuses and
says to move a point onto the paper. That is the one-point interior the exercise
is about, and it leans on D46: a point on the paper is the most ordinary
construction there is.

**All three delivered.** Depth division (D50), the scale figure (D51), the room
(D52). What the app can now do that it could not this morning: space anything
evenly in depth, check any scene against human scale, and draw an interior.

### D51 — the scale figure (SHIPPED 1.10.0, staging)

Second of the three Noah agreed to, and the one with the best effort-to-usefulness
ratio in the app so far.

**Everyone's eye is at eye level.** So the vertical from ANY point on the ground
up to the horizon spans exactly the observer's own eye height — wherever that
point is, however far away. That segment is a ruler that the perspective has
already foreshortened for you. A figure your own height has its eye ON the
horizon at any depth, which is the oldest trick in the book and the one artists
use to check a scene reads at human scale.

Generalised it measures anything of known height, so the control offers a person,
a door (1.2), a storey (1.9) and a lamp post (2.6) as multiples of eye height.

**It stores a RATIO and re-derives the length inside `solveRay`.** That is the
whole design: a gauge that remembered its length would be a stick standing at
yesterday's size, and a wrong measurement made with authority is worse than none.
Move the figure, move the horizon, or drag a point that defines the horizon, and
every figure re-measures. `gaugeSpan` reads the horizon at the FIGURE'S OWN x, so
a tilted horizon measures correctly along its length, and falls back to the
eye-level line when there are fewer than two points on the horizon (D36).

Standing one exactly on the horizon is refused: anything on the ground there is
infinitely far away, so there is no height to draw.

**Planting the defect** — remember the length instead of the ratio — makes all
three figures 60px tall regardless of depth and reddens three walk checks and two
unit tests. That is exactly the picture a stale gauge produces, and it is the one
an artist would trust and be misled by.

**Next: the interior room.** A box you are INSIDE, which inverts the face logic in
the opposite direction from everything fixed on 2026-07-30, and is the one-point
exercise every beginner starts with.

### D50 — equal intervals in depth (SHIPPED 1.9.0, staging)

**Noah, 2026-07-31:** *"I want to see maybe a city block generator? What else
would be useful for artists? A house scene? Internal room scene?"* — and then
"Go" to the answer: this first, then a scale figure, then the interior room.

The reason this comes first is that a city block generator without it would have
been MY guess at spacing rather than the artist's. Every depth in the app was
eyeballed. Equal intervals going away from you — fence posts, floor tiles, window
bays, the buildings along a street — is the construction an artist reaches for
constantly, and it is the primitive underneath all three of the scenes he named.

**No diagonals needed, because the answer is exact.** Along a line to a vanishing
point, with D the distance from the origin to the point and t1 the first
interval, the mark f intervals out sits at

    t(f) = D · f · t1 / (D + (f - 1) · t1)

t(1) = t1, t(0) = 0, and t → D as f → ∞. Fractional f divides instead of
repeating, so one formula does both. This is the same answer the corner-to-corner
diagonal gives on paper — it is projective geometry, not a fit.

**Gated against something derived independently**, which is the part that makes
it believable: the unit test builds a real 1-D projection `t = D·d/(d+k)` for an
arbitrary camera constant k, and asserts the formula agrees to 1e-9 at 2, 3, 4, 7
and 12 intervals and at quarter divisions. Planting naive even spacing (`t = f·t1`)
turns the walk's measured gaps from 166/140/120 into 200/200/200 and reddens two
unit tests — the plant produces exactly the wrong picture, which is the one thing
an artist would notice instantly.

Every mark is an ordinary ray vertex on the same guide with the same origin, so
nothing new enters the model: the run is held by the construction and moves when
the point does. A whole run is one `beginGesture`, so one undo. Marks that would
land past the vanishing point are dropped and counted in the announcement rather
than placed somewhere meaningless.

**Next, in order:** the scale figure — everyone's eye is at eye level, so a
standing figure at any depth has its eye on the horizon, which makes it nearly
free and is the tool artists use to check a scene reads at human scale. Then the
interior room, which is a box you are INSIDE and therefore a real new capability
rather than more of the same.

### D49 — stop recalculating what the construction knows (FIXED 1.8.1, staging)

**Noah, 2026-07-31, after a screenshot of three cubes straddling the two lines:**
*"All these cubes fail at eye/horizon lines."* Then, cutting the whole thing
short: *"Why do you recalculate normals at all?"*

That question ends a run of four amendments chasing the same bug. D37 stored the
two front walls. D39's signed depths invalidated that. D44 replaced it with
"nearest is the corner LOWEST ON THE PAGE". D48 (never shipped) was going to
patch that to "furthest from the horizon". Every one of them derived, from SCREEN
POSITION, a fact the construction already held.

**`buildBox` puts the anchor at the near bottom corner and runs both depths
OUTWARD from it.** The two walls meeting at the anchor's vertical edge are the
front pair, by construction, permanently. Dragging the box around the page cannot
change that. The one thing that does is a depth going NEGATIVE — which puts that
corner on the near side of the anchor — and that is a stored sign, not a
measurement. Two signs, four cases, exact:

    both +      anchor nearest        walls at ring[0]
    left -      left corner nearest   walls at ring[1]
    right -     right corner nearest  walls at ring[3]
    both -      back corner nearest   walls at ring[2]

No eye level, no screen y, nothing to go stale, and a test that drags the box
from y=1150 to y=100 and asserts the answer never moves.

**The second half was the other line.** Whether you see the top of a horizontal
face or its underside is decided by the **HORIZON** — the vanishing line the
points define — not by the authored eye-level marker. A horizontal plane below
your eye projects below the horizon; above your eye, above it. Eye level is a
drawn reference that COINCIDES with the horizon whenever the points are level,
which is why testing against it worked for as long as it did and failed exactly
in the band Noah photographed. Falls back to eye level when there are fewer than
two points on the horizon (D36), because a one-point scene is an ordinary drawing.

Consequence worth stating: **moving the eye-level marker no longer changes what is
drawn.** It never should have. The lesson is still there — it is about where the
POINTS sit relative to your eye, and moving the points is what changes the view.

**Gated:** the walk drags a lopsided cube from well below the horizon to well
above it and asserts the same pair of walls stays lit (planted: they swap,
81736/41791 becomes 18970/46743) with the top giving way to the underside; plus a
differential in the disagreement band where the horizon moves across a face and
the eye-level line never moves. Planting both old rules reddens four walk checks
and a unit test.

### D47 — the toolbar (SHIPPED 1.8.0, staging)

**Noah, 2026-07-30, with a photograph of four toolbar rows:** *"Can you clean up
the menus now?"*

Thirty-three controls in four rows, taking about a third of an iPad's height away
from the thing the app is for. Every one of them was added for a good reason and
the sum was indefensible.

**The rule used to sort them:** does this get REACHED FOR mid-drawing, or SET?
Reached-for stays on the bar; set moves into a panel.

- **Bar (19):** the four modes; Add line / Add box / Add cube (the non-drag path
  to the primary act — burying it would make the accessible route the slow route,
  §4); the guide picker, which forces the NEXT stroke and so is used mid-drawing;
  Undo/Redo; zoom; Setup, Points, Clear, Export, Project, About.
- **Setup panel (13):** Solid + strength, Hidden lines, Rays, Grid, Eye level /
  Taller, Shorter, Stronger, Gentler / Assist, 45°, Weld, Touch draws.
- **Add VP** moved into the Points panel head, where the points are. That is
  placement, not hiding: since D41 it is disabled unless the sheet is empty.

A PANEL, not a menu or a dialog: Taller and Stronger are used while composing, so
a trip through a modal each time would be worse than the crowded bar. It docks
LEFT, opposite Points, so both can be open without either covering the other, and
its state is a saved preference like the Points panel's.

Measured: header 107px, 19 controls, the stage gets **87%** of the window.

**Three things this broke, all caught by gates rather than by looking:**
- The walk drives real controls, and a control inside a closed panel is not
  clickable. `tapSetup(page, id)` opens the panel and presses the real button; it
  skips only Playwright's actionability wait, and the a11y and interactions gates
  are where "44px and reachable" is actually asserted.
- The a11y gate assumed every surface it opens is a `dialog[open]`. A docked panel
  is not, so a surface now names what opening it looks like.
- Off-screen markers stepped clear of the Points panel only, and always leftwards
  — which would push a marker off the screen for a left-docked panel. They step
  away from whichever panel they hit, in the direction that has room. `renderSetup`
  has to re-render for that to happen, which the first version did not.

### D46 — a vanishing point belongs on the paper (FIXED 1.7.3, staging)

**Noah, 2026-07-30:** *"You are dead wrong when you tell the user that putting a
vanishing point on the paper makes it cease being a vanishing point. What the fuck
do you think a train track is?"*

He is right, and this is a correction of substance, not of a threshold. **D45's
guard forbade one-point perspective.** The point in the middle of the picture —
the track, the corridor, the road running away from you — is the most ordinary
construction in perspective drawing, and I shipped a rule that refused it and a
message that told the user it was invalid. Being confidently wrong in a toast is
worse than the missing feature, because it teaches the user something false about
their own craft.

Where the reasoning went wrong: I saw corners clamping near a close point, found
`tLimit = 0.95 x distance to the point`, and inferred that a point on the paper
"collapses the depth limits of everything near it". The premise is true and the
conclusion is a non-sequitur. A corner cannot reach its own vanishing point,
because that distance is infinity in the world being drawn — that limit is CORRECT
wherever the point sits, and has nothing whatever to do with the sheet. I turned a
correct rule about depth into a false rule about composition.

**What is refused now:** two points arriving at the same place, and nothing else.
Then the two guides through any corner are one line and a crossing defines
nothing. Everything else — including a point dead centre — is allowed.

Also corrected here: the collapse guard I first wrote for this measured distance
from the CENTRE, which never fires for horizon points, because D45 pins their y
and so they keep a fixed offset from it forever. Caught by the walk refusing to
stop after sixty presses. And `Add cube` now keeps its edge under half the
distance to the nearest point, so a fixed 40-unit minimum cannot exceed the
distance to the point that edge runs toward.

**The lesson to carry:** the app may state a limit, but it must never state a
FACT about perspective that it has not been taught. When a guard needs a
justification in prose, that prose is a claim, and a wrong one ships to the user's
screen.

### D45 — a cube that stays a cube, and a dial that stops in time (FIXED 1.7.2, staging)

**Noah, 2026-07-30, with a photograph:** *"Placed a cube with the button, and it
is only manipulatable with the out-of-sight corners."* The screenshot shows a flat
slab spanning the whole paper, with both vanishing point markers pinned to the
screen edges — so the points had been pulled well in with Stronger first.

**Three defects, all mine, all from D42.**

1. **`Add cube` used a fixed 220 canvas units.** That is a cube when the points
   are 2,000 away and a wildly foreshortened plank when they are 400 away, because
   what matters is the edge AS A FRACTION of the distance to the point it runs
   toward. It is sized from the nearest point now (18%, clamped), so it is a cube
   at any setting of the dial and gets more dramatic as you exaggerate.

2. **Stronger slid the horizon off eye level.** `scaleVpSpread` scaled x AND y
   about the paper centre, so a point sitting exactly on the horizon drifted a
   little further off it with every press. Points flagged `onHorizon` keep their y
   now; only the third point has a height worth exaggerating.

3. **The guard measured the wrong thing** — and the replacement I wrote for it
   was WRONG ON THE FACTS. **Superseded by D46; read that instead.**

**On the manipulation report specifically: I could not reproduce it, and the
explanation I offered in (3) was wrong — see D46. I still do not have one.** What was tried, all on
a cube: `manipulate` on all eight corners through the API (all moved, 40-72px); a
mouse tap on each corner's exact screen position (all eight selected the right
corner); and a ONE-FINGER CDP touch drag on each corner with Touch draws ON in
Select mode, matching the toolbar state in his screenshot (all eight moved
103-111px). The condition his screenshot is actually in — points pulled in close —
was reproduced too, and every corner still moved. If it recurs after 1.7.2, the
thing to capture is the Points panel open beside it, because the distance field
for a stuck corner will say whether it is clamped.

### D43/D44 — the canvas artifact and reversed normals (FIXED 1.7.1, staging)

**Both found by Noah on PRODUCTION 1.7.0, with photographs.**

**D43 — a band of stale pixels along the bottom of the canvas**, surviving even a
Clear. `sizeCanvas` sets the backing store to `viewport x dpr`; `draw` cleared the
VIEWPORT RECTANGLE. Those are the same thing only while the two agree, and they
stop agreeing the moment the stage gets SHORTER without a window resize — which is
exactly what a wrapping toolbar does when a button's text changes width, and what
Safari does when its bars return. The uncleared strip keeps the last thing drawn
there and CSS stretches it into the shorter box, which is the streaky band in the
photograph. 1.7.0 made this much more likely by adding nine toolbar buttons.

Two fixes, both needed: `draw` clears the whole backing store (same cost, cannot
go stale), and a `ResizeObserver` on the stage, because a `resize` listener never
hears about a toolbar that wrapped.

**D44 — inverted boxes had the wrong pair of walls shaded.** Noah: *"Inverted
boxes have normals reversed (I think...) - i guess that because the sides do not
resemble a solid."* He was right.

D37 STORED two vertical faces and asserted they were always visible, reasoning
that they meet at the near vertical edge and that edge is nearest by construction.
D39 then made depths signed so a box can be pushed through its own origin — and
the instant it inverts, the anchor is no longer the nearest corner. The app kept
shading the same two walls, now the far ones, so the fill sat behind the
silhouette and the box stopped reading as an object. A new capability quietly
invalidated an older one's assumption; nothing in the gates connected them.

The walls are not stored any more. `buildBox` stores the two RINGS — base and top,
in matching order — and the four walls are read off them every frame. The visible
pair is the two meeting at the base corner LOWEST ON THE PAGE, which is the same
"lowest is nearest" that solid ordering already assumes rather than a new rule.
Derived state cannot go stale, and boxes saved before this work unchanged because
their stored walls are simply ignored in favour of the ring.

**Gated, each planted-failed:** a walk check that enlarges the backing store,
paints magenta into the strip below the viewport rectangle, and asserts a redraw
leaves **0** of it (planted: 143,280 pixels); a check that grows the HEADER and
asserts the canvas follows with no window resize (planted: 797 -> 797); and a unit
test that pushes a depth to -400 and asserts the near base corner CHANGES, which
is what "which pair of walls faces you" comes down to.

### D42 — forced perspective, as an artist means it (SHIPPED 1.7.0, staging)

**Noah, 2026-07-30, asked for "making a square into a cube into a skyscraper with
forced perspective". Asked which kind, he said:** *"It means exaggerating for an
artist's reference, sometimes in cartoons rather than reality."*

That answer picks between two different tools, and it matters. The measured cube
— a measuring-point construction, a fourth point on the horizon, provably equal
depths — is the OTHER request, and it is not this one. This one is a dial.

- **Add cube**: a box equal along all three guides. Not measured, and the notes
  say so out loud: it reads as a cube and exaggerates as it leaves the middle of
  the paper. For a reference drawing that is the feature, not the compromise.
- **Taller / Shorter**: a box's whole height hangs off ONE ray vertex bound to
  vertical — every upper corner is derived from it — so stretching a box is
  multiplying a single number and letting the solver do the rest. The footprint
  is untouched, and the two are exact inverses.
- **Stronger / Gentler**: scale every unlocked point's distance from the CENTRE
  OF THE PAPER. Not the centroid of the points, which would drift the composition
  sideways each time it was used. Because every line is bound rather than baked,
  the whole drawing follows the dial live — the one thing this app can do that a
  sheet of paper cannot, for about fifteen lines. It refuses as a whole, naming
  the point, before any point would land inside the drawing.

**Three instrument fixes came out of gating this, and two were my own mistakes.**

**The framerate gate was failing at random.** Same code measured 27.3ms and
37.6ms within minutes on a loaded machine, against a 33ms bar. Proved rather than
assumed: `git stash`, run the committed build, 27.3ms; restore, 35.3ms; and then
`git diff` showed render.mjs differed by six lines of COMMENT. The bar is
unchanged; the measurement is now best-of-three medians. A real regression is
present in every run, a load spike is not — and the same gate caught a real one
that afternoon.

**That real one was mine.** I replaced a per-frame `scene.edges.filter(...)` with
a `skip` callback threaded into the edge loop, reasoning that avoiding a
2,000-element allocation per frame must be faster. It measured **27.3 → 35.1ms**.
A callback in the hot loop cost far more than the allocation it saved. Reverted,
with the number in the comment so nobody re-optimises it the same way.

**And the eye-level fixture was badly conditioned.** The D37 checks measured face
AREAS on a box dragged out by pixel coordinates, whose top face was a thin wedge —
263px against the walls' 11,700, and one run later it dipped under the threshold
and went red against working code. The fixture is `Add cube` now, dropped below
the horizon before the underside is measured, because a cube sitting near the
vanishing points' own line has a base that is nearly edge-on: "you can see
underneath it" is true and invisible. Lowering the threshold to fit the old
fixture would have been a test written to pass.

**Boot budgets went from 10s to 30s** in both the a11y gate and the walk, for the
same reason as the framerate change: they were failing on a loaded machine and a
rerun cleared them, which teaches everyone to rerun a red gate. Nothing is
skipped — the app must still boot.

### D39/D40/D41 — inversion, hidden lines, the point cap (SHIPPED 1.6.0, staging)

**Noah, 2026-07-30, on 1.5.1.**

**D39 — signed depth; the box can invert.** *"Pulling/pushing only moves the front
left point away from the user, it never crosses over and comes on the other side
inverting the box."*

He was hitting D3's fold, which the Ultracode assessment had already named as a
permanent wall. D3 solved a ray as `origin + s·|t|·u` with `s` chosen to MINIMISE
DISPLACEMENT from the last solve. That rule exists for a real reason — when a
vanishing point crosses its own origin, `u` reverses and every dependent corner
would otherwise leap across — but it cannot tell "the user pushed this through
zero" from "the guide flipped underneath it", so it undid the first along with
the second.

The fix separates the two cases instead of conflating them. `t` is plainly signed
and applied as-is. The guide-reversal case is handled where it happens: the last
solved unit direction is remembered on the vertex, and if the new one is opposite,
`t` is negated ONCE so the corner holds position. Displacement is still minimised
when the guide flips; it is no longer minimised when the user is the one moving
the corner. `T_FLOOR` is deleted — it only existed to keep `|t|` off the fold, and
with the fold gone a floor would be the same wall one layer up. `clampT` is now
symmetric and allows zero. `buildBox` keeps the SIGN of its depths, which was the
other half of the same wall.

**D40 — a solid covers its own far side.** *"You can see the internals of the
boxes with no way to erase or cover the lines, otherwise. The box is too
translucent with no way to adjust opacity."*

D37 filled the faces and then stroked all twelve of the solid's edges over the
top, including the three behind it. That is a wireframe with a grey wash. An edge
is drawn now only when it lies on a face you can see — adjacent corners in a
visible face's loop — which falls out of the same eye-level rule that picks the
faces, so hidden-line removal adds no geometry and cannot disagree with the
shading. Shading strength is a SELECT, not a slider: a slider is a drag (SC
2.5.7). Below full opacity the hidden edges come back faintly, because a
see-through object with no far side would be a lie. `Hidden lines` shows them
outright.

**D41 — the point count belongs to the scene.** *"Adding or removing VPs has no
effect on existing geometry. Scenes should be scoped to the number of vanishing
points on the screen, and there should likely be a limit ... that number probably
should not be changed, unless you can redraw the drawing."*

Right twice. A new point cannot retro-fit itself to lines built without it, so
offering the button once there is a drawing offers a change the app cannot honour.
And a single rectilinear object has at most three vanishing points, one per axis;
a fourth is a point nothing can bind to. So: cap of three, and the button is
DISABLED once anything is drawn, with an aria-label that says which reason
applies. Changing the count means a new drawing, from Project.

This is also how he ended up with a screenful of points: on the broken 1.5.0 the
app was dead but `#add-vp` still mutated the scene, so every hopeful tap added one
more and autosave kept them. The cap would have stopped it at three.

**Also:** a `Grid` toggle. D35 raised the grid from 1.33:1 to 3.21:1 to meet
SC 1.4.11, which was right, and the side effect is a much louder lattice — Noah
saw "MANY canvases" at the bottom of the sheet. The contrast rule stays; the grid
can now be switched off, which is the answer that does not weaken a gate.

### D36a — the migration door I missed (FIXED 1.5.1, staging)

**Noah, 2026-07-30, on 1.5.0:** *"There are no VPs on the page and I cannot add
any, now."*

His saved drawing was written by an older build, so it carried `horizon` and no
`eyeLevel`. The first `render()` read `scene.eyeLevel.y`, threw, and took the
canvas and the points panel with it — inside `boot()`'s async IIFE, so it never
even surfaced as a page error, and `window.__ip` was never assigned. Every point
was still in the file. The app just could not draw one of them, or itself.

**The mistake was believing there was ONE door.** `parseProjectJson` migrated,
and I reasoned that `adoptScene` was the single point every scene passes through
— from storage, from a file, from undo, from New. It is not: `boot()` assigns
`scene = restored.scene` directly and calls `solveScene`, bypassing it entirely.
That is the door almost everyone comes through, and it was the only one unguarded.

`migrateScene` now lives in solver.mjs next to the schema and runs at
`loadLastScene`, `loadSceneById`, `parseProjectJson`, `adoptScene` AND `boot`. It
is total and idempotent by construction — it fills what is missing and leaves
what is present — so running it five times over costs nothing.

**Why no gate caught it:** every walk context starts with an empty IndexedDB, so
the walk had only ever met scenes this build wrote itself. There was no way for
it to see a schema change break an old file. The new block writes a pre-1.5.0
record into storage and reloads onto it, then asserts the app boots, that the old
horizon became eye level with the same number, that the canvas actually has ink
on it, that the panel has a row per point, and that Add VP still works.

Planting the defect back reddens three of those checks and names the symptom —
but only after the block was changed to treat a failure to boot as a REPORT
rather than an abort. The first version died on the timeout and said
"waitForFunction: Timeout 20000ms exceeded", which is the gate describing its own
disappointment instead of the four things that were broken.

**The general rule, for every schema change after this one:** a migration is not
done when the file loader handles it. Find every path by which a scene enters
memory and make the migration idempotent so it can run on all of them.

### D36/D37/D38 — eye level, solids, rays (SHIPPED 1.5.0, staging)

**Noah, 2026-07-30, with three screenshots:** *"The horizon should follow two of
the VPs. There is no horizon without the VPs. What you CAN show is 'observer eye
level' ... When the VPs are below/at/above the observer's eye level, it changes
what you see — whether the top or bottom is visible at all, according to the
height of the object being where it is in relation, etc. I want a way to make the
boxes 'solid' with some shading so they are not a blob. I want a way to turn on
rays that extend to each VP."*

**D36 — two lines, not one.** Up to 1.4.0 the app stored a horizontal line called
`horizon` and SLAVED every on-horizon point's y to it. That made the state the
lesson is about — a vanishing point above or below the observer's eye —
literally unrepresentable.

- `scene.eyeLevel` is stored and authored: horizontal, always available, its own
  toolbar toggle. It is what the old field always was, under its true name.
- The horizon is DERIVED, never stored: `horizonLine(scene)` returns the line
  through the two points flagged `onHorizon`, or **null** — fewer than two
  points, or two in the same place, and nothing is drawn. An app that draws a
  horizon regardless is asserting a fact it does not have.
- `onHorizon` therefore changed meaning: it no longer slaves y, it declares
  membership. `moveVp` sets both coordinates freely now.
- They are told apart by DASH AND WEIGHT, not hue (§4): eye level is a long dash
  at 1.5px, the horizon a short dash at 2px. When the points are level the two
  coincide, which is the ordinary case; when they are not, the gap is the lesson.
- Schema 2. Version 1 files still open — `horizon` migrates to `eyeLevel` with
  the same number. A drawing tool that cannot open its own older files has
  destroyed the user's work as surely as deleting it.

**D37 — solids.** `scene.faces` are loops of corner ids that already exist. A
face owns no positions, so it can never disagree with the wireframe it shades:
move a corner and the fill follows, delete one and the face goes with it.
`buildBox` emits four — the two walls meeting at the near vertical edge, plus top
and bottom. The two back walls are never stored because they can never be seen.

- **Top and bottom visibility is decided by eye level at draw time**, which is not
  a shortcut — it IS the amendment: top visible when its middle is below eye
  level, bottom when its middle is above, and a box straddling your eye shows
  neither.
- Solids paint FARTHEST FIRST — lowest point on the page is nearest, which is
  what a ground plane receding to a horizon means — and each solid's own edges
  are stroked immediately after its fills, so a nearer box covers a farther one.
  Filling everything and then stroking everything would leave the far box's
  wireframe showing through the near one, which is the blob this removes.
- Inside a solid the horizontal face is painted LAST. Found by measurement: the
  base parallelogram and the two walls share the near base edges and lie on the
  SAME side of them on screen, so painting the base first hid it completely and
  "eye level below the box" showed nothing. When a horizontal face is visible it
  is the face nearest the eye, so it belongs on top. The top face does not
  overlap the walls at all, so one rule covers both.
- The face fills are SURFACES, not marks. They are held to "every mark stays
  >= 3:1 ON them" rather than to 3:1 themselves, and `canvas-contrast.test.mjs`
  now splits the palette on exactly that line.

**D38 — rays.** A toggle. Lines run from the selected corner to every vanishing
point, or from every anchor when nothing is selected — never from every vertex,
which would bury the drawing under a few boxes' worth of fan.

**None of the three touches the drawing.** Solid, Rays and Eye level are view
state: no history step, saved with the other preferences. The walk asserts the
edge and corner counts are unchanged after using all of them, and that turning
Rays off returns the canvas to **0 differing pixels**.

**Gated in the walk by pixels, because every one of these is a claim about what
is on screen:** face-colour areas counted across the whole canvas at three eye
levels (top 263px / underside 2222px / neither), the horizon present with two
points and absent with one, its slope going 0 → -0.037 when a point is lifted,
and 692 pixels changing when Rays is switched on. Each was planted-failed first.

### D34/D35 — drawing without a drag, and no protected colours (SHIPPED 1.4.0, staging)

**Noah, 2026-07-30:** *"Fix those things. There is NO reason that any color be
protected right now. That was the WRONG call."*

**D34 — the keyboard can draw (closes F-04).** Two toolbar buttons, **Add line**
and **Add box**, in their own group labelled "Draw without dragging". Until 1.4.0
every manipulation in this app had a non-drag path except the primary creative
act; the interactions gate had been printing that as a GAP on every run since it
was built, which is better than silence and is still not a fix.

The design rule is that neither button is a new way to SPECIFY geometry — no
coordinate dialog, no wizard, nothing to learn:
- **Add line** resolves its guide the way the toolbar already reads: the forced
  guide if one is set, else the first unlocked vanishing point, else horizontal.
  It runs 200 canvas units from the middle of the view through the SAME
  `resolveEndpoint` → `resolveStrokeEnd` → `commitStroke` a drag uses, then
  SELECTS the far end and focuses the canvas. From there the arrow keys and the
  inspector's distance field — both already built — finish it.
- **Add box** calls the same `buildBox` with one depth set and the other at its
  floor, which is exactly the state the first drag leaves, then calls
  `beginExtrude`. So it lands in D31's second step and D33's arrow is on the
  corner pointing the way. The keyboard path for that step already existed and
  was already gated; this just reaches it without a drag.
- Both are one `beginGesture` — one undo, like every other edit — and both place
  the shape at the middle of the current view, clamped into the paper.

**Gated by a walk block that never touches the mouse**: buttons activated with
Enter after `focus()`, lengths and depths set with arrow keys, and a counter on
the canvas's own `pointerdown` asserting **0** at the end. Planting a failure in
both functions reddens five checks.

**D35 — no colour is protected.** The grid measured 1.33:1 (dark) and 1.38:1
(light) against paper. Both are now **#636A80 / 3.21:1** and **#8A8F98 /
3.25:1**, raised multiplicatively so each keeps its own r:g:b ratio — the same
hue, only louder. `canvas-contrast.test.mjs` now asserts ALL EIGHT palette marks
at 3:1 in both themes, plus a test that the palette contains exactly those eight
so a new colour cannot be added without a contrast decision, plus a hierarchy
test (grid < guides < ink) because raising the quietest mark on the paper could
have inverted an ordering that weight and dash also carry.

The general rule, worth keeping: when a gate fails on a real value, there are
three moves — exempt the value, lower the threshold, or fix the value. The first
two both end with a gate that cannot fail. Only the third is a fix.

### D33 — the second step says WHICH WAY (SHIPPED 1.3.2, staging)

**Noah, 2026-07-30:** *"When the box drawing switches to the third axis on
release, it would be helpful to show a double headed arrow on the auto selected
corner for the second step, aligned with the axis movement direction, to indicate
the expected user input."*

D31 gave the step a standing strip that says a step is happening. That is the
announcement §3 asks for, and it is still not an instruction: it names the
vanishing point but leaves the user to work out where on the canvas to push. The
arrow closes that gap at the place the answer is needed — on the corner itself.

- **Double-headed**, because the depth can grow or shrink and both are one drag
  away. It carries **arrowheads**, not just the selection colour, so the meaning
  survives a greyscale render (§4) — colour only reinforces.
- **Screen space**, fixed reach (46px) and head (9px), so it stays legible at any
  zoom. It is a pointer AT the user, not part of the drawing, and it is never
  exported: `buildSvg`/`renderPng` do not see it.
- **Derived from the live scene every frame**, never remembered. Move the
  vanishing point while the step is open and the arrow turns with it, because it
  reads the same `bindingDirection` the solver uses. It returns null — draws
  nothing — the moment the corner is degenerate or non-finite, so a broken scene
  gets no confident arrow pointing nowhere.
- `beginExtrude`/`endExtrude` now render explicitly. They did not before, because
  nothing on the canvas depended on the state; Escape would have left a stale
  arrow on screen.

**Gated four ways in the walk**, each proven to fail before being trusted (§6):
the hint sits on the auto-selected corner and is parallel to that corner's own
guide (checked against origin→VP, not taken on trust — a wrong direction reds it);
selection-coloured pixels in a ring 22–52px around the corner go from 176 with the
step live to 0 after Done (deleting the drawing block reds it); and every one of
those 176 pixels lies within 20° of the guide (drawing it perpendicular reds it,
while the presence check stays green). Plus: Done ends the step and keeps the box.

**And the colour is now measured, not eyeballed.** `themeColors` is exported and
`test/canvas-contrast.test.mjs` does the SC 1.4.11 arithmetic the a11y gate
cannot: a canvas is one opaque element to a DOM walker, so every mark drawn on
the drawing surface was ungated. Selection on paper is 8.68:1 dark / 5.83:1 light.

**The carve-out written here at 1.3.2 was wrong and was reversed at 1.4.0.** This
amendment originally exempted the grid from that gate, on the reasoning that it
was decorative and that asserting a threshold it failed would be a test written to
pass. Noah: *"There is NO reason that any color be protected right now. That was
the WRONG call."* He is right — the third option, the one not taken, was to fix
the colour. See D35.

### D30/D31 — three shapes, and the box's second step (SHIPPED 1.3.0, staging)

**Noah, 2026-07-30:** *"Indicate the corner that is the anchor. It currently looks
the same. Drawing a box *should* be a two-step process, but it should be automatic
- first square goes in, then the other axis is immediately draggable."*

**D30 — three kinds of corner, three shapes.** Anchor: filled square inside an
open ring (you placed it; free in the plane; moves the whole shape). Ray: filled
square (slides along one guide). Intersect: OPEN square (derived — it moves by
adjusting the distances behind it). Shape and never hue (§4): it survives a
greyscale render. D29 made every corner move; this says which is which without
having to drag one to find out.

**D31 — the box's second step, automatic.** The first drag sets height and the
depth toward the point you drag toward. On release the remaining depth is LIVE:
the next drag anywhere sets it, with no handle to find and no mode to pick. This
is the answer to "a drag carries two numbers and a box needs three" that does not
require the user to know which corner is magic.
- It is a state, so it announces itself in a standing strip with a Done button
  (§3). Escape and switching tools do the same. Every exit KEEPS the box — the
  step can only add, never take away, so walking away from it costs nothing.
- Nothing about it is timed (§4: no timed gestures), and it commits nothing by
  itself: a tap during the step leaves the box exactly as drawn.
- Each step is its own undo, so the depth can be taken back while the box stays.
- The non-drag path is not a new control: beginning the step SELECTS the corner
  it is about, so the arrow keys act on exactly what the drag would, and the
  panel already carries its distance as a number. Declared in INTERACTIONS.md and
  gated — and the gate caught the honest version of this: it first failed because
  it measured the Done button while the step was over, so `check-interactions.mjs`
  now leaves the app IN the step rather than assembling a state for the gate.
- Gated in the walk: the first release lands 12 edges and raises the indicator;
  the next drag anywhere lifts the shallow depth (19.8 -> 192.1 measured) with the
  other unchanged; the box stays sound; undo takes back the second step alone;
  switching tools ends the step and keeps the box.

splitBoxDepths is still untouched — the first drag keeps its floor because the
second step is now what supplies the other depth, which is a better answer than
retuning a heuristic that can only ever trade one impossible box for another.

### D29 — every corner moves, through one entry (SHIPPED 1.2.0, staging)

The first half of the assessment below, built and gated. `manipulate(scene, id,
target)` in the solver is now the ONLY way anything moves: drag, arrow keys and
the inspector's number fields all call it, because they were three code paths that
had already drifted apart once (F-05) and drifted again (F-06).

- anchor → move; ray → project onto its own guide and set t, STRICTLY single
  parameter (the walk pins that changing one depth leaves the other alone);
  intersect → damped Gauss-Newton over the ray ancestors found by walking
  defs/origins, minimum-norm step when underdetermined.
- Measured: all eight corners reachable, 1–3 iterations, sub-pixel, box intact
  (worst VP miss ~1e-13px). The far top corner dragged straight up puts the
  travel into HEIGHT and keeps the depths symmetric — the min-norm step is what
  makes it feel like direct manipulation instead of three hidden sliders.
- The four guards each have a test that reds without them: refuse a corner with
  no finite position (a Jacobian taken there NaN-poisons every ancestor and
  destroys the box beyond undo); abort on any non-finite residual/step; clamp
  |t| ≥ 1 (the solver's side-choice folds at zero) and ≤ 0.95 × origin-to-VP
  distance (an unbounded solve happily converges with a corner sitting ON a
  vanishing point); keep the best position found when a target is unreachable, so
  the corner pins at the boundary instead of chasing.
- History opens at the moved=true transition, which also killed the empty undo
  steps a dead-corner drag used to push.
- Corners draw as SQUARE handles now. The report was two defects: half the
  corners did nothing, AND nothing said which half — he had to scrub them.
- The walk drags one of every kind through real pointer events. It had never
  dragged a vertex at all (F-07), which is why this class shipped twice; on its
  first run it caught a regression I had just made (a deleted box-release branch,
  0 edges) before it reached staging.

NOT done in 1.2.0, deliberately: splitBoxDepths is untouched. The two-stage
creation gesture is designed below and is next; retuning the split now would
break the tall-thin gate, which is Noah's own earlier complaint encoded as a test.

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

## Decided by Noah, 2026-08-01 — for the next session

- **Winding refactor (D63) lands FIRST**, before anything else on this list. It
  is on `d63-winding-wip` with five known walk failures, one of which is a real
  solver/renderer disagreement about the same box.
- **A vanishing point made from two drawn lines is BOUND** to those lines: move a
  line and the point follows. Not a plain point dropped where they crossed. Nearly
  parallel lines must refuse with a reason rather than return a number a mile off
  the page.
- **Image import is the same feature** as the above, not a separate one — drawing
  two lines along a building's edges in a photo to get its point is the actual
  workflow. Open decision when it is built: a photo as base64 in the project JSON
  turns a 30KB file into a 4MB one, so it probably belongs in IndexedDB with the
  JSON holding a reference — which costs a project file its backing image when it
  moves between devices. Decide deliberately, do not discover.
- **Curvilinear ("banana-pan" — panoramic, verticals straight and horizontals
  bowing — and a spherical grid) is a SECOND GEOMETRY, not a setting.** Every line
  here is a straight segment to a point; curvilinear makes edges arcs and points
  poles. D62's circle built the first curve infrastructure, so it is not from zero,
  but it is the largest item by a distance and it comes after the refactor.

## Closed by Noah, 2026-08-01 — do not re-open, do not re-ask

Two long-standing reports that were never reproduced. **Noah: "You can forget
these two."** They are dropped as findings; the investigation notes stay in the
D45 entry and the 1.7.0 record because what was tried is worth keeping, but
neither is outstanding and neither should appear in a status list again.

- *"Placed a cube with the button, and it is only manipulatable with the
  out-of-sight corners"* (reported 2026-07-30, never reproduced headlessly).
- The Weld preference desyncing from its button on reload (P2, 2026-07-29).

Also closed and NOT an open question: §4's flat ">= 44px" versus WCAG 2.2 SC
2.5.8's inline exception. §4 has carried the exception in its own words since
2026-07-30 (hub `0ada0b7`), and the a11y gate spent two days printing a question
that had already been answered. It cites §4 now and prints the list §4 requires
it to print. §4 also gained three rules earned here this week — a control must
not move when used, no two controls answer to the same name, and the way in
costs what the way out costs.

Still genuinely open, and small: the snap radius is hardcoded where §4 wants it
adjustable, and target SPACING is ungated (the gate measures size only).

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
