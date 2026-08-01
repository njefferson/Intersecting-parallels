// D53 — inclined planes: the slope vanishing point, and the roof built on it.
//
// A sloping edge belongs to no axis and is not free either. A set of parallel
// slopes has its own vanishing point, and that point sits on the VERTICAL LINE
// through the point its horizontal projection runs to. That single fact is what
// makes a roof drawable, and it is what these tests pin.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, setEyeLevel, solveScene, moveVp,
  addSlopePoint, axisPointCount, deleteVp,
} from "../public/app/solver.mjs";
import { buildBox, buildRoof } from "../public/app/snap.mjs";

function house({ pitch = 0.5 } = {}) {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  const l = addVp(scene, { label: "VP1", x: -600, y: 540, axis: "x", onHorizon: true }).vp;
  const r = addVp(scene, { label: "VP2", x: 2200, y: 540, axis: "y", onHorizon: true }).vp;
  const box = buildBox(scene, { at: { x: 800, y: 900 }, height: 220, depthL: 260, depthR: 260 });
  const roof = buildRoof(scene, { corners: box.corners, pitch });
  return { scene, l, r, box, roof };
}

test("a slope point sits on the vertical through the point it hangs from", () => {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  const parent = addVp(scene, { label: "VP1", x: 900, y: 500, onHorizon: true }).vp;
  const res = addSlopePoint(scene, { vpId: parent.id, rise: -300 });
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.vp.x, parent.x, "a slope point must share its parent's x");
  assert.equal(res.vp.y, parent.y - 300);
});

test("and it FOLLOWS its parent, because a roof turns with the walls", () => {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  const parent = addVp(scene, { label: "VP1", x: 900, y: 500, onHorizon: true }).vp;
  const slope = addSlopePoint(scene, { vpId: parent.id, rise: -300 }).vp;
  moveVp(scene, parent.id, { x: 200, y: 700 });
  assert.equal(slope.x, 200, "the slope point did not follow in x");
  assert.equal(slope.y, 400, "nor in y");
});

test("a slope point does not count against the three-axis limit", () => {
  // D41 caps AXES at three because a fourth has nothing to bind to. A slope is
  // the same axis tilted, and things bind to it, so it is not one of the three.
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  const a = addVp(scene, { label: "VP1", x: 100, y: 500, onHorizon: true }).vp;
  addVp(scene, { label: "VP2", x: 1500, y: 500, onHorizon: true });
  assert.equal(axisPointCount(scene), 2);
  addSlopePoint(scene, { vpId: a.id, rise: -400 });
  addSlopePoint(scene, { vpId: a.id, rise: 400 });
  assert.equal(scene.vanishingPoints.length, 4);
  assert.equal(axisPointCount(scene), 2, "slope points were counted as axes");
});

test("a rise of zero is refused — that is not a slope, it is the floor", () => {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  const parent = addVp(scene, { label: "VP1", x: 900, y: 500 }).vp;
  for (const rise of [0, Number.NaN, undefined]) {
    const res = addSlopePoint(scene, { vpId: parent.id, rise });
    assert.equal(res.ok, false, `rise ${rise} was accepted`);
  }
  assert.equal(scene.vanishingPoints.length, 1);
});

test("a roof puts its ridge over the middle of the box, in PERSPECTIVE", () => {
  const { roof, box } = house();
  assert.equal(roof.ok, true, roof.reason);
  const { nearTop, rightTop } = box.corners;
  // The perspective midpoint of a receding edge is NOT the average of its ends:
  // the near half takes more of the page. The peak must sit past the average,
  // toward the near end's side of centre.
  const average = (nearTop.x + rightTop.x) / 2;
  assert.ok(roof.midNear.x > average + 1,
    `the gable middle landed at ${roof.midNear.x.toFixed(1)}, the naive average is ${average.toFixed(1)}`);
  assert.ok(roof.midNear.x < rightTop.x, "and it is still on the edge it divides");
});

test("both peaks are the same height above their own gable middles", () => {
  const { roof } = house();
  const nearRise = roof.midNear.y - roof.peakNear.y;
  const farRise = roof.midFar.y - roof.peakFar.y;
  assert.ok(nearRise > 0 && farRise > 0, "a gable peak must be above its middle");
  // The far one is further away, so it is SHORTER on the page. That is the
  // perspective doing its job, and it is why the far peak is an intersect rather
  // than a measured height.
  assert.ok(farRise < nearRise, `far rise ${farRise.toFixed(1)} is not less than near ${nearRise.toFixed(1)}`);
});

test("the ridge runs to the same point the eaves below it run to", () => {
  const { scene, roof, box } = house();
  const axis = box.corners.leftBottom.binding;
  const vp = scene.vanishingPoints.find(v => v.id === axis.vpId);
  const dx = roof.peakFar.x - roof.peakNear.x, dy = roof.peakFar.y - roof.peakNear.y;
  const ex = vp.x - roof.peakNear.x, ey = vp.y - roof.peakNear.y;
  const cross = Math.abs(dx * ey - dy * ex) / (Math.hypot(dx, dy) * Math.hypot(ex, ey));
  assert.ok(cross < 1e-9, `the ridge is off its axis by ${cross}`);
});

test("the two roof planes get slope points ABOVE and BELOW the same axis point", () => {
  const { scene, roof, r } = house();
  const [up, down] = roof.slopes;
  assert.ok(up && down, "a gable needs both slopes");
  assert.equal(up.x, r.x);
  assert.equal(down.x, r.x);
  assert.ok(up.y < r.y, "the climbing plane's point must be above the axis point");
  assert.ok(down.y > r.y, "and the falling plane's below it");
  assert.equal(axisPointCount(scene), 2, "the roof added axes it should not have");
});

test("a steeper pitch raises the ridge and moves both slope points further out", () => {
  const shallow = house({ pitch: 0.25 });
  const steep = house({ pitch: 1 });
  const rise = h => h.roof.midNear.y - h.roof.peakNear.y;
  assert.ok(rise(steep) > rise(shallow) * 2, "pitch did not raise the ridge");
  const spread = h => Math.abs(h.roof.slopes[0].y - h.roof.slopes[1].y);
  assert.ok(spread(steep) > spread(shallow), "a steeper roof did not push its slope points further apart");
});

test("the whole house survives its vanishing points being dragged about", () => {
  const { scene, l, r } = house();
  for (const p of [{ x: -1400, y: 300 }, { x: 300, y: 900 }, { x: -200, y: 540 }]) {
    moveVp(scene, l.id, p);
    assert.ok(scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)),
      `a corner went non-finite with VP1 at ${JSON.stringify(p)}`);
  }
  moveVp(scene, r.id, { x: 1400, y: 300 });
  assert.ok(scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)));
  // and the slope points are still hanging off the point they belong to
  for (const vp of scene.vanishingPoints.filter(v => v.trace)) {
    const parent = scene.vanishingPoints.find(v => v.id === vp.trace.vpId);
    assert.equal(vp.x, parent.x, "a slope point came off its parent's vertical");
  }
});

test("deleting the point a slope hangs from leaves the slope where it is", () => {
  // D17's rule: deleting a guide must never move the drawing. A slope point that
  // loses its parent stops following, and stops nothing else.
  const { scene, r, roof } = house();
  const slope = roof.slopes[0];
  const before = { x: slope.x, y: slope.y };
  deleteVp(scene, r.id);
  assert.ok(Math.abs(slope.x - before.x) < 1e-9 && Math.abs(slope.y - before.y) < 1e-9,
    "the slope point moved when its parent was deleted");
  assert.ok(scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)));
});

// D60 — the gable midpoint holds a FRACTION of its edge, not a length.
//
// Noah, 2026-08-01, with two screenshots of a house pulled into a crossed
// tangle. Push a box through a vanishing point and a depth goes negative (D39):
// the gable edge flips to the other side of its origin. A midpoint that stored a
// LENGTH stayed behind on the old side, which put the ridge outside the building
// and made both roof planes self-intersecting quads. This is D52's lesson, which
// the room got right and the roof — written later — did not.

// Is a quad's perimeter simple, or does it cross itself?
function bowtie(pts) {
  const side = (o, a, b) => Math.sign((a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x));
  const hits = (p, q, r, t) => side(p, q, r) !== side(p, q, t) && side(r, t, p) !== side(r, t, q);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (hits(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}
const between = (m, a, b) => (m >= Math.min(a, b) - 1e-6) && (m <= Math.max(a, b) + 1e-6);

test("the gable middle stays ON its gable when a depth inverts", () => {
  const { scene, box, roof } = house();
  const { nearTop, rightTop, leftTop, backTop, rightBottom } = box.corners;
  assert.ok(between(roof.midNear.x, nearTop.x, rightTop.x), "it did not start on its own edge");
  rightBottom.t = -rightBottom.t;                 // push the box through, as D39 allows
  solveScene(scene);
  assert.ok(between(roof.midNear.x, nearTop.x, rightTop.x),
    `the near gable runs ${nearTop.x.toFixed(0)}..${rightTop.x.toFixed(0)} and its middle is at ${roof.midNear.x.toFixed(0)}`);
  assert.ok(between(roof.midFar.x, leftTop.x, backTop.x),
    `the far gable runs ${leftTop.x.toFixed(0)}..${backTop.x.toFixed(0)} and its middle is at ${roof.midFar.x.toFixed(0)}`);
});

// The visible symptom — a roof plane crossing itself — is asserted in walk.mjs,
// against the sequence that actually produced it on Noah's device. A unit fixture
// was tried here first and dropped: it holds the midpoint off its own gable, which
// the test above catches, but its numbers never fold into a bowtie, so the check
// passed against all three planted faults. A check that cannot fail is worse than
// no check, because it reads like proof.
test("the middle is RE-DERIVED, not remembered: move the far corner and it follows", () => {
  const { scene, box, roof } = house();
  const before = roof.midNear.x;
  box.corners.rightBottom.t *= 2;                 // stretch the gable out
  solveScene(scene);
  assert.ok(Math.abs(roof.midNear.x - before) > 20,
    `the gable doubled and its middle moved ${Math.abs(roof.midNear.x - before).toFixed(1)}px`);
  assert.ok(between(roof.midNear.x, box.corners.nearTop.x, box.corners.rightTop.x));
});

test("a divider depends on the corner it divides, so it is never solved from stale ends", () => {
  // The arithmetic was right the whole time; it was being fed yesterday's edge,
  // because the only declared dependency was the midpoint's own origin.
  const { scene, box, roof } = house();
  const order = scene.vertices.map(v => v.id);
  const i = order.indexOf(roof.midNear.id), j = order.indexOf(box.corners.rightTop.id);
  assert.ok(i >= 0 && j >= 0);
  assert.equal(roof.midNear.divide.ofId, box.corners.rightTop.id,
    "the near gable's middle does not know which corner it divides");
  // One solve is enough — no second pass to settle.
  box.corners.rightBottom.t = -box.corners.rightBottom.t;
  solveScene(scene);
  const once = roof.midNear.x;
  solveScene(scene);
  assert.ok(Math.abs(roof.midNear.x - once) < 1e-9,
    "a second solve moved it, so the first one used stale input");
});

test("a roof refuses a box that is not there", () => {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  assert.equal(buildRoof(scene, {}).ok, false);
  assert.equal(buildRoof(scene, { corners: {} }).ok, false);
  assert.equal(scene.vertices.length, 0);
});
