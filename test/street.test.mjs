// D61 — the street. Buildings down both sides, crossroads, alleys behind.
//
// The claims worth pinning are the three this is assembled from, because each is
// a fact about perspective rather than about the code: crossroads stay HORIZONTAL
// wherever the point goes, blocks crowd toward the point without reaching it, and
// equal storeys come out correctly foreshortened at every depth because they are
// measured to the horizon rather than laid out in pixels.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, setEyeLevel, solveScene, moveVp,
  buildStreet, horizonLine, clearDrawing,
} from "../public/app/solver.mjs";

function facing() {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  const vp = addVp(scene, { label: "VP1", x: 800, y: 540, axis: "z", onHorizon: true }).vp;
  return { scene, vp };
}
const street = (scene, vp, o = {}) =>
  buildStreet(scene, { vpId: vp.id, at: { x: 800, y: 1050 }, blocks: 4, ...o });

test("a street is four rails and a crossroad at every block", () => {
  const { scene, vp } = facing();
  const s = street(scene, vp);
  assert.equal(s.ok, true, s.reason);
  assert.equal(s.rails.length, 4, "kerb, kerb, and the alley behind each block");
  assert.equal(s.fracs.length, 4);
  for (const r of s.rails) assert.equal(r.length, 5, "a foot on the near line and one point per block");
  assert.ok(s.plots.length === 8, `two sides times four blocks, got ${s.plots.length}`);
});

test("every crossroad is HORIZONTAL, and stays horizontal wherever the point goes", () => {
  // This is the reason the rails hold a fraction rather than a length: all four
  // reach the same height at the same fraction, so the line across them is level.
  const { scene, vp } = facing();
  const s = street(scene, vp);
  const level = j => {
    const ys = s.rails.map(r => r[j].y);
    return Math.max(...ys) - Math.min(...ys);
  };
  for (const p of [{ x: 800, y: 540 }, { x: 300, y: 300 }, { x: 1500, y: 900 }, { x: 60, y: 1100 }]) {
    moveVp(scene, vp.id, p);
    for (let j = 0; j <= s.fracs.length; j++) {
      assert.ok(level(j) < 1e-6, `crossroad ${j} tilted by ${level(j).toFixed(3)}px with the point at ${JSON.stringify(p)}`);
    }
  }
});

test("blocks crowd toward the point and never reach it", () => {
  const { scene, vp } = facing();
  const s = street(scene, vp, { blocks: 8 });
  const kerb = s.rails[1];
  const ys = kerb.map(v => v.y);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] < ys[i - 1], `block ${i} did not recede`);
  // Strictly shorter, by a real margin. `far < near + 1e-9` was the first version
  // and it admits far === near — which is exactly what naive fractions give,
  // because a fraction of the way to the point is LINEAR in page height. That
  // tolerance let a plant replacing the interval formula with `first * j` pass
  // every test in this file. Crowding is the claim; equal spacing must fail it.
  for (let i = 2; i < ys.length; i++) {
    const near = ys[i - 2] - ys[i - 1], far = ys[i - 1] - ys[i];
    assert.ok(far < near * 0.97, `block ${i} spans ${far.toFixed(1)}px against ${near.toFixed(1)}px — that is not foreshortening`);
  }
  assert.ok(ys[ys.length - 1] > vp.y, "a block reached or passed the vanishing point");
  assert.ok(s.fracs.every(f => f > 0 && f < 1));
  // And the fractions themselves are sublinear: equal steps in the WORLD, so the
  // gaps between them close as they go.
  for (let i = 1; i < s.fracs.length; i++) {
    assert.ok(s.fracs[i] < s.fracs[0] * (i + 1) * 0.99,
      `fraction ${i + 1} is ${s.fracs[i].toFixed(4)}, which is linear growth, not perspective`);
  }
});

test("equal storeys shrink with distance, because they are measured to the horizon", () => {
  const { scene, vp } = facing();
  const s = street(scene, vp, { storeys: [3] });
  assert.ok(s.buildings.length >= 4);
  const sameSide = s.buildings.filter(b => b.side === "left");
  // SIGNED, and asserted upward first. Math.abs here hid a gauge sign error that
  // built the entire city downward into the ground: every ratio still came out
  // exactly right, because a wall of the correct length pointing the wrong way is
  // the correct length. The screenshot caught what the suite could not.
  const h = b => b.base[0].y - b.top[0].y;
  for (const b of s.buildings) {
    assert.ok(h(b) > 0, `a building was drawn downward: base ${b.base[0].y.toFixed(0)}, top ${b.top[0].y.toFixed(0)}`);
    assert.ok(b.top[0].y < b.base[0].y, "a roof must be above its own ground floor");
  }
  for (let i = 1; i < sameSide.length; i++) {
    assert.ok(h(sameSide[i]) < h(sameSide[i - 1]),
      `block ${i} is not shorter on the page: ${h(sameSide[i - 1]).toFixed(1)} then ${h(sameSide[i]).toFixed(1)}`);
  }
  // and every one of them is the SAME building — three times eye height.
  const hz = horizonLine(scene)?.a.y ?? scene.eyeLevel.y;
  for (const b of sameSide) {
    const eye = b.base[0].y - hz;
    assert.ok(Math.abs(h(b) / eye - 3) < 1e-6, `a three-storey block came out ${(h(b) / eye).toFixed(3)}x eye height`);
  }
});

test("a taller building is taller at the same depth, in proportion", () => {
  const { scene, vp } = facing();
  const s = street(scene, vp, { storeys: [2, 6] });
  const h = b => b.base[0].y - b.top[0].y;
  const two = s.buildings.find(b => b.storeys === 2);
  const six = s.buildings.find(b => b.storeys === 6);
  assert.ok(two && six);
  // Different plots, so compare each against its own eye-height span.
  const hz = horizonLine(scene)?.a.y ?? scene.eyeLevel.y;
  assert.ok(Math.abs(h(two) / (two.base[0].y - hz) - 2) < 1e-6);
  assert.ok(Math.abs(h(six) / (six.base[0].y - hz) - 6) < 1e-6);
});

test("a zero storey leaves the plot empty — that is how the alleys get there", () => {
  const { scene, vp } = facing();
  const s = street(scene, vp, { blocks: 4, storeys: [3, 0, 4, 2] });
  assert.equal(s.buildings.length, 6, "two of the eight plots should have been left open");
  assert.ok(s.buildings.every(b => b.storeys > 0));
});

test("the whole city re-measures when the horizon moves", () => {
  // A one-point scene has no DERIVED horizon — D36 needs two points on it — so
  // the gauge falls back to the authored eye level, and moving the single point
  // is correctly not the same thing as changing where you are standing. Raising
  // eye level is what moving the horizon means here, and the first version of
  // this test asserted the wrong one and failed honestly.
  const { scene, vp } = facing();
  const s = street(scene, vp, { storeys: [3] });
  const b = s.buildings[0];
  const before = b.base[0].y - b.top[0].y;
  assert.equal(horizonLine(scene), null, "this scene has one point, so it has no horizon of its own");
  setEyeLevel(scene, 300);                           // stand higher up
  solveScene(scene);
  const after = b.base[0].y - b.top[0].y;
  assert.ok(after > before + 10, `the buildings did not re-measure: ${before.toFixed(1)} -> ${after.toFixed(1)}`);
  assert.ok(Math.abs(after / (b.base[0].y - scene.eyeLevel.y) - 3) < 1e-6, "and it is still three storeys");
});

test("a street survives its vanishing point being dragged all over", () => {
  const { scene, vp } = facing();
  const s = street(scene, vp, { storeys: [3, 5, 2] });
  for (const p of [{ x: 20, y: 20 }, { x: 1580, y: 1180 }, { x: 800, y: 1049 }, { x: 800, y: 540 }]) {
    moveVp(scene, vp.id, p);
    assert.ok(scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)),
      `something went non-finite with the point at ${JSON.stringify(p)}`);
  }
  void s;
});

test("it refuses a point off to the side, because that road runs past you", () => {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  const vp = addVp(scene, { label: "VP1", x: -900, y: 540, onHorizon: true }).vp;
  const s = buildStreet(scene, { vpId: vp.id, at: { x: 800, y: 1050 } });
  assert.equal(s.ok, false);
  assert.match(s.reason, /runs away from where you stand/);
  assert.equal(scene.vertices.length, 0, "a refusal must not leave half a street behind");
});

test("it refuses nonsense rather than drawing it", () => {
  const { scene, vp } = facing();
  for (const bad of [
    { at: { x: Number.NaN, y: 1050 } },
    { at: { x: 800, y: 1050 }, width: 0 },
    { at: { x: 800, y: 1050 }, block: 0 },
    { at: { x: 800, y: 1050 }, first: 0 },
    { at: { x: 800, y: 1050 }, first: 0.9 },
  ]) {
    clearDrawing(scene);
    const s = buildStreet(scene, { vpId: vp.id, ...bad });
    assert.equal(s.ok, false, `${JSON.stringify(bad)} was accepted`);
    assert.equal(scene.vertices.length, 0);
  }
});
