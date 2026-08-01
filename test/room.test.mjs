// D52 — the interior room. A box you are INSIDE.
//
// The claim is that the far wall stays a rectangle no matter where the vanishing
// point goes, because the four corners hold a FRACTION of the way to the point
// rather than a length. Store lengths and the wall skews the instant the point
// moves, since the four corners are different distances from it — and a skewed
// far wall is the one thing that makes a room stop reading as a room.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, setEyeLevel, solveScene, moveVp, buildRoom, clearDrawing,
} from "../public/app/solver.mjs";

function onePoint() {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  const vp = addVp(scene, { label: "VP1", x: 800, y: 540, axis: "z", onHorizon: false }).vp;
  return { scene, vp };
}

const rect = { at: { x: 400, y: 300 }, width: 800, height: 600 };

function farRect(res) {
  return res.far.map(v => ({ x: v.x, y: v.y }));
}

// Is a quad a rectangle with horizontal and vertical sides?
function isAxisRectangle(pts, tol = 1e-6) {
  const [bl, br, tr, tl] = pts;
  return Math.abs(bl.y - br.y) < tol && Math.abs(tl.y - tr.y) < tol
    && Math.abs(bl.x - tl.x) < tol && Math.abs(br.x - tr.x) < tol;
}

test("a room is eight corners, twelve edges and five surfaces", () => {
  const { scene, vp } = onePoint();
  const res = buildRoom(scene, { ...rect, vpId: vp.id, depth: 0.6 });
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.vertices.length, 8);
  assert.equal(res.edges.length, 12);
  const faces = scene.faces.filter(f => f.solid === res.solid);
  assert.equal(faces.length, 5, "a room shows every surface it has — there is no near face");
  assert.deepEqual(faces.map(f => f.shade).sort(), ["back", "bottom", "left", "right", "top"]);
});

test("the opening is a rectangle, and so is the far wall", () => {
  const { scene, vp } = onePoint();
  const res = buildRoom(scene, { ...rect, vpId: vp.id, depth: 0.6 });
  assert.ok(isAxisRectangle(res.near.map(v => ({ x: v.x, y: v.y }))), "the opening is not a rectangle");
  assert.ok(isAxisRectangle(farRect(res)), "the far wall is not a rectangle");
});

test("the far wall STAYS a rectangle wherever the vanishing point goes", () => {
  // This is the whole reason a fraction is stored instead of a length.
  const { scene, vp } = onePoint();
  const res = buildRoom(scene, { ...rect, vpId: vp.id, depth: 0.6 });
  for (const p of [{ x: 500, y: 400 }, { x: 1300, y: 700 }, { x: 200, y: 200 }, { x: 900, y: 1000 }]) {
    moveVp(scene, vp.id, p);
    assert.ok(isAxisRectangle(farRect(res), 1e-6),
      `the far wall skewed with the point at ${JSON.stringify(p)}`);
    assert.ok(res.far.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)));
  }
});

test("the far wall is the near wall scaled about the point — same shape, smaller", () => {
  const { scene, vp } = onePoint();
  const res = buildRoom(scene, { ...rect, vpId: vp.id, depth: 0.6 });
  const near = res.near.map(v => ({ x: v.x, y: v.y }));
  const far = farRect(res);
  const w = p => Math.abs(p[1].x - p[0].x), h = p => Math.abs(p[3].y - p[0].y);
  assert.ok(w(far) < w(near) && h(far) < h(near), "the far wall is not smaller");
  assert.ok(Math.abs(w(far) / w(near) - h(far) / h(near)) < 1e-6,
    "the far wall is not the same proportion as the opening");
});

test("deeper means smaller, and the depth is bounded so the wall never reaches the point", () => {
  const { scene, vp } = onePoint();
  const widths = [];
  for (const depth of [0.2, 0.5, 0.8, 5]) {          // 5 is out of range on purpose
    clearDrawing(scene);
    const res = buildRoom(scene, { ...rect, vpId: vp.id, depth });
    assert.equal(res.ok, true, res.reason);
    const far = farRect(res);
    widths.push(Math.abs(far[1].x - far[0].x));
    assert.ok(widths[widths.length - 1] > 0.5, "the far wall collapsed onto the point");
  }
  for (let i = 1; i < widths.length; i++) {
    assert.ok(widths[i] < widths[i - 1], `depth step ${i} did not go further back`);
  }
});

test("every corner of the opening runs to the SAME point", () => {
  const { scene, vp } = onePoint();
  const res = buildRoom(scene, { ...rect, vpId: vp.id, depth: 0.6 });
  for (let i = 0; i < 4; i++) {
    const n = res.near[i], f = res.far[i];
    const cross = (f.x - n.x) * (vp.y - n.y) - (f.y - n.y) * (vp.x - n.x);
    const scale = Math.hypot(vp.x - n.x, vp.y - n.y) * Math.hypot(f.x - n.x, f.y - n.y);
    assert.ok(Math.abs(cross) / (scale || 1) < 1e-9, `corner ${i} does not run to the point`);
  }
});

test("it refuses a room with no vanishing point to run away to", () => {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  const res = buildRoom(scene, { ...rect, vpId: "nope", depth: 0.6 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /vanishing point/);
  assert.equal(scene.vertices.length, 0, "a refusal must not leave half a room behind");
});

test("it refuses nonsense dimensions rather than drawing them", () => {
  const { scene, vp } = onePoint();
  for (const bad of [
    { at: { x: 400, y: 300 }, width: 0, height: 600 },
    { at: { x: 400, y: 300 }, width: 800, height: 0 },
    { at: { x: Number.NaN, y: 300 }, width: 800, height: 600 },
  ]) {
    const res = buildRoom(scene, { ...bad, vpId: vp.id });
    assert.equal(res.ok, false, `${JSON.stringify(bad)} was accepted`);
  }
  assert.equal(scene.vertices.length, 0);
});

test("a room survives the point being dragged onto the opening itself", () => {
  // The point inside the frame is the ORDINARY case for an interior — it is
  // where you are looking. It must not be a special case that breaks.
  const { scene, vp } = onePoint();
  const res = buildRoom(scene, { ...rect, vpId: vp.id, depth: 0.6 });
  moveVp(scene, vp.id, { x: 800, y: 600 });          // dead centre of the opening
  assert.ok(res.far.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)));
  assert.ok(isAxisRectangle(farRect(res)));
  assert.ok(scene.vertices.every(v => !v.degenerate), "a corner went degenerate");
});
