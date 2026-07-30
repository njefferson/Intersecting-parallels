// D36/D37 — eye level, the derived horizon, and the faces that read off it.
//
// Noah, 2026-07-30: "The horizon should follow two of the VPs. There is no
// horizon without the VPs. What you CAN show is 'observer eye level' ... When
// the VPs are below/at/above the observer's eye level, it changes what you see —
// whether the top or bottom is visible at all."
//
// So these are two different lines and the app must never conflate them again.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, addAnchor, setEyeLevel, horizonLine, addFace, deleteVertex, clearDrawing,
} from "../public/app/solver.mjs";
import { buildBox } from "../public/app/snap.mjs";
import { parseProjectJson } from "../public/app/state.mjs";

function twoPointScene() {
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  const l = addVp(scene, { label: "VP1", x: -600, y: 540, axis: "x", onHorizon: true }).vp;
  const r = addVp(scene, { label: "VP2", x: 2200, y: 540, axis: "y", onHorizon: true }).vp;
  return { scene, l, r };
}

test("there is no horizon without the points", () => {
  const scene = createScene({ name: "t", width: 1000, height: 800 });
  assert.equal(horizonLine(scene), null, "no points, no horizon");
  addVp(scene, { label: "VP1", x: 100, y: 400, onHorizon: true });
  assert.equal(horizonLine(scene), null, "one point is not a line");
  addVp(scene, { label: "VP2", x: 900, y: 400, onHorizon: true });
  assert.ok(horizonLine(scene), "two points make one");
});

test("a point that is not ON the horizon does not define it", () => {
  const scene = createScene({ name: "t", width: 1000, height: 800 });
  addVp(scene, { label: "VP1", x: 100, y: 400, onHorizon: true });
  addVp(scene, { label: "VP3", x: 500, y: 2000 });          // the nadir — not on the horizon
  assert.equal(horizonLine(scene), null);
});

test("two points in the same place define no direction, so no horizon", () => {
  const scene = createScene({ name: "t", width: 1000, height: 800 });
  addVp(scene, { label: "VP1", x: 500, y: 400, onHorizon: true });
  addVp(scene, { label: "VP2", x: 500, y: 400, onHorizon: true });
  assert.equal(horizonLine(scene), null);
});

test("the horizon runs through the two points, and tilts when they are not level", () => {
  const { scene, r } = twoPointScene();
  const level = horizonLine(scene);
  assert.equal(level.u.y, 0, "level points give a level horizon");
  assert.equal(level.offsetFromEyeLevel, 0, "and it sits exactly on eye level");

  r.y = 340;                                    // lift the right-hand point
  const tilted = horizonLine(scene);
  assert.ok(Math.abs(tilted.u.y) > 0.01, "the horizon tilts with the point");
  // It still passes through both points — that is the whole claim.
  for (const p of [tilted.a, tilted.b]) {
    const cross = (p.x - tilted.a.x) * tilted.u.y - (p.y - tilted.a.y) * tilted.u.x;
    assert.ok(Math.abs(cross) < 1e-6, "a defining point is off its own horizon");
  }
});

test("eye level is independent: moving it moves no point, and moving a point moves it not at all", () => {
  const { scene, l, r } = twoPointScene();
  setEyeLevel(scene, 200);
  assert.equal(l.y, 540, "the point stayed where it was put");
  assert.equal(r.y, 540);
  assert.equal(scene.eyeLevel.y, 200);
  // And now the horizon sits BELOW eye level, which is the state the lesson needs.
  assert.equal(horizonLine(scene).offsetFromEyeLevel, 340);
});

test("setEyeLevel refuses a non-number rather than poisoning the scene", () => {
  const { scene } = twoPointScene();
  const res = setEyeLevel(scene, Number.NaN);
  assert.equal(res.ok, false);
  assert.equal(scene.eyeLevel.y, 540, "the old value survives a refused write");
});

test("a box brings its four shadeable faces, naming corners that exist", () => {
  const { scene } = twoPointScene();
  const res = buildBox(scene, { at: { x: 800, y: 900 }, height: 200, depthL: 150, depthR: 150 });
  assert.equal(res.ok, true);
  const faces = scene.faces.filter(f => f.solid === res.solid);
  assert.equal(faces.length, 4);
  assert.deepEqual(faces.map(f => f.shade).sort(), ["bottom", "left", "right", "top"]);
  const ids = new Set(scene.vertices.map(v => v.id));
  for (const f of faces) {
    assert.equal(f.loop.length, 4);
    for (const id of f.loop) assert.ok(ids.has(id), `face names a missing corner ${id}`);
  }
});

test("which of top and bottom you can see follows eye level — the lesson, in the data", () => {
  const { scene } = twoPointScene();
  const res = buildBox(scene, { at: { x: 800, y: 900 }, height: 200, depthL: 150, depthR: 150 });
  const byId = new Map(scene.vertices.map(v => [v.id, v]));
  const midY = shade => {
    const f = scene.faces.find(x => x.solid === res.solid && x.shade === shade);
    const ys = f.loop.map(id => byId.get(id).y);
    return ys.reduce((a, b) => a + b, 0) / ys.length;
  };
  const top = midY("top"), bottom = midY("bottom");
  assert.ok(top < bottom, "the top of a box is above its base on the page");

  // Eye above the whole box: you look down on it and see its top.
  setEyeLevel(scene, top - 100);
  assert.ok(top > scene.eyeLevel.y, "top visible");
  assert.ok(!(bottom < scene.eyeLevel.y), "and the underside is not");

  // Eye below the whole box: you look up at it and see underneath.
  setEyeLevel(scene, bottom + 100);
  assert.ok(bottom < scene.eyeLevel.y, "underside visible");
  assert.ok(!(top > scene.eyeLevel.y), "and the top is not");

  // Eye level THROUGH the box: neither. This is the middle case in the tutorial.
  setEyeLevel(scene, (top + bottom) / 2);
  assert.ok(!(top > scene.eyeLevel.y) && !(bottom < scene.eyeLevel.y),
    "a box straddling your eye shows neither its top nor its underside");
});

test("a face cannot name a corner that is not there, and dies with the corner", () => {
  const { scene } = twoPointScene();
  const a = addAnchor(scene, { x: 10, y: 10 }).vertex;
  const b = addAnchor(scene, { x: 20, y: 10 }).vertex;
  const c = addAnchor(scene, { x: 20, y: 20 }).vertex;
  assert.equal(addFace(scene, { loop: [a.id, b.id, "nope"], solid: "s", shade: "top" }).ok, false);
  assert.equal(addFace(scene, { loop: [a.id, b.id], solid: "s", shade: "top" }).ok, false);
  assert.equal(addFace(scene, { loop: [a.id, b.id, c.id], solid: "s", shade: "top" }).ok, true);
  const res = deleteVertex(scene, b.id);
  assert.equal(res.removedFaces, 1, "the face went with its corner");
  assert.equal(scene.faces.length, 0);
});

test("clearing the drawing clears its faces too", () => {
  const { scene } = twoPointScene();
  buildBox(scene, { at: { x: 800, y: 900 }, height: 200, depthL: 150, depthR: 150 });
  assert.equal(scene.faces.length, 4);
  clearDrawing(scene);
  assert.equal(scene.faces.length, 0);
  assert.equal(scene.vanishingPoints.length, 2, "the points are not the drawing");
});

test("a version 1 file still opens: its horizon becomes eye level, unchanged", () => {
  const v1 = {
    schemaVersion: 1,
    id: "scene1", name: "old", createdAt: 1, modifiedAt: 1,
    canvas: { width: 1000, height: 800 },
    horizon: { y: 375 },
    vanishingPoints: [{ id: "vp1", label: "VP1", x: -400, y: 375, axis: "x", locked: false, onHorizon: true }],
    vertices: [{ id: "v1", kind: "anchor", x: 100, y: 200 }],
    edges: [],
    nextId: 3,
  };
  const res = parseProjectJson(JSON.stringify(v1));
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.scene.eyeLevel.y, 375, "the value carried over exactly");
  assert.equal(res.scene.horizon, undefined, "and the old name is gone");
  assert.deepEqual(res.scene.faces, [], "an old file simply has no faces");
});

test("a file from the future is still refused, and says which versions this build reads", () => {
  const res = parseProjectJson(JSON.stringify({ schemaVersion: 99, canvas: { width: 1, height: 1 } }));
  assert.equal(res.ok, false);
  assert.match(res.reason, /versions 1 and 2/);
});

test("a face naming a missing corner is dropped on load, and costs the drawing nothing", () => {
  const { scene } = twoPointScene();
  const a = addAnchor(scene, { x: 10, y: 10 }).vertex;
  const b = addAnchor(scene, { x: 20, y: 10 }).vertex;
  const c = addAnchor(scene, { x: 20, y: 20 }).vertex;
  addFace(scene, { loop: [a.id, b.id, c.id], solid: "s", shade: "top" });
  const raw = JSON.parse(JSON.stringify(scene));
  raw.faces.push({ id: "fX", loop: [a.id, b.id, "ghost"], solid: "s", shade: "left" });
  const res = parseProjectJson(JSON.stringify(raw));
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.scene.faces.length, 1, "the bad face went, the good one stayed");
  assert.equal(res.scene.vertices.length, scene.vertices.length, "no corner was harmed");
});
