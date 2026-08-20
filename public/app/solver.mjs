// solver.mjs — the constraint graph and its solver (build-order step 1).
//
// Implements vpdrawingappspec.md §2 AS AMENDED by NOTES.md D1–D4:
//   D1  Vertex is a discriminated union: anchor | ray | intersect.
//       A binding can name a VP or be "vertical"/"horizontal", for vertices
//       exactly as for edges — "drop a vertical from a receding edge" must be
//       representable.
//   D2  Constructed corners are intersect vertices; a free endpoint is a ray
//       vertex that keeps its authored length |t|.
//   D3  A binding is a LINE through the VP, not a ray from it. Side is s∈{+1,−1}
//       chosen to minimise displacement from the previous solve; t is stored
//       SIGNED so a cold load lands on the same side deterministically.
//   D4  Degenerate is ONLY coincident (|VP−origin| ≤ EPS_LEN, relative to the
//       canvas diagonal) or parallel (|cross| ≤ 1e-9 on unit vectors). An
//       intersection behind an origin is legitimate geometry. On a failed
//       solve x,y is left untouched — it IS the last-valid cache §2.3.4 wants —
//       and `degenerate` is set for the UI's visible marker.
//
// Pure data + pure functions, no DOM, no dependencies: the same bytes run in
// the app and under node --test. Mutations return {ok:true,...} or
// {ok:false,reason} — a rejected operation always surfaces its reason (§2.3.3).

export const SCHEMA_VERSION = 3;   // 3 adds circles (D62)
export const SNAP_RADIUS = 12;        // §2.4 — canvas px; the call site scales by zoom
export const SNAP_THRESHOLD = 15;     // §12 — degrees; tunable once there is stylus time behind it
export const PARALLEL_EPS = 1e-9;     // D4 — on the cross product of unit vectors
export const EPS_LEN_FACTOR = 1e-6;   // D4 — × canvas diagonal → EPS_LEN

// ---- geometry ------------------------------------------------------------

export function epsLen(scene) {
  return EPS_LEN_FACTOR * Math.hypot(scene.canvas.width, scene.canvas.height);
}

// Signed scalar position of P along the line through P0 with unit direction u,
// and the projected point itself.
export function projectPointOnLine(p0, u, p) {
  const t = (p.x - p0.x) * u.x + (p.y - p0.y) * u.y;
  return { t, x: p0.x + t * u.x, y: p0.y + t * u.y };
}

// Intersection of two infinite lines. null iff parallel (D4: divergence does
// not exist for lines, and an intersection "behind" an origin is legitimate).
export function intersectLines(p1, u1, p2, u2, eps = PARALLEL_EPS) {
  const cross = u1.x * u2.y - u1.y * u2.x;
  if (Math.abs(cross) <= eps) return null;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const a = (dx * u2.y - dy * u2.x) / cross;
  return { x: p1.x + a * u1.x, y: p1.y + a * u1.y };
}

// Unit direction of a binding's line at an origin position. null iff the
// binding names a VP that is coincident with the origin (D4) or missing.
export function bindingDirection(scene, originPos, binding) {
  if (binding === "vertical") return { x: 0, y: 1 };
  if (binding === "horizontal") return { x: 1, y: 0 };
  // D16: the optional 45° pair. Off unless the toolbar toggle is on.
  if (binding === "diag45") return { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  if (binding === "diag135") return { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
  const vp = scene.vanishingPoints.find(v => v.id === binding.vpId);
  if (!vp) return null;
  const dx = vp.x - originPos.x, dy = vp.y - originPos.y;
  const len = Math.hypot(dx, dy);
  if (len <= epsLen(scene)) return null;
  return { x: dx / len, y: dy / len };
}

// ---- scene construction --------------------------------------------------

// D36a — THE MIGRATION, and the one boundary it has to run at.
//
// FOUND ON A REAL TABLET, 2026-07-30, on 1.5.0: no vanishing points on the page,
// and no way to add any. The saved drawing had been written by an older build, so it
// carried `horizon` and no `eyeLevel`; the first render read `scene.eyeLevel.y`,
// threw, and took the panel down with it. Every point was still in the file. The
// app just could not draw a single one of them, or itself.
//
// parseProjectJson migrated — but that is only the FILE door. The scene restored
// from IndexedDB at boot never went through it, and that is the door almost
// everyone comes through. So this lives here, next to the schema it is about, and
// runs at `adoptScene`: the single point every scene passes through, whether it
// came from a file, from storage, from undo, or from New.
//
// It is total and idempotent by construction — it fills what is missing and
// leaves what is present — so running it on an already-current scene, which
// undo/redo does constantly, costs nothing and changes nothing.
export function migrateScene(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const height = Number.isFinite(raw.canvas?.height) ? raw.canvas.height : 800;
  if (!raw.eyeLevel || !Number.isFinite(raw.eyeLevel.y)) {
    // v1 called this line "horizon" and slaved points to it. It was always the
    // observer's eye level; it migrates under its true name, with its own value.
    const y = Number.isFinite(raw.horizon?.y) ? raw.horizon.y : height / 2;
    raw.eyeLevel = { y };
  }
  delete raw.horizon;
  if (!Array.isArray(raw.faces)) raw.faces = [];
  if (!Array.isArray(raw.circles)) raw.circles = [];   // D62 — v2 had none
  for (const key of ["vanishingPoints", "vertices", "edges"]) {
    if (!Array.isArray(raw[key])) raw[key] = [];
  }
  raw.schemaVersion = SCHEMA_VERSION;
  return raw;
}

// D62 — A CIRCLE IN PERSPECTIVE, WHICH IS NOT NEW GEOMETRY.
//
// Wheels, arches and domes were asked for. The temptation is a new kind of thing
// with its own position and radius that has to be kept in step with everything
// else. It is not one: a circle is a FACT ABOUT FOUR CORNERS — the square it is
// inscribed in — and those are ordinary vertices the solver already holds. So a
// circle stores four ids and nothing else. Drag a corner, drag a vanishing point,
// invert the box it sits on, and the ellipse follows for free, because there is
// nothing of its own to go stale. This is D49's rule ("stop recalculating what
// the construction already knows") applied before writing the thing rather than
// after being caught by it.
//
// The curve is EXACT, not an eight-point approximation. A circle drawn on a plane
// and photographed is a conic, and the map from the plane to the page is the
// projective transform that takes the unit square to those four corners. Send the
// unit circle through the same transform and you have the ellipse the camera
// would have produced — tangent to all four sides at their PERSPECTIVE midpoints,
// which is the property the eight-point construction is trying to approximate.
// D63 — orient a whole solid's faces once, at BUILD time.
//
// Every builder makes its rings in whatever order its own construction produced,
// and those orders do not agree with each other: a box's base ring runs
// [near, left, back, right], a street plot's runs across the block and back. Both
// are perfectly good rings, and a face scheme applied to them comes out wound
// outward for one and inward for the other. Hand-flipping each builder is how you
// get five conventions and a bug per builder.
//
// So the winding is NORMALISED here instead, once, from the solid's own geometry:
// take any cap, and if it is wound the wrong way for our convention, reverse every
// face of the solid. `inward` asks for the opposite, which is what an interior is.
// This is a build-time fact about the construction, never recomputed per frame.
export function orientSolid(scene, solid, { cap, inward = false } = {}) {
  const byId = new Map(scene.vertices.map(v => [v.id, v]));
  const area = loop => {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = byId.get(loop[i]), q = byId.get(loop[(i + 1) % loop.length]);
      if (!p || !q || !Number.isFinite(p.x) || !Number.isFinite(q.x)) return null;
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  };
  const faces = scene.faces.filter(f => f.solid === solid);
  const ref = cap ? faces.find(f => f.shade === cap) : faces[0];
  if (!ref) return false;
  const a = area(ref.loop);
  if (a === null || Math.abs(a) < 1e-9) return false;    // edge-on: nothing to learn
  const wantPositive = !inward;
  if ((a > 0) === wantPositive) return false;            // already right way round
  for (const f of faces) f.loop.reverse();
  return true;
}

export function addCircle(scene, { quad, label }) {
  if (!Array.isArray(quad) || quad.length !== 4) return { ok: false, reason: "a circle is inscribed in four corners" };
  const seen = new Set(quad);
  if (seen.size !== 4) return { ok: false, reason: "those four corners are not four different corners" };
  for (const id of quad) {
    if (!scene.vertices.some(v => v.id === id)) return { ok: false, reason: "one of those corners is not in the drawing" };
  }
  if (!Array.isArray(scene.circles)) scene.circles = [];
  const circle = { id: newId(scene, "c"), quad: [...quad], label: label ?? "Circle" };
  scene.circles.push(circle);
  return { ok: true, circle };
}

// Heckbert's square-to-quad projective map, from the unit square's corners in the
// order (0,0) (1,0) (1,1) (0,1) to the four given points. Returns null when the
// quad is degenerate — three corners in a line has no such map, and refusing is
// the honest answer rather than dividing by something near zero.
export function quadTransform(p) {
  if (!p || p.length !== 4 || p.some(q => !q || !Number.isFinite(q.x) || !Number.isFinite(q.y))) return null;
  const [p0, p1, p2, p3] = p;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
    d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y;
    g = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dy1 * dx2;
    if (!Number.isFinite(den) || Math.abs(den) < 1e-12) return null;
    g = (dx3 * dy2 - dy3 * dx2) / den;
    h = (dx1 * dy3 - dy1 * dx3) / den;
    a = p1.x - p0.x + g * p1.x;
    b = p3.x - p0.x + h * p3.x;
    c = p0.x;
    d = p1.y - p0.y + g * p1.y;
    e = p3.y - p0.y + h * p3.y;
    f = p0.y;
  }
  return (u, v) => {
    const w = g * u + h * v + 1;
    if (!Number.isFinite(w) || Math.abs(w) < 1e-9) return null;   // on the vanishing line
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

// The ellipse, as points on the page. `steps` is how finely it is sampled; the
// curve itself is exact and this only decides how smoothly it is drawn.
export function circlePoints(scene, circle, steps = 72) {
  const byId = new Map(scene.vertices.map(v => [v.id, v]));
  const quad = circle.quad.map(id => byId.get(id));
  if (quad.some(v => !v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || v.degenerate)) return null;
  const T = quadTransform(quad);
  if (!T) return null;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const p = T(0.5 + 0.5 * Math.cos(t), 0.5 + 0.5 * Math.sin(t));
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;   // it crosses the horizon
    out.push(p);
  }
  return out;
}

export function createScene({ name = "untitled", width, height }) {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "scene1",
    name,
    createdAt: now,
    modifiedAt: now,
    canvas: { width, height },
    // D36 — eye level and the horizon are DIFFERENT THINGS and only one of them
    // is stored. Eye level is where the observer's eye is: a horizontal line,
    // authored, always available. The horizon is wherever the vanishing points
    // put it — it is DERIVED (see horizonLine), and a scene with fewer than two
    // horizon points simply has no horizon to draw.
    eyeLevel: { y: height / 2 },
    vanishingPoints: [],
    vertices: [],
    edges: [],
    faces: [],
    circles: [],
    nextId: 1,
  };
}

function newId(scene, prefix) {
  return `${prefix}${scene.nextId++}`;
}

export function addVp(scene, { label, x, y, axis = "z", locked = false, onHorizon = false }) {
  const vp = {
    id: newId(scene, "vp"),
    label: label ?? `VP${scene.vanishingPoints.length + 1}`,
    x,
    // D36: `onHorizon` no longer SLAVES y — it declares that this point is one
    // of the ones the horizon runs through. A point being above or below eye
    // level is the whole lesson, so the model must let it happen.
    y,
    axis, locked, onHorizon,
  };
  scene.vanishingPoints.push(vp);
  return { ok: true, vp };
}

export function addAnchor(scene, { x, y }) {
  const v = { id: newId(scene, "v"), kind: "anchor", x, y };
  scene.vertices.push(v);
  return { ok: true, vertex: v };
}

function vertexById(scene, id) {
  return scene.vertices.find(v => v.id === id);
}

const AXIS_BINDINGS = new Set(["vertical", "horizontal", "diag45", "diag135"]);

function validBinding(scene, binding) {
  if (AXIS_BINDINGS.has(binding)) return true;
  return !!(binding && binding.vpId && scene.vanishingPoints.some(v => v.id === binding.vpId));
}

export function addRayVertex(scene, { origin, binding, t = 0 }) {
  if (!vertexById(scene, origin)) return { ok: false, reason: `origin vertex "${origin}" does not exist` };
  if (!validBinding(scene, binding)) return { ok: false, reason: `binding names no known vanishing point` };
  const v = { id: newId(scene, "v"), kind: "ray", x: NaN, y: NaN, origin, binding, t, degenerate: false };
  scene.vertices.push(v);
  solveScene(scene);
  return { ok: true, vertex: v };
}

export function addIntersectVertex(scene, { defs }) {
  if (!Array.isArray(defs) || defs.length !== 2) return { ok: false, reason: "an intersect vertex needs exactly two ray definitions" };
  for (const d of defs) {
    if (!vertexById(scene, d.origin)) return { ok: false, reason: `origin vertex "${d.origin}" does not exist` };
    if (!validBinding(scene, d.binding)) return { ok: false, reason: `binding names no known vanishing point` };
  }
  const v = { id: newId(scene, "v"), kind: "intersect", x: NaN, y: NaN, defs, degenerate: false };
  scene.vertices.push(v);
  solveScene(scene);
  return { ok: true, vertex: v };
}

export function addEdge(scene, { a, b, binding = "free", role = "committed", style }) {
  if (!vertexById(scene, a) || !vertexById(scene, b)) return { ok: false, reason: "edge endpoints must be existing vertices" };
  const e = { id: newId(scene, "e"), a, b, binding, role, style: style ?? { weight: 1, dash: null } };
  scene.edges.push(e);
  return { ok: true, edge: e };
}

// ---- dependency graph ----------------------------------------------------

function depsOf(v) {
  // D60 — a vertex that DIVIDES another one's edge depends on the far end of that
  // edge as surely as it does on its own origin. Leaving it out let the solver
  // place a gable midpoint before the corner it divides had moved, so it halved
  // yesterday's edge: correct arithmetic on stale input, which is the hardest
  // kind of wrong to see. The cycle check walks this list too, so a midpoint can
  // never come to divide something that depends on it.
  if (v.kind === "ray") return v.divide ? [v.origin, v.divide.ofId] : [v.origin];
  if (v.kind === "intersect") return [v.defs[0].origin, v.defs[1].origin];
  return [];
}

// Would vertex `id` end up its own ancestor if it depended on `newDeps`?
// Walked at edit time (§2.3.3): at creation a cycle is impossible because a
// new vertex cannot already be anyone's dependency, but a rebind can close one.
export function wouldCycle(scene, id, newDeps) {
  const seen = new Set();
  const stack = [...newDeps];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === id) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const v = vertexById(scene, cur);
    if (v) stack.push(...depsOf(v));
  }
  return false;
}

export function rebindVertex(scene, id, patch) {
  const v = vertexById(scene, id);
  if (!v) return { ok: false, reason: `vertex "${id}" does not exist` };
  if (v.kind === "anchor") return { ok: false, reason: "an anchor has no binding to change" };
  const next = { ...v, ...patch };
  const deps = depsOf(next);
  for (const d of deps) {
    if (!vertexById(scene, d)) return { ok: false, reason: `origin vertex "${d}" does not exist` };
  }
  if (wouldCycle(scene, id, deps)) {
    return { ok: false, reason: `rejected: vertex "${id}" would become its own ancestor (§2.3.3 — cycles are refused, never silently broken)` };
  }
  Object.assign(v, patch);
  solveScene(scene);
  return { ok: true, vertex: v };
}

// ---- solving -------------------------------------------------------------

function solveRay(scene, v, index) {
  const origin = index ? index.get(v.origin) : vertexById(scene, v.origin);
  // D51 — a height gauge holds a RATIO of the observer's eye height, so its
  // length is re-measured here rather than remembered. Move the figure, move the
  // horizon, or move a vanishing point that defines the horizon, and it re-scales
  // itself instead of standing there at yesterday's size.
  if (Number.isFinite(v.gauge)) {
    const span = gaugeSpan(scene, { x: origin.x, y: origin.y });
    if (span !== null && Math.abs(span) >= 1) v.t = span * v.gauge;
  }
  // D52 — a room's far corner holds how far back it is as a FRACTION of the way
  // to the vanishing point, not as a length. All four corners share the fraction,
  // which is what keeps the far wall a rectangle: it is the near wall scaled
  // about the point. Store lengths instead and the wall skews the moment the
  // point moves, because the four corners are different distances from it.
  if (Number.isFinite(v.recede) && typeof v.binding === "object") {
    const vp = scene.vanishingPoints.find(p => p.id === v.binding.vpId);
    if (vp) {
      const D = Math.hypot(vp.x - origin.x, vp.y - origin.y);
      if (Number.isFinite(D) && D > 0) v.t = D * v.recede;
    }
  }
  // D60 — a gable midpoint divides ANOTHER corner's depth, so it holds the
  // FRACTION and re-derives the length every solve. It used to store the length,
  // and that is the same defect D52 was written about: push the box through a
  // vanishing point, the gable edge flips to the other side, and the midpoint
  // stays behind on the old side — the ridge ends up outside the building and the
  // roof planes cross themselves. A fraction flips with the edge for free.
  const u = bindingDirection(scene, { x: origin.x, y: origin.y }, v.binding);
  if (!u) { v.degenerate = true; return; } // x,y untouched — the last-valid cache
  if (v.divide && typeof v.binding === "object") {
    const of = scene.vertices.find(x => x.id === v.divide.ofId);
    const vp = scene.vanishingPoints.find(p => p.id === v.binding.vpId);
    if (of && vp && Number.isFinite(of.x) && Number.isFinite(of.y)) {
      // Both distances are SIGNED projections onto the guide, taken from where
      // the edge is right now. buildRoof used to take t1 as a bare hypot, which
      // throws the sign away, and then stored the answer — so a gable edge that
      // flipped through its origin left its midpoint behind on the old side.
      const t1 = (of.x - origin.x) * u.x + (of.y - origin.y) * u.y;
      const D = (vp.x - origin.x) * u.x + (vp.y - origin.y) * u.y;
      const t = depthAtInterval(D, t1, v.divide.f);
      if (Number.isFinite(t)) v.t = t;
    }
  }
  v.degenerate = false;
  if (v.binding === "vertical" || v.binding === "horizontal") {
    // Fixed directions cannot cross their origin; plain signed t.
    v.x = origin.x + v.t * u.x;
    v.y = origin.y + v.t * u.y;
    return;
  }
  // D39 — SIGNED t, so a depth can be pushed THROUGH its origin and out the
  // other side. This is the amendment that lets a box invert.
  //
  // THE DEFECT, 2026-07-30: pulling or pushing only ever moved the front-left
  // point away from the viewer. It never crossed over to the other side, so the
  // box could not be inverted.
  //
  // That is D3's fold. D3 solved position as origin + s·|t|·u with `s`
  // chosen to MINIMISE DISPLACEMENT from the last solve, which exists for a real
  // reason: when a vanishing point crosses its own origin, `u` reverses, and
  // without that rule every dependent corner would leap to the far side. But the
  // rule cannot tell "the user pushed this corner through zero" from "the guide
  // flipped underneath it", so it undid the first along with the second. |t| can
  // approach zero and never pass it. A permanent wall.
  //
  // The fix separates the two cases instead of conflating them. `t` is plainly
  // signed and applied as-is, so pushing through zero works and keeps going. The
  // guide-reversal case is handled where it actually happens: the last solved
  // direction is remembered, and if the new one is opposite, `t` is negated ONCE
  // so the corner stays exactly where it sat. Displacement is still minimised
  // when the guide flips; it is no longer minimised when the user is the one
  // moving the corner.
  // D52 — the flip holds a STORED length in place when its guide reverses. A
  // derived length (a D51 gauge, a D52 room corner) is recomputed from scratch
  // every solve, so there is no history to preserve and negating it just sends
  // the corner to the wrong side. Found by a room's far wall skewing when the
  // point moved past one of its corners.
  const derived = Number.isFinite(v.gauge) || Number.isFinite(v.recede) || !!v.divide;
  if (!derived && Number.isFinite(v.ux) && Number.isFinite(v.uy) && (v.ux * u.x + v.uy * u.y) < 0) {
    v.t = -v.t;                       // the guide reversed under it — hold position
  }
  v.ux = u.x;
  v.uy = u.y;
  v.x = origin.x + v.t * u.x;
  v.y = origin.y + v.t * u.y;
}

function solveIntersect(scene, v, index) {
  const [d1, d2] = v.defs;
  const o1 = index ? index.get(d1.origin) : vertexById(scene, d1.origin);
  const o2 = index ? index.get(d2.origin) : vertexById(scene, d2.origin);
  const u1 = bindingDirection(scene, { x: o1.x, y: o1.y }, d1.binding);
  const u2 = bindingDirection(scene, { x: o2.x, y: o2.y }, d2.binding);
  if (!u1 || !u2) { v.degenerate = true; return; }
  const p = intersectLines({ x: o1.x, y: o1.y }, u1, { x: o2.x, y: o2.y }, u2);
  if (!p) { v.degenerate = true; return; } // parallel — x,y untouched
  v.degenerate = false;
  v.x = p.x;
  v.y = p.y;
}

// Re-solve every constructed vertex in topological order (§2.3). Anchors are
// fixed. A dependency cycle in LOADED data (creation and rebind refuse them,
// but a hand-edited project file is still a possible input) must terminate:
// the unsolvable vertices keep their cached x,y and are flagged degenerate.
//
// Kahn's algorithm over an index built once — O(V+E). The obvious version of
// this (a Set of pending deps per vertex, rescanned until nothing moves, with
// a linear lookup by id inside) is O(V²) and measured 37ms per solve at the
// 2,000 edges §11 asks for, against a 16ms frame. The shape of the algorithm
// was the cost, not the constant (Doctrine §14), so it is the shape that
// changed. Same semantics, including how cycles are reported.
export function solveScene(scene) {
  reseatDerivedVps(scene);       // D65: points made from two lines, before anything reads them
  reseatSlopePoints(scene);      // D53: derived points first, then everything that binds to them
  const index = new Map();
  for (const v of scene.vertices) index.set(v.id, v);

  const pending = new Map();     // id -> count of unsolved dependencies
  const dependents = new Map();  // id -> ids waiting on it
  const queue = [];
  for (const v of scene.vertices) {
    if (v.kind === "anchor") continue;
    let count = 0;
    for (const d of depsOf(v)) {
      const dep = index.get(d);
      if (!dep || dep.kind === "anchor") continue;
      count++;
      let list = dependents.get(d);
      if (!list) { list = []; dependents.set(d, list); }
      list.push(v.id);
    }
    pending.set(v.id, count);
    if (count === 0) queue.push(v.id);
  }

  const order = [];
  const degenerate = [];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const v = index.get(id);
    if (v.kind === "ray") solveRay(scene, v, index);
    else solveIntersect(scene, v, index);
    order.push(id);
    if (v.degenerate) degenerate.push(id);
    const waiting = dependents.get(id);
    if (waiting) {
      for (const w of waiting) {
        const left = pending.get(w) - 1;
        pending.set(w, left);
        if (left === 0) queue.push(w);
      }
    }
  }

  const unresolved = [];
  for (const [id, left] of pending) {
    if (left > 0) {                 // cycle in loaded data — visible, never a hang
      unresolved.push(id);
      index.get(id).degenerate = true;
    }
  }
  scene.modifiedAt = Date.now();
  return { order, degenerate, unresolved };
}

// ---- VP and horizon mutations -------------------------------------------

// D23 — move an ANCHOR. `rebindVertex` refuses anchors (they have no binding to
// change) and `moveVp` only takes vanishing points, so until now a box's near
// bottom corner — its one anchored vertex — could not be moved at all after it
// was drawn. NOTES claimed the corners were "adjustable afterwards"; they were
// adjustable in principle and unreachable in the app, which is the gap this
// closes. Every dependent vertex re-solves, so the box follows.
export function moveAnchor(scene, vertexId, { x, y }) {
  const v = vertexById(scene, vertexId);
  if (!v) return { ok: false, reason: `vertex "${vertexId}" does not exist` };
  if (v.kind !== "anchor") {
    return { ok: false, reason: `${v.kind === "ray" ? "this point rides a guide — set its distance along it instead" : "this point is where two guides cross — move what defines it"}` };
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: "x and y must be numbers" };
  v.x = x; v.y = y;
  solveScene(scene);
  return { ok: true, vertex: v };
}

// ---- D29: one entry for every manipulation --------------------------------
//
// THE DEFECT, 2026-07-30, reported against 1.1.0 with the working corners
// circled in a screenshot: only some corners respond to a drag, and the rest do
// nothing at all. Half a
// box's corners are `intersect` vertices — each the crossing of two guide lines —
// and nothing in the app could move one. They were not refused, they were
// SILENTLY inert: the drag branch had cases for anchor and ray and fell through,
// which also pushed an empty undo step and announced success.
//
// The constraint graph already holds everything needed to move them. An intersect
// has no parameters of its own, but its ANCESTORS do: walk `defs`/`origin` back to
// the ray vertices and their `t` values are the numbers that place it. So moving
// an intersect is an inverse problem — find the ancestor t's that put this corner
// under the finger — and the forward model is the solver we already trust.
//
// Damped Gauss-Newton over those t's, with the existing solveScene as the forward
// map. Measured on the real modules: reachable targets converge in 1-3 iterations
// to sub-pixel error at 1-4% of a 60Hz frame, and every edge stays on its
// vanishing point to ~1e-13px. Underdetermined corners (the box's far top corner
// depends on three parameters through two equations) take the minimum-norm step,
// which distributes the drag by geometric sensitivity — dragging it straight up
// moves mostly height and leaves the two depths symmetric, so it behaves like
// direct manipulation rather than like three hidden sliders.
//
// The guards are not optional and each one is a measured failure, not a
// precaution. See `manipulate` for what each prevents.

const GN_MAX_ITERATIONS = 8;
const GN_TOLERANCE = 0.5;          // px — half a pixel is past what a finger means
const GN_EPS = 0.01;               // px — finite-difference step on t
const GN_STEP_CAP = 600;           // px — no single iteration may leap further
// D39 removed T_FLOOR. It existed only because solveRay used to fold at t = 0,
// so a corner had to be kept off it; with signed t there is nothing to protect
// against and a floor would be the wall itself, re-imposed one layer up.
const T_VP_FRACTION = 0.95;        // still never let a corner reach its own VP

/**
 * The ray vertices whose `t` determines where `vertexId` sits. Walks the
 * dependency chain, so it works for a corner defined by other corners (the box's
 * far top corner is two levels deep) without anything knowing what a box is.
 */
export function ancestorParams(scene, vertexId, seen = new Set()) {
  const v = vertexById(scene, vertexId);
  if (!v || seen.has(vertexId)) return [];
  seen.add(vertexId);
  if (v.kind === "anchor") return [];
  if (v.kind === "ray") {
    return [v.id, ...ancestorParams(scene, v.origin, seen)];
  }
  return v.defs.flatMap(d => ancestorParams(scene, d.origin, seen));
}

// How far along its guide a ray may travel before it reaches its own vanishing
// point. A corner AT its vanishing point is a degenerate construction, and the
// unbounded solve will happily converge there for an extreme target — measured:
// a corner dragged onto a VP produced a box whose base edge had crossed to the
// far side of the anchor. Axis bindings have no such limit.
function tLimit(scene, ray) {
  const origin = vertexById(scene, ray.origin);
  if (!origin || AXIS_BINDINGS.has(ray.binding)) return Infinity;
  const vp = scene.vanishingPoints.find(p => p.id === ray.binding?.vpId);
  if (!vp) return Infinity;
  const d = Math.hypot(vp.x - origin.x, vp.y - origin.y);
  return Number.isFinite(d) ? d * T_VP_FRACTION : Infinity;
}

function clampT(scene, ray, t) {
  // Bounded on BOTH sides now, and zero is allowed: a corner may sit on its own
  // origin on the way through to the other side. The only thing still forbidden
  // is reaching the vanishing point itself, where the construction stops meaning
  // anything.
  const limit = tLimit(scene, ray);
  return Math.max(-limit, Math.min(limit, t));
}

const finitePoint = v => v && Number.isFinite(v.x) && Number.isFinite(v.y);

/**
 * Move `vertexId` so that it lands on `target`, by whatever means its kind allows.
 * ONE entry point, because drag, arrow keys and the numeric fields were three code
 * paths that had already drifted apart once (ACCESSIBILITY F-05).
 *
 * Returns { ok, kind, moved, converged, error, params } or { ok:false, reason }.
 */
export function manipulate(scene, vertexId, target) {
  const v = vertexById(scene, vertexId);
  if (!v) return { ok: false, reason: `vertex "${vertexId}" does not exist` };
  if (!Number.isFinite(target?.x) || !Number.isFinite(target?.y)) {
    return { ok: false, reason: "the target is not a point" };
  }
  // GUARD 1 — never start from a broken corner. Measured: one drag on a corner
  // that was born degenerate (two parallel guides) writes NaN into its ancestors'
  // t values through the Jacobian and destroys the whole construction
  // irrecoverably. A corner the solver could not place is not a corner to grab.
  if (!finitePoint(v) || v.degenerate) {
    return { ok: false, reason: "this corner has no position yet — its two guides are parallel or its vanishing point sits on its origin" };
  }

  if (v.kind === "anchor") {
    const r = moveAnchor(scene, vertexId, target);
    return r.ok ? { ok: true, kind: "anchor", moved: true, converged: true, error: 0, params: [] } : r;
  }

  if (v.kind === "ray") {
    // Strictly single-parameter: project the target onto this ray's own guide and
    // set t. Deliberately NOT the generic inverse — a ray must never adjust its
    // ancestors, because the depths of a box are independent and the walk pins
    // that changing one leaves the other alone to within 0.01px.
    const origin = vertexById(scene, v.origin);
    const u = origin ? bindingDirection(scene, { x: origin.x, y: origin.y }, v.binding) : null;
    if (!u) return { ok: false, reason: "this corner's guide is degenerate here" };
    const t = clampT(scene, v, (target.x - origin.x) * u.x + (target.y - origin.y) * u.y);
    const r = rebindVertex(scene, vertexId, { t });
    return r.ok
      ? { ok: true, kind: "ray", moved: true, converged: true, error: Math.hypot(v.x - target.x, v.y - target.y), params: [v.id] }
      : r;
  }

  // ---- intersect: the inverse solve ---------------------------------------
  const params = [...new Set(ancestorParams(scene, vertexId))]
    .map(id => vertexById(scene, id))
    .filter(p => p && p.kind === "ray");
  if (!params.length) {
    return { ok: false, reason: "this corner is fixed by other points that cannot move" };
  }

  const read = () => ({ x: v.x, y: v.y });
  const snapshot = params.map(p => p.t);
  const writeT = theta => {
    params.forEach((p, i) => { p.t = clampT(scene, p, theta[i]); });
    solveScene(scene);
  };
  const restore = () => writeT(snapshot);

  let theta = params.map(p => p.t);
  let best = { theta: [...theta], err: Infinity };
  let lambda = 1e-3;
  let iterations = 0;

  for (; iterations < GN_MAX_ITERATIONS; iterations++) {
    writeT(theta);
    theta = params.map(p => p.t);           // clamping may have moved us
    const at = read();
    if (!finitePoint(v)) { restore(); return { ok: false, reason: "the construction stopped being solvable there" }; }
    const r = [at.x - target.x, at.y - target.y];
    const err = Math.hypot(r[0], r[1]);
    if (err < best.err) best = { theta: [...theta], err };
    if (err <= GN_TOLERANCE) break;

    // Finite-difference Jacobian: 2 rows (x,y), one column per parameter.
    const J = [];
    for (let i = 0; i < params.length; i++) {
      const kept = theta[i];
      params[i].t = kept + GN_EPS;
      solveScene(scene);
      const plus = read();
      params[i].t = kept;
      solveScene(scene);
      if (!Number.isFinite(plus.x) || !Number.isFinite(plus.y)) { J.push([0, 0]); continue; }
      J.push([(plus.x - at.x) / GN_EPS, (plus.y - at.y) / GN_EPS]);
    }

    // Minimum-norm damped step: d = -J^T (J J^T + lambda I)^-1 r. Two equations,
    // n unknowns; when n > 2 this spreads the correction by sensitivity rather
    // than dumping it into whichever parameter comes first.
    const a = J.reduce((s, c) => s + c[0] * c[0], 0) + lambda;
    const b = J.reduce((s, c) => s + c[0] * c[1], 0);
    const d = J.reduce((s, c) => s + c[1] * c[1], 0) + lambda;
    const det = a * d - b * b;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) { restore(); writeT(best.theta); break; }
    const w = [(-r[0] * d + r[1] * b) / det, (r[0] * b - r[1] * a) / det];
    const step = J.map(c => c[0] * w[0] + c[1] * w[1]);
    // GUARD 2 — a non-finite residual, Jacobian or step ends the solve rather
    // than writing NaN into the scene.
    if (step.some(x => !Number.isFinite(x))) { writeT(best.theta); break; }
    const norm = Math.hypot(...step);
    const scale = norm > GN_STEP_CAP ? GN_STEP_CAP / norm : 1;
    const next = theta.map((x, i) => x + step[i] * scale);
    if (next.some(x => !Number.isFinite(x))) { writeT(best.theta); break; }
    theta = next;
    lambda = err < best.err ? Math.max(lambda * 0.5, 1e-6) : Math.min(lambda * 4, 1e3);
  }

  // GUARD 3 — on non-convergence keep the best position found, so an
  // unreachable target pins the corner at the edge of what the construction can
  // do instead of leaving it wherever the last iteration landed.
  writeT(best.theta);
  const finalErr = Math.hypot(v.x - target.x, v.y - target.y);
  if (!finitePoint(v)) { restore(); return { ok: false, reason: "the construction stopped being solvable there" }; }
  return {
    ok: true,
    kind: "intersect",
    moved: true,
    converged: finalErr <= GN_TOLERANCE,
    error: finalErr,
    iterations,
    params: params.map(p => p.id),
  };
}

export function moveVp(scene, vpId, { x, y }) {
  const vp = scene.vanishingPoints.find(v => v.id === vpId);
  if (!vp) return { ok: false, reason: `vanishing point "${vpId}" does not exist` };
  if (vp.locked) return { ok: false, reason: `"${vp.label}" is locked and rejects drags (§4)` };
  vp.x = x;
  vp.y = y;                       // D36: free in both axes; nothing slaves it
  solveScene(scene);
  return { ok: true, vp };
}

// D36 — eye level is authored and moves nothing else. It used to drag every
// on-horizon vanishing point with it, which made "the point is above eye level"
// unrepresentable; that state is exactly what the tutorial has to show.
// D42 — FORCED PERSPECTIVE, as an artist means it.
//
// THE DEFINITION GIVEN, 2026-07-30: it means exaggerating for an artist's
// reference — sometimes for cartooning rather than for reality.
//
// So the control is not a measuring-point construction that guarantees a true
// cube — that is the other request, the honest-geometry one, and it is not this.
// This is the dial a cartoonist reaches for: bring the vanishing points IN and
// everything converges harder; push them OUT and it calms down. Because every
// line in this app is bound to a point rather than baked, the whole drawing
// follows the dial live. That is the one thing this app can do that a sheet of
// paper cannot, and it costs about fifteen lines.
//
// Scaling is about the CENTRE OF THE PAPER, not the centroid of the points: the
// paper is what the drawing sits on and what the artist is composing within, and
// scaling about a moving centroid would drift the composition sideways every
// time it was used.
// D46 — a vanishing point may sit ANYWHERE, INCLUDING ON THE PAPER.
//
// THE CORRECTION, 2026-07-30, and the app was flatly wrong: it told the reader
// that placing a vanishing point on the paper stopped it being a vanishing
// point. A pair of train tracks running away from the viewer is exactly that
// case, and it is the most ordinary one there is.
//
// That is right, and D45 was wrong on the substance rather than on its threshold.
// One-point perspective puts the vanishing point IN THE MIDDLE OF THE PICTURE —
// the track, the corridor, the road running away from you. A point on the paper
// is not a failure state, it is the most ordinary construction there is, and
// refusing it forbade an entire class of drawing this app exists to make.
//
// The real limit is much smaller and is about arithmetic, not composition: a
// guide has no direction when its point sits ON the corner it guides, and
// scaling everything toward one spot would eventually put every point there.
// So the only thing refused is a scale that collapses the points into the centre
// they are being scaled about. Everything else is allowed.
//
// The clamp people actually feel near a close point is `tLimit` — a corner cannot
// reach its own vanishing point, because that distance is infinity in the world
// being drawn. That is correct wherever the point sits, and has nothing to do
// with the paper.
// The only true degeneracy: two points arriving at the same place. Then the two
// guides through any corner are the same line, the corner is no longer defined by
// a crossing, and the construction has nothing left to say. Distance from the
// CENTRE is not the test — a lone point scaled all the way to the middle of the
// paper is one-point perspective, and perfectly fine.
const SPREAD_FLOOR = 0.02;   // of the paper's diagonal, between any two points

export function scaleVpSpread(scene, k) {
  if (!Number.isFinite(k) || k <= 0) return { ok: false, reason: "that is not a scale" };
  const movable = scene.vanishingPoints.filter(v => !v.locked);
  if (!movable.length) {
    return { ok: false, reason: "every vanishing point is locked — unlock one to change the perspective" };
  }
  const { width: w, height: h } = scene.canvas;
  const cx = w / 2, cy = h / 2;
  const floor = Math.hypot(w, h) * SPREAD_FLOOR;

  // D45 — a point that sits ON the horizon STAYS on it. Scaling y as well as x
  // pulled horizon points off the line they define, so pressing Stronger slid the
  // horizon away from eye level a little at a time. Only the third point — the
  // one above or below — has a meaningful y to exaggerate.
  const next = movable.map(vp => ({
    vp,
    x: cx + (vp.x - cx) * k,
    y: vp.onHorizon ? vp.y : cy + (vp.y - cy) * k,
  }));

  for (let i = 0; i < next.length; i++) {
    for (let j = i + 1; j < next.length; j++) {
      if (Math.hypot(next[i].x - next[j].x, next[i].y - next[j].y) < floor) {
        return { ok: false, reason: `any stronger and ${next[i].vp.label} and ${next[j].vp.label} would be the same point, and two guides that are one line define no corner` };
      }
    }
  }
  for (const n of next) { n.vp.x = n.x; n.vp.y = n.y; }
  solveScene(scene);
  return { ok: true, moved: movable.length };
}

export function setEyeLevel(scene, y) {
  if (!Number.isFinite(y)) return { ok: false, reason: "eye level needs a number" };
  scene.eyeLevel.y = y;
  return { ok: true };
}

// D36 — the horizon, derived. It is the line through the points that declare
// themselves on it. THE RULE IS FLAT: there is no horizon without the vanishing
// points. Fewer than two, and this returns null and NOTHING is drawn — an app that
// draws a horizon anyway is asserting a fact it does not have.
//
// Two points at the same place cannot define a line either; that is null too,
// rather than a direction picked out of the air.
export function horizonLine(scene) {
  const on = scene.vanishingPoints.filter(v => v.onHorizon);
  if (on.length < 2) return null;
  const [a, b] = on;                       // the first two, in the order they were added
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= epsLen(scene)) return null;
  return {
    a: { x: a.x, y: a.y },
    b: { x: b.x, y: b.y },
    u: { x: dx / len, y: dy / len },
    ids: [a.id, b.id],
    // Signed, in canvas units: how far the horizon sits from eye level at the
    // midpoint between the two points. Positive means the horizon is BELOW eye
    // level. This is the number the lesson is about.
    offsetFromEyeLevel: (a.y + b.y) / 2 - scene.eyeLevel.y,
  };
}

// D17 — a vanishing point can always be deleted, and deleting it moves nothing.
//
// THE DEFECT, 2026-07-29: the app said a vanishing point could not be deleted
// without destroying existing lines, and refused the deletion outright. That is
// the wrong answer to a real problem: the lines leaning on that point would be
// left with no guide. Refusing lets a drawing hold its own tool hostage.
//
// What happens instead: everything that depended on the point is FROZEN EXACTLY
// WHERE IT SITS. A constructed point becomes a plain anchor at its current
// coordinates; a line bound to that point keeps its geometry and loses only its
// guide. Not one pixel moves — deleting a guide must never redraw the drawing
// (Doctrine §14: no silent mutation of the user's content).
//
// A dependent that never solved (NaN, so nothing was ever visible) has no
// position to freeze; it is removed along with any line referencing it, and the
// caller is told the count rather than left to wonder.
export function deleteVp(scene, vpId) {
  const vp = scene.vanishingPoints.find(v => v.id === vpId);
  if (!vp) return { ok: false, reason: `vanishing point "${vpId}" does not exist` };

  const usesVp = v =>
    (v.kind === "ray" && v.binding && v.binding.vpId === vpId) ||
    (v.kind === "intersect" && v.defs.some(d => d.binding && d.binding.vpId === vpId));

  let frozen = 0;
  const dropped = new Set();
  for (const v of scene.vertices) {
    if (!usesVp(v)) continue;
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) { dropped.add(v.id); continue; }
    const { x, y } = v;                       // its position now, kept to the pixel
    delete v.binding; delete v.origin; delete v.defs; delete v.t; delete v.degenerate;
    v.kind = "anchor";
    v.x = x; v.y = y;
    frozen++;
  }

  let freed = 0;
  const before = scene.edges.length;
  scene.edges = scene.edges.filter(e => !(dropped.has(e.a) || dropped.has(e.b)));
  const removedEdges = before - scene.edges.length;
  for (const e of scene.edges) {
    if (e.binding && e.binding.vpId === vpId) { e.binding = "free"; freed++; }
  }
  if (dropped.size) scene.vertices = scene.vertices.filter(v => !dropped.has(v.id));

  scene.vanishingPoints = scene.vanishingPoints.filter(v => v.id !== vpId);
  solveScene(scene);
  return { ok: true, label: vp.label, frozen, freed, removedEdges, dropped: dropped.size };
}

// D17 — deleting a point takes the lines that end on it with it, because a line
// with one end is not a line. The count comes back so the user is told.
// D24 — clear the screen. Two actions, because "clear" means two different
// things in a perspective tool and guessing which would be wrong half the time:
// wipe what you have DRAWN and keep the vanishing points you set up, or start
// from nothing. Both report what they removed, counted from the scene rather
// than described, and both leave the horizon and the canvas size alone — those
// are the sheet of paper, not the drawing on it.
//
// Neither is a "reset": no defaults are invented, nothing is re-added. And
// neither touches history, so the caller's one beginGesture makes the whole
// thing a single undo step (D7).
export function clearDrawing(scene) {
  const removed = { edges: scene.edges.length, vertices: scene.vertices.length };
  if (!removed.edges && !removed.vertices) {
    return { ok: false, reason: "there is nothing drawn yet", ...removed };
  }
  scene.edges = [];
  scene.vertices = [];
  scene.faces = [];
  solveScene(scene);
  return { ok: true, ...removed, keptPoints: scene.vanishingPoints.length };
}

export function clearAll(scene) {
  const removed = {
    edges: scene.edges.length,
    vertices: scene.vertices.length,
    points: scene.vanishingPoints.length,
  };
  if (!removed.edges && !removed.vertices && !removed.points) {
    return { ok: false, reason: "the sheet is already empty", ...removed };
  }
  scene.edges = [];
  scene.vertices = [];
  scene.faces = [];
  scene.vanishingPoints = [];
  solveScene(scene);
  return { ok: true, ...removed };
}

// D37 — a face is a way of SEEING the drawing, not a new kind of geometry. It
// owns no positions: it is a loop of corner ids that already exist, so a face
// can never disagree with the wireframe it shades. Delete a corner and the face
// goes with it; move one and the fill follows for free.
export function addFace(scene, { loop, solid, shade }) {
  if (!Array.isArray(loop) || loop.length < 3) return { ok: false, reason: "a face needs at least three corners" };
  const known = new Set(scene.vertices.map(v => v.id));
  for (const id of loop) if (!known.has(id)) return { ok: false, reason: `face names a missing corner "${id}"` };
  if (!scene.faces) scene.faces = [];
  const face = { id: newId(scene, "f"), loop: [...loop], solid, shade };
  scene.faces.push(face);
  return { ok: true, face };
}

// ---- D50 — equal intervals in depth -------------------------------------
//
// FROM THE QUESTION of what would actually be useful to an artist, 2026-07-31.
// This is the thing underneath all of it: putting marks at EQUAL WORLD INTERVALS
// going away from you. Fence posts, floor tiles, window bays, the buildings
// along a street. On paper it is done with diagonals — cross a square corner to
// corner, and the crossing is its centre in perspective. Until now every depth
// in this app was eyeballed, which means a "city block" would have been this
// code's guess at spacing rather than a construction.
//
// It needs no diagonals and no camera calibration, because the answer is exact
// projective geometry. Along a line running to a vanishing point, let D be the
// distance from the origin to that point and t the distance to a mark. Equal
// world steps are NOT equal t steps — t crowds toward the vanishing point, which
// is the whole phenomenon. Writing t for the first interval, the mark f intervals
// out sits at
//
//     t(f) = D · f · t1 / (D + (f - 1) · t1)
//
// t(1) = t1, t(0) = 0, and t -> D as f -> infinity: the marks approach the
// vanishing point and never reach it, which is what "infinitely far away" means.
// Fractional f divides rather than repeats, so one formula does both.
export function depthAtInterval(D, t1, f) {
  if (!Number.isFinite(D) || !Number.isFinite(t1) || !Number.isFinite(f)) return null;
  const denom = D + (f - 1) * t1;
  if (Math.abs(denom) < 1e-9) return null;      // the mark is at the vanishing point
  const t = (D * f * t1) / denom;
  return Number.isFinite(t) ? t : null;
}

// The vanishing point a guide-riding corner runs toward, and how far off it is.
function guideReach(scene, v) {
  if (!v || v.kind !== "ray" || typeof v.binding !== "object") return null;
  const origin = vertexById(scene, v.origin);
  const vp = scene.vanishingPoints.find(p => p.id === v.binding.vpId);
  if (!origin || !vp) return null;
  const D = Math.hypot(vp.x - origin.x, vp.y - origin.y);
  if (!(D > 0) || !Number.isFinite(D)) return null;
  return { origin, vp, D };
}

/**
 * Marks at equal world intervals along the guide a corner rides.
 *
 * `parts` divides the corner's own distance into that many equal steps; `times`
 * repeats it that many intervals out. Both create ray vertices on the SAME guide
 * with the same origin, so they are held by the construction like everything
 * else: move the vanishing point and the whole run of marks moves with it.
 */
export function markIntervals(scene, vertexId, { parts = 0, times = 0 } = {}) {
  const v = vertexById(scene, vertexId);
  if (!v) return { ok: false, reason: `point "${vertexId}" does not exist` };
  const reach = guideReach(scene, v);
  if (!reach) {
    return { ok: false, reason: "pick a corner that runs to a vanishing point — that is the direction to space things along" };
  }
  const { D } = reach;
  if (Math.abs(v.t) < 1) {
    return { ok: false, reason: "that corner sits on its own origin, so there is no interval to repeat" };
  }
  const fractions = [];
  if (parts >= 2) for (let k = 1; k < parts; k++) fractions.push(k / parts);
  if (times >= 2) for (let n = 2; n <= times; n++) fractions.push(n);
  if (!fractions.length) return { ok: false, reason: "nothing to do" };

  const made = [];
  const limit = tLimit(scene, v);
  for (const f of fractions) {
    const t = depthAtInterval(D, v.t, f);
    if (t === null || Math.abs(t) >= limit) continue;   // past the vanishing point: silently out of reach
    const r = addRayVertex(scene, { origin: v.origin, binding: { ...v.binding }, t });
    if (r.ok) made.push(r.vertex.id);
  }
  if (!made.length) {
    return { ok: false, reason: "every mark would land past the vanishing point — shorten the first interval" };
  }
  solveScene(scene);
  return { ok: true, made, asked: fractions.length };
}

// ---- D51 — the scale figure, and why it is nearly free ------------------
//
// Everyone's eye is at eye level. So the vertical from ANY point on the ground up
// to the horizon spans exactly the observer's own eye height, wherever that point
// is and however far away — that segment is a ruler, already correctly
// foreshortened by the perspective itself. A figure the same height as you has
// its eye ON the horizon at any depth, which is the oldest trick in the book and
// the one artists use to check a scene reads at human scale.
//
// Generalised, it measures ANYTHING of known height: a door is about 1.2 of eye
// height, a storey about 1.9, a lamp post about 2.6. Multiply the feet-to-horizon
// span by that ratio and you have the height, at that depth, correct.
//
// It is stored as a RATIO rather than a length, and re-derived on every solve, so
// moving the horizon or the figure re-measures it instead of leaving a stale
// stick behind. That is the same rule the rest of the app follows: hold the
// relationship, not the number it happened to produce.
export function gaugeSpan(scene, originPos) {
  if (!originPos || !Number.isFinite(originPos.x) || !Number.isFinite(originPos.y)) return null;
  const hz = horizonLine(scene);
  if (hz) {
    // Where the vertical through the feet meets the horizon. Vertical is (0,1),
    // so this is a plain line/line solve that cannot divide by zero unless the
    // horizon is itself vertical, which two points on a horizon never are.
    if (Math.abs(hz.u.x) < 1e-9) return null;
    const y = hz.a.y + (originPos.x - hz.a.x) * (hz.u.y / hz.u.x);
    return Number.isFinite(y) ? y - originPos.y : null;
  }
  const eye = scene.eyeLevel?.y;
  return Number.isFinite(eye) ? eye - originPos.y : null;
}

/**
 * A vertical measure standing on the ground at `at`, `ratio` times the observer's
 * eye height. ratio 1 is a figure your own height — its eye lands on the horizon.
 */
export function addFigure(scene, { at, ratio = 1 }) {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
    return { ok: false, reason: "that is not a place to stand" };
  }
  if (!Number.isFinite(ratio) || ratio <= 0) return { ok: false, reason: "a height has to be a positive number" };
  const span = gaugeSpan(scene, at);
  if (span === null || Math.abs(span) < 1) {
    return { ok: false, reason: "that spot is level with the horizon, where anything standing on the ground is infinitely far away" };
  }
  const feet = addAnchor(scene, { x: at.x, y: at.y });
  if (!feet.ok) return feet;
  const head = addRayVertex(scene, { origin: feet.vertex.id, binding: "vertical", t: span * ratio });
  if (!head.ok) return head;
  head.vertex.gauge = ratio;          // re-measured on every solve, never stored as a length
  const e = addEdge(scene, { a: feet.vertex.id, b: head.vertex.id, binding: "vertical" });
  if (!e.ok) return e;
  solveScene(scene);
  return { ok: true, feet: feet.vertex, head: head.vertex, edge: e.edge, ratio };
}

// ---- D52 — the interior room -------------------------------------------
//
// Third of the three that were asked for, and the only one that is a NEW KIND of
// thing rather than more of what exists. A room is a box you are INSIDE, and
// that inverts everything the box code assumes: you see the far wall, the floor,
// the ceiling and both side walls, and the surface nearest you — the opening you
// are looking through — is the one you do not see at all.
//
// The construction is the oldest exercise in perspective. Draw the opening as a
// rectangle. Run a line from each of its corners to the vanishing point. Stop all
// four at the same fraction of the way there, and the far wall is the near wall
// scaled about the point — which is why it stays a rectangle without anything
// having to enforce it.
//
// `recede` is that fraction, held per corner and re-derived on every solve, so
// moving the vanishing point re-forms the room instead of skewing it.
const ROOM_MIN = 0.05, ROOM_MAX = 0.95;

// D61 — a street. Buildings down both sides, crossroads, and the alleys behind.
//
// THE REQUEST, 2026-08-01: buildings down both sides of a road in one-point
// perspective, with alleys and crossroads — built as a grid of lines acting as
// streets, which is then plotted with buildings.
//
// Nothing new is invented here. The whole thing is three amendments already in
// the app, pointed at one construction:
//
//   D52's FRACTION — four rails start on the same near line and run to the same
//   point, so at a shared fraction of the way there they all reach the same
//   height on the page. That is what keeps every crossroad HORIZONTAL no matter
//   where the point is dragged, and it is the far-wall-stays-a-rectangle argument
//   with four rails instead of four corners.
//
//   D50's INTERVAL — the fractions themselves, so blocks are equally spaced in
//   the world and crowd toward the point on the page.
//
//   D51's GAUGE — every building's height is a multiple of your own eye height,
//   measured to the horizon from its own corner. Equal storeys therefore come out
//   correctly foreshortened at every depth, and the roofline runs to the point
//   without anyone aiming it there. Move the horizon and the city re-measures.
//
// The rails, from left to right: the back of the left block, the left kerb, the
// right kerb, the back of the right block. The outer pair are the alleys.
const STREET_MAX_BLOCKS = 8;

export function buildStreet(scene, { vpId, at, width = 420, block = 300, blocks = 4, first = 0.17, storeys } = {}) {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return { ok: false, reason: "that is not a place to put a street" };
  if (!(width > 1) || !(block > 1)) return { ok: false, reason: "a street needs a road and a block either side of it" };
  const n = Math.max(1, Math.min(STREET_MAX_BLOCKS, Math.round(blocks)));
  const vp = scene.vanishingPoints.find(v => v.id === vpId) ?? scene.vanishingPoints.find(v => !v.locked);
  if (!vp) return { ok: false, reason: "a street needs a vanishing point to run away to — add one first" };
  // D52's rule, and for the same reason: a point off to the side builds a road
  // running PAST you rather than away from you. That is honest geometry and it is
  // not a street you are standing in.
  if (vp.x < 0 || vp.x > scene.canvas.width || vp.y < 0 || vp.y > scene.canvas.height) {
    return { ok: false, reason: "a street runs away from where you stand — drag a vanishing point onto the paper first" };
  }
  if (!(Number.isFinite(first) && first > 0.01 && first < 0.6)) return { ok: false, reason: "that first block is not a distance" };

  const made = { vertices: [], edges: [] };
  const V = r => { if (!r.ok) return null; made.vertices.push(r.vertex.id); return r.vertex; };
  const E = (a2, b2, binding) => {
    const r = addEdge(scene, { a: a2.id, b: b2.id, binding });
    if (r.ok) made.edges.push(r.edge.id);
    return r.ok;
  };

  // The fractions. depthAtInterval against a unit distance IS the fraction, so
  // one formula serves the marks along a guide and the blocks along a street.
  const fracs = [];
  for (let j = 1; j <= n; j++) {
    const f = depthAtInterval(1, first, j);
    if (f === null || !(f > 0) || !(f < 1)) break;
    fracs.push(f);
  }
  if (!fracs.length) return { ok: false, reason: "could not space the blocks" };

  const half = width / 2;
  const offsets = [-half - block, -half, half, half + block];
  const rails = [];
  for (const dx of offsets) {
    const foot = V(addAnchor(scene, { x: at.x + dx, y: at.y }));
    if (!foot) return { ok: false, reason: "could not lay the kerb" };
    const along = [foot];
    for (const f of fracs) {
      const p = V(addRayVertex(scene, { origin: foot.id, binding: { vpId: vp.id }, t: 0 }));
      if (!p) return { ok: false, reason: "could not run the street to the vanishing point" };
      p.recede = f;                       // the shared fraction — this is the whole trick
      along.push(p);
    }
    rails.push(along);
  }

  for (const along of rails) {
    for (let j = 0; j + 1 < along.length; j++) E(along[j], along[j + 1], { vpId: vp.id });
  }
  // Crossroads. Every rail is at the same height at the same fraction, so these
  // are horizontal and stay horizontal; the binding says so rather than the
  // coordinates happening to agree.
  for (let j = 0; j < rails[0].length; j++) {
    for (let r = 0; r + 1 < rails.length; r++) E(rails[r][j], rails[r + 1][j], "horizontal");
  }

  // The plots: the strip behind each kerb, block by block. Rails 0-1 on the left,
  // 2-3 on the right. The road itself (rails 1-2) is left empty, which is what
  // makes it a road.
  const plots = [];
  for (const [a2, b2, side] of [[0, 1, "left"], [2, 3, "right"]]) {
    for (let j = 0; j + 1 < rails[0].length; j++) {
      plots.push({ side, block: j, corners: [rails[a2][j], rails[b2][j], rails[b2][j + 1], rails[a2][j + 1]] });
    }
  }

  const built = [];
  // No storeys is not an empty city, it is a STREET PLAN — the grid on its own,
  // to draw over. The two-step description the request came in — lay a grid of
  // lines that act as streets, then plot buildings onto them — has the grid as a
  // thing in its own right, and an artist placing buildings by hand wants exactly the
  // lines and none of the massing.
  if (storeys && storeys.length) {
    for (let i = 0; i < plots.length; i++) {
      const h = storeys[i % storeys.length];
      if (!(h > 0)) continue;                       // a zero is a gap — the alleys
      const r = raiseBuilding(scene, plots[i], h, vp, made);
      if (r) built.push(r);
    }
  }

  solveScene(scene);
  return { ok: true, ...made, vp, rails, fracs, plots, buildings: built };
}

// One building on one plot: a vertical from each ground corner, every one of them
// a MULTIPLE OF EYE HEIGHT rather than a length, so the four come out to the right
// foreshortened heights on their own and the roofline runs where it should.
function raiseBuilding(scene, plot, storeys, vp, made) {
  const V = r => { if (!r.ok) return null; made.vertices.push(r.vertex.id); return r.vertex; };
  // D63 — make the ground ring's ROTATIONAL SENSE canonical before anything is
  // built on it. A street plot is [railA@j, railB@j, railB@j+1, railA@j+1], which
  // goes round the opposite way to a box's [near, left, back, right]; feed that to
  // the box's face scheme and every face comes out inside out. This is not a
  // winding to be flipped afterwards — orientSolid cannot see it, because the set
  // it produces is internally consistent and simply faces the wrong way as a
  // whole. Fixing the RING is the one place that ends it for good.
  const ringArea = pts => {
    let a2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a2 += p.x * q.y - q.x * p.y;
    }
    return a2 / 2;
  };
  const E = (a2, b2, binding) => {
    const r = addEdge(scene, { a: a2.id, b: b2.id, binding });
    if (r.ok) made.edges.push(r.edge.id);
  };
  const base = ringArea(plot.corners) < 0 ? [...plot.corners].reverse() : plot.corners;
  const top = [];
  for (const g of base) {
    const t = V(addRayVertex(scene, { origin: g.id, binding: "vertical", t: -10 }));
    if (!t) return null;
    // POSITIVE, like a scale figure's ratio (D51). gaugeSpan is negative for a
    // point below the horizon and the vertical guide points down the page, so a
    // positive gauge is what sends the wall UP. Getting this backwards buried
    // every building in the ground, and the first version of the tests could not
    // see it because they measured height with Math.abs.
    t.gauge = storeys;
    top.push(t);
  }
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    E(top[i], top[j], i % 2 === 0 ? "horizontal" : { vpId: vp.id });
    E(base[i], top[i], "vertical");
  }
  // D63 — all six, wound like a box's. Which walls you can see is the winding's
  // business now, so a building no longer has to be told which side of the road
  // it is on: the projection already knows.
  const solid = `bldg${scene.nextId}`;
  const F = (loop, shade) => addFace(scene, { loop: loop.map(v => v.id), solid, shade });
  const wallShade = ["near", "left", "back", "right"];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    F([base[i], base[j], top[j], top[i]], wallShade[i]);
  }
  F(top, "top");
  F([...base].reverse(), "bottom");
  // Orient from the TOP cap: a building stands on the ground, so its top is the
  // horizontal face you can see and its underside is the one that must cull.
  // The ring is canonical now, so the faces are already right way out. This is
  // kept as the backstop for a plot so foreshortened its ring reads as zero area.
  orientSolid(scene, solid, { cap: "top" });
  return { solid, base, top, storeys, side: plot.side };
}

export function buildRoom(scene, { at, width, height, vpId, depth = 0.6 }) {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return { ok: false, reason: "that is not a place to put a room" };
  if (!(width > 1) || !(height > 1)) return { ok: false, reason: "a room needs a wall you can see" };
  const vp = scene.vanishingPoints.find(v => v.id === vpId) ?? scene.vanishingPoints.find(v => !v.locked);
  if (!vp) return { ok: false, reason: "a room needs a vanishing point to run away to — add one first" };
  const recede = Math.max(ROOM_MIN, Math.min(ROOM_MAX, depth));

  const made = { vertices: [], edges: [] };
  const V = r => { if (!r.ok) return null; made.vertices.push(r.vertex.id); return r.vertex; };
  const E = (a, b, binding) => {
    const r = addEdge(scene, { a: a.id, b: b.id, binding });
    if (r.ok) made.edges.push(r.edge.id);
    return r.ok;
  };

  // The opening, held as a rectangle the way this app holds rectangles: one
  // anchor, two axis rays, and a corner where the two axes cross.
  const bl = V(addAnchor(scene, { x: at.x, y: at.y + height }));
  if (!bl) return { ok: false, reason: "could not place the near corner" };
  const br = V(addRayVertex(scene, { origin: bl.id, binding: "horizontal", t: width }));
  const tl = V(addRayVertex(scene, { origin: bl.id, binding: "vertical", t: -height }));
  if (!br || !tl) return { ok: false, reason: "could not raise the opening" };
  const tr = V(addIntersectVertex(scene, { defs: [
    { origin: tl.id, binding: "horizontal" },
    { origin: br.id, binding: "vertical" },
  ] }));
  if (!tr) return { ok: false, reason: "could not close the opening" };

  // The far wall: the same four corners, the same fraction of the way to the
  // point. Ring order matches the near ring, which is the contract every face
  // below reads off.
  const near = [bl, br, tr, tl];
  const far = [];
  for (const n of near) {
    const f = V(addRayVertex(scene, { origin: n.id, binding: { vpId: vp.id }, t: 0 }));
    if (!f) return { ok: false, reason: "could not run the walls back to the vanishing point" };
    f.recede = recede;
    far.push(f);
  }

  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    E(near[i], near[j], i % 2 === 0 ? "horizontal" : "vertical");   // the opening
    E(far[i], far[j], i % 2 === 0 ? "horizontal" : "vertical");     // the far wall
    E(near[i], far[i], { vpId: vp.id });                            // and the run between
  }

  // Five surfaces, and every one of them faces you. That is what being inside
  // means, and it is why a room needs its own face set rather than the box's.
  // D63 — the SAME scheme a box uses, then every loop REVERSED. A room is a box
  // you are inside, so its faces face inward; reversing is the whole difference,
  // and it means one rule culls both. The old set was wound four different ways
  // and only worked because visibleFaces had a special case for interiors.
  const solid = `room${scene.nextId}`;
  const F = (loop, shade) => addFace(scene, { loop: loop.map(v => v.id).reverse(), solid, shade });
  const wallShade = ["bottom", "right", "top", "left"];   // near ring is [bl, br, tr, tl]
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    F([near[i], near[j], far[j], far[i]], wallShade[i]);
  }
  F(far, "back");

  solveScene(scene);
  return { ok: true, ...made, solid, vp, recede, near, far };
}

// ---- D53 — inclined planes: roofs, ramps, stairs ------------------------
//
// The last thing a house needs that a box cannot express. A sloping edge is not
// bound to any of the three axis points, and it is not free either — a set of
// parallel slopes has its OWN vanishing point, and that point sits on the
// VERTICAL LINE through the point its horizontal projection runs to. Rising away
// from you puts it above; falling away puts it below.
//
// That is the whole construction, and it is why a roof is drawable at all: the
// eaves run to VP1, so the slope above them runs to a point directly above VP1,
// and every rafter on that side is parallel to it.
//
// A slope point is DERIVED — it holds which point it hangs from and how far, and
// re-derives its position on every solve, so moving the parent takes the roof
// with it. It does not count against D41's limit of three, because it is not a
// fourth axis: it is the same axis tilted, and the limit exists to stop points
// that nothing can bind to.
export function addSlopePoint(scene, { vpId, rise, label }) {
  const parent = scene.vanishingPoints.find(v => v.id === vpId);
  if (!parent) return { ok: false, reason: "a slope hangs off an existing vanishing point — pick the one its base runs to" };
  if (!Number.isFinite(rise) || rise === 0) {
    return { ok: false, reason: "a slope needs a rise: above the point to climb away from you, below it to fall away" };
  }
  const vp = {
    id: newId(scene, "vp"),
    label: label ?? `${parent.label} slope`,
    x: parent.x,
    y: parent.y + rise,
    axis: "slope", locked: false, onHorizon: false,
    trace: { vpId: parent.id, rise },
  };
  scene.vanishingPoints.push(vp);
  solveScene(scene);
  return { ok: true, vp };
}

// Re-seat every derived point before anything is solved against it. Cheap, and
// it means a slope point can never be stale: drag the parent and the roof turns
// with the walls, which is the entire reason it is derived rather than placed.
// D65 — a vanishing point made from TWO DRAWN LINES, and BOUND to them.
//
// THE REQUEST, 2026-08-01: create vanishing points as the intersection of two
// drawn lines. Bound rather than merely placed, which was the explicit part —
// move either line and the point follows.
//
// This is how you find a point in a photograph: draw along two edges of a
// building that are parallel in the world, and where they cross is where they
// vanish. It is also the half of the image-import workflow that works with no
// image at all.
//
// The point stores the two EDGE ids and nothing else, and is re-derived at the
// top of every solve — the same shape as a slope point (D53). Two refusals it
// must make rather than fudge:
//
//   · lines that are parallel, or nearly so, cross at infinity. There is no point
//     to place and a number a mile off the page is not one.
//   · a line already bound to a vanishing point cannot help define one, or the
//     point would depend on itself. That is a cycle, and it is refused at the
//     moment of asking rather than discovered as a hang.
export function edgeLine(scene, edgeId) {
  const e = (scene.edges ?? []).find(x => x.id === edgeId);
  if (!e) return null;
  const a = scene.vertices.find(v => v.id === e.a);
  const b = scene.vertices.find(v => v.id === e.b);
  if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) return null;
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return null;
  return { a, b, e };
}

// How far a point can be before moving it further stops changing the drawing.
//
// THE RULING, 2026-08-02: once the difference cannot be discerned on screen past
// a certain distance, everything past it can be treated as the same. Derived rather than
// picked: lines aimed at a point R away deviate from truly parallel by about
// L/R radians, so across a page of diagonal L they land about L²/R from where
// parallel lines would. Setting that under half a pixel gives R = 2L².
//
// For a 1600x1200 page that is about 8 million — a large coordinate and a
// perfectly ordinary one. Nothing is approximated up to there; past it the answer
// is pinned to a place that draws identically to the one asked for.
export function vpReach(scene) {
  const w = scene?.canvas?.width ?? 1600, h = scene?.canvas?.height ?? 1200;
  return 2 * (w * w + h * h);
}

// Where two lines cross, ALWAYS — the near-parallel case included.
//
// This used to refuse anything within about a degree of parallel, on the grounds
// that the crossing "stops meaning anything". That was corrected 2026-08-02, and
// the correction is right:
// a degree of divergence over 700px crosses 36,000px away, which is a real point
// the app already draws edge markers for. Refusing it threw away answers it could
// perfectly well give.
//
// Past parallel needs no handling at all: the determinant changes sign and the
// crossing comes back from the other side by itself. That is the second half of the ruling and
// it falls out of doing the arithmetic signed.
//
// So only EXACTLY parallel is left, and it gets a point rather than an error —
// placed at the reach along the lines' own direction, where it draws the same as
// the infinity it stands for. "Nudge it just slightly", made precise.
export function linesCross(L1, L2, { reach = Infinity } = {}) {
  const d1 = { x: L1.b.x - L1.a.x, y: L1.b.y - L1.a.y };
  const d2 = { x: L2.b.x - L2.a.x, y: L2.b.y - L2.a.y };
  const n1 = Math.hypot(d1.x, d1.y), n2 = Math.hypot(d2.x, d2.y);
  if (!(n1 > 0) || !(n2 > 0)) return null;
  const den = d1.x * d2.y - d1.y * d2.x;
  const mid = { x: (L1.a.x + L1.b.x) / 2, y: (L1.a.y + L1.b.y) / 2 };
  const cap = Number.isFinite(reach) ? reach : Infinity;

  // Exactly parallel, to floating point. Stand the point off along the shared
  // direction at the reach: it is the limit these lines are heading toward, and
  // at that distance it is indistinguishable from it.
  if (Math.abs(den) / (n1 * n2) < 1e-12) {
    if (!Number.isFinite(cap)) return null;
    return { x: mid.x + (d1.x / n1) * cap, y: mid.y + (d1.y / n1) * cap, atReach: true };
  }

  const t = ((L2.a.x - L1.a.x) * d2.y - (L2.a.y - L1.a.y) * d2.x) / den;
  const p = { x: L1.a.x + t * d1.x, y: L1.a.y + t * d1.y };
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const away = Math.hypot(p.x - mid.x, p.y - mid.y);
  if (away > cap) {
    // Same direction, pinned to where the difference stops showing.
    return { x: mid.x + (p.x - mid.x) / away * cap, y: mid.y + (p.y - mid.y) / away * cap, atReach: true };
  }
  return p;
}

// Does this edge, or anything it hangs off, already run to `vpId`?
function edgeDependsOnVp(scene, edgeId, vpId) {
  const e = (scene.edges ?? []).find(x => x.id === edgeId);
  if (!e) return false;
  if (typeof e.binding === "object" && e.binding?.vpId === vpId) return true;
  const seen = new Set();
  const stack = [e.a, e.b];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const v = scene.vertices.find(x => x.id === id);
    if (!v) continue;
    if (typeof v.binding === "object" && v.binding?.vpId === vpId) return true;
    if (v.defs) for (const d of v.defs) {
      if (typeof d.binding === "object" && d.binding?.vpId === vpId) return true;
      stack.push(d.origin);
    }
    if (v.origin) stack.push(v.origin);
  }
  return false;
}

export function addVpFromLines(scene, { edgeA, edgeB, label }) {
  if (!edgeA || !edgeB || edgeA === edgeB) {
    return { ok: false, reason: "pick two different lines — a point is where two of them cross" };
  }
  const L1 = edgeLine(scene, edgeA), L2 = edgeLine(scene, edgeB);
  if (!L1 || !L2) return { ok: false, reason: "one of those lines is not in the drawing any more" };
  const at = linesCross(L1, L2, { reach: vpReach(scene) });
  if (!at) return { ok: false, reason: "one of those lines has no length, so there is no direction to follow" };
  const vp = {
    id: newId(scene, "vp"),
    label: label ?? `VP${scene.vanishingPoints.length + 1}`,
    x: at.x, y: at.y,
    axis: "z", locked: false, onHorizon: false,
    from: { edgeA, edgeB },
  };
  // Refuse a cycle BEFORE it exists: neither line may already run to this point.
  if (edgeDependsOnVp(scene, edgeA, vp.id) || edgeDependsOnVp(scene, edgeB, vp.id)) {
    return { ok: false, reason: "a line that already runs to this point cannot also define it" };
  }
  scene.vanishingPoints.push(vp);
  solveScene(scene);
  return { ok: true, vp, at };
}

// Re-derive every point that was made from two lines, before anything is solved
// against it. Cheap, and it means such a point can never be stale.
export function reseatDerivedVps(scene) {
  for (const vp of scene.vanishingPoints ?? []) {
    if (!vp.from) continue;
    const L1 = edgeLine(scene, vp.from.edgeA), L2 = edgeLine(scene, vp.from.edgeB);
    if (!L1 || !L2) { delete vp.from; continue; }      // a line went; it stays put
    const at = linesCross(L1, L2, { reach: vpReach(scene) });
    if (!at) continue;                                 // a line lost its length: hold the last good place
    vp.x = at.x; vp.y = at.y;
  }
}

export function reseatSlopePoints(scene) {
  for (const vp of scene.vanishingPoints) {
    if (!vp.trace) continue;
    const parent = scene.vanishingPoints.find(v => v.id === vp.trace.vpId);
    if (!parent) { delete vp.trace; continue; }   // its parent went; it stays where it is
    vp.x = parent.x;
    vp.y = parent.y + vp.trace.rise;
  }
}

// D41's limit counts AXIS points only. A slope is the same axis tilted.
export function axisPointCount(scene) {
  return scene.vanishingPoints.filter(v => !v.trace).length;
}

export function deleteVertex(scene, vertexId) {
  const v = scene.vertices.find(x => x.id === vertexId);
  if (!v) return { ok: false, reason: `point "${vertexId}" does not exist` };
  // Anything constructed FROM this point loses its origin, so it is frozen
  // where it sits rather than silently jumping (same rule as above).
  for (const other of scene.vertices) {
    if (other.id === vertexId) continue;
    const depends =
      (other.kind === "ray" && other.origin === vertexId) ||
      (other.kind === "intersect" && other.defs.some(d => d.origin === vertexId));
    if (!depends || !Number.isFinite(other.x) || !Number.isFinite(other.y)) continue;
    const { x, y } = other;
    delete other.binding; delete other.origin; delete other.defs; delete other.t; delete other.degenerate;
    other.kind = "anchor";
    other.x = x; other.y = y;
  }
  const before = scene.edges.length;
  scene.edges = scene.edges.filter(e => e.a !== vertexId && e.b !== vertexId);
  const removedEdges = before - scene.edges.length;
  scene.vertices = scene.vertices.filter(x => x.id !== vertexId);
  // D37: a face with a missing corner is not a face. It goes, quietly — the
  // shading is a way of LOOKING at the drawing, never part of it, so losing one
  // is not a change to the user's content.
  const facesBefore = scene.faces?.length ?? 0;
  if (scene.faces) scene.faces = scene.faces.filter(f => !f.loop.includes(vertexId));
  solveScene(scene);
  return { ok: true, removedEdges, removedFaces: facesBefore - (scene.faces?.length ?? 0) };
}
