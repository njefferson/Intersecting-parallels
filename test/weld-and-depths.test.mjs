// D22 (welding is a toggle) and D23 (two depths, and corners you can actually
// set). Every block here was run against the previous code first: without the
// `weld` option the end still merged, without depthL/depthR the plan came out
// square, and moveAnchor did not exist.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, addAnchor, addRayVertex, addEdge, solveScene, moveVp,
  moveAnchor, rebindVertex,
} from "../public/app/solver.mjs";
import { resolveStrokeEnd, buildBox, splitBoxDepths } from "../public/app/snap.mjs";

function twoPointScene() {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  const l = addVp(scene, { label: "VP1", x: 100, y: 600 }).vp;
  const r = addVp(scene, { label: "VP2", x: 1500, y: 600 }).vp;
  solveScene(scene);
  return { scene, l, r };
}

// ---- D22 -----------------------------------------------------------------

test("weld on: an end that lands on an existing corner ON the guide merges into it", () => {
  const { scene, l } = twoPointScene();
  // A corner sitting exactly on the horizontal guide through the start.
  const start = { x: 400, y: 800 };
  const corner = addAnchor(scene, { x: 700, y: 800 }).vertex;
  const u = { x: 1, y: 0 };
  const end = resolveStrokeEnd(scene, start, "horizontal", u, { x: 703, y: 802 }, 12);
  assert.equal(end.type, "merge");
  assert.equal(end.vertexId, corner.id);
  assert.ok(l);
});

test("weld off: the same stroke joins nothing and ends where the finger left it", () => {
  const { scene } = twoPointScene();
  const start = { x: 400, y: 800 };
  addAnchor(scene, { x: 700, y: 800 });
  const end = resolveStrokeEnd(scene, start, "horizontal", { x: 1, y: 0 },
    { x: 703, y: 802 }, 12, { weld: false });
  assert.equal(end.type, "plain");
  assert.deepEqual(end.at, { x: 703, y: 802 });
});

test("weld off refuses a CROSSING too, not only a nearby corner", () => {
  // Rewritten after the deliberate break: the first version put the stroke in an
  // empty scene, so "plain" came back whether welding was on or off and the test
  // could not fail. It now sets up rule 2 of D20 — a bound line crossing this
  // guide near the finger — which welding ON would take as a two-constraint
  // corner. With welding off it must be refused.
  const { scene, r: vpR } = twoPointScene();
  const a = addAnchor(scene, { x: 500, y: 700 }).vertex;
  const b = addRayVertex(scene, { origin: a.id, binding: { vpId: vpR.id }, t: 400 }).vertex;
  addEdge(scene, { a: a.id, b: b.id, binding: { vpId: vpR.id } });
  solveScene(scene);
  const start = { x: 700, y: 900 }, u = { x: 0, y: -1 };        // straight up
  // Where the vertical through `start` meets that bound line:
  const s = (start.x - a.x) / (b.x - a.x);
  const hit = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
  const welded = resolveStrokeEnd(scene, start, "vertical", u, { x: hit.x + 2, y: hit.y + 2 }, 12);
  assert.equal(welded.type, "cross", "setup: welding on should find the crossing");
  const bare = resolveStrokeEnd(scene, start, "vertical", u, { x: hit.x + 2, y: hit.y + 2 }, 12, { weld: false });
  assert.equal(bare.type, "plain");
});

// ---- D23 -----------------------------------------------------------------

test("a straight-up drag still makes a square plan", () => {
  const { scene } = twoPointScene();
  const s = splitBoxDepths(scene, { x: 800, y: 900 }, { x: 800, y: 700 });
  assert.equal(s.height, 200);
  assert.equal(s.depthL, s.depthR, "no sideways movement means no preference");
});

test("dragging toward one vanishing point deepens that side only", () => {
  const { scene } = twoPointScene();       // VP1 left at x=100, VP2 right at x=1500
  const right = splitBoxDepths(scene, { x: 800, y: 900 }, { x: 950, y: 700 });
  assert.ok(right.depthR > right.depthL, `right drag: L=${right.depthL} R=${right.depthR}`);
  const left = splitBoxDepths(scene, { x: 800, y: 900 }, { x: 650, y: 700 });
  assert.ok(left.depthL > left.depthR, `left drag: L=${left.depthL} R=${left.depthR}`);
  // Monotone: further right is always deeper right, which is what makes it
  // learnable rather than a knack.
  const further = splitBoxDepths(scene, { x: 800, y: 900 }, { x: 1050, y: 700 });
  assert.ok(further.depthR > right.depthR);
});

test("buildBox honours two different depths", () => {
  const { scene } = twoPointScene();
  const res = buildBox(scene, { at: { x: 800, y: 900 }, height: 200, depthL: 120, depthR: 300 });
  assert.ok(res.ok, res.reason);
  const { nearBottom, leftBottom, rightBottom } = res.corners;
  const dL = Math.hypot(leftBottom.x - nearBottom.x, leftBottom.y - nearBottom.y);
  const dR = Math.hypot(rightBottom.x - nearBottom.x, rightBottom.y - nearBottom.y);
  assert.ok(Math.abs(dL - 120) < 0.001, `left base ran ${dL}`);
  assert.ok(Math.abs(dR - 300) < 0.001, `right base ran ${dR}`);
  assert.ok(dR > dL * 2, "the plan is not square");
});

test("a lopsided box is still a box after a vanishing point moves", () => {
  const { scene, l } = twoPointScene();
  const res = buildBox(scene, { at: { x: 800, y: 900 }, height: 220, depthL: 100, depthR: 320 });
  assert.ok(res.ok, res.reason);
  moveVp(scene, l.id, { x: 260, y: 640 });
  const verts = res.vertices.map(id => scene.vertices.find(v => v.id === id));
  assert.ok(verts.every(v => v && Number.isFinite(v.x) && Number.isFinite(v.y)), "a corner went non-finite");
  assert.ok(verts.every(v => !v.degenerate), "a corner became unsolvable");

  const { nearBottom, leftBottom, rightBottom } = res.corners;
  // Still LOPSIDED, and still each depth's own length — checked after the move,
  // because the first version of this test asserted only "finite and solvable",
  // which a square box passes just as happily. It has to be able to fail.
  const dL = Math.hypot(leftBottom.x - nearBottom.x, leftBottom.y - nearBottom.y);
  const dR = Math.hypot(rightBottom.x - nearBottom.x, rightBottom.y - nearBottom.y);
  assert.ok(Math.abs(dL - 100) < 0.001, `left base is ${dL}, not the 100 it was given`);
  assert.ok(Math.abs(dR - 320) < 0.001, `right base is ${dR}, not the 320 it was given`);
  // And the left base edge still runs to the point that moved: cross product of
  // (edge direction) with (direction to the moved VP) must be zero.
  const ex = leftBottom.x - nearBottom.x, ey = leftBottom.y - nearBottom.y;
  const vx = 260 - nearBottom.x, vy = 640 - nearBottom.y;
  const cross = (ex * vy - ey * vx) / (Math.hypot(ex, ey) * Math.hypot(vx, vy));
  assert.ok(Math.abs(cross) < 1e-9, `left base is ${cross} off its moved vanishing point`);
});

test("depth is settable exactly afterwards, one side at a time", () => {
  const { scene } = twoPointScene();
  const res = buildBox(scene, { at: { x: 800, y: 900 }, height: 200, depthL: 150, depthR: 150 });
  assert.ok(res.ok, res.reason);
  const { nearBottom, leftBottom, rightBottom } = res.corners;
  const before = Math.hypot(rightBottom.x - nearBottom.x, rightBottom.y - nearBottom.y);
  const r = rebindVertex(scene, leftBottom.id, { t: 420 });
  assert.ok(r.ok, r.reason);
  const dL = Math.hypot(leftBottom.x - nearBottom.x, leftBottom.y - nearBottom.y);
  const after = Math.hypot(rightBottom.x - nearBottom.x, rightBottom.y - nearBottom.y);
  assert.ok(Math.abs(dL - 420) < 0.001, `left base is now ${dL}`);
  assert.ok(Math.abs(after - before) < 0.001, "changing one depth moved the other");
  // and the box did not fall apart
  const verts = res.vertices.map(id => scene.vertices.find(v => v.id === id));
  assert.ok(verts.every(v => v && Number.isFinite(v.x) && !v.degenerate));
});

test("the box's anchored corner can be moved, and the whole box follows", () => {
  const { scene } = twoPointScene();
  const res = buildBox(scene, { at: { x: 800, y: 900 }, height: 200, depthL: 140, depthR: 260 });
  assert.ok(res.ok, res.reason);
  const { nearBottom, backTop } = res.corners;
  const before = { x: backTop.x, y: backTop.y };
  const r = moveAnchor(scene, nearBottom.id, { x: 760, y: 940 });
  assert.ok(r.ok, r.reason);
  assert.equal(nearBottom.x, 760);
  assert.ok(Math.hypot(backTop.x - before.x, backTop.y - before.y) > 1,
    "the far corner did not follow the corner that defines it");
  assert.ok(Number.isFinite(backTop.x) && !backTop.degenerate);
});

test("moveAnchor refuses a constrained point, and says which control to use", () => {
  const { scene } = twoPointScene();
  const a = addAnchor(scene, { x: 300, y: 300 }).vertex;
  const ray = addRayVertex(scene, { origin: a.id, binding: "vertical", t: 80 }).vertex;
  const r = moveAnchor(scene, ray.id, { x: 10, y: 10 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /distance along it/);
  // and it did not move it anyway
  assert.equal(ray.x, 300);
});

test("an edge drawn with welding off is still bound to its guide", () => {
  // The end-to-end property: welding off changes WHERE a line stops, never what
  // it follows. Built here through the same pieces the app uses.
  const { scene, r: vpR } = twoPointScene();
  const a = addAnchor(scene, { x: 500, y: 800 }).vertex;
  const b = addRayVertex(scene, { origin: a.id, binding: { vpId: vpR.id }, t: 200 }).vertex;
  const e = addEdge(scene, { a: a.id, b: b.id, binding: { vpId: vpR.id } });
  assert.ok(e.ok);
  solveScene(scene);
  const cross = (b.x - a.x) * (vpR.y - a.y) - (b.y - a.y) * (vpR.x - a.x);
  assert.ok(Math.abs(cross) < 1e-6, "the line does not run to its vanishing point");
});
