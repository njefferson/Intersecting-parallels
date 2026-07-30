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

export const SCHEMA_VERSION = 1;
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

export function createScene({ name = "untitled", width, height }) {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "scene1",
    name,
    createdAt: now,
    modifiedAt: now,
    canvas: { width, height },
    horizon: { y: height / 2 },
    vanishingPoints: [],
    vertices: [],
    edges: [],
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
    y: onHorizon ? scene.horizon.y : y,
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
  // D3: position = origin + s·|t|·unit(VP − origin), s minimising displacement
  // from the previous solve; sign(t) decides on a cold start.
  const mag = Math.abs(v.t);
  const plus = { x: origin.x + mag * u.x, y: origin.y + mag * u.y };
  const minus = { x: origin.x - mag * u.x, y: origin.y - mag * u.y };
  let s;
  if (Number.isFinite(v.x) && Number.isFinite(v.y)) {
    const dPlus = Math.hypot(plus.x - v.x, plus.y - v.y);
    const dMinus = Math.hypot(minus.x - v.x, minus.y - v.y);
    s = dPlus <= dMinus ? 1 : -1;
  } else {
    s = v.t < 0 ? -1 : 1;
  }
  const p = s === 1 ? plus : minus;
  v.x = p.x;
  v.y = p.y;
  v.t = s * mag; // stored signed so reload is deterministic (D3)
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

export function moveVp(scene, vpId, { x, y }) {
  const vp = scene.vanishingPoints.find(v => v.id === vpId);
  if (!vp) return { ok: false, reason: `vanishing point "${vpId}" does not exist` };
  if (vp.locked) return { ok: false, reason: `"${vp.label}" is locked and rejects drags (§4)` };
  vp.x = x;
  vp.y = vp.onHorizon ? scene.horizon.y : y; // onHorizon slaves y (§4)
  solveScene(scene);
  return { ok: true, vp };
}

export function setHorizon(scene, y) {
  scene.horizon.y = y;
  for (const vp of scene.vanishingPoints) if (vp.onHorizon) vp.y = y;
  solveScene(scene);
  return { ok: true };
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
  solveScene(scene);
  return { ok: true, removedEdges };
}
