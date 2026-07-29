// Snap / binding-choice / D2 endpoint-precedence tests (spec §3.2, §2.4).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createScene, addVp, addAnchor, setHorizon, solveScene, moveVp } from "../public/app/solver.mjs";
import {
  scoreBindings, chooseBinding, nearestVertex, nearestBoundEdge, resolveEndpoint, commitStroke, thresholdFor,
} from "../public/app/snap.mjs";

function scene2pt() {
  const scene = createScene({ name: "s", width: 1200, height: 800 });
  const vp1 = addVp(scene, { label: "VP1", x: -600, y: 300, axis: "x", onHorizon: true }).vp;
  const vp2 = addVp(scene, { label: "VP2", x: 1800, y: 300, axis: "y", onHorizon: true }).vp;
  setHorizon(scene, 300);
  return { scene, vp1, vp2 };
}

test("§3.2 scoring: a stroke 5° off a VP line binds to that VP", () => {
  const { scene, vp1 } = scene2pt();
  const origin = { x: 600, y: 500 };
  const toVp1 = { x: vp1.x - origin.x, y: vp1.y - origin.y };
  const len = Math.hypot(toVp1.x, toVp1.y);
  const base = Math.atan2(toVp1.y / len, toVp1.x / len);
  const off = base + 5 * Math.PI / 180;
  const chosen = chooseBinding(scene, origin, { x: Math.cos(off), y: Math.sin(off) });
  assert.deepEqual(chosen.binding, { vpId: vp1.id });
});

test("§3.2 threshold: 40° off every candidate falls back to free", () => {
  const { scene } = scene2pt();
  const origin = { x: 600, y: 500 };
  const ranked = scoreBindings(scene, origin, { x: 1, y: 0 });
  assert.ok(ranked.length >= 4);
  // Find a direction at least 40° from every candidate line.
  let found = null;
  for (let deg = 0; deg < 180; deg += 1) {
    const r = deg * Math.PI / 180;
    const dir = { x: Math.cos(r), y: Math.sin(r) };
    const worst = scoreBindings(scene, origin, dir)[0];
    if (worst.angle >= 40) { found = dir; break; }
  }
  assert.ok(found, "a direction 40°+ off every guide exists in a 2-point setup");
  assert.equal(chooseBinding(scene, origin, found).binding, "free");
});

test("assist off, and a forced binding, both bypass scoring (§3.2 overrides)", () => {
  const { scene, vp2 } = scene2pt();
  const origin = { x: 600, y: 500 };
  const alongVertical = { x: 0, y: 1 };
  assert.equal(chooseBinding(scene, origin, alongVertical, { assist: false }).binding, "free");
  const forced = chooseBinding(scene, origin, alongVertical, { forced: { vpId: vp2.id } });
  assert.deepEqual(forced.binding, { vpId: vp2.id });
  assert.equal(chooseBinding(scene, origin, alongVertical, { forced: "free" }).binding, "free");
});

test("locked VPs are not offered as guides (§4)", () => {
  const { scene, vp1 } = scene2pt();
  vp1.locked = true;
  const ranked = scoreBindings(scene, { x: 600, y: 500 }, { x: 1, y: 0 });
  assert.ok(!ranked.some(r => r.binding.vpId === vp1.id));
});

test("§2.4 merge: a second endpoint inside SNAP_RADIUS reuses the vertex id", () => {
  const { scene } = scene2pt();
  const a = addAnchor(scene, { x: 400, y: 600 }).vertex;
  const desc = resolveEndpoint(scene, { x: 404, y: 603 });
  assert.equal(desc.type, "merge");
  assert.equal(desc.vertexId, a.id);
  const far = resolveEndpoint(scene, { x: 500, y: 600 });
  assert.equal(far.type, "plain");
});

test("D2 precedence: an endpoint on a bound edge becomes an intersect vertex, not a ray vertex", () => {
  const { scene, vp1, vp2 } = scene2pt();
  // First stroke: from a fresh anchor toward VP1.
  const s1 = commitStroke(
    scene,
    resolveEndpoint(scene, { x: 700, y: 600 }),
    resolveEndpoint(scene, { x: 400, y: 555 }),
    { vpId: vp1.id },
  );
  assert.equal(s1.ok, true);
  // Second stroke: starts elsewhere, ends ON that first edge, bound to VP2.
  const startDesc = resolveEndpoint(scene, { x: 900, y: 700 });
  const mid = scene.vertices.find(v => v.id === s1.b);
  const onEdge = nearestBoundEdge(scene, { x: (700 + mid.x) / 2, y: (600 + mid.y) / 2 });
  assert.ok(onEdge, "the first edge is hit-testable");
  const s2 = commitStroke(scene, startDesc, { type: "onEdge", edge: onEdge.edge, at: onEdge.point }, { vpId: vp2.id });
  assert.equal(s2.ok, true);
  const corner = scene.vertices.find(v => v.id === s2.b);
  assert.equal(corner.kind, "intersect");
  // And it is genuinely determined by both lines: move VP1, the corner follows.
  const before = { x: corner.x, y: corner.y };
  moveVp(scene, vp1.id, { x: -900, y: 300 });
  assert.ok(Math.hypot(corner.x - before.x, corner.y - before.y) > 1e-6, "intersection re-solved with its defining line");
  assert.ok(Number.isFinite(corner.x) && Number.isFinite(corner.y));
});

test("D2 fallback: a free endpoint keeps its authored length under VP drag", () => {
  const { scene, vp1 } = scene2pt();
  const s = commitStroke(
    scene,
    resolveEndpoint(scene, { x: 700, y: 600 }),
    resolveEndpoint(scene, { x: 500, y: 570 }),
    { vpId: vp1.id },
  );
  assert.equal(s.ok, true);
  const a = scene.vertices.find(v => v.id === s.a);
  const b = scene.vertices.find(v => v.id === s.b);
  assert.equal(b.kind, "ray");
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  moveVp(scene, vp1.id, { x: -200, y: 120 });
  const len2 = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(Math.abs(len - len2) < 1e-9, "authored length preserved");
});

test("a free stroke stores two anchors and no binding", () => {
  const { scene } = scene2pt();
  const s = commitStroke(
    scene,
    resolveEndpoint(scene, { x: 100, y: 100 }),
    resolveEndpoint(scene, { x: 300, y: 700 }),
    "free",
  );
  assert.equal(s.ok, true);
  assert.equal(scene.vertices.find(v => v.id === s.a).kind, "anchor");
  assert.equal(scene.vertices.find(v => v.id === s.b).kind, "anchor");
  assert.equal(scene.edges.find(e => e.id === s.edge.id).binding, "free");
});

test("a stroke whose endpoints merge to the same vertex is refused with a reason", () => {
  const { scene, vp1 } = scene2pt();
  const a = addAnchor(scene, { x: 400, y: 600 }).vertex;
  const res = commitStroke(
    scene,
    { type: "merge", vertexId: a.id, at: { x: a.x, y: a.y } },
    { type: "merge", vertexId: a.id, at: { x: a.x, y: a.y } },
    { vpId: vp1.id },
  );
  assert.equal(res.ok, false);
  assert.match(res.reason, /two distinct endpoints/);
});

test("hit-testing ignores unsolved (degenerate-from-birth) vertices", () => {
  const { scene } = scene2pt();
  scene.vertices.push({ id: "ghost", kind: "anchor", x: NaN, y: NaN });
  solveScene(scene);
  assert.equal(nearestVertex(scene, { x: 0, y: 0 }, 1e9), null);
});

test("a free edge is never offered for intersection (D2 rule 2 needs a line)", () => {
  const { scene } = scene2pt();
  commitStroke(
    scene,
    resolveEndpoint(scene, { x: 100, y: 100 }),
    resolveEndpoint(scene, { x: 500, y: 100 }),
    "free",
  );
  assert.equal(nearestBoundEdge(scene, { x: 300, y: 101 }), null);
});

// ---- D11: a vanishing point outranks an axis guide on a near-tie ----------
//
// Regression for the defect Noah found on his iPad, 2026-07-29 — "the lines do
// not converge on the vanishing point". Strokes aimed at a VP near the horizon
// were binding to `horizontal`, and horizontal lines are parallel: they can
// never converge. These tests fail against the old rank-by-angle-alone rule.

function farVpScene() {
  // The app's own defaults: VPs far outside the document, on the horizon.
  const scene = createScene({ name: "d11", width: 1600, height: 1200 });
  setHorizon(scene, 540);
  const vp1 = addVp(scene, { label: "VP1", x: -1360, y: 540, onHorizon: true }).vp;
  const vp2 = addVp(scene, { label: "VP2", x: 2960, y: 540, onHorizon: true }).vp;
  return { scene, vp1, vp2 };
}

// Unit direction from a point toward a VP, i.e. a perfectly aimed stroke.
function aimAt(from, vp) {
  const dx = vp.x - from.x, dy = vp.y - from.y, L = Math.hypot(dx, dy);
  return { x: dx / L, y: dy / L };
}

test("D11: a stroke aimed straight at a near-horizontal VP binds to the VP, not to `horizontal`", () => {
  const { scene, vp1 } = farVpScene();
  const from = { x: 900, y: 500 };
  const chosen = chooseBinding(scene, from, aimAt(from, vp1), {});
  assert.equal(typeof chosen.binding, "object", "should be a VP binding, not an axis");
  assert.equal(chosen.binding.vpId, vp1.id);
});

test("D11: the same stroke with a degree of hand wobble still binds to the VP", () => {
  const { scene, vp1 } = farVpScene();
  const from = { x: 900, y: 500 };
  const ideal = aimAt(from, vp1);
  const base = Math.atan2(ideal.y, ideal.x);
  // ±3° of wobble either side of a perfect aim — a finger, not a plotter.
  for (const wobble of [-3, -2, -1, -0.5, 0.5, 1, 2, 3]) {
    const a = base + wobble / (180 / Math.PI);
    const chosen = chooseBinding(scene, from, { x: Math.cos(a), y: Math.sin(a) }, {});
    assert.equal(typeof chosen.binding, "object", `wobble ${wobble}° should still find VP1`);
    assert.equal(chosen.binding.vpId, vp1.id, `wobble ${wobble}° bound to the wrong guide`);
  }
});

test("D11: several strokes aimed at one VP all converge on it", () => {
  // The property Noah was actually asserting: lines drawn to a vanishing point
  // meet there. Checked as geometry, not as a binding label.
  const { scene, vp1 } = farVpScene();
  for (const from of [{ x: 800, y: 300 }, { x: 900, y: 500 }, { x: 850, y: 700 }, { x: 1000, y: 900 }]) {
    const chosen = chooseBinding(scene, from, aimAt(from, vp1), {});
    const start = resolveEndpoint(scene, from);
    const dir = aimAt(from, vp1);
    const end = resolveEndpoint(scene, { x: from.x + dir.x * 260, y: from.y + dir.y * 260 });
    const res = commitStroke(scene, start, end, chosen.binding);
    assert.equal(res.ok, true, res.reason);
  }
  const byId = new Map(scene.vertices.map(v => [v.id, v]));
  for (const e of scene.edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    const distance = Math.abs(dx * (a.y - vp1.y) - dy * (a.x - vp1.x)) / L;
    assert.ok(distance < 1e-6, `edge ${e.id} misses VP1 by ${distance.toFixed(1)}px`);
  }
});

test("D11: an axis still wins when it is clearly the better fit", () => {
  // The margin is a near-tie rule, not a VP override. A VP well off horizontal
  // must not capture a stroke the user drew flat.
  const scene = createScene({ name: "d11b", width: 1600, height: 1200 });
  setHorizon(scene, 540);
  addVp(scene, { label: "VP1", x: -600, y: 100, onHorizon: false });   // ~8° off horizontal at the origin below
  const chosen = chooseBinding(scene, { x: 900, y: 640 }, { x: -1, y: 0 }, {});
  assert.equal(chosen.binding, "horizontal");
});

test("D11: a vertical stroke is unaffected — verticals still bind vertical", () => {
  const { scene } = farVpScene();
  const chosen = chooseBinding(scene, { x: 900, y: 500 }, { x: 0, y: 1 }, {});
  assert.equal(chosen.binding, "vertical");
});

test("D11: touch gets a wider snap band than a stylus, and both refuse a wild angle", () => {
  const { scene, vp1 } = farVpScene();
  const from = { x: 900, y: 500 };
  const base = Math.atan2(aimAt(from, vp1).y, aimAt(from, vp1).x);
  const at = deg => { const a = base + deg / (180 / Math.PI); return { x: Math.cos(a), y: Math.sin(a) }; };

  // 18° off: outside the pen band (15°), inside the touch band (22°).
  assert.equal(chooseBinding(scene, from, at(18), { threshold: thresholdFor("pen") }).binding, "free");
  const touched = chooseBinding(scene, from, at(18), { threshold: thresholdFor("touch") });
  assert.equal(typeof touched.binding, "object");
  assert.equal(touched.binding.vpId, vp1.id);

  // 40° off: no guide, whatever the instrument. Assist must not invent one.
  for (const kind of ["pen", "touch", "mouse"]) {
    assert.equal(chooseBinding(scene, from, at(40), { threshold: thresholdFor(kind) }).binding, "free");
  }
});
