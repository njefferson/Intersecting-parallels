// Snap / binding-choice / D2 endpoint-precedence tests (spec §3.2, §2.4).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createScene, addVp, addAnchor, setHorizon, solveScene, moveVp } from "../public/app/solver.mjs";
import {
  scoreBindings, chooseBinding, nearestVertex, nearestBoundEdge,
  resolveEndpoint, commitStroke,
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
