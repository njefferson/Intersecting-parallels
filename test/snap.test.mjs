// Snap / binding-choice / D2 endpoint-precedence tests (spec §3.2, §2.4).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createScene, addVp, addAnchor, setEyeLevel, solveScene, moveVp, addRayVertex, addEdge, bindingDirection } from "../public/app/solver.mjs";
import {
  scoreBindings, chooseBinding, nearestVertex, nearestBoundEdge, resolveEndpoint, commitStroke, bindingSatisfied, effectiveBinding, SWITCH_MARGIN, sameBinding, resolveStrokeEnd, buildBox,
} from "../public/app/snap.mjs";

function scene2pt() {
  const scene = createScene({ name: "s", width: 1200, height: 800 });
  const vp1 = addVp(scene, { label: "VP1", x: -600, y: 300, axis: "x", onHorizon: true }).vp;
  const vp2 = addVp(scene, { label: "VP2", x: 1800, y: 300, axis: "y", onHorizon: true }).vp;
  setEyeLevel(scene, 300);
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

test("D18 replaces §3.2's threshold: a direction far from every guide takes the nearest one", () => {
  const { scene } = scene2pt();
  const origin = { x: 600, y: 500 };
  // Find the worst-case direction — the one furthest from every guide there is.
  let worstDir = null, worstAngle = -1;
  for (let deg = 0; deg < 180; deg += 1) {
    const r = deg * Math.PI / 180;
    const dir = { x: Math.cos(r), y: Math.sin(r) };
    const nearest = scoreBindings(scene, origin, dir)[0];
    if (nearest.angle > worstAngle) { worstAngle = nearest.angle; worstDir = dir; }
  }
  assert.ok(worstAngle > 20, `the worst case is only ${worstAngle.toFixed(1)}° off — pick a scene with a real gap`);
  // The spec would have returned `free` here. Noah's rule says there is no such
  // thing, so the nearest guide takes it however far away that is.
  const chosen = chooseBinding(scene, origin, worstDir, {});
  assert.notEqual(chosen.binding, "free", `${worstAngle.toFixed(1)}° off every guide still came back unguided`);
  const nearest = scoreBindings(scene, origin, worstDir)[0];
  assert.ok(Math.abs(chosen.u.x) === Math.abs(nearest.u.x) || chosen.binding, "it is a real guide");
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
  setEyeLevel(scene, 540);
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
  setEyeLevel(scene, 540);
  addVp(scene, { label: "VP1", x: -600, y: 100, onHorizon: false });   // ~8° off horizontal at the origin below
  const chosen = chooseBinding(scene, { x: 900, y: 640 }, { x: -1, y: 0 }, {});
  assert.equal(chosen.binding, "horizontal");
});

test("D11: a vertical stroke is unaffected — verticals still bind vertical", () => {
  const { scene } = farVpScene();
  const chosen = chooseBinding(scene, { x: 900, y: 500 }, { x: 0, y: 1 }, {});
  assert.equal(chosen.binding, "vertical");
});

test("D18: a stroke at any angle lands on a guide — never on nothing", () => {
  const { scene } = farVpScene();
  const from = { x: 900, y: 500 };
  // Every direction on the circle, including the ones that used to fall through
  // the old 15°/22° threshold to `free`.
  for (let a = 0; a < 360; a += 3) {
    const r = a * Math.PI / 180;
    const chosen = chooseBinding(scene, from, { x: Math.cos(r), y: Math.sin(r) }, {});
    assert.notEqual(chosen.binding, "free", `${a}° came back unguided`);
    assert.ok(chosen.u, `${a}° came back with no direction`);
  }
});

test("D18: the deliberate escapes still work — assist off, and a forced none", () => {
  const { scene } = farVpScene();
  const dir = { x: 0.6, y: 0.8 };
  assert.equal(chooseBinding(scene, { x: 900, y: 500 }, dir, { assist: false }).binding, "free");
  assert.equal(chooseBinding(scene, { x: 900, y: 500 }, dir, { forced: "free" }).binding, "free");
});
test("D12: a stroke between two existing points that are not on the guide is not recorded as bound", () => {
  const { scene, vp1 } = farVpScene();
  const p1 = addAnchor(scene, { x: 900, y: 400 }).vertex;
  const p2 = addAnchor(scene, { x: 600, y: 900 }).vertex;
  const res = commitStroke(scene,
    resolveEndpoint(scene, { x: p1.x, y: p1.y }),
    resolveEndpoint(scene, { x: p2.x, y: p2.y }),
    { vpId: vp1.id });                                   // as the Guide picker forces it
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.edge.binding, "free", "an unsatisfiable binding must not be stored");
  assert.deepEqual(res.demoted, { vpId: vp1.id }, "and the caller must be told, so the user can be");
  // Nothing was moved to make the claim true (Doctrine §14: no silent mutation).
  assert.deepEqual({ x: p1.x, y: p1.y }, { x: 900, y: 400 });
  assert.deepEqual({ x: p2.x, y: p2.y }, { x: 600, y: 900 });
});

test("D12: a stroke between two existing points that ARE on the guide keeps its binding", () => {
  const { scene, vp1 } = farVpScene();
  const p1 = addAnchor(scene, { x: 900, y: 400 }).vertex;
  // p2 placed exactly on the line from p1 to VP1 — closing a corner properly.
  const dx = vp1.x - p1.x, dy = vp1.y - p1.y, L = Math.hypot(dx, dy);
  const p2 = addAnchor(scene, { x: p1.x + dx / L * 300, y: p1.y + dy / L * 300 }).vertex;
  const res = commitStroke(scene,
    resolveEndpoint(scene, { x: p1.x, y: p1.y }),
    resolveEndpoint(scene, { x: p2.x, y: p2.y }),
    { vpId: vp1.id });
  assert.equal(res.ok, true, res.reason);
  assert.deepEqual(res.edge.binding, { vpId: vp1.id }, "a satisfied binding is kept");
  assert.equal(res.demoted, null);
});

test("D12: every edge the drawing flow produces satisfies the binding it stores", () => {
  // The invariant, asserted over a messy drawing rather than one tidy case:
  // strokes that merge, strokes that cross, strokes drawn at every angle.
  const { scene, vp1, vp2 } = farVpScene();
  const rand = (() => { let a = 7; return () => (a = (a * 1103515245 + 12345) % 2147483648) / 2147483648; })();
  for (let i = 0; i < 60; i++) {
    const from = { x: 300 + rand() * 1000, y: 200 + rand() * 800 };
    const angle = rand() * Math.PI * 2;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const chosen = chooseBinding(scene, from, dir, {});
    const to = { x: from.x + dir.x * 250, y: from.y + dir.y * 250 };
    commitStroke(scene, resolveEndpoint(scene, from), resolveEndpoint(scene, to), chosen.binding);
  }
  assert.ok(scene.edges.length > 30, `only ${scene.edges.length} edges were built`);
  const byId = new Map(scene.vertices.map(v => [v.id, v]));
  for (const e of scene.edges) {
    assert.equal(bindingSatisfied(scene, byId.get(e.a), byId.get(e.b), e.binding), true,
      `edge ${e.id} stores a binding its geometry does not satisfy`);
  }
  // And the same holds after the vanishing points are dragged around.
  for (const [vp, x, y] of [[vp1, -400, 700], [vp2, 2000, 200], [vp1, 800, 100]]) {
    moveVp(scene, vp.id, { x, y });
    for (const e of scene.edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
      assert.equal(effectiveBinding(scene, e) === "free" || bindingSatisfied(scene, a, b, e.binding), true,
        `edge ${e.id} reports a binding it no longer satisfies after a drag`);
    }
  }
});

test("D12: a binding that goes stale after a drag is reported as free, and the file is not rewritten", () => {
  const { scene, vp1 } = farVpScene();
  // Two anchors that line up with VP1 only by coincidence.
  const c = addAnchor(scene, { x: 400, y: 300 }).vertex;
  const dx = vp1.x - c.x, dy = vp1.y - c.y, L = Math.hypot(dx, dy);
  const d = addAnchor(scene, { x: c.x + dx / L * 200, y: c.y + dy / L * 200 }).vertex;
  const res = commitStroke(scene,
    resolveEndpoint(scene, { x: c.x, y: c.y }), resolveEndpoint(scene, { x: d.x, y: d.y }),
    { vpId: vp1.id });
  assert.deepEqual(res.edge.binding, { vpId: vp1.id }, "honest at creation");
  moveVp(scene, vp1.id, { x: -400, y: 900 });
  assert.equal(effectiveBinding(scene, res.edge), "free", "no longer true, so no longer reported");
  assert.deepEqual(res.edge.binding, { vpId: vp1.id },
    "but the stored file is left alone — a drag must not silently edit the drawing");
});

// ---- D16: the guide set is exactly VPs + vertical + horizontal ------------
//
// Noah, 2026-07-29: "WHY is there ANYTHING besides VPs, and perfect vertical
// and horizontal lines acting as ANCHORS FOR MY LINES?! I DIDN'T ASK FOR THAT!
// 45 degrees may be a toggle."

test("D16: nothing outside {vanishing points, vertical, horizontal} is ever offered", () => {
  const { scene } = farVpScene();
  const offered = new Set();
  for (let a = 0; a < 360; a += 7) {
    const r = a * Math.PI / 180;
    for (const c of scoreBindings(scene, { x: 800, y: 600 }, { x: Math.cos(r), y: Math.sin(r) })) {
      offered.add(typeof c.binding === "string" ? c.binding : "vp");
    }
  }
  assert.deepEqual([...offered].sort(), ["horizontal", "vertical", "vp"]);
});

test("D16: the 45° pair appears ONLY when it is switched on", () => {
  const { scene } = farVpScene();
  const dir = { x: Math.SQRT1_2, y: Math.SQRT1_2 };           // exactly 45°
  const off = scoreBindings(scene, { x: 800, y: 600 }, dir).map(c => c.binding);
  assert.equal(off.includes("diag45"), false, "off by default");
  // D18: with the toggle off a 45° stroke does not come back unguided — it takes
  // the nearest guide there is, which is simply not the 45° one.
  const without = chooseBinding(scene, { x: 800, y: 600 }, dir, {}).binding;
  assert.notEqual(without, "free", "still guided");
  assert.notEqual(without, "diag45", "but never the guide that is switched off");
  const on = scoreBindings(scene, { x: 800, y: 600 }, dir, { diagonals: true }).map(c => c.binding);
  assert.equal(on.includes("diag45"), true);
  assert.equal(chooseBinding(scene, { x: 800, y: 600 }, dir, { diagonals: true }).binding, "diag45");
});

test("D20: an end joins another end ONLY when that end is on this stroke's guide", () => {
  // Rewritten from D16's "nothing ever joins". Noah, after a cube fell apart
  // under a VP drag: "Being unable to connect line ends means everything breaks
  // when you do adjustments." Joining is back — but it may only move an end
  // ALONG its guide, never off it.
  const { scene, vp1 } = farVpScene();
  const a = addAnchor(scene, { x: 900, y: 400 }).vertex;
  const onGuide = addRayVertex(scene, { origin: a.id, binding: { vpId: vp1.id }, t: 300 }).vertex;
  const offGuide = addAnchor(scene, { x: 900, y: 700 }).vertex;   // nowhere near that line
  const u = bindingDirection(scene, a, { vpId: vp1.id });

  // A stroke from `a` along VP1 whose finger stops 4px from the existing end
  // that IS on the guide → it merges, so the corner is shared.
  const near = { x: onGuide.x + 3, y: onGuide.y + 2 };
  const joined = resolveStrokeEnd(scene, a, { vpId: vp1.id }, u, near, 12);
  assert.equal(joined.type, "merge");
  assert.equal(joined.vertexId, onGuide.id);

  // A stroke along VERTICAL from `a`, whose finger stops near the off-guide
  // point — that point is not on the vertical, so it must NOT capture the end.
  const vu = bindingDirection(scene, a, "vertical");
  const nearOff = { x: offGuide.x + 40, y: offGuide.y + 2 };      // 40px off the vertical
  const notJoined = resolveStrokeEnd(scene, a, "vertical", vu, nearOff, 12);
  assert.notEqual(notJoined.type, "merge");
});

test("D20: an end stops at a bound line crossing its guide — the corner a box needs", () => {
  const { scene, vp1 } = farVpScene();
  // An existing vertical line, and a stroke toward VP1 that crosses it.
  const p = addAnchor(scene, { x: 1100, y: 300 }).vertex;
  const q = addRayVertex(scene, { origin: p.id, binding: "vertical", t: 400 }).vertex;
  assert.equal(addEdge(scene, { a: p.id, b: q.id, binding: "vertical" }).ok, true);

  const a = addAnchor(scene, { x: 700, y: 520 }).vertex;
  const u = bindingDirection(scene, a, { vpId: vp1.id });
  // Where our guide crosses that vertical:
  const t = (1100 - a.x) / u.x;
  const at = { x: a.x + u.x * t, y: a.y + u.y * t };
  const desc = resolveStrokeEnd(scene, a, { vpId: vp1.id }, u, { x: at.x + 3, y: at.y + 3 }, 12);
  assert.equal(desc.type, "cross", `got ${desc.type}`);
  // Committing it makes a two-constraint corner, which is what survives a drag.
  const res = commitStroke(scene, { type: "plain", at: { x: a.x, y: a.y } }, desc, { vpId: vp1.id });
  assert.equal(res.ok, true, res.reason);
  const corner = scene.vertices.find(v => v.id === res.b);
  assert.equal(corner.kind, "intersect");
  const was = { x: corner.x, y: corner.y };
  moveVp(scene, vp1.id, { x: -700, y: 800 });
  assert.ok(Math.hypot(corner.x - was.x, corner.y - was.y) > 1, "it re-solved with the point");
  assert.ok(Number.isFinite(corner.x) && Number.isFinite(corner.y));
});
test("D19: swinging the stroke onto another guide switches it mid-line", () => {
  const { scene, vp1, vp2 } = farVpScene();
  // Well BELOW the horizon, so the two points are genuinely different
  // directions from here (~29° apart). Measured while writing this: from a
  // point NEAR the horizon they are only ~3° apart, which is inside the switch
  // margin — there is nothing to swing through, and the Guide picker is the way
  // to change between them there. That is geometry, not a defect.
  const from = { x: 800, y: 1100 };
  const toward = vp => {
    const dx = vp.x - from.x, dy = vp.y - from.y, L = Math.hypot(dx, dy);
    return { x: dx / L, y: dy / L };
  };
  // Start out along VP1's line and confirm it is what we are holding.
  const first = chooseBinding(scene, from, toward(vp1), {});
  assert.equal(first.binding.vpId, vp1.id);
  // Now swing decisively to VP2's line while HOLDING VP1 — it must hand over.
  const swung = chooseBinding(scene, from, toward(vp2), { current: first.binding });
  assert.equal(swung.binding.vpId, vp2.id, "a deliberate swing switches the guide");
  // And vertical, which is nowhere near either, takes it just as readily.
  const up = chooseBinding(scene, from, { x: 0, y: 1 }, { current: swung.binding });
  assert.equal(up.binding, "vertical");
});

test("D19: hysteresis — a tremor does NOT flap the line between two guides", () => {
  // Written the second time round. The first version jittered around a VP aim
  // and passed with hysteresis DELETED, because D11's tie-breaks were already
  // pinning that case — a test satisfied by a mechanism other than the one it
  // names is decoration. This one sits exactly on the boundary between vertical
  // and horizontal, 45° from each, where nothing else breaks the tie: without
  // hysteresis the guide flips with every wobble.
  const scene = createScene({ name: "d19", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);                       // no vanishing points at all
  const from = { x: 800, y: 600 };
  const base = 45 * Math.PI / 180;
  let held = chooseBinding(scene, from, { x: Math.cos(base), y: Math.sin(base) }, {}).binding;
  const started = held;
  assert.ok(started === "vertical" || started === "horizontal", `started on ${started}`);
  let flips = 0;
  for (let i = 0; i < 200; i++) {
    const wobble = ((i * 37) % 9 - 4) * 0.6;     // ±2.4°, deterministic, either side
    const a = base + wobble * Math.PI / 180;
    const next = chooseBinding(scene, from, { x: Math.cos(a), y: Math.sin(a) }, { current: held }).binding;
    if (!sameBinding(next, started)) flips++;
    held = next;
  }
  assert.equal(flips, 0, `the guide moved ${flips} times under a ±2.4° tremor`);
});

test("D19: the margin is a margin, not a lock — past it the switch happens", () => {
  const { scene } = farVpScene();
  const from = { x: 900, y: 500 };
  // Hold `vertical`, then rotate away from it degree by degree and find where it
  // lets go. It must let go, and only after SWITCH_MARGIN is exceeded.
  let held = "vertical";
  let switchedAt = null;
  for (let deg = 90; deg >= 0; deg -= 1) {
    const r = deg * Math.PI / 180;
    const next = chooseBinding(scene, from, { x: Math.cos(r), y: Math.sin(r) }, { current: held }).binding;
    if (!sameBinding(next, "vertical")) { switchedAt = 90 - deg; break; }
  }
  assert.ok(switchedAt !== null, "it never let go — that is a lock, not hysteresis");
  assert.ok(switchedAt > SWITCH_MARGIN - 1,
    `let go after only ${switchedAt}°, inside the ${SWITCH_MARGIN}° margin`);
});

// ---- D21: a box, from one gesture, that stays a box ------------------------
//
// Noah, 2026-07-29: "Add drawing boxes/rectangles." — after building a cube out
// of nine strokes and watching it come apart when he moved a point.

function boxFixture() {
  const scene = createScene({ name: "d21", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  const vp1 = addVp(scene, { label: "VP1", x: -1360, y: 540, onHorizon: true }).vp;
  const vp2 = addVp(scene, { label: "VP2", x: 2960, y: 540, onHorizon: true }).vp;
  const res = buildBox(scene, { at: { x: 800, y: 800 }, height: 260, depth: 200 });
  return { scene, vp1, vp2, res };
}

// Every bound edge lies on its guide, and every corner is shared by >1 edge.
function boxIsSound(scene) {
  const byId = new Map(scene.vertices.map(v => [v.id, v]));
  const uses = new Map();
  let worst = 0;
  for (const e of scene.edges) {
    for (const id of [e.a, e.b]) uses.set(id, (uses.get(id) || 0) + 1);
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) return { ok: false, why: "an edge lost an endpoint" };
    if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) return { ok: false, why: "a corner went non-finite" };
    if (typeof e.binding === "string") continue;
    const vp = scene.vanishingPoints.find(v => v.id === e.binding.vpId);
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    worst = Math.max(worst, Math.abs(dx * (a.y - vp.y) - dy * (a.x - vp.x)) / L);
  }
  const orphans = [...uses.values()].filter(n => n < 2).length;
  return { ok: worst < 1e-6 && orphans === 0, worst, orphans };
}

test("D21: one gesture builds twelve edges and eight shared corners", () => {
  const { scene, res } = boxFixture();
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.edges.length, 12, "a box has twelve edges");
  assert.equal(scene.vertices.length, 8, "and eight corners");
  // Only ONE anchor: everything else is held by constraints, which is the whole
  // point — a box of eight anchors would come apart exactly like the hand-drawn
  // cube did.
  assert.equal(scene.vertices.filter(v => v.kind === "anchor").length, 1);
  const sound = boxIsSound(scene);
  assert.equal(sound.ok, true, JSON.stringify(sound));
});

test("D21: the box survives its vanishing points being dragged anywhere", () => {
  const { scene, vp1, vp2 } = boxFixture();
  for (const [vp, x, y] of [
    [vp1, -400, 250], [vp2, 2000, 900], [vp1, 200, 540],
    [vp2, 1000, 100], [vp1, -3000, 540],
  ]) {
    moveVp(scene, vp.id, { x, y });
    const sound = boxIsSound(scene);
    assert.equal(sound.ok, true, `after VP to ${x},${y}: ${JSON.stringify(sound)}`);
    assert.equal(scene.edges.length, 12, "no edge was lost");
    assert.equal(scene.vertices.length, 8, "no corner was lost");
  }
});

test("D21: a box needs two points, and says so plainly when it has one", () => {
  const scene = createScene({ name: "d21b", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  addVp(scene, { label: "VP1", x: -1360, y: 540, onHorizon: true });
  const res = buildBox(scene, { at: { x: 800, y: 800 }, height: 200, depth: 200 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /two vanishing points/);
  assert.equal(scene.edges.length, 0, "and it left nothing half-built behind");
});
