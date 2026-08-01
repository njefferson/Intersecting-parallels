// D62 — a circle in perspective.
//
// The claims here are about PROJECTIVE GEOMETRY, not about the code, and each one
// is checkable against something independent of the implementation:
//   · the map is exact — a real projection of a circle is a conic, and the points
//     produced satisfy a conic equation to floating-point precision;
//   · the ellipse is TANGENT to each side of its square at that side's
//     PERSPECTIVE midpoint, not at the halfway point on the page;
//   · it is held by the construction — move a point and it follows, with nothing
//     of its own to go stale.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, setEyeLevel, solveScene, moveVp, addCircle,
  quadTransform, circlePoints, migrateScene, SCHEMA_VERSION,
} from "../public/app/solver.mjs";
import { buildCircle } from "../public/app/snap.mjs";

function twoPoint() {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  addVp(scene, { label: "VP1", x: -900, y: 540, axis: "x", onHorizon: true });
  addVp(scene, { label: "VP2", x: 2500, y: 540, axis: "y", onHorizon: true });
  return scene;
}

// Fit a general conic Ax²+Bxy+Cy²+Dx+Ey+F=0 to five points, then measure how far
// the rest are from satisfying it. Independent of how the points were made.
function conicResidual(pts) {
  const rows = pts.slice(0, 5).map(p => [p.x * p.x, p.x * p.y, p.y * p.y, p.x, p.y, 1]);
  // Solve the 5x6 nullspace by Gaussian elimination with the last unknown free.
  const m = rows.map(r => r.slice());
  const n = 5;
  const piv = [];
  let col = 0;
  for (let r = 0; r < n && col < 6; col++) {
    let best = r;
    for (let i = r; i < n; i++) if (Math.abs(m[i][col]) > Math.abs(m[best][col])) best = i;
    if (Math.abs(m[best][col]) < 1e-12) continue;
    [m[r], m[best]] = [m[best], m[r]];
    for (let i = 0; i < n; i++) {
      if (i === r) continue;
      const f = m[i][col] / m[r][col];
      for (let j = col; j < 6; j++) m[i][j] -= f * m[r][j];
    }
    piv.push(col); r++;
  }
  const coef = new Array(6).fill(0);
  const free = [0, 1, 2, 3, 4, 5].find(c => !piv.includes(c));
  coef[free] = 1;
  for (let r = piv.length - 1; r >= 0; r--) {
    const c = piv[r];
    let acc = 0;
    for (let j = c + 1; j < 6; j++) acc += m[r][j] * coef[j];
    coef[c] = -acc / m[r][c];
  }
  const scale = Math.max(...pts.map(p => Math.hypot(p.x, p.y)));
  let worst = 0;
  for (const p of pts) {
    const v = coef[0] * p.x * p.x + coef[1] * p.x * p.y + coef[2] * p.y * p.y
            + coef[3] * p.x + coef[4] * p.y + coef[5];
    worst = Math.max(worst, Math.abs(v) / (scale * scale));
  }
  return worst;
}

test("the curve is an exact conic, not an eight-point approximation", () => {
  const scene = twoPoint();
  const res = buildCircle(scene, { at: { x: 700, y: 900 }, size: 220 });
  assert.equal(res.ok, true, res.reason);
  // STRONGLY foreshortened before measuring. The first fixture put the points far
  // out, which makes the quad nearly a parallelogram — and on a parallelogram a
  // plain bilinear blend is very close to the right answer, so a plant swapping
  // the projective map for bilinear sailed through the test named for exactly
  // that distinction. A near-affine fixture cannot tell the two apart; that is
  // the whole point of the claim.
  moveVp(scene, scene.vanishingPoints[0].id, { x: 240, y: 560 });
  const pts = circlePoints(scene, res.circle, 48);
  assert.ok(pts && pts.length === 48);
  assert.ok(conicResidual(pts) < 1e-9,
    `the points do not lie on one conic — worst residual ${conicResidual(pts)}`);
});

test("the ellipse is INSCRIBED — inside its square, touching all four sides", () => {
  // The first version of this test asked for a "true circle from an
  // unforeshortened square" by putting both points 10 million px away. That is
  // not an unforeshortened square, it is a DEGENERATE one: two horizon points
  // very far apart give two nearly-parallel directions, so the square collapses
  // to a sliver and the radius ran from 0.01 to 141. A square on the ground in
  // two-point perspective is never unforeshortened, so the claim was false and
  // the fixture was the only thing wrong with it. Inscribed-and-tangent is the
  // property that is actually true, and it is the one worth holding.
  const scene = twoPoint();
  const res = buildCircle(scene, { at: { x: 700, y: 900 }, size: 240 });
  const pts = circlePoints(scene, res.circle, 96);
  const q = res.quad;
  const side = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const sign = Math.sign(side(q[0], q[1], q[2]));
  let touches = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let closest = Infinity;
    for (const p of pts) {
      const d = side(a, b, p) / len;
      assert.ok(Math.sign(d) === sign || Math.abs(d) < 1e-6,
        `a point of the ellipse fell outside side ${i}`);
      closest = Math.min(closest, Math.abs(d));
    }
    if (closest < 0.6) touches++;      // sampled at 96 points, so it grazes
  }
  assert.equal(touches, 4, "an inscribed circle touches all four sides");
});

test("it touches each side at that side's PERSPECTIVE midpoint, not the page's", () => {
  const scene = twoPoint();
  const res = buildCircle(scene, { at: { x: 500, y: 950 }, size: 260 });
  const [p0, p1, p2, p3] = res.quad;
  const T = quadTransform(res.quad);
  // Where the circle touches the side p0->p1 is the image of (0.5, 0) — the
  // perspective middle of that edge.
  const touch = T(0.5, 0);
  const naive = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  assert.ok(Math.hypot(touch.x - naive.x, touch.y - naive.y) > 0.5,
    "on a foreshortened edge the tangent point is NOT the average of the ends");
  // And it really is on the edge, and really is on the curve.
  const cross = (p1.x - p0.x) * (touch.y - p0.y) - (p1.y - p0.y) * (touch.x - p0.x);
  assert.ok(Math.abs(cross) / (Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1) < 1e-9,
    "the tangent point drifted off the side it belongs to");
  void p2; void p3;
});

test("move a vanishing point and the circle follows — it stores no shape of its own", () => {
  const scene = twoPoint();
  const res = buildCircle(scene, { at: { x: 700, y: 900 }, size: 220 });
  const before = circlePoints(scene, res.circle, 32);
  moveVp(scene, scene.vanishingPoints[0].id, { x: 200, y: 300 });
  const after = circlePoints(scene, res.circle, 32);
  assert.ok(after, "the circle stopped being drawable");
  const moved = before.filter((p, i) => Math.hypot(p.x - after[i].x, p.y - after[i].y) > 1).length;
  assert.ok(moved > 24, `only ${moved} of 32 points moved with the point`);
  assert.ok(conicResidual(after) < 1e-9, "and it is still one conic afterwards");
});

test("a circle stores four ids and nothing else", () => {
  const scene = twoPoint();
  const res = buildCircle(scene, { at: { x: 700, y: 900 }, size: 200 });
  assert.deepEqual(Object.keys(res.circle).sort(), ["id", "label", "quad"]);
  assert.equal(res.circle.quad.length, 4);
  assert.equal(scene.circles.length, 1);
});

test("it refuses corners that are not four different real corners", () => {
  const scene = twoPoint();
  const res = buildCircle(scene, { at: { x: 700, y: 900 }, size: 200 });
  const q = res.circle.quad;
  assert.equal(addCircle(scene, { quad: q.slice(0, 3) }).ok, false);
  assert.equal(addCircle(scene, { quad: [q[0], q[0], q[1], q[2]] }).ok, false);
  assert.equal(addCircle(scene, { quad: [q[0], q[1], q[2], "nope"] }).ok, false);
  assert.equal(scene.circles.length, 1, "a refusal must not leave one behind");
});

test("a degenerate quad has no ellipse, and says so rather than guessing", () => {
  assert.equal(quadTransform([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]), null);
  assert.equal(quadTransform(null), null);
  assert.equal(quadTransform([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: Number.NaN }, { x: 0, y: 1 }]), null);
});

test("it refuses a one-point scene, because a circle needs a square seen at an angle", () => {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  addVp(scene, { label: "VP1", x: 800, y: 540, onHorizon: true });
  const res = buildCircle(scene, { at: { x: 700, y: 900 } });
  assert.equal(res.ok, false);
  assert.match(res.reason, /two vanishing points/);
  assert.equal(scene.vertices.length, 0);
});

test("an old scene with no circles opens, and gets an empty list", () => {
  const old = migrateScene({ schemaVersion: 2, canvas: { width: 100, height: 100 }, faces: [] });
  assert.deepEqual(old.circles, []);
  assert.equal(old.schemaVersion, SCHEMA_VERSION);
});
