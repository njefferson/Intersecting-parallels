// D24 — clearing the screen. Two actions, one undo step each, and the counts
// they report have to come from the scene rather than from the sentence.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, addAnchor, addRayVertex, addEdge, solveScene, setHorizon,
  clearDrawing, clearAll,
} from "../public/app/solver.mjs";
import { createHistory, beginGesture, undo } from "../public/app/state.mjs";

function drawnScene() {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setHorizon(scene, 540);
  const l = addVp(scene, { label: "VP1", x: 100, y: 540, onHorizon: true }).vp;
  const r = addVp(scene, { label: "VP2", x: 1500, y: 540, onHorizon: true }).vp;
  const a = addAnchor(scene, { x: 600, y: 800 }).vertex;
  const b = addRayVertex(scene, { origin: a.id, binding: { vpId: l.id }, t: 240 }).vertex;
  const c = addRayVertex(scene, { origin: a.id, binding: { vpId: r.id }, t: 200 }).vertex;
  addEdge(scene, { a: a.id, b: b.id, binding: { vpId: l.id } });
  addEdge(scene, { a: a.id, b: c.id, binding: { vpId: r.id } });
  solveScene(scene);
  return { scene, l, r };
}

test("clearDrawing removes the drawing and keeps the vanishing points", () => {
  const { scene } = drawnScene();
  const res = clearDrawing(scene);
  assert.equal(res.ok, true);
  assert.equal(res.edges, 2);
  assert.equal(res.vertices, 3);
  assert.equal(scene.edges.length, 0);
  assert.equal(scene.vertices.length, 0);
  assert.equal(scene.vanishingPoints.length, 2, "the points were the setup, not the drawing");
  assert.equal(res.keptPoints, 2);
});

test("clearDrawing leaves the horizon and the canvas alone", () => {
  const { scene } = drawnScene();
  clearDrawing(scene);
  assert.equal(scene.horizon.y, 540);
  assert.equal(scene.canvas.width, 1600);
  assert.equal(scene.canvas.height, 1200);
  assert.equal(scene.name, "t", "clearing is not renaming");
});

test("clearAll removes the points too, and still keeps the sheet", () => {
  const { scene } = drawnScene();
  const res = clearAll(scene);
  assert.equal(res.ok, true);
  assert.equal(res.points, 2);
  assert.equal(scene.vanishingPoints.length, 0);
  assert.equal(scene.edges.length, 0);
  assert.equal(scene.horizon.y, 540, "the horizon is the paper, not the drawing");
  assert.equal(scene.canvas.width, 1600);
});

test("the reported counts are what was actually removed, not a fixed sentence", () => {
  // The failure this guards against: a message that says "cleared" while the
  // store still holds rows. Assert on the store AND on the number reported.
  const { scene } = drawnScene();
  addAnchor(scene, { x: 10, y: 10 });                  // a third loose point
  const before = { edges: scene.edges.length, verts: scene.vertices.length };
  const res = clearDrawing(scene);
  assert.equal(res.edges, before.edges);
  assert.equal(res.vertices, before.verts);
  assert.equal(scene.vertices.length, 0);
});

test("clearing an empty drawing refuses, and says which kind of empty", () => {
  const scene = createScene({ name: "t", width: 800, height: 600 });
  const a = clearDrawing(scene);
  assert.equal(a.ok, false);
  assert.match(a.reason, /nothing drawn/);
  const b = clearAll(scene);
  assert.equal(b.ok, false);
  assert.match(b.reason, /already empty/);
  // A vanishing point on its own is not "nothing drawn" for clearAll…
  addVp(scene, { label: "VP1", x: 50, y: 300 });
  assert.equal(clearAll(scene).ok, true);
});

test("a point with nothing drawn on it is still not a drawing", () => {
  // clearDrawing should refuse when only vanishing points exist: there is
  // nothing for it to remove, and reporting success would be a lie.
  const scene = createScene({ name: "t", width: 800, height: 600 });
  addVp(scene, { label: "VP1", x: 50, y: 300 });
  const res = clearDrawing(scene);
  assert.equal(res.ok, false);
  assert.equal(scene.vanishingPoints.length, 1, "and it did not clear them anyway");
});

test("one undo puts the whole drawing back, in a single step", () => {
  const { scene } = drawnScene();
  const history = createHistory();
  const before = JSON.stringify(scene);
  beginGesture(history, scene);                        // what the UI does
  clearDrawing(scene);
  assert.equal(scene.edges.length, 0);
  const back = undo(history, scene);
  assert.ok(back, "nothing to undo");
  assert.equal(JSON.stringify(back), before, "the restored scene is not the one that was cleared");
  assert.equal(back.edges.length, 2);
  assert.equal(back.vertices.length, 3);
});

test("one undo puts the vanishing points back after clearAll", () => {
  const { scene } = drawnScene();
  const history = createHistory();
  const before = JSON.stringify(scene);
  beginGesture(history, scene);
  clearAll(scene);
  assert.equal(scene.vanishingPoints.length, 0);
  const back = undo(history, scene);
  assert.equal(JSON.stringify(back), before);
  assert.equal(back.vanishingPoints.length, 2);
});

test("a cleared scene still solves, so the next stroke works", () => {
  const { scene, l } = drawnScene();
  clearDrawing(scene);
  const a = addAnchor(scene, { x: 300, y: 400 }).vertex;
  const b = addRayVertex(scene, { origin: a.id, binding: { vpId: l.id }, t: 150 }).vertex;
  assert.ok(addEdge(scene, { a: a.id, b: b.id, binding: { vpId: l.id } }).ok);
  solveScene(scene);
  assert.ok(Number.isFinite(b.x) && !b.degenerate, "drawing after a clear produced a broken vertex");
});
