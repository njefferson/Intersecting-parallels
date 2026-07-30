// snap.mjs — hit-testing and stroke-guide scoring. Pure functions over the
// scene; no DOM.
//
// Read the amendments in NOTES.md before changing anything here. The short
// version, because it has been got wrong twice:
//   D16  The guide set is EXACTLY the vanishing points, vertical and horizontal
//        (plus the optional 45° pair). Endpoint anchoring — D2's merge into a
//        nearby vertex or snap onto an existing edge — is OFF; an endpoint
//        lands where it was put. `join` still exists for a future toggle.
//   D18  There is no plain line: every stroke takes the nearest guide.
//   D19  The guide may switch mid-stroke, with hysteresis so a tremor cannot.

import {
  SNAP_RADIUS, EPS_LEN_FACTOR,
  projectPointOnLine, bindingDirection,
  addAnchor, addRayVertex, addIntersectVertex, addEdge,
} from "./solver.mjs";

const DEG = 180 / Math.PI;

// D11 — a vanishing point outranks an axis guide when both fit.
//
// FOUND ON NOAH'S IPAD, 2026-07-29: "the lines do not converge on the vanishing
// point." Reproduced headlessly — strokes aimed straight at VP1 were binding to
// `horizontal`. The cause is structural, not a rounding accident: a VP far away
// and near the horizon has a guide direction within a degree of horizontal
// everywhere on the canvas, so `horizontal` won on measurement noise. And
// `horizontal` is a PARALLEL family — lines bound to it can never converge,
// which is precisely the fan he saw.
//
// The rule: an axis guide (`vertical`/`horizontal`) only beats the best VP
// guide if it beats it by more than AXIS_MARGIN. Below that the two lines are
// visually identical over a stroke, and in a perspective construction tool the
// VP is the constraint the user aimed at while the axes are available
// everywhere. Anyone who genuinely wants an axis can force it in the toolbar —
// that control exists for exactly this.
export const AXIS_MARGIN = 4;          // degrees

// The same measurement, run against the real default scene, exposed a SECOND
// ambiguity underneath the first: with both VPs on the horizon, a stroke drawn
// near the horizon is within a couple of degrees of BOTH of them as lines —
//   wobble 3°:  VP2 0.87°  |  horizontal 1.99°  |  VP1 3.00°
// — so angle alone cannot say which vanishing point was meant, and a hand
// tremor flips the answer between two guides that converge in OPPOSITE
// directions. The stroke's direction is the information that settles it: D3
// made a binding a direction-less LINE for solving, but the drag still says
// which way the user was reaching. Among VP guides within VP_TIE of each
// other, the one being drawn TOWARD wins.
export const VP_TIE = 4;               // degrees


// D18 — THERE IS NO PLAIN LINE. Every stroke lands on a guide.
//
// Noah, 2026-07-29: *"No 'drawn as plain line.'"*
//
// §3.2's angular threshold is gone. A stroke more than N degrees off every
// guide used to fall through to `free`, which in a perspective construction
// tool is the one outcome that is never useful: it silently hands back a line
// that belongs to nothing and will not move when a point does. Whatever the
// angle, the stroke now takes the NEAREST available guide. SNAP_THRESHOLD and
// the per-instrument band it needed are deleted rather than left lying around
// claiming to do something.
//
// Deliberate escapes are untouched: Assist off, and "Guide: none" in the
// picker, are choices he makes, not something the app decides for him.

// D19 — the guide can be switched MID-STROKE, and switching must be deliberate.
//
// Noah, 2026-07-29: *"Allow switching targets mid line?"* Yes. The choice used
// to lock a short way into the drag and never move again, so a stroke aimed
// wrongly had to be undone and redrawn. Now every pointer move re-picks, and
// swinging the finger toward another guide moves the line onto it.
//
// The reason it locked was jitter. Hysteresis replaces the lock: a different
// guide has to beat the one in hand by SWITCH_MARGIN degrees before it takes
// over, so a tremor cannot flap the line between two guides while a deliberate
// swing crosses that margin immediately.
export const SWITCH_MARGIN = 6;        // degrees a rival must win by, mid-stroke

const isVpBinding = b => typeof b !== "string";

// Human name for a binding, for the status line and the inspector.
export function bindingName(scene, binding) {
  if (binding === "free") return "no guide";
  if (binding === "diag45") return "45°";
  if (binding === "diag135") return "135°";
  if (typeof binding === "string") return binding;
  return scene.vanishingPoints.find(v => v.id === binding.vpId)?.label ?? "a vanishing point";
}

// Angle between a direction and a LINE (not a ray — D3): 0..90 degrees.
function lineAngle(dir, u) {
  const dot = Math.abs(dir.x * u.x + dir.y * u.y);
  return Math.acos(Math.min(1, dot)) * DEG;
}

// D16 — THE GUIDE SET IS EXACTLY: every unlocked vanishing point, true
// vertical, true horizontal. Optionally the 45° pair, behind a toggle that is
// OFF by default. Nothing else may ever capture a stroke.
//
// Noah, 2026-07-29: "WHY is there ANYTHING besides VPs, and perfect vertical
// and horizontal lines acting as ANCHORS FOR MY LINES?! I DIDN'T ASK FOR THAT!
// 45 degrees may be a toggle."
//
// This function was already that list. What was NOT on the list, and was
// silently anchoring his lines anyway, was ENDPOINT snapping: §2.4's mandatory
// merge into any existing vertex within 12px, and D2's snap onto any existing
// bound edge. Those pulled the END of a stroke off its guide and onto whatever
// he had drawn earlier — see `resolveEndpoint`, where it is now off.
export function scoreBindings(scene, originPos, dir, { diagonals = false } = {}) {
  const out = [];
  for (const vp of scene.vanishingPoints) {
    if (vp.locked) continue;
    const u = bindingDirection(scene, originPos, { vpId: vp.id });
    if (!u) continue; // coincident with the origin — no line to offer
    out.push({ binding: { vpId: vp.id }, u, angle: lineAngle(dir, u), label: vp.label });
  }
  out.push({ binding: "vertical", u: { x: 0, y: 1 }, angle: lineAngle(dir, { x: 0, y: 1 }), label: "vertical" });
  out.push({ binding: "horizontal", u: { x: 1, y: 0 }, angle: lineAngle(dir, { x: 1, y: 0 }), label: "horizontal" });
  if (diagonals) {
    for (const [binding, u, label] of [
      ["diag45", { x: Math.SQRT1_2, y: Math.SQRT1_2 }, "45°"],
      ["diag135", { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, "135°"],
    ]) out.push({ binding, u, angle: lineAngle(dir, u), label });
  }
  out.sort((a, b) => a.angle - b.angle);
  return out;
}

// The stroke's binding: forced wins; assist off means free (his choice, D18);
// otherwise the NEAREST guide, always — with the guide already in hand kept
// unless a rival beats it by SWITCH_MARGIN (D19).
export function chooseBinding(scene, originPos, dir, { forced = null, assist = true, diagonals = false, current = null } = {}) {
  if (forced) return forced === "free" ? { binding: "free", u: null } : bestForced(scene, originPos, forced);
  if (!assist) return { binding: "free", u: null };
  const ranked = scoreBindings(scene, originPos, dir, { diagonals });
  // D18: every candidate is in range. There is always a nearest guide, so a
  // stroke can never come back unguided.
  const inRange = ranked;
  if (!inRange.length) return { binding: "free", u: null };   // only if a scene has no guides at all
  const best = inRange[0];                                   // sorted best-first
  const vps = inRange.filter(c => isVpBinding(c.binding));   // therefore angle-sorted too
  let bestVp = vps[0];
  // D11, part two: among points that are still too close to tell apart after
  // that, the one being reached toward wins outright.
  if (bestVp) {
    const tied = vps.filter(c => c.angle <= bestVp.angle + VP_TIE);
    if (tied.length > 1) {
      const toward = tied.filter(c => headingToward(scene, originPos, dir, c.binding));
      if (toward.length) bestVp = toward[0];
    }
  }
  // D11, part one: the VP takes a near-tie with an axis. Only a clearly better
  // axis beats it.
  let winner = best;
  if (bestVp && bestVp !== best && bestVp.angle <= best.angle + AXIS_MARGIN) winner = bestVp;

  // D19: mid-stroke, the guide already in hand keeps the line unless the winner
  // beats it by SWITCH_MARGIN. Without this a tremor flaps the line between two
  // guides; with it, a deliberate swing still crosses the margin at once.
  if (current) {
    const held = inRange.find(c => sameBinding(c.binding, current));
    if (held && held.angle <= winner.angle + SWITCH_MARGIN) winner = held;
  }
  return { binding: winner.binding, u: winner.u };
}

export function sameBinding(a, b) {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return !!(a && b && a.vpId === b.vpId);
}

// Is the drag reaching toward this vanishing point, or away from it? Both draw
// the same line; only the gesture says which end the user is working to.
function headingToward(scene, originPos, dir, binding) {
  const vp = scene.vanishingPoints.find(v => v.id === binding.vpId);
  if (!vp) return false;
  return dir.x * (vp.x - originPos.x) + dir.y * (vp.y - originPos.y) > 0;
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
//
// D16: `join` is what §2.4 called mandatory and Noah calls an anchor he never
// asked for. With join off — which is how the app now draws — an endpoint lands
// exactly where it was put, and only a GUIDE can influence a stroke.
export function resolveEndpoint(scene, p, r = SNAP_RADIUS, { join = true } = {}) {
  if (!join) return { type: "plain", at: { x: p.x, y: p.y } };
  const v = nearestVertex(scene, p, r);
  if (v) return { type: "merge", vertexId: v.id, at: { x: v.x, y: v.y } };
  const hit = nearestBoundEdge(scene, p, r);
  if (hit) return { type: "onEdge", edge: hit.edge, at: hit.point };
  return { type: "plain", at: { x: p.x, y: p.y } };
}

// D12 — a binding is a FACT about the line, never an aspiration.
//
// §2.4 makes endpoint merging mandatory: it is what keeps a box coherent when
// a VP moves. But when BOTH ends merge into points that already exist, the
// edge's geometry is fully determined by those points — and nothing makes it
// pass through the vanishing point the stroke asked for. Measured on a plain
// two-point scene: an edge stored as bound to VP1 whose line misses VP1 by
// 1,866px. It draws as a line that does not converge and does not move when
// that point moves, which is the defect Noah reported wearing a second
// costume.
//
// So the binding is CHECKED against the geometry at commit, and an unsatisfied
// one is demoted to `free` rather than recorded as a claim the drawing does not
// support. Nothing is moved to make the claim true: silently repositioning a
// point the user already placed is exactly what Doctrine §14 forbids.
export function bindingSatisfied(scene, aPos, bPos, binding) {
  if (binding === "free") return true;
  const dx = bPos.x - aPos.x, dy = bPos.y - aPos.y;
  const L = Math.hypot(dx, dy);
  if (L === 0) return false;
  const u = bindingDirection(scene, aPos, binding);
  if (!u) return false;
  // Perpendicular distance from b to the binding's line through a, relative to
  // the document like every other tolerance here (D4).
  const perp = Math.abs(dx * u.y - dy * u.x);
  return perp <= EPS_LEN_FACTOR * Math.hypot(scene.canvas.width, scene.canvas.height) * 10;
}

// Commit one stroke: endpoint descriptors from resolveEndpoint, the stroke's
// chosen binding, and the raw positions. Creates the vertices D2 asks for and
// the edge, returns { ok, edge, a, b, demoted } or { ok:false, reason }.
export function commitStroke(scene, aDesc, bDesc, binding, role = "committed") {
  const aId = materializeStart(scene, aDesc, binding);
  if (!aId.ok) return aId;
  const bId = materializeEnd(scene, bDesc, binding, aId.vertexId, aDesc.at);
  if (!bId.ok) return bId;
  if (aId.vertexId === bId.vertexId) return { ok: false, reason: "a stroke needs two distinct endpoints" };
  const av = scene.vertices.find(v => v.id === aId.vertexId);
  const bv = scene.vertices.find(v => v.id === bId.vertexId);
  // D12: only a binding the drawn line actually satisfies is recorded.
  const honest = bindingSatisfied(scene, av, bv, binding);
  const e = addEdge(scene, { a: aId.vertexId, b: bId.vertexId, binding: honest ? binding : "free", role });
  if (!e.ok) return e;
  return {
    ok: true, edge: e.edge, a: aId.vertexId, b: bId.vertexId,
    demoted: honest ? null : binding,
  };
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

// D12, read side. A stored binding is trusted only while the geometry still
// satisfies it. Both endpoints being anchors that lined up by coincidence, and
// a vanishing point moving afterwards, leaves a true-at-the-time label that is
// no longer true — and the drawing, not the label, is the thing the reader
// believes. Derived at the point of use rather than rewritten on every drag,
// because rewriting would edit the user's file behind their back.
export function effectiveBinding(scene, edge) {
  if (edge.binding === "free") return "free";
  const a = scene.vertices.find(v => v.id === edge.a);
  const b = scene.vertices.find(v => v.id === edge.b);
  if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) return edge.binding;
  return bindingSatisfied(scene, a, b, edge.binding) ? edge.binding : "free";
}
