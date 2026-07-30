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

export const SCHEMA_VERSION = 2;
export const SNAP_RADIUS = 12;        // §2.4 — canvas px; the call site scales by zoom
export const SNAP_THRESHOLD = 15;     // §12 — degrees; tunable once Noah has stylus time
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
// FOUND ON NOAH'S IPAD, 2026-07-30, on 1.5.0: "There are no VPs on the page and I
// cannot add any, now." His saved drawing was written by an older build, so it
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
  for (const key of ["vanishingPoints", "vertices", "edges"]) {
    if (!Array.isArray(raw[key])) raw[key] = [];
  }
  raw.schemaVersion = SCHEMA_VERSION;
  return raw;
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
  if (v.kind === "ray") return [v.origin];
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
  const u = bindingDirection(scene, { x: origin.x, y: origin.y }, v.binding);
  if (!u) { v.degenerate = true; return; } // x,y untouched — the last-valid cache
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
  // Noah, 2026-07-30: "Pulling/pushing only moves the front left point away from
  // the user, it never crosses over and comes on the other side inverting the
  // box."
  //
  // He was hitting D3's fold. D3 solved position as origin + s·|t|·u with `s`
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
  if (Number.isFinite(v.ux) && Number.isFinite(v.uy) && (v.ux * u.x + v.uy * u.y) < 0) {
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
// Noah, 2026-07-30, on 1.1.0: "The circled corners in this image are the only
// corners that do anything when I drag on them ... the rest do nothing." Half a
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
// Noah, 2026-07-30: "It means exaggerating for an artist's reference, sometimes
// in cartoons rather than reality."
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
// A point must stay OFF the paper, with room to spare. Measured against the paper
// itself rather than its centre: the first version of this guard used distance
// from the centre, which happily allowed a point to sit inside the sheet as long
// as it was far enough sideways. A vanishing point inside the drawing collapses
// every depth limit near it — corners stop responding because they are already
// clamped — which is the state Noah's screenshot was in.
const SPREAD_MARGIN = 0.25;   // of the paper's own width/height, outside the edge

export function scaleVpSpread(scene, k) {
  if (!Number.isFinite(k) || k <= 0) return { ok: false, reason: "that is not a scale" };
  const movable = scene.vanishingPoints.filter(v => !v.locked);
  if (!movable.length) {
    return { ok: false, reason: "every vanishing point is locked — unlock one to change the perspective" };
  }
  const { width: w, height: h } = scene.canvas;
  const cx = w / 2, cy = h / 2;
  const mx = w * SPREAD_MARGIN, my = h * SPREAD_MARGIN;

  // D45 — a point that sits ON the horizon STAYS on it. Scaling y as well as x
  // pulled horizon points off the line they define, so pressing Stronger slid the
  // horizon away from eye level a little at a time. Only the third point — the
  // one above or below — has a meaningful y to exaggerate.
  const next = movable.map(vp => ({
    vp,
    x: cx + (vp.x - cx) * k,
    y: vp.onHorizon ? vp.y : cy + (vp.y - cy) * k,
  }));

  // Refuse as a whole rather than moving some and stopping.
  for (const n of next) {
    const outside = n.x < -mx || n.x > w + mx || n.y < -my || n.y > h + my;
    if (!outside) {
      return { ok: false, reason: `any stronger and ${n.vp.label} would be on the paper, where it stops being a vanishing point` };
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
// themselves on it, and Noah's rule is flat: "There is no horizon without the
// VPs." Fewer than two, and this returns null and NOTHING is drawn — an app that
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
// Noah, 2026-07-29: "VPs said they could not be deleted without destroying
// existing lines." The app refused the deletion outright, which is the wrong
// answer to a real problem: the lines that lean on that point would be left
// with no guide. Refusing makes his own drawing hold his tool hostage.
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
