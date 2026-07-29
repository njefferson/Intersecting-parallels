// snap.mjs — hit-testing, stroke-binding scoring (§3.2) and the endpoint
// precedence of D2. Pure functions over the scene; no DOM.
//
// D2's precedence, applied to every endpoint at placement:
//   1. Merge into an existing vertex within SNAP_RADIUS.
//   2. Otherwise intersect an existing BOUND edge within SNAP_RADIUS.
//   3. Otherwise create a plain vertex (anchor for a stroke's first endpoint,
//      ray vertex with authored length for its second).
// Rule 2 is what makes acceptance test 1's box intersection-defined, so a VP
// drag reads as perspective rather than rotation.

import {
  SNAP_RADIUS, SNAP_THRESHOLD,
  projectPointOnLine, bindingDirection,
  addAnchor, addRayVertex, addIntersectVertex, addEdge,
} from "./solver.mjs";

const DEG = 180 / Math.PI;

// Angle between a direction and a LINE (not a ray — D3): 0..90 degrees.
function lineAngle(dir, u) {
  const dot = Math.abs(dir.x * u.x + dir.y * u.y);
  return Math.acos(Math.min(1, dot)) * DEG;
}

// Score every candidate binding for a stroke that starts at originPos and
// travels along dir (§3.2): each unlocked VP's line through the origin, plus
// vertical and horizontal. Sorted best-first.
export function scoreBindings(scene, originPos, dir) {
  const out = [];
  for (const vp of scene.vanishingPoints) {
    if (vp.locked) continue;
    const u = bindingDirection(scene, originPos, { vpId: vp.id });
    if (!u) continue; // coincident with the origin — no line to offer
    out.push({ binding: { vpId: vp.id }, u, angle: lineAngle(dir, u), label: vp.label });
  }
  out.push({ binding: "vertical", u: { x: 0, y: 1 }, angle: lineAngle(dir, { x: 0, y: 1 }), label: "vertical" });
  out.push({ binding: "horizontal", u: { x: 1, y: 0 }, angle: lineAngle(dir, { x: 1, y: 0 }), label: "horizontal" });
  out.sort((a, b) => a.angle - b.angle);
  return out;
}

// The stroke's binding (§3.2): forced wins; assist off means free; otherwise
// the best candidate, unless its angular error exceeds SNAP_THRESHOLD.
export function chooseBinding(scene, originPos, dir, { forced = null, assist = true, threshold = SNAP_THRESHOLD } = {}) {
  if (forced) return forced === "free" ? { binding: "free", u: null } : bestForced(scene, originPos, forced);
  if (!assist) return { binding: "free", u: null };
  const ranked = scoreBindings(scene, originPos, dir);
  const best = ranked[0];
  if (!best || best.angle > threshold) return { binding: "free", u: null };
  return { binding: best.binding, u: best.u };
}

function bestForced(scene, originPos, forced) {
  const u = bindingDirection(scene, originPos, forced);
  return { binding: u ? forced : "free", u };
}

// ---- hit-testing (canvas-space point p, canvas-space radius r) -----------

export function nearestVertex(scene, p, r = SNAP_RADIUS) {
  let best = null, bestD = r;
  for (const v of scene.vertices) {
    if (!Number.isFinite(v.x)) continue;
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d <= bestD) { best = v; bestD = d; }
  }
  return best;
}

// Distance from p to the SEGMENT a–b of each solved edge. Only bound edges
// participate in D2's rule 2 — a free edge has no line a VP can move.
export function nearestBoundEdge(scene, p, r = SNAP_RADIUS, { excludeVertexIds = [] } = {}) {
  let best = null, bestD = r;
  for (const e of scene.edges) {
    if (e.binding === "free") continue;
    if (excludeVertexIds.includes(e.a) || excludeVertexIds.includes(e.b)) continue;
    const a = scene.vertices.find(v => v.id === e.a);
    const b = scene.vertices.find(v => v.id === e.b);
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const qx = a.x + t * dx, qy = a.y + t * dy;
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d < bestD) { best = { edge: e, point: { x: qx, y: qy } }; bestD = d; }
  }
  return best;
}

export function nearestEdge(scene, p, r = SNAP_RADIUS) {
  let best = null, bestD = r;
  for (const e of scene.edges) {
    const a = scene.vertices.find(v => v.id === e.a);
    const b = scene.vertices.find(v => v.id === e.b);
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

// ---- endpoint resolution (D2) --------------------------------------------

// Describe what a tap at p should become, before anything is created.
export function resolveEndpoint(scene, p, r = SNAP_RADIUS) {
  const v = nearestVertex(scene, p, r);
  if (v) return { type: "merge", vertexId: v.id, at: { x: v.x, y: v.y } };
  const hit = nearestBoundEdge(scene, p, r);
  if (hit) return { type: "onEdge", edge: hit.edge, at: hit.point };
  return { type: "plain", at: { x: p.x, y: p.y } };
}

// Commit one stroke: endpoint descriptors from resolveEndpoint, the stroke's
// chosen binding, and the raw positions. Creates the vertices D2 asks for and
// the edge, returns { ok, edge, a, b } or { ok:false, reason }.
export function commitStroke(scene, aDesc, bDesc, binding, role = "committed") {
  const aId = materializeStart(scene, aDesc, binding);
  if (!aId.ok) return aId;
  const bId = materializeEnd(scene, bDesc, binding, aId.vertexId, aDesc.at);
  if (!bId.ok) return bId;
  if (aId.vertexId === bId.vertexId) return { ok: false, reason: "a stroke needs two distinct endpoints" };
  const e = addEdge(scene, { a: aId.vertexId, b: bId.vertexId, binding, role });
  if (!e.ok) return e;
  return { ok: true, edge: e.edge, a: aId.vertexId, b: bId.vertexId };
}

// First endpoint: merge, or ride an existing bound edge's line (a ray vertex
// on that line, so it follows the guide when its VP moves), or an anchor.
function materializeStart(scene, desc, _binding) {
  if (desc.type === "merge") return { ok: true, vertexId: desc.vertexId };
  if (desc.type === "onEdge") {
    const host = desc.edge;
    const origin = scene.vertices.find(v => v.id === host.a);
    const u = bindingDirection(scene, { x: origin.x, y: origin.y }, host.binding);
    if (u) {
      const proj = projectPointOnLine({ x: origin.x, y: origin.y }, u, desc.at);
      const r = addRayVertex(scene, { origin: host.a, binding: host.binding, t: proj.t });
      return r.ok ? { ok: true, vertexId: r.vertex.id } : r;
    }
  }
  const a = addAnchor(scene, { x: desc.at.x, y: desc.at.y });
  return a.ok ? { ok: true, vertexId: a.vertex.id } : a;
}

// Second endpoint: merge; else if it lands on a bound edge AND this stroke is
// bound, a true intersect vertex (D2 rule 2 — the corner two lines define);
// else a ray vertex with the authored length along the stroke's line, or an
// anchor for a free stroke.
function materializeEnd(scene, desc, binding, startVertexId, startPos) {
  if (desc.type === "merge") return { ok: true, vertexId: desc.vertexId };
  if (desc.type === "onEdge" && binding !== "free") {
    const host = desc.edge;
    const i = addIntersectVertex(scene, {
      defs: [
        { origin: startVertexId, binding },
        { origin: host.a, binding: host.binding },
      ],
    });
    if (i.ok) return { ok: true, vertexId: i.vertex.id };
    return i;
  }
  if (binding === "free") {
    const a = addAnchor(scene, { x: desc.at.x, y: desc.at.y });
    return a.ok ? { ok: true, vertexId: a.vertex.id } : a;
  }
  const start = scene.vertices.find(v => v.id === startVertexId);
  const u = bindingDirection(scene, { x: start.x, y: start.y }, binding);
  if (!u) return { ok: false, reason: "the chosen guide is degenerate at this origin" };
  const proj = projectPointOnLine({ x: start.x, y: start.y }, u, desc.at);
  const r = addRayVertex(scene, { origin: startVertexId, binding, t: proj.t });
  return r.ok ? { ok: true, vertexId: r.vertex.id } : r;
}
