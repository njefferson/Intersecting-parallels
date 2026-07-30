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
  addAnchor, addRayVertex, addIntersectVertex, addEdge, addFace, solveScene,
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
  if ((desc.type === "onEdge" || desc.type === "cross") && binding !== "free") {
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

// D20 — line ends JOIN again, but joining may only move an end ALONG its guide.
//
// Noah, 2026-07-29, with two screenshots of a cube coming apart under a VP
// drag: *"Being unable to connect line ends means everything breaks when you do
// adjustments."* He is right, and this is the consequence I flagged when D16
// took joining out wholesale.
//
// D16 and this are not in conflict once the two things it conflated are pulled
// apart:
//   · a guide decides a line's DIRECTION — only a vanishing point, vertical,
//     horizontal, or the optional 45° pair, exactly as D16 says;
//   · joining decides only WHERE ALONG that direction the line ends.
// The old behaviour broke that rule: it merged an end into any nearby point
// even when the point was nowhere near the guide, which dragged the line off
// its direction and produced the non-converging fan of D11/D12. So:
//
//   1. MERGE into an existing end only if that end lies on this stroke's guide
//      (within the snap radius, perpendicular). A shared corner, and the line
//      keeps its direction.
//   2. Otherwise, if a bound line CROSSES this stroke's guide near the finger,
//      end at the crossing — a true two-constraint corner, which is what makes
//      a box hold its shape when a vanishing point moves.
//   3. Otherwise end on the guide where the finger left it.
// A stroke's START may always merge, because the guide is computed THROUGH the
// start point: joining there cannot change any direction.
// D22 adds `weld`. With welding OFF the end lands on its guide exactly where the
// finger left it and joins nothing — which is the 0.2.0 behaviour Noah asked for
// and then found broke his adjustments. It is a choice now rather than a verdict:
// the guide still decides direction either way, so turning welding off can never
// bring back a line that belongs to nothing (D18).
export function resolveStrokeEnd(scene, startPos, binding, u, p, r = SNAP_RADIUS, { weld = true } = {}) {
  if (!weld) return { type: "plain", at: { x: p.x, y: p.y } };
  if (binding === "free" || !u) {
    const v = nearestVertex(scene, p, r);
    return v ? { type: "merge", vertexId: v.id, at: { x: v.x, y: v.y } }
             : { type: "plain", at: { x: p.x, y: p.y } };
  }
  const onGuide = q => Math.abs((q.x - startPos.x) * u.y - (q.y - startPos.y) * u.x);

  // 1 — an existing end that is ON this guide.
  let best = null, bestD = r;
  for (const v of scene.vertices) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
    if (Math.hypot(v.x - p.x, v.y - p.y) > r) continue;
    if (onGuide(v) > r) continue;                       // near the finger but off the guide
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d <= bestD) { best = v; bestD = d; }
  }
  if (best) return { type: "merge", vertexId: best.id, at: { x: best.x, y: best.y } };

  // 2 — a bound line crossing this guide near the finger.
  let cross = null, crossD = r;
  for (const e of scene.edges) {
    if (e.binding === "free") continue;
    const a = scene.vertices.find(v => v.id === e.a);
    const b = scene.vertices.find(v => v.id === e.b);
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = u.x * ey - u.y * ex;
    if (Math.abs(den) < 1e-9) continue;                 // parallel to this guide
    // parameter along the EDGE, so only a crossing of the drawn segment counts
    const s = ((a.x - startPos.x) * u.y - (a.y - startPos.y) * u.x) / den;
    if (s < -0.001 || s > 1.001) continue;
    const q = { x: a.x + ex * s, y: a.y + ey * s };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= crossD) { cross = { edge: e, at: q }; crossD = d; }
  }
  if (cross) return { type: "cross", edge: cross.edge, at: cross.at };

  return { type: "plain", at: { x: p.x, y: p.y } };
}

// D21 — a box, drawn in one gesture, every corner constrained.
//
// Noah, 2026-07-29: *"Add drawing boxes/rectangles."* He had just built a cube
// out of nine separate strokes, and it came apart when he moved a point.
//
// This emits the twelve edges of a box in two-point perspective where EVERY
// vertex is defined by constraints rather than by coordinates: the near edge is
// vertical, the receding edges are bound to the vanishing points, and all six
// remaining corners are intersections of two of those. So a vanishing point
// drag — or a corner drag — moves the whole box and it stays a box. That is the
// property his hand-drawn cube could not have.
//
// One drag: it starts at the near bottom corner and its vertical extent is the
// height. D23 replaced the square plan: the two base depths are taken separately
// from the drag, `depthL` and `depthR`, so the direction of the drag proportions
// the plan. `depth` is still accepted and means both, which is what the box did
// before and what a straight-up drag still falls back to.
//
// Why one drag cannot simply state both: a box needs three numbers — height and
// two depths — and a gesture carries two. So the drag sets height and the SHARE
// between the two axes, and each depth is then settable exactly, because D23 also
// made a base corner's distance along its guide editable. That is the part NOTES
// used to claim was already possible.
// D23 — turn one drag into a height and TWO depths.
//
// A gesture carries two numbers and a box needs three, so the drag sets the
// height and the SHARE between the two base axes: the axis you drag toward gets
// the sideways distance added to it, the other keeps a floor proportional to the
// height. Straight up is therefore still a square plan — the old behaviour, now
// the special case rather than the only case — and up-and-right makes a box that
// runs further to the right. Monotone in the drag, which is what makes it
// learnable: further right is always deeper right.
//
// Pure, and exported, so the mapping is pinned by tests rather than only visible
// through a gesture.
export function splitBoxDepths(scene, at, to, { unit = 90 } = {}) {
  const height = Math.abs(to.y - at.y);
  const hx = to.x - at.x;
  // The floor is a FIXED size, not a fraction of the height. Tying it to the
  // height welded all three axes to one drag: Noah, 2026-07-30, "I tried creating
  // a tall, narrow, thin box, but dragging straight up changed all three axis."
  // Measured on the shipped build — height 141 gave depths 70.7, height 636 gave
  // depths 318.1, so a tall thin box could not be drawn at all. Straight up now
  // means TALL: the depths stay at the floor however far up the drag goes, and
  // sideways is the only thing that deepens them.
  const floor = Math.max(8, unit * 0.22);
  const vps = scene.vanishingPoints.filter(v => !v.locked).slice(0, 2);
  if (vps.length < 2) return { height, depthL: floor, depthR: floor };
  const sideOf = vp => {
    const dx = vp.x - at.x, dy = vp.y - at.y;
    const L = Math.hypot(dx, dy) || 1;
    return dx / L;
  };
  const [sL, sR] = vps.map(sideOf);
  const toward = s2 => (Math.sign(hx) === Math.sign(s2) && s2 !== 0 ? Math.abs(hx) : 0);
  return { height, depthL: floor + toward(sL), depthR: floor + toward(sR) };
}

export function buildBox(scene, { at, height, depth, depthL, depthR }) {
  const vps = scene.vanishingPoints.filter(v => !v.locked);
  if (vps.length < 2) return { ok: false, reason: "a box needs two vanishing points — add one, or unlock one" };
  const [vpL, vpR] = vps;
  const h = Math.abs(height) < 1 ? 1 : height;
  const fallback = Math.abs(depth ?? 0) < 1 ? 1 : Math.abs(depth);
  const dL = Math.abs(depthL ?? fallback) < 1 ? 1 : Math.abs(depthL ?? fallback);
  const dR = Math.abs(depthR ?? fallback) < 1 ? 1 : Math.abs(depthR ?? fallback);

  const made = { vertices: [], edges: [] };
  const V = r => { if (!r.ok) return null; made.vertices.push(r.vertex.id); return r.vertex; };
  const E = (a, b, binding) => {
    const r = addEdge(scene, { a: a.id, b: b.id, binding });
    if (r.ok) made.edges.push(r.edge.id);
  };

  const nearBottom = V(addAnchor(scene, { x: at.x, y: at.y }));
  const nearTop = V(addRayVertex(scene, { origin: nearBottom.id, binding: "vertical", t: -h }));
  if (!nearTop) return { ok: false, reason: "could not raise the near edge" };
  const leftBottom = V(addRayVertex(scene, { origin: nearBottom.id, binding: { vpId: vpL.id }, t: dL }));
  const rightBottom = V(addRayVertex(scene, { origin: nearBottom.id, binding: { vpId: vpR.id }, t: dR }));
  if (!leftBottom || !rightBottom) return { ok: false, reason: "could not run the base edges to the vanishing points" };

  // Every corner above or behind is where two guides meet.
  const leftTop = V(addIntersectVertex(scene, { defs: [
    { origin: nearTop.id, binding: { vpId: vpL.id } },
    { origin: leftBottom.id, binding: "vertical" },
  ] }));
  const rightTop = V(addIntersectVertex(scene, { defs: [
    { origin: nearTop.id, binding: { vpId: vpR.id } },
    { origin: rightBottom.id, binding: "vertical" },
  ] }));
  const backBottom = V(addIntersectVertex(scene, { defs: [
    { origin: leftBottom.id, binding: { vpId: vpR.id } },
    { origin: rightBottom.id, binding: { vpId: vpL.id } },
  ] }));
  const backTop = V(addIntersectVertex(scene, { defs: [
    { origin: leftTop.id, binding: { vpId: vpR.id } },
    { origin: backBottom.id, binding: "vertical" },
  ] }));
  if (!leftTop || !rightTop || !backBottom || !backTop) {
    return { ok: false, reason: "the vanishing points are too close together to make a box here" };
  }

  const L = { vpId: vpL.id }, R = { vpId: vpR.id };
  E(nearBottom, nearTop, "vertical");
  E(nearBottom, leftBottom, L);
  E(nearBottom, rightBottom, R);
  E(nearTop, leftTop, L);
  E(nearTop, rightTop, R);
  E(leftBottom, leftTop, "vertical");
  E(rightBottom, rightTop, "vertical");
  E(leftBottom, backBottom, R);
  E(rightBottom, backBottom, L);
  E(leftTop, backTop, R);
  E(rightTop, backTop, L);
  E(backBottom, backTop, "vertical");

  // D37 — the four faces worth shading, as loops of corners that already exist.
  //
  // The two FRONT faces are the ones meeting at the near vertical edge; that edge
  // is the nearest part of the box by construction, so those two are always the
  // ones you can see. The back two are never visible on a convex box and are not
  // stored at all — storing faces that can never be drawn would be inviting a
  // sorting problem that does not exist.
  //
  // Top and bottom are stored but their visibility is decided at draw time by
  // eye level, because that IS the lesson: you see the top of a box whose top is
  // below your eye, and the underside of one whose base is above it.
  const solid = `box${scene.nextId}`;
  const F = (loop, shade) => addFace(scene, { loop: loop.map(v => v.id), solid, shade });
  F([nearBottom, nearTop, leftTop, leftBottom], "left");
  F([nearBottom, nearTop, rightTop, rightBottom], "right");
  F([nearTop, leftTop, backTop, rightTop], "top");
  F([nearBottom, leftBottom, backBottom, rightBottom], "bottom");

  solveScene(scene);
  return { ok: true, ...made, solid, corners: { nearBottom, nearTop, leftBottom, rightBottom, leftTop, rightTop, backBottom, backTop } };
}
