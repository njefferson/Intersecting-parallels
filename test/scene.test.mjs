// The artwork's geometry, pinned. These are cheap and they guard the one claim
// the pictures make: that a line drawn as running to a vanishing point really
// does run to it, and that a family of such lines is not secretly parallel.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cameraFrom, project, originAt, at, buildScene, verify, missDistance, clipNear,
} from "../art/scene.mjs";

const ICON = { A: { x: 68, y: 168 }, B: { x: 950, y: 168 }, C: { x: 512, y: 940 } };

test("three vanishing points give an orthogonal basis and a real focal length", () => {
  const cam = cameraFrom(ICON.A, ICON.B, ICON.C);
  assert.ok(cam.f > 0, "focal length must be positive");
  assert.ok(cam.orthogonality < 1e-9, `basis not orthogonal: ${cam.orthogonality}`);
  // The principal point is the orthocentre, which for a horizontal AB lies on
  // the vertical through C.
  assert.ok(Math.abs(cam.P.x - ICON.C.x) < 1e-6);
});

test("each axis direction projects back to the vanishing point it came from", () => {
  const cam = cameraFrom(ICON.A, ICON.B, ICON.C);
  // A point very far along an axis lands arbitrarily close to that axis's VP.
  for (const [name, e, vp] of [["A", cam.eA, ICON.A], ["B", cam.eB, ICON.B], ["C", cam.eC, ICON.C]]) {
    const far = { x: e.x * 1e7, y: e.y * 1e7, z: e.z * 1e7 };
    const s = project(cam, far);
    assert.ok(Math.hypot(s.x - vp.x, s.y - vp.y) < 1e-3, `axis ${name} missed its VP`);
  }
});

test("an impossible vanishing-point triple is refused, with the way out named", () => {
  // Noah's wide layout: horizon points 1076px apart, third point only 502px out.
  assert.throws(
    () => cameraFrom({ x: 62, y: 90 }, { x: 1138, y: 90 }, { x: 600, y: 592 }),
    err => /needs d > s/.test(err.message) && /closer together/.test(err.message),
  );
});

test("collinear vanishing points are refused", () => {
  assert.throws(
    () => cameraFrom({ x: 0, y: 100 }, { x: 500, y: 100 }, { x: 900, y: 100 }),
    /collinear/,
  );
});

test("every drawn line runs to the vanishing point it is tagged with", () => {
  const cam = cameraFrom(ICON.A, ICON.B, ICON.C);
  const O = originAt(cam, { x: 512, y: 372 }, 118);
  const scene = buildScene(cam, O, { vps: ICON, gridA: [-2.5, 3.5], gridB: [-2.5, 3.5], step: 0.5 });
  const checks = verify(scene);
  for (const [name, c] of Object.entries(checks)) {
    assert.ok(c.count > 0, `no lines tagged ${name}`);
    assert.ok(c.worstMiss < 0.01, `VP ${name}: worst miss ${c.worstMiss}px`);
  }
});

test("the vertical family converges — it is not merely parallel", () => {
  // This is the defect being fixed: the previous artwork drew a third vanishing
  // point and then drew every vertical edge parallel, so the point was
  // decoration. Parallel lines all miss a distant point by very little, so the
  // miss check alone cannot catch it; the family's angular spread can.
  const cam = cameraFrom(ICON.A, ICON.B, ICON.C);
  const O = originAt(cam, { x: 512, y: 372 }, 118);
  const scene = buildScene(cam, O, { vps: ICON, gridA: [-2, 3], gridB: [-2, 3], step: 0.5 });
  const spread = verify(scene).C.spreadDeg;
  assert.ok(spread > 5, `vertical family spread only ${spread.toFixed(2)}° — suspiciously parallel`);
});

test("a line's own supporting line is what verifies, so clipping cannot break it", () => {
  const cam = cameraFrom(ICON.A, ICON.B, ICON.C);
  const O = originAt(cam, { x: 512, y: 372 }, 118);
  const p = at(cam, O, -6, 0, 0), q = at(cam, O, 6, 0, 0);
  const seg = clipNear(p, q, 0.3 * O.z);
  assert.ok(seg, "a segment straddling the near plane must be trimmed, not dropped");
  assert.ok(seg[0].z >= 0.3 * O.z - 1e-9 && seg[1].z >= 0.3 * O.z - 1e-9);
  // Trimmed, it still lies on the same line, so it still points at the same VP.
  assert.ok(missDistance(ICON.A, project(cam, seg[0]), project(cam, seg[1])) < 0.01);
});

test("clipNear drops a segment entirely behind the near plane", () => {
  assert.equal(clipNear({ x: 0, y: 0, z: 0.1 }, { x: 1, y: 1, z: 0.2 }, 1), null);
});
