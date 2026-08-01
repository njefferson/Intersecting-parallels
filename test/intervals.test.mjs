// D50 — equal intervals in depth. The artist's most-reached-for construction,
// and the thing every "generator" would otherwise have had to guess.
//
// The claim under test is not "it looks about right". It is that the marks are
// EXACTLY where the diagonal construction would put them, which is a statement
// about cross-ratios and can be checked against a real projection.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, addAnchor, addRayVertex, setEyeLevel, solveScene,
  markIntervals, depthAtInterval, moveVp,
} from "../public/app/solver.mjs";

function sceneWithGuide({ t = 200 } = {}) {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  const vp = addVp(scene, { label: "VP1", x: 2200, y: 540, axis: "x", onHorizon: true }).vp;
  const o = addAnchor(scene, { x: 200, y: 900 }).vertex;
  const v = addRayVertex(scene, { origin: o.id, binding: { vpId: vp.id }, t }).vertex;
  solveScene(scene);
  return { scene, vp, o, v };
}

// A real one-dimensional projection, to check the formula against something
// derived independently: world distance d maps to screen t = D*d/(d+k).
function project(D, k, d) { return (D * d) / (d + k); }

test("the interval formula matches a real projection, not an approximation", () => {
  const D = 1000, k = 340;          // any camera constant
  const t1 = project(D, k, 1);      // the first interval is one world unit
  for (const n of [2, 3, 4, 7, 12]) {
    const expected = project(D, k, n);
    const got = depthAtInterval(D, t1, n);
    assert.ok(Math.abs(got - expected) < 1e-9,
      `${n} intervals out: got ${got}, a real projection gives ${expected}`);
  }
  // and the same for subdivision
  for (const f of [0.25, 0.5, 0.75]) {
    const expected = project(D, k, f);
    const got = depthAtInterval(D, t1, f);
    assert.ok(Math.abs(got - expected) < 1e-9, `at ${f} of an interval`);
  }
});

test("marks crowd toward the vanishing point and never reach it", () => {
  const D = 1000, t1 = 300;
  let last = 0;
  for (let n = 1; n <= 200; n++) {
    const t = depthAtInterval(D, t1, n);
    assert.ok(t > last, `interval ${n} did not recede further than ${n - 1}`);
    assert.ok(t < D, `interval ${n} reached or passed the vanishing point`);
    // each step is smaller than the one before — that IS foreshortening
    if (n > 2) {
      const prev = depthAtInterval(D, t1, n - 1);
      const prev2 = depthAtInterval(D, t1, n - 2);
      assert.ok((t - prev) < (prev - prev2) + 1e-9, `step ${n} was not shorter than step ${n - 1}`);
    }
    last = t;
  }
});

test("the endpoints are exact: f=1 is where you started, f=0 is the origin", () => {
  assert.equal(depthAtInterval(1000, 250, 1), 250);
  assert.equal(depthAtInterval(1000, 250, 0), 0);
});

test("Repeat lays marks along the same guide, held by the same origin", () => {
  const { scene, v, o } = sceneWithGuide({ t: 200 });
  const before = scene.vertices.length;
  const res = markIntervals(scene, v.id, { times: 4 });
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.made.length, 3, "four intervals means three new marks");
  assert.equal(scene.vertices.length, before + 3);
  for (const id of res.made) {
    const m = scene.vertices.find(x => x.id === id);
    assert.equal(m.kind, "ray");
    assert.equal(m.origin, o.id, "a mark must hang off the same origin");
    assert.deepEqual(m.binding, v.binding, "and ride the same guide");
    assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y));
  }
  const ts = res.made.map(id => scene.vertices.find(x => x.id === id).t);
  assert.deepEqual([...ts].sort((a, b) => a - b), ts, "the marks are not in order");
  assert.ok(ts[0] > v.t, "the first repeat is not further away than the original");
});

test("Divide puts N-1 marks between the origin and the corner", () => {
  const { scene, v } = sceneWithGuide({ t: 400 });
  const res = markIntervals(scene, v.id, { parts: 4 });
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.made.length, 3);
  const ts = res.made.map(id => scene.vertices.find(x => x.id === id).t);
  for (const t of ts) {
    assert.ok(t > 0 && t < v.t, `a division landed outside the interval at ${t}`);
  }
  // Nearer divisions are further apart on the page than distant ones.
  const gaps = [ts[0] - 0, ts[1] - ts[0], ts[2] - ts[1], v.t - ts[2]];
  for (let i = 1; i < gaps.length; i++) {
    assert.ok(gaps[i] < gaps[i - 1] + 1e-9, `gap ${i} is not smaller than gap ${i - 1}`);
  }
});

test("the marks are HELD: move the vanishing point and they all follow", () => {
  const { scene, vp, v } = sceneWithGuide({ t: 200 });
  const res = markIntervals(scene, v.id, { times: 4 });
  const marks = res.made.map(id => scene.vertices.find(x => x.id === id));
  const before = marks.map(m => ({ x: m.x, y: m.y }));
  moveVp(scene, vp.id, { x: 1800, y: 300 });
  const moved = marks.every((m, i) => Math.hypot(m.x - before[i].x, m.y - before[i].y) > 1);
  assert.ok(moved, "the marks did not move with their vanishing point");
  // and they still sit on the line from the origin to the point
  const o = scene.vertices.find(x => x.id === v.origin);
  for (const m of marks) {
    const cross = (m.x - o.x) * (vp.y - o.y) - (m.y - o.y) * (vp.x - o.x);
    const scale = Math.hypot(vp.x - o.x, vp.y - o.y) * Math.hypot(m.x - o.x, m.y - o.y);
    assert.ok(Math.abs(cross) / (scale || 1) < 1e-9, "a mark drifted off its guide");
  }
});

test("it refuses a corner that has no vanishing point to run toward", () => {
  const scene = createScene({ name: "t", width: 1000, height: 800 });
  const o = addAnchor(scene, { x: 100, y: 100 }).vertex;
  const up = addRayVertex(scene, { origin: o.id, binding: "vertical", t: 100 }).vertex;
  solveScene(scene);
  const res = markIntervals(scene, up.id, { times: 3 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /vanishing point/);
  assert.equal(scene.vertices.length, 2, "a refusal must not leave half a run of marks");
});

test("it refuses a corner sitting on its own origin, and says why", () => {
  const { scene, v } = sceneWithGuide({ t: 200 });
  v.t = 0;
  solveScene(scene);
  const res = markIntervals(scene, v.id, { times: 4 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /own origin/);
});

test("marks that would land past the vanishing point are dropped, not faked", () => {
  // A first interval most of the way to the point: two intervals out is already
  // past it, which is beyond what the construction can express.
  const { scene, v } = sceneWithGuide({ t: 1900 });     // VP is 2000 away
  const res = markIntervals(scene, v.id, { times: 6 });
  if (res.ok) {
    for (const id of res.made) {
      const m = scene.vertices.find(x => x.id === id);
      assert.ok(Math.abs(m.t) < 2000, `a mark landed at ${m.t}, at or past the point`);
      assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y));
    }
    assert.ok(res.made.length < res.asked, "nothing was dropped when it should have been");
  } else {
    assert.match(res.reason, /past the vanishing point/);
  }
});

test("a non-finite ask returns null rather than poisoning a scene", () => {
  assert.equal(depthAtInterval(Number.NaN, 100, 2), null);
  assert.equal(depthAtInterval(1000, Number.NaN, 2), null);
  assert.equal(depthAtInterval(1000, 100, Number.NaN), null);
  assert.equal(depthAtInterval(1000, -1000, 2), null, "a mark exactly at the point has no answer");
});
