// D29 — manipulate(): one entry for dragging, nudging and typing at any vertex.
//
// The corners this is about are `intersect` vertices, which had no way to move at
// all. The closed-form inverses exist for three of them and are used HERE as
// oracles — the runtime path is the generic Gauss-Newton solve, so these tests
// check the solver against mathematics rather than against itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, addAnchor, addRayVertex, addIntersectVertex, solveScene, moveVp,
  manipulate, ancestorParams,
} from "../public/app/solver.mjs";
import { buildBox } from "../public/app/snap.mjs";

function boxScene({ h = 200, dL = 150, dR = 150 } = {}) {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  const l = addVp(scene, { label: "VP1", x: 100, y: 600 }).vp;
  const r = addVp(scene, { label: "VP2", x: 1500, y: 600 }).vp;
  solveScene(scene);
  const box = buildBox(scene, { at: { x: 800, y: 900 }, height: h, depthL: dL, depthR: dR });
  assert.ok(box.ok, box.reason);
  return { scene, l, r, box };
}

const sound = (scene, box) => {
  const verts = box.vertices.map(id => scene.vertices.find(v => v.id === id));
  return verts.every(v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && !v.degenerate);
};

test("ancestorParams finds the numbers behind each corner, however deep", () => {
  const { scene, box } = boxScene();
  const n = id => ancestorParams(scene, id).length;
  assert.equal(n(box.corners.nearBottom.id), 0, "an anchor has no parameters");
  assert.equal(n(box.corners.nearTop.id), 1, "a ray has its own t");
  assert.equal(n(box.corners.backBottom.id), 2, "both depths");
  assert.equal(n(box.corners.leftTop.id), 2, "height and one depth");
  // The far top corner is defined by two corners that are themselves defined by
  // corners — the walk has to recurse or it finds nothing.
  assert.equal(n(box.corners.backTop.id), 3, "height and both depths");
});

test("every one of the eight corners can be moved, to sub-pixel", () => {
  const { scene, box } = boxScene();
  for (const [name, corner] of Object.entries(box.corners)) {
    const target = { x: corner.x + 55, y: corner.y - 35 };
    const res = manipulate(scene, corner.id, target);
    assert.ok(res.ok, `${name}: ${res.reason}`);
    const err = Math.hypot(corner.x - target.x, corner.y - target.y);
    // A ray corner is constrained to its guide, so it lands at the projection
    // rather than on the target — that is correct, not a miss.
    if (corner.kind === "intersect" || corner.kind === "anchor") {
      assert.ok(err < 0.5, `${name} landed ${err.toFixed(2)}px from the target`);
    }
    assert.ok(sound(scene, box), `${name} broke the box`);
  }
});

test("the inverse agrees with the closed form, which is the independent check", () => {
  // leftTop sits where the line nearTop->VPL crosses the vertical through
  // leftBottom. Given a target T with the anchor fixed:
  //   dL = (T.x - ax) / uL.x        and       h = ay - (the y of nearTop)
  // where nearTop is where the line VPL->T meets the near vertical x = ax.
  const { scene, l, box } = boxScene();
  const { nearBottom, leftTop, leftBottom } = box.corners;
  const ax = nearBottom.x, ay = nearBottom.y;
  const target = { x: leftTop.x - 70, y: leftTop.y + 25 };

  const uLx = (l.x - ax) / Math.hypot(l.x - ax, l.y - ay);
  const expectDL = (target.x - ax) / uLx;
  // line through VPL and target, evaluated at x = ax
  const yAtAx = l.y + (ax - l.x) * (target.y - l.y) / (target.x - l.x);
  const expectH = ay - yAtAx;

  const res = manipulate(scene, leftTop.id, target);
  assert.ok(res.ok && res.converged, `did not converge: ${res.reason ?? res.error}`);
  const gotDL = Math.abs(leftBottom.t);
  const gotH = Math.abs(box.corners.nearTop.t);
  assert.ok(Math.abs(gotDL - Math.abs(expectDL)) < 1, `depth ${gotDL} against closed form ${Math.abs(expectDL)}`);
  assert.ok(Math.abs(gotH - Math.abs(expectH)) < 1, `height ${gotH} against closed form ${Math.abs(expectH)}`);
});

test("dragging the back bottom corner sets BOTH depths in one gesture", () => {
  // This is the owner's report answered directly: the drag that could not state
  // two depths is followed by a corner drag that can.
  const { scene, box } = boxScene({ dL: 20, dR: 20 });      // the 1.1.0 slab
  const { backBottom, leftBottom, rightBottom } = box.corners;
  // Deeper is UP: the base plane recedes toward the horizon, so dragging the back
  // corner toward the horizon is what lengthens both base edges. (The first
  // version of this test dragged DOWNWARD and failed at 4.4px of depth — the
  // solver was right and the test was wrong, which is the useful direction for a
  // disagreement to run.)
  const res = manipulate(scene, backBottom.id, { x: backBottom.x + 40, y: backBottom.y - 120 });
  assert.ok(res.ok, res.reason);
  assert.ok(Math.abs(leftBottom.t) > 100, `left depth only reached ${Math.abs(leftBottom.t)}`);
  assert.ok(Math.abs(rightBottom.t) > 100, `right depth only reached ${Math.abs(rightBottom.t)}`);
  assert.ok(sound(scene, box));
});

test("the far top corner spreads a straight-up drag across height, not sideways", () => {
  // The minimum-norm step is what makes this feel like direct manipulation: pull
  // the far top corner up and the box grows TALLER, it does not slew sideways.
  const { scene, box } = boxScene();
  const { backTop, leftBottom, rightBottom, nearTop } = box.corners;
  const h0 = Math.abs(nearTop.t), dL0 = Math.abs(leftBottom.t), dR0 = Math.abs(rightBottom.t);
  const res = manipulate(scene, backTop.id, { x: backTop.x, y: backTop.y - 90 });
  assert.ok(res.ok && res.converged, res.reason);
  const dh = Math.abs(nearTop.t) - h0;
  const ddL = Math.abs(leftBottom.t) - dL0, ddR = Math.abs(rightBottom.t) - dR0;
  assert.ok(dh > 40, `height barely moved: ${dh}`);
  assert.ok(Math.abs(ddL - ddR) < 5, `the two depths diverged: ${ddL} against ${ddR}`);
  assert.ok(dh > Math.abs(ddL) * 2, "the drag went sideways more than up");
});

test("a ray corner stays single-parameter — moving one depth leaves the other", () => {
  const { scene, box } = boxScene();
  const { leftBottom, rightBottom } = box.corners;
  const before = rightBottom.t;
  const res = manipulate(scene, leftBottom.id, { x: leftBottom.x - 80, y: leftBottom.y - 30 });
  assert.ok(res.ok, res.reason);
  assert.equal(rightBottom.t, before, "manipulating one ray moved another parameter");
});

test("a corner with no position REFUSES the drag rather than poisoning the box", () => {
  // The measured failure: a corner born degenerate (its two guides parallel) has
  // no finite position, and a Jacobian taken there writes NaN into every ancestor
  // and destroys the construction beyond undo. Refusing is the whole fix.
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  const vp = addVp(scene, { label: "VP1", x: 800, y: 200 }).vp;
  const a = addAnchor(scene, { x: 800, y: 900 }).vertex;
  const up = addRayVertex(scene, { origin: a.id, binding: "vertical", t: -100 }).vertex;
  // Both defs are vertical lines: parallel, so the intersect can never solve.
  const bad = addIntersectVertex(scene, { defs: [
    { origin: up.id, binding: "vertical" },
    { origin: a.id, binding: "vertical" },
  ] }).vertex;
  assert.ok(bad.degenerate || !Number.isFinite(bad.x), "setup: this corner should be unsolvable");
  const res = manipulate(scene, bad.id, { x: 900, y: 800 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /no position|parallel/);
  assert.ok(Number.isFinite(up.t) && up.t === -100, "the ancestors were written to anyway");
  assert.ok(vp);
});

test("an unreachable target pins the corner instead of running away", () => {
  const { scene, box } = boxScene();
  const { backBottom, leftBottom, rightBottom } = box.corners;
  // Above the horizon: outside anything this construction can express.
  const res = manipulate(scene, backBottom.id, { x: 800, y: 200 });
  assert.ok(res.ok, res.reason);
  assert.equal(res.converged, false, "it claimed to reach an unreachable target");
  assert.ok(Number.isFinite(backBottom.x) && Number.isFinite(backBottom.y));
  assert.ok(sound(scene, box), "the box broke chasing an impossible target");
  // and it did not chase to infinity — the VP clamp holds it well short
  for (const ray of [leftBottom, rightBottom]) {
    assert.ok(Math.abs(ray.t) < 2000, `a depth ran to ${ray.t}`);
  }
});

test("no corner may converge onto its own vanishing point", () => {
  const { scene, l, box } = boxScene();
  const res = manipulate(scene, box.corners.backTop.id, { x: l.x, y: l.y });
  assert.ok(res.ok, res.reason);
  const { leftBottom } = box.corners;
  const originToVp = Math.hypot(l.x - box.corners.nearBottom.x, l.y - box.corners.nearBottom.y);
  assert.ok(Math.abs(leftBottom.t) < originToVp,
    `a base corner reached its vanishing point: t=${leftBottom.t} against distance ${originToVp}`);
  assert.ok(sound(scene, box));
});

test("depths never fold through zero, where the solver's side-choice is undefined", () => {
  const { scene, box } = boxScene({ dL: 40, dR: 40 });
  const { backBottom, leftBottom } = box.corners;
  // Drag hard toward the near corner: without the floor this walks t to 0, where
  // solveRay's |t| fold makes the derivative meaningless and the solve stalls.
  for (let i = 0; i < 12; i++) {
    manipulate(scene, backBottom.id, { x: box.corners.nearBottom.x, y: box.corners.nearBottom.y });
    assert.ok(Math.abs(leftBottom.t) >= 1, `a depth reached ${leftBottom.t}`);
    assert.ok(Number.isFinite(leftBottom.t));
  }
  assert.ok(sound(scene, box));
});

test("the box still holds together after a vanishing point moves under it", () => {
  const { scene, l, box } = boxScene();
  manipulate(scene, box.corners.backTop.id, { x: box.corners.backTop.x + 40, y: box.corners.backTop.y - 60 });
  moveVp(scene, l.id, { x: 300, y: 640 });
  assert.ok(sound(scene, box), "moving a vanishing point after an inverse drag broke the box");
  // and every VP-bound edge still runs to its point
  let worst = 0;
  for (const e of scene.edges) {
    if (typeof e.binding === "string") continue;
    const vp = scene.vanishingPoints.find(v => v.id === e.binding.vpId);
    const a = scene.vertices.find(v => v.id === e.a), b = scene.vertices.find(v => v.id === e.b);
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    worst = Math.max(worst, Math.abs(dx * (a.y - vp.y) - dy * (a.x - vp.x)) / L);
  }
  assert.ok(worst < 0.001, `an edge drifted ${worst}px off its vanishing point`);
});
