// D65 — a vanishing point made from two drawn lines, and BOUND to them.
//
// The ruling was BOUND rather than merely placed: move either line and the point
// follows. That makes it
// a derived thing like a slope point, and the claims worth pinning are the ones
// that stop a derived thing lying — that it re-derives, that it refuses the two
// cases it cannot answer, and that it never comes to depend on itself.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, addAnchor, addEdge, addRayVertex, setEyeLevel, solveScene,
  moveAnchor, addVpFromLines, linesCross, edgeLine, vpReach,
} from "../public/app/solver.mjs";

function twoLines({ ax = 200, ay = 900, bx = 900, by = 700, cx = 200, cy = 300, dx = 900, dy = 500 } = {}) {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 600);
  const p = (x, y) => addAnchor(scene, { x, y }).vertex;
  const a = p(ax, ay), b = p(bx, by), c = p(cx, cy), d = p(dx, dy);
  const e1 = addEdge(scene, { a: a.id, b: b.id }).edge;
  const e2 = addEdge(scene, { a: c.id, b: d.id }).edge;
  return { scene, a, b, c, d, e1, e2 };
}

test("two lines make a point where they cross", () => {
  const { scene, e1, e2 } = twoLines();
  const res = addVpFromLines(scene, { edgeA: e1.id, edgeB: e2.id });
  assert.equal(res.ok, true, res.reason);
  const L1 = edgeLine(scene, e1.id), L2 = edgeLine(scene, e2.id);
  const cross = linesCross(L1, L2);
  assert.ok(Math.abs(res.vp.x - cross.x) < 1e-9 && Math.abs(res.vp.y - cross.y) < 1e-9);
  // and it really is on both lines
  for (const L of [L1, L2]) {
    const d = (L.b.x - L.a.x) * (res.vp.y - L.a.y) - (L.b.y - L.a.y) * (res.vp.x - L.a.x);
    assert.ok(Math.abs(d) / Math.hypot(L.b.x - L.a.x, L.b.y - L.a.y) < 1e-9, "the point is off one of its lines");
  }
});

test("it is BOUND: move an end of either line and the point follows", () => {
  const { scene, e1, e2, b } = twoLines();
  const res = addVpFromLines(scene, { edgeA: e1.id, edgeB: e2.id });
  const before = { x: res.vp.x, y: res.vp.y };
  moveAnchor(scene, b.id, { x: 900, y: 850 });          // swing the first line
  assert.ok(Math.hypot(res.vp.x - before.x, res.vp.y - before.y) > 1,
    "the point did not follow the line it was made from");
  const L1 = edgeLine(scene, e1.id), L2 = edgeLine(scene, e2.id);
  const cross = linesCross(L1, L2);
  assert.ok(Math.abs(res.vp.x - cross.x) < 1e-6 && Math.abs(res.vp.y - cross.y) < 1e-6,
    "it followed, but not to where the lines actually cross now");
});

test("and corners bound to it move when the lines that define it move", () => {
  // The whole reason for "bound": the point is not the end of the chain.
  const { scene, e1, e2, b } = twoLines();
  const res = addVpFromLines(scene, { edgeA: e1.id, edgeB: e2.id });
  const o = addAnchor(scene, { x: 400, y: 1000 }).vertex;
  const r = addRayVertex(scene, { origin: o.id, binding: { vpId: res.vp.id }, t: 150 }).vertex;
  solveScene(scene);
  const was = { x: r.x, y: r.y };
  moveAnchor(scene, b.id, { x: 900, y: 1000 });
  assert.ok(Math.hypot(r.x - was.x, r.y - was.y) > 1,
    "a corner running to the point did not move when the point's own lines did");
});

test("NEARLY parallel is answered, not refused — it is a real point, just far", () => {
  // SETTLED 2026-08-02: refusing within a degree of parallel threw away answers the
  // app can perfectly well give. A degree of divergence over 700px crosses about
  // 36,000px away, and off-page points are the ordinary case here.
  const { scene, e1, e2 } = twoLines({ ay: 900, by: 899, cy: 300, dy: 300 });
  const res = addVpFromLines(scene, { edgeA: e1.id, edgeB: e2.id });
  assert.equal(res.ok, true, res.reason);
  assert.ok(Number.isFinite(res.vp.x) && Number.isFinite(res.vp.y));
  assert.ok(Math.hypot(res.vp.x - 550, res.vp.y - 900) > 5000, "a near-parallel pair should cross a long way off");
});

test("a crossing beyond the reach is PINNED to it, not left as a huge number", () => {
  // The half the first version of these tests missed: "far away" and "clamped"
  // are different claims, and a test asserting only distance passes against an
  // unclamped answer. A hair of divergence here crosses billions of pixels out.
  const { scene, e1, e2 } = twoLines({ ay: 900, by: 899.9999, cy: 300, dy: 300 });
  const res = addVpFromLines(scene, { edgeA: e1.id, edgeB: e2.id });
  assert.equal(res.ok, true, res.reason);
  const R = vpReach(scene);
  const away = Math.hypot(res.vp.x - 550, res.vp.y - 900);
  assert.ok(Math.abs(away - R) / R < 1e-6,
    `crossing landed ${away.toExponential(2)} out; the reach is ${R.toExponential(2)}`);
});

test("and just INSIDE the reach it is the true crossing, untouched", () => {
  // The clamp must not be doing anything to ordinary answers.
  const { scene, e1, e2 } = twoLines();
  const res = addVpFromLines(scene, { edgeA: e1.id, edgeB: e2.id });
  const exact = linesCross(edgeLine(scene, e1.id), edgeLine(scene, e2.id));
  assert.ok(Math.abs(res.vp.x - exact.x) < 1e-9 && Math.abs(res.vp.y - exact.y) < 1e-9);
  assert.ok(!exact.atReach, "an ordinary crossing should not be marked as pinned");
});

test("past parallel it comes back from the OTHER side, with no special case", () => {
  // Tilt one line through parallel and the crossing should swap ends rather than
  // break: the determinant changes sign and the arithmetic does the rest.
  const before = twoLines({ ay: 900, by: 880, cy: 300, dy: 300 }).scene;
  const a1 = addVpFromLines(before, { edgeA: before.edges[0].id, edgeB: before.edges[1].id });
  const after = twoLines({ ay: 900, by: 920, cy: 300, dy: 300 }).scene;
  const a2 = addVpFromLines(after, { edgeA: after.edges[0].id, edgeB: after.edges[1].id });
  assert.equal(a1.ok, true); assert.equal(a2.ok, true);
  assert.ok(Math.sign(a1.vp.x - 550) !== Math.sign(a2.vp.x - 550),
    "tilting through parallel did not move the crossing to the other side");
});

test("EXACTLY parallel gets a point at the reach, not an error", () => {
  // The only case left, and it gets an answer: a point far enough away that lines
  // drawn to it are within half a pixel of parallel across the whole page.
  const { scene, e1, e2 } = twoLines({ ay: 900, by: 900, cy: 300, dy: 300 });
  const res = addVpFromLines(scene, { edgeA: e1.id, edgeB: e2.id });
  assert.equal(res.ok, true, res.reason);
  const R = vpReach(scene);
  assert.ok(Math.abs(Math.hypot(res.vp.x - 550, res.vp.y - 900) - R) < 1e-6,
    "it should stand off at exactly the reach");
  // And it points ALONG the lines, which is the direction they are heading.
  assert.ok(Math.abs(res.vp.y - 900) < 1e-6, "two horizontal lines vanish horizontally");
});

test("the reach is derived from the page, and half a pixel is the criterion", () => {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  const L2 = 1600 * 1600 + 1200 * 1200;
  assert.equal(vpReach(scene), 2 * L2);
  // The claim behind the number: across the page diagonal, lines to a point that
  // far away land under half a pixel from where truly parallel lines would.
  const L = Math.sqrt(L2);
  assert.ok(L * L / vpReach(scene) <= 0.5);
});

test("it refuses to make a point out of one line, or out of a line that is gone", () => {
  const { scene, e1 } = twoLines();
  assert.equal(addVpFromLines(scene, { edgeA: e1.id, edgeB: e1.id }).ok, false);
  assert.equal(addVpFromLines(scene, { edgeA: e1.id, edgeB: "nope" }).ok, false);
  assert.equal(addVpFromLines(scene, {}).ok, false);
  assert.equal(scene.vanishingPoints.length, 0);
});

test("a line that already runs to a point cannot also define it", () => {
  // Otherwise the point depends on itself. Refused when asked, not discovered
  // later as a hang.
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 600);
  const vp = addVp(scene, { label: "VP1", x: 1400, y: 600, onHorizon: true }).vp;
  const o = addAnchor(scene, { x: 200, y: 900 }).vertex;
  const r = addRayVertex(scene, { origin: o.id, binding: { vpId: vp.id }, t: 300 }).vertex;
  const bound = addEdge(scene, { a: o.id, b: r.id, binding: { vpId: vp.id } }).edge;
  const p = (x, y) => addAnchor(scene, { x, y }).vertex;
  const free = addEdge(scene, { a: p(200, 300).id, b: p(900, 500).id }).edge;
  solveScene(scene);
  // Making a NEW point from those two is fine — it is a different point.
  const fresh = addVpFromLines(scene, { edgeA: bound.id, edgeB: free.id });
  assert.equal(fresh.ok, true, fresh.reason);
  // And nothing has become circular: a solve completes and leaves finite corners.
  solveScene(scene);
  assert.ok(scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)));
});

test("if one of its lines is deleted it stops following and stays where it is", () => {
  const { scene, e1, e2 } = twoLines();
  const res = addVpFromLines(scene, { edgeA: e1.id, edgeB: e2.id });
  const before = { x: res.vp.x, y: res.vp.y };
  scene.edges = scene.edges.filter(e => e.id !== e1.id);
  solveScene(scene);
  assert.ok(Math.abs(res.vp.x - before.x) < 1e-9 && Math.abs(res.vp.y - before.y) < 1e-9,
    "the point moved when a line it was made from was deleted");
  assert.equal(res.vp.from, undefined, "it should stop claiming to be derived");
});
