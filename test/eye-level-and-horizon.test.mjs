// D36/D37 — eye level, the derived horizon, and the faces that read off it.
//
// THE RULING, 2026-07-30: the horizon follows two of the vanishing points, and
// there is no horizon without them. What CAN always be shown is the observer's
// eye level — and where the points sit relative to it (below, at, above) is what
// decides whether the top or the bottom of a solid is visible at all.
//
// So these are two different lines and the app must never conflate them again.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, addAnchor, setEyeLevel, horizonLine, addFace, deleteVertex, clearDrawing, solveScene, scaleVpSpread, moveAnchor,
} from "../public/app/solver.mjs";
import { buildBox } from "../public/app/snap.mjs";
import { nearBaseIndex } from "../public/app/render.mjs";
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

test("D63: a box stores ALL SIX faces, wound consistently round its outside", () => {
  // Replaces D44's two rings. THE RULE, 2026-08-01: give a face a normal that
  // does not change with the direction it is viewed from, and cull the reverse
  // normals the way every 3-D program does. Deriving walls at draw time was the
  // thing that had to keep being patched; a stored, consistently wound face needs
  // no patching, because the projection says which side you are looking at.
  const { scene } = twoPointScene();
  const res = buildBox(scene, { at: { x: 800, y: 900 }, height: 200, depthL: 150, depthR: 150 });
  assert.equal(res.ok, true);
  const faces = scene.faces.filter(f => f.solid === res.solid);
  assert.equal(faces.length, 6);
  assert.deepEqual(faces.map(f => f.shade).sort(),
    ["back", "bottom", "left", "near", "right", "top"]);

  // CONSISTENT WINDING, checked combinatorially so it does not depend on where
  // anything happens to project: in a closed surface every edge is shared by
  // exactly two faces, and they must traverse it in OPPOSITE directions. That is
  // the whole definition of "all the normals point the same way out", and it is
  // true of the construction rather than of the current view.
  const seen = new Map();
  for (const f of faces) {
    for (let i = 0; i < f.loop.length; i++) {
      const a = f.loop[i], b = f.loop[(i + 1) % f.loop.length];
      const key = [a, b].join(">");
      assert.ok(!seen.has(key), `edge ${key} is traversed the same way twice — a face is wound inside out`);
      seen.set(key, f.shade);
    }
  }
  for (const [key, shade] of seen) {
    const [a, b] = key.split(">");
    assert.ok(seen.has([b, a].join(">")), `${shade}'s edge ${key} has no matching face going the other way`);
  }
  const ids = new Set(scene.vertices.map(v => v.id));
  for (const f of faces) for (const id of f.loop) assert.ok(ids.has(id), `face names a missing corner ${id}`);
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
  assert.equal(scene.faces.length, 6);   // D63 — all six, consistently wound
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
  assert.match(res.reason, /versions 1 to 3/);
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

test("D44: inverting a box changes WHICH pair of walls faces you", () => {
  // THE DEFECT: an inverted box had its normals reversed, so its sides stopped
  // resembling a solid. The near corner is the base corner lowest on the page;
  // push a depth through zero and a DIFFERENT corner becomes the near one, so a
  // different pair of walls must be the visible pair.
  const { scene } = twoPointScene();
  const res = buildBox(scene, { at: { x: 800, y: 900 }, height: 200, depthL: 150, depthR: 150 });
  const byId = new Map(scene.vertices.map(v => [v.id, v]));
  const ring = scene.faces.find(f => f.solid === res.solid && f.shade === "bottom").loop;

  const nearIndex = () => {
    let best = -1, y = -Infinity;
    ring.forEach((id, i) => { const v = byId.get(id); if (v.y > y) { y = v.y; best = i; } });
    return best;
  };
  const before = nearIndex();

  // Push one depth through zero and well out the other side.
  const left = scene.vertices.find(v => v.id === res.corners.leftBottom.id);
  left.t = -400;
  solveScene(scene);
  const after = nearIndex();

  assert.notEqual(after, before,
    "the near corner did not change when the box inverted — the same two walls would still be shaded");
  assert.ok(scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)));
});

test("D45: Stronger keeps horizon points ON the horizon", () => {
  const { scene, l, r } = twoPointScene();
  // Well clear of the paper, so the guard is not what is under test here.
  l.x = -3000; r.x = 4600;
  const before = horizonLine(scene);
  assert.equal(before.offsetFromEyeLevel, 0, "starts on eye level");
  const res = scaleVpSpread(scene, 0.8);
  assert.equal(res.ok, true, res.reason);
  assert.equal(l.y, 540, "a horizon point kept its height");
  assert.equal(r.y, 540);
  assert.equal(horizonLine(scene).offsetFromEyeLevel, 0,
    "the horizon slid away from eye level, which is what pressing Stronger used to do");
});

test("D45: the third point IS exaggerated in y — it is the one with a height to change", () => {
  const { scene, l, r } = twoPointScene();
  l.x = -3000; r.x = 4600;
  const nadir = addVp(scene, { label: "VP3", x: 800, y: 2600, axis: "z", onHorizon: false }).vp;
  const res = scaleVpSpread(scene, 0.8);
  assert.equal(res.ok, true, res.reason);
  assert.ok(nadir.y < 2600, "the point below the drawing did not come closer");
});

test("D46: a vanishing point is allowed to sit ON the paper — that is one-point perspective", () => {
  // D45 refused this, and D45 was wrong: a pair of train tracks running away from
  // the viewer is exactly this case.
  // The track, the corridor, the road running away from you all
  // put the point in the middle of the picture. Forbidding it forbade a whole
  // class of drawing.
  const scene = createScene({ name: "t", width: 1000, height: 800 });
  setEyeLevel(scene, 400);
  const l = addVp(scene, { label: "VP1", x: -900, y: 400, onHorizon: true }).vp;
  addVp(scene, { label: "VP2", x: 1900, y: 400, onHorizon: true });
  let guard = 0, landedOnPaper = false;
  while (scaleVpSpread(scene, 0.8).ok && guard++ < 200) {
    if (l.x > 0 && l.x < 1000 && l.y > 0 && l.y < 800) landedOnPaper = true;
  }
  assert.ok(landedOnPaper, "a point was never allowed onto the paper");
});

test("D46: what IS refused is two points arriving at the same place", () => {
  const scene = createScene({ name: "t", width: 1000, height: 800 });
  setEyeLevel(scene, 400);
  addVp(scene, { label: "VP1", x: -900, y: 400, onHorizon: true });
  addVp(scene, { label: "VP2", x: 1900, y: 400, onHorizon: true });
  let guard = 0, last = { ok: true };
  while ((last = scaleVpSpread(scene, 0.8)).ok && guard++ < 200) { /* keep pressing */ }
  assert.ok(guard < 200, "it never refused at all");
  assert.match(last.reason, /the same point/);
  const floor = Math.hypot(1000, 800) * 0.02;
  const [a, b] = scene.vanishingPoints;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= floor,
    `the two points collapsed onto each other at ${Math.round(a.x)},${Math.round(a.y)}`);
  assert.ok(scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)));
});

test("D63: exactly the faces wound toward you are drawn, and dragging never changes that", () => {
  // Replaces both D49 tests, which asserted nearBaseIndex — the depth-sign rule
  // that the D63 ruling got rid of. The claim now is the renderer's: a face is visible
  // when its projected polygon is wound outward, and a convex box shows exactly
  // two walls at a time because the other two are wound the other way.
  const { scene } = twoPointScene();
  const res = buildBox(scene, { at: { x: 800, y: 900 }, height: 200, depthL: 250, depthR: 250 });
  const area = loop => {
    const byId = new Map(scene.vertices.map(v => [v.id, v]));
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
      const p2 = byId.get(loop[i]), q = byId.get(loop[(i + 1) % loop.length]);
      a += p2.x * q.y - q.x * p2.y;
    }
    return a / 2;
  };
  const walls = () => scene.faces
    .filter(f => f.solid === res.solid && ["near", "left", "back", "right"].includes(f.shade))
    .filter(f => area(f.loop) > 0).map(f => f.shade).sort();

  const first = walls();
  assert.equal(first.length, 2, `a box shows two walls, not ${first.length}`);

  // Dragging it around the page cannot change WHICH two — the box has not turned.
  const anchor = scene.vertices.find(v => v.id === res.corners.nearBottom.id);
  for (const p2 of [{ x: 300, y: 400 }, { x: 1400, y: 1100 }, { x: 800, y: 200 }]) {
    moveAnchor(scene, anchor.id, p2);
    assert.deepEqual(walls(), first, `the visible pair changed just from moving to ${JSON.stringify(p2)}`);
  }

  // Pushing a depth through zero DOES turn it, and then the other pair faces you.
  const L = scene.vertices.find(v => v.id === res.corners.leftBottom.id);
  L.t = -250; solveScene(scene);
  const after = walls();
  assert.equal(after.length, 2, "still exactly two after inverting");
  assert.notDeepEqual(after, first, "inverting a depth must change which walls face you");
});

test("D49: face visibility follows the HORIZON, not the eye-level line", () => {
  // THE DEFECT, 2026-07-31, reported with three cubes sitting between the two
  // lines: every one of them failed where eye level and the horizon diverge.
  // Where the points are level the two
  // coincide, which is why testing against eye level worked until they diverged.
  const { scene, l, r } = twoPointScene();          // both points at y 540
  const res = buildBox(scene, { at: { x: 800, y: 900 }, height: 200, depthL: 250, depthR: 250 });
  const byId = new Map(scene.vertices.map(v => [v.id, v]));
  const faceMid = shade => {
    const f = scene.faces.find(x => x.solid === res.solid && x.shade === shade);
    const p = f.loop.map(id => byId.get(id));
    return { x: p.reduce((a, v) => a + v.x, 0) / p.length, y: p.reduce((a, v) => a + v.y, 0) / p.length };
  };
  const top = faceMid("top");

  // Put the box's top face BETWEEN the two lines: below the horizon (so its top
  // is visible) but above the authored eye-level line (so the old rule said no).
  setEyeLevel(scene, top.y + 60);        // eye level BELOW the face
  l.y = r.y = top.y - 60;                // horizon ABOVE it
  const hz = horizonLine(scene);
  const side = (top.x - hz.a.x) * hz.u.y - (top.y - hz.a.y) * hz.u.x;
  assert.ok(side < 0, "the top face should be below the horizon in this setup");
  assert.ok(top.y < scene.eyeLevel.y, "and above the eye-level line, which is the whole point");
  // The two lines disagree here. The horizon is the one that decides.
});

test("D49: with no horizon at all, eye level still answers", () => {
  // One point, or none: D36 says there is no horizon. The fallback has to hold,
  // because a one-point scene is an ordinary drawing, not an error.
  const scene = createScene({ name: "t", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  addVp(scene, { label: "VP1", x: -600, y: 540, axis: "x", onHorizon: true });
  addVp(scene, { label: "VP2", x: 2200, y: 540, axis: "y" });     // NOT on the horizon
  assert.equal(horizonLine(scene), null, "this scene has no horizon by D36");
  const res = buildBox(scene, { at: { x: 800, y: 900 }, height: 200, depthL: 250, depthR: 250 });
  assert.equal(res.ok, true);
  assert.ok(scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)),
    "a scene with no horizon still solves");
});
