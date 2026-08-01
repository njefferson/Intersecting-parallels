// D51 — the scale figure.
//
// Everyone's eye is at eye level, so the vertical from any point on the ground up
// to the horizon spans the observer's own eye height — already foreshortened by
// the perspective itself. The claim under test is that this stays true at every
// depth and keeps re-deriving itself, because a gauge that goes stale is worse
// than no gauge: it lies with authority.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, setEyeLevel, solveScene, moveVp,
  addFigure, gaugeSpan, horizonLine, moveAnchor,
} from "../public/app/solver.mjs";

function ground() {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 500);
  addVp(scene, { label: "VP1", x: -600, y: 500, axis: "x", onHorizon: true });
  addVp(scene, { label: "VP2", x: 2200, y: 500, axis: "y", onHorizon: true });
  return scene;
}

test("a figure your own height puts its eye exactly on the horizon", () => {
  const scene = ground();
  const res = addFigure(scene, { at: { x: 800, y: 1000 }, ratio: 1 });
  assert.equal(res.ok, true, res.reason);
  const hz = horizonLine(scene);
  // ratio 1 means the top of the measure IS eye height, so it lands on the line.
  assert.ok(Math.abs(res.head.y - hz.a.y) < 1e-6,
    `the head landed at ${res.head.y}, the horizon is at ${hz.a.y}`);
  assert.equal(res.feet.y, 1000, "and its feet stayed where they were put");
});

test("the same ratio at any depth gives the right height, without being told the depth", () => {
  const scene = ground();
  // Three figures at different distances: nearer means further below the horizon.
  const near = addFigure(scene, { at: { x: 700, y: 1100 }, ratio: 1 });
  const mid = addFigure(scene, { at: { x: 800, y: 800 }, ratio: 1 });
  const far = addFigure(scene, { at: { x: 900, y: 600 }, ratio: 1 });
  const h = r => Math.abs(r.head.y - r.feet.y);
  assert.ok(h(near) > h(mid) && h(mid) > h(far),
    `heights did not shrink with distance: ${h(near)}, ${h(mid)}, ${h(far)}`);
  // Each one's head is on the horizon — that is the whole trick.
  const hz = horizonLine(scene).a.y;
  for (const r of [near, mid, far]) {
    assert.ok(Math.abs(r.head.y - hz) < 1e-6, "a figure's eye left the horizon");
  }
});

test("a ratio measures anything of known height, not just a person", () => {
  const scene = ground();
  const person = addFigure(scene, { at: { x: 800, y: 1000 }, ratio: 1 });
  const lamp = addFigure(scene, { at: { x: 800, y: 1000 }, ratio: 2.6 });
  const h = r => Math.abs(r.head.y - r.feet.y);
  assert.ok(Math.abs(h(lamp) / h(person) - 2.6) < 1e-9,
    `a 2.6x measure came out ${(h(lamp) / h(person)).toFixed(3)}x`);
  assert.ok(lamp.head.y < scene.eyeLevel.y, "a lamp post should rise above the horizon");
});

test("a figure RE-MEASURES when the horizon moves — it is a ratio, not a length", () => {
  const scene = ground();
  const res = addFigure(scene, { at: { x: 800, y: 1000 }, ratio: 1 });
  const before = Math.abs(res.head.y - res.feet.y);
  // Raise the horizon by moving the points that define it.
  for (const vp of scene.vanishingPoints) vp.y = 300;
  solveScene(scene);
  const after = Math.abs(res.head.y - res.feet.y);
  assert.ok(after > before + 100, `the figure did not re-scale: ${before} -> ${after}`);
  const hz = horizonLine(scene);
  assert.ok(Math.abs(res.head.y - hz.a.y) < 1e-6, "and its eye is still on the horizon");
});

test("and when the figure itself is moved", () => {
  const scene = ground();
  const res = addFigure(scene, { at: { x: 800, y: 1100 }, ratio: 1 });
  const before = Math.abs(res.head.y - res.feet.y);
  moveAnchor(scene, res.feet.id, { x: 800, y: 700 });      // walk it further away
  const after = Math.abs(res.head.y - res.feet.y);
  assert.ok(after < before - 100, `walking it back did not shrink it: ${before} -> ${after}`);
  assert.ok(Math.abs(res.head.y - horizonLine(scene).a.y) < 1e-6);
});

test("a tilted horizon is measured at the figure's own x, not at some average", () => {
  const scene = ground();
  const [l, r] = scene.vanishingPoints;
  l.y = 300; r.y = 700;                                   // tilt it
  solveScene(scene);
  const hz = horizonLine(scene);
  for (const x of [400, 800, 1200]) {
    const span = gaugeSpan(scene, { x, y: 1000 });
    const yOnLine = hz.a.y + (x - hz.a.x) * (hz.u.y / hz.u.x);
    assert.ok(Math.abs(span - (yOnLine - 1000)) < 1e-6,
      `at x=${x} the span was measured against the wrong point on a tilted horizon`);
  }
});

test("with no horizon at all it falls back to the eye-level line", () => {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 500);
  addVp(scene, { label: "VP1", x: -600, y: 500, axis: "x", onHorizon: true });   // only one
  assert.equal(horizonLine(scene), null, "this scene has no horizon by D36");
  const res = addFigure(scene, { at: { x: 800, y: 1000 }, ratio: 1 });
  assert.equal(res.ok, true, res.reason);
  assert.ok(Math.abs(res.head.y - 500) < 1e-6, "it did not fall back to eye level");
});

test("standing ON the horizon is refused, because that is infinitely far away", () => {
  const scene = ground();
  const res = addFigure(scene, { at: { x: 800, y: 500 }, ratio: 1 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /infinitely far away/);
  assert.equal(scene.vertices.length, 0, "a refusal must not leave half a figure behind");
});

test("a nonsense height is refused rather than drawn", () => {
  const scene = ground();
  for (const ratio of [0, -2, Number.NaN, Infinity]) {
    const res = addFigure(scene, { at: { x: 800, y: 1000 }, ratio });
    assert.equal(res.ok, false, `ratio ${ratio} was accepted`);
  }
  assert.equal(scene.vertices.length, 0);
});

test("a figure survives a vanishing point being dragged around", () => {
  const scene = ground();
  const res = addFigure(scene, { at: { x: 800, y: 1000 }, ratio: 1 });
  for (const p of [{ x: -3000, y: 400 }, { x: 400, y: 900 }, { x: 5000, y: 100 }]) {
    moveVp(scene, scene.vanishingPoints[0].id, p);
    assert.ok(Number.isFinite(res.head.x) && Number.isFinite(res.head.y),
      `the figure went non-finite with a point at ${JSON.stringify(p)}`);
  }
});
