// Solver tests — build-order step 1 (spec §10.1), plus the amendment tests the
// handoff calls machine-verifiable: D3 continuity, D4 degeneracy, and
// acceptance tests 1 and 2 (spec §11) driven against the solver.
//
// Doctrine §6: every block here was made to FAIL against a deliberately broken
// solver before it was trusted (see the commit message that introduced it).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addVp, addAnchor, addRayVertex, addIntersectVertex, addEdge, rebindVertex, moveVp, setEyeLevel, solveScene, wouldCycle, projectPointOnLine, intersectLines, epsLen,
} from "../public/app/solver.mjs";

// Deterministic PRNG so a fuzz failure is reproducible from its seed.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const finiteVertex = v => Number.isFinite(v.x) && Number.isFinite(v.y);

function boxScene() {
  // A six-edge box in 2-point (§11 acceptance test 1), built the way D2 says
  // the drawing flow produces it: the front corner authored, receding bottom
  // edges as ray vertices (authored length), everything above as intersections.
  const scene = createScene({ name: "box", width: 1200, height: 800 });
  const vp1 = addVp(scene, { label: "VP1", x: -600, y: 300, onHorizon: true }).vp;
  const vp2 = addVp(scene, { label: "VP2", x: 1600, y: 300, onHorizon: true }).vp;
  setEyeLevel(scene, 300);
  const a1 = addAnchor(scene, { x: 500, y: 560 }).vertex;                                  // front bottom
  const a2 = addRayVertex(scene, { origin: a1.id, binding: "vertical", t: -140 }).vertex;  // front top
  const b1 = addRayVertex(scene, { origin: a1.id, binding: { vpId: vp1.id }, t: 180 }).vertex; // left bottom
  const c1 = addRayVertex(scene, { origin: a1.id, binding: { vpId: vp2.id }, t: 200 }).vertex; // right bottom
  const b2 = addIntersectVertex(scene, { defs: [                                            // left top
    { origin: a2.id, binding: { vpId: vp1.id } },
    { origin: b1.id, binding: "vertical" },
  ] }).vertex;
  const c2 = addIntersectVertex(scene, { defs: [                                            // right top
    { origin: a2.id, binding: { vpId: vp2.id } },
    { origin: c1.id, binding: "vertical" },
  ] }).vertex;
  for (const [a, b, binding] of [
    [a1, a2, "vertical"], [a1, b1, { vpId: vp1.id }], [a1, c1, { vpId: vp2.id }],
    [a2, b2, { vpId: vp1.id }], [a2, c2, { vpId: vp2.id }], [b1, b2, "vertical"],
  ]) assert.equal(addEdge(scene, { a: a.id, b: b.id, binding }).ok, true);
  return { scene, vp1, vp2, a1, a2, b1, c1, b2, c2 };
}

// Residual of a point against the line its def describes — connectedness is
// "the corner sits on both of its defining lines", not a screenshot.
function lineResidual(scene, v, def) {
  const origin = scene.vertices.find(x => x.id === def.origin);
  let u;
  if (def.binding === "vertical") u = { x: 0, y: 1 };
  else if (def.binding === "horizontal") u = { x: 1, y: 0 };
  else {
    const vp = scene.vanishingPoints.find(p => p.id === def.binding.vpId);
    const len = Math.hypot(vp.x - origin.x, vp.y - origin.y);
    u = { x: (vp.x - origin.x) / len, y: (vp.y - origin.y) / len };
  }
  const proj = projectPointOnLine({ x: origin.x, y: origin.y }, u, v);
  return Math.hypot(proj.x - v.x, proj.y - v.y);
}

test("projection: signed t on both sides of the origin", () => {
  const u = { x: 1, y: 0 };
  const ahead = projectPointOnLine({ x: 10, y: 10 }, u, { x: 25, y: 13 });
  assert.equal(ahead.t, 15);
  assert.deepEqual({ x: ahead.x, y: ahead.y }, { x: 25, y: 10 });
  const behind = projectPointOnLine({ x: 10, y: 10 }, u, { x: 4, y: 9 });
  assert.equal(behind.t, -6);
});

test("intersection: crossing lines meet at the known point; parallels return null", () => {
  const p = intersectLines({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: -5 }, { x: 0, y: 1 });
  assert.deepEqual(p, { x: 5, y: 0 });
  assert.equal(intersectLines({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 5, y: 0 }, { x: 0, y: 1 }), null);
});

test("D4: an intersection behind both origins is legitimate, not degenerate", () => {
  // Both directions point AWAY from the crossing — the old ray semantics would
  // have called this divergent; as lines it is a VP behind the viewer.
  const u1 = { x: 1, y: 0 }, u2 = { x: 0, y: 1 };
  const p = intersectLines({ x: 10, y: 0 }, u1, { x: 0, y: 10 }, u2);
  assert.deepEqual(p, { x: 0, y: 0 });
});

test("anchor-pinned invariant: VP move re-aims a ray vertex, anchor and |t| hold (§2.2)", () => {
  const scene = createScene({ name: "s", width: 1000, height: 800 });
  const vp = addVp(scene, { label: "VP1", x: 900, y: 100 }).vp;
  const o = addAnchor(scene, { x: 100, y: 100 }).vertex;
  const r = addRayVertex(scene, { origin: o.id, binding: { vpId: vp.id }, t: 50 }).vertex;
  assert.ok(Math.abs(r.x - 150) < 1e-9 && Math.abs(r.y - 100) < 1e-9);
  assert.equal(moveVp(scene, vp.id, { x: 100, y: 900 }).ok, true);
  assert.deepEqual({ x: o.x, y: o.y }, { x: 100, y: 100 });        // anchors never move
  assert.ok(Math.abs(Math.hypot(r.x - o.x, r.y - o.y) - 50) < 1e-9); // authored length holds (D2)
  assert.ok(Math.abs(r.x - 100) < 1e-9 && Math.abs(r.y - 150) < 1e-9);
});

test("topological solve: vertex array order does not matter (§2.3)", () => {
  const { scene, b2 } = boxScene();
  const expect = { x: b2.x, y: b2.y };
  scene.vertices.reverse();
  const result = solveScene(scene);
  assert.equal(result.unresolved.length, 0);
  const again = scene.vertices.find(v => v.id === b2.id);
  assert.ok(Math.abs(again.x - expect.x) < 1e-9 && Math.abs(again.y - expect.y) < 1e-9);
});

test("cycle rejection: a rebind that closes a loop is refused with a reason (§2.3.3)", () => {
  const scene = createScene({ name: "s", width: 1000, height: 800 });
  addVp(scene, { label: "VP1", x: 900, y: 400 });
  const a = addAnchor(scene, { x: 100, y: 100 }).vertex;
  const r1 = addRayVertex(scene, { origin: a.id, binding: "vertical", t: 40 }).vertex;
  const r2 = addRayVertex(scene, { origin: r1.id, binding: "horizontal", t: 40 }).vertex;
  assert.equal(wouldCycle(scene, r1.id, [r2.id]), true);
  const res = rebindVertex(scene, r1.id, { origin: r2.id });
  assert.equal(res.ok, false);
  assert.match(res.reason, /ancestor/);
  assert.equal(r1.origin, a.id); // refused means untouched
});

test("D3 continuity: a VP crossing its origin does not flip the vertex 180°", () => {
  const scene = createScene({ name: "s", width: 1000, height: 800 });
  const vp = addVp(scene, { label: "VP1", x: 400, y: 200 }).vp;
  const o = addAnchor(scene, { x: 200, y: 200 }).vertex;
  const r = addRayVertex(scene, { origin: o.id, binding: { vpId: vp.id }, t: 100 }).vertex;
  assert.ok(Math.abs(r.x - 300) < 1e-9);
  let prev = { x: r.x, y: r.y };
  for (let x = 400; x >= 0; x -= 10) {          // sweep straight across the origin,
    moveVp(scene, vp.id, { x, y: 200 });        // including exactly onto it at x=200
    assert.ok(finiteVertex(r), `finite at vp.x=${x}`);
    const step = Math.hypot(r.x - prev.x, r.y - prev.y);
    assert.ok(step < 50, `no jump at vp.x=${x} (moved ${step.toFixed(1)}px)`);
    prev = { x: r.x, y: r.y };
  }
  // The naive normalize(VP−origin) formula would now put it at (100,200).
  assert.ok(Math.abs(r.x - 300) < 1e-9 && Math.abs(r.y - 200) < 1e-9, "held its side");
  assert.ok(r.t < 0, "t is stored signed after crossing");
  // Cold-load determinism: same JSON, fresh solve, same side.
  const reloaded = JSON.parse(JSON.stringify(scene));
  for (const v of reloaded.vertices) if (v.kind !== "anchor") { v.x = NaN; v.y = NaN; }
  solveScene(reloaded);
  const rr = reloaded.vertices.find(v => v.id === r.id);
  assert.ok(Math.abs(rr.x - r.x) < 1e-9 && Math.abs(rr.y - r.y) < 1e-9);
});

test("D4: coincident VP flags degenerate and keeps the last valid position", () => {
  const scene = createScene({ name: "s", width: 1000, height: 800 });
  const vp = addVp(scene, { label: "VP1", x: 500, y: 100 }).vp;
  const o = addAnchor(scene, { x: 100, y: 100 }).vertex;
  const r = addRayVertex(scene, { origin: o.id, binding: { vpId: vp.id }, t: 60 }).vertex;
  const held = { x: r.x, y: r.y };
  const result = (moveVp(scene, vp.id, { x: 100, y: 100 }), solveScene(scene));
  assert.equal(r.degenerate, true);
  assert.ok(result.degenerate.includes(r.id));
  assert.deepEqual({ x: r.x, y: r.y }, held); // untouched, finite
});

test("D4: parallel defining lines flag degenerate and keep the last valid position", () => {
  const scene = createScene({ name: "s", width: 1000, height: 800 });
  addVp(scene, { label: "VP1", x: 900, y: 400 });
  const o1 = addAnchor(scene, { x: 100, y: 100 }).vertex;
  const o2 = addAnchor(scene, { x: 300, y: 100 }).vertex;
  const i = addIntersectVertex(scene, { defs: [
    { origin: o1.id, binding: "vertical" },
    { origin: o2.id, binding: "horizontal" },
  ] }).vertex;
  assert.ok(finiteVertex(i) && !i.degenerate);
  const held = { x: i.x, y: i.y };
  const res = rebindVertex(scene, i.id, { defs: [
    { origin: o1.id, binding: "vertical" },
    { origin: o2.id, binding: "vertical" },
  ] });
  assert.equal(res.ok, true);
  assert.equal(i.degenerate, true);
  assert.deepEqual({ x: i.x, y: i.y }, held);
});

test("D4 property: fuzzed VP positions — including exactly onto anchors — never produce NaN", () => {
  const rand = mulberry32(20260729);
  const { scene, vp1, vp2, a1, a2, b1 } = boxScene();
  const anchorsish = [a1, a2, b1];
  for (let i = 0; i < 500; i++) {
    const target = i % 10 === 3
      ? anchorsish[i % anchorsish.length]                      // exact hits, on purpose
      : { x: (rand() - 0.5) * 20000, y: (rand() - 0.5) * 20000 };
    const vp = i % 2 ? vp1 : vp2;
    moveVp(scene, vp.id, { x: target.x, y: target.y });
    for (const v of scene.vertices) {
      assert.ok(finiteVertex(v), `vertex ${v.id} finite on iteration ${i}`);
      if (v.kind === "ray") assert.ok(Number.isFinite(v.t), `t finite on iteration ${i}`);
    }
  }
});

test("acceptance 1 (§11, against the solver): VP1 dragged across the canvas — corners stay connected, nothing detaches, no jumps", () => {
  const { scene, vp1, b2, c2, b1, a2 } = boxScene();
  const edgeRefs = scene.edges.map(e => `${e.a}-${e.b}`).join();
  let prev = scene.vertices.map(v => ({ x: v.x, y: v.y }));
  for (let x = -600; x <= 1200; x += 15) {
    moveVp(scene, vp1.id, { x, y: 300 });
    scene.vertices.forEach((v, k) => {
      assert.ok(finiteVertex(v), `finite at vp1.x=${x}`);
      const step = Math.hypot(v.x - prev[k].x, v.y - prev[k].y);
      assert.ok(step < 400, `no vertex jump at vp1.x=${x} (${v.id} moved ${step.toFixed(0)}px)`);
    });
    for (const corner of [b2, c2]) {
      if (corner.degenerate) continue; // frozen at last valid, by design
      for (const def of corner.defs) {
        assert.ok(lineResidual(scene, corner, def) < 1e-6, `corner ${corner.id} on its line at vp1.x=${x}`);
      }
    }
    assert.ok(Math.abs(b1.x - b2.x) < 1e-6, `back edge stays vertical at vp1.x=${x}`);
    prev = scene.vertices.map(v => ({ x: v.x, y: v.y }));
  }
  assert.equal(scene.edges.map(e => `${e.a}-${e.b}`).join(), edgeRefs); // no edge detached
  assert.equal(a2.degenerate, false);
});

test("acceptance 2 (§11, against the solver): VP dragged to the far side of the horizon — geometry inverts, stays finite, no vanished edges", () => {
  const { scene, vp2, c2, a2 } = boxScene();
  // Off-horizon so it can travel vertically (onHorizon slaves y — §4).
  vp2.onHorizon = false;
  let prev = scene.vertices.map(v => ({ x: v.x, y: v.y }));
  for (let y = 300; y >= -500; y -= 10) {
    moveVp(scene, vp2.id, { x: 1600, y });
    scene.vertices.forEach((v, k) => {
      assert.ok(finiteVertex(v), `finite at vp2.y=${y}`);
      const step = Math.hypot(v.x - prev[k].x, v.y - prev[k].y);
      assert.ok(step < 400, `inverts predictably at vp2.y=${y} (${v.id} moved ${step.toFixed(0)}px)`);
    });
    prev = scene.vertices.map(v => ({ x: v.x, y: v.y }));
  }
  // The top-right corner ends up genuinely re-solved, not frozen.
  assert.equal(c2.degenerate, false);
  assert.ok(finiteVertex(c2) && finiteVertex(a2));
});

test("a dependency cycle in loaded data terminates, flags, and never hangs", () => {
  const { scene } = boxScene();
  const r1 = { id: "z1", kind: "ray", x: 5, y: 5, origin: "z2", binding: "vertical", t: 10, degenerate: false };
  const r2 = { id: "z2", kind: "ray", x: 6, y: 6, origin: "z1", binding: "horizontal", t: 10, degenerate: false };
  scene.vertices.push(r1, r2);
  const result = solveScene(scene);
  assert.deepEqual(new Set(result.unresolved), new Set(["z1", "z2"]));
  assert.ok(r1.degenerate && r2.degenerate);
  assert.deepEqual({ x: r1.x, y: r1.y }, { x: 5, y: 5 }); // cached position kept
});

test("locked VPs reject drags with a reason; D36 leaves every unlocked point free in BOTH axes", () => {
  const scene = createScene({ name: "s", width: 1000, height: 800 });
  const locked = addVp(scene, { label: "VP1", x: 900, y: 400, locked: true }).vp;
  const onH = addVp(scene, { label: "VP2", x: -200, y: 999, onHorizon: true }).vp;
  // Before D36 this y was overwritten with the horizon's. It is not any more:
  // a point above or below eye level is the state the tutorial has to show, and
  // slaving y made it unrepresentable.
  assert.equal(onH.y, 999, "onHorizon no longer overwrites y at creation");
  const res = moveVp(scene, locked.id, { x: 0, y: 0 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /locked/);
  assert.deepEqual({ x: locked.x, y: locked.y }, { x: 900, y: 400 });
  setEyeLevel(scene, 250);
  assert.equal(onH.y, 999, "moving eye level moves no vanishing point");
  moveVp(scene, onH.id, { x: 100, y: 640 });
  assert.equal(onH.y, 640, "a drag sets y for real");
});

test("EPS_LEN is relative to the canvas diagonal, so it survives any document size (D4)", () => {
  const small = createScene({ name: "s", width: 100, height: 100 });
  const big = createScene({ name: "b", width: 100000, height: 100000 });
  assert.ok(epsLen(big) / epsLen(small) === 1000);
});

// ---- D17: deleting a vanishing point moves nothing ------------------------
//
// Noah, 2026-07-29: "VPs said they could not be deleted without destroying
// existing lines." The app refused outright. Now the point goes and the drawing
// stays put, to the pixel.

test("D17: a vanishing point can be deleted, and not one pixel of the drawing moves", async () => {
  const { deleteVp } = await import("../public/app/solver.mjs");
  const scene = createScene({ name: "d17", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  const vp1 = addVp(scene, { label: "VP1", x: -1360, y: 540, onHorizon: true }).vp;
  const vp2 = addVp(scene, { label: "VP2", x: 2960, y: 540, onHorizon: true }).vp;
  const a = addAnchor(scene, { x: 700, y: 700 }).vertex;
  const r1 = addRayVertex(scene, { origin: a.id, binding: { vpId: vp1.id }, t: 260 }).vertex;
  const r2 = addRayVertex(scene, { origin: a.id, binding: { vpId: vp2.id }, t: 240 }).vertex;
  const up = addRayVertex(scene, { origin: a.id, binding: "vertical", t: -180 }).vertex;
  addEdge(scene, { a: a.id, b: r1.id, binding: { vpId: vp1.id } });
  addEdge(scene, { a: a.id, b: r2.id, binding: { vpId: vp2.id } });
  addEdge(scene, { a: a.id, b: up.id, binding: "vertical" });

  const before = scene.vertices.map(v => ({ id: v.id, x: v.x, y: v.y }));
  const res = deleteVp(scene, vp1.id);
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.label, "VP1");
  assert.equal(res.freed, 1, "the line that leaned on VP1 lost its guide");
  assert.equal(res.frozen, 1, "and the point it built is frozen");
  assert.equal(scene.vanishingPoints.length, 1);

  // The whole point of the amendment: nothing moved.
  for (const b of before) {
    const now = scene.vertices.find(v => v.id === b.id);
    assert.ok(now, `vertex ${b.id} survived`);
    assert.equal(now.x, b.x, `${b.id} x unmoved`);
    assert.equal(now.y, b.y, `${b.id} y unmoved`);
  }
  assert.equal(scene.edges.length, 3, "no line was destroyed");
  // The frozen point is a plain anchor now, and nothing still names VP1.
  assert.equal(scene.vertices.find(v => v.id === r1.id).kind, "anchor");
  const names = JSON.stringify(scene);
  assert.equal(names.includes(vp1.id), false, "no dangling reference to the deleted point");

  // And the lines that never used VP1 still follow their own guides.
  moveVp(scene, vp2.id, { x: 2000, y: 300 });
  const stillBound = scene.vertices.find(v => v.id === r2.id);
  assert.equal(stillBound.kind, "ray");
  assert.ok(Math.abs(Math.hypot(stillBound.x - a.x, stillBound.y - a.y) - 240) < 1e-9);
});

test("D17: deleting a point takes its lines with it and freezes what was built from it", async () => {
  const { deleteVertex } = await import("../public/app/solver.mjs");
  const scene = createScene({ name: "d17b", width: 1600, height: 1200 });
  setEyeLevel(scene, 540);
  const vp = addVp(scene, { label: "VP1", x: -1360, y: 540, onHorizon: true }).vp;
  const a = addAnchor(scene, { x: 700, y: 700 }).vertex;
  const b = addRayVertex(scene, { origin: a.id, binding: { vpId: vp.id }, t: 300 }).vertex;
  const c = addRayVertex(scene, { origin: b.id, binding: "vertical", t: -120 }).vertex;
  addEdge(scene, { a: a.id, b: b.id, binding: { vpId: vp.id } });
  addEdge(scene, { a: b.id, b: c.id, binding: "vertical" });
  const cWas = { x: c.x, y: c.y };

  const res = deleteVertex(scene, b.id);
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.removedEdges, 2, "both lines ending on it went with it");
  assert.equal(scene.vertices.find(v => v.id === b.id), undefined);
  // c was built FROM b. It keeps its position rather than jumping.
  const cNow = scene.vertices.find(v => v.id === c.id);
  assert.equal(cNow.kind, "anchor");
  assert.deepEqual({ x: cNow.x, y: cNow.y }, cWas);
  assert.ok(scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)));
});
