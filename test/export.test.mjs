// Export tests (§5, D9) and project-file validation (§5.4, §6).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createScene, addVp, addAnchor, addRayVertex, addEdge, setEyeLevel } from "../public/app/solver.mjs";
import { buildSvg, clampExportSize } from "../public/app/export.mjs";
import { createHistory, beginGesture, undo, redo, canUndo, parseProjectJson, UNDO_LIMIT } from "../public/app/state.mjs";

function drawing() {
  const scene = createScene({ name: "box & <rig>", width: 1000, height: 800 });
  const vp = addVp(scene, { label: "VP1", x: -400, y: 300, axis: "x", onHorizon: true }).vp;
  setEyeLevel(scene, 300);
  const a = addAnchor(scene, { x: 600, y: 600 }).vertex;
  const b = addRayVertex(scene, { origin: a.id, binding: { vpId: vp.id }, t: 200 }).vertex;
  const c = addRayVertex(scene, { origin: a.id, binding: "vertical", t: -150 }).vertex;
  addEdge(scene, { a: a.id, b: b.id, binding: { vpId: vp.id } });
  addEdge(scene, { a: a.id, b: c.id, binding: "vertical" });
  addEdge(scene, { a: b.id, b: c.id, binding: "free" });
  addEdge(scene, { a: a.id, b: b.id, binding: { vpId: vp.id }, role: "construction" });
  return { scene, vp };
}

test("D9: the root svg declares xmlns:inkscape, so inkscape:label is valid", () => {
  const svg = buildSvg(drawing().scene);
  assert.match(svg, /xmlns:inkscape="http:\/\/www\.inkscape\.org\/namespaces\/inkscape"/);
  assert.match(svg, /inkscape:label="committed"/);
});

test("§5.1: stroked never filled, viewBox is the canvas, groups carry id AND label", () => {
  const { scene } = drawing();
  const svg = buildSvg(scene);
  assert.match(svg, /viewBox="0 0 1000 800"/);
  assert.match(svg, /fill="none"/);
  assert.ok(!/fill="(?!none)/.test(svg), "no filled paths");
  assert.match(svg, /<g id="committed" inkscape:label="committed"/);
  assert.match(svg, /<g id="axis-x" inkscape:label="axis-x"/);
  assert.match(svg, /<g id="vertical" inkscape:label="vertical"/);
  assert.match(svg, /<g id="free" inkscape:label="free"/);
});

test("§5.1: construction is omitted unless opted in, and carries eye level when included", () => {
  const { scene } = drawing();
  assert.ok(!buildSvg(scene).includes('id="construction"'));
  const withIt = buildSvg(scene, { includeConstruction: true });
  assert.match(withIt, /<g id="construction" inkscape:label="construction"/);
  assert.match(withIt, /<path id="eye-level"/);
});

test("D36: the exported horizon appears only when the points define one", () => {
  const { scene } = drawing();
  const none = buildSvg(scene, { includeConstruction: true });
  assert.ok(!none.includes('id="horizon"'),
    "no horizon may be exported when fewer than two points claim to be on it");
  // One point on the horizon is still not a horizon — it takes two to make a line,
  // and the scene above deliberately has only one.
  addVp(scene, { label: "VP2", x: 1500, y: 320, axis: "y", onHorizon: true });
  const withIt = buildSvg(scene, { includeConstruction: true });
  assert.match(withIt, /<path id="horizon"/);
  assert.ok(!withIt.includes("NaN"));
});

test("hairline option emits non-scaling-stroke; weight is honoured", () => {
  const { scene } = drawing();
  assert.match(buildSvg(scene, { hairline: true }), /vector-effect="non-scaling-stroke"/);
  assert.match(buildSvg(scene, { strokeWeight: 3 }), /stroke-width="3"/);
});

test("the scene name is escaped, not interpolated raw (Doctrine §16.7 in spirit)", () => {
  const svg = buildSvg(drawing().scene);
  assert.match(svg, /<title>box &amp; &lt;rig&gt;<\/title>/);
});

test("a degenerate or unsolved vertex drops its edge rather than emitting NaN coordinates", () => {
  const { scene } = drawing();
  scene.vertices.push({ id: "bad", kind: "anchor", x: NaN, y: NaN });
  addEdge(scene, { a: scene.vertices[0].id, b: "bad", binding: "free" });
  const svg = buildSvg(scene);
  assert.ok(!svg.includes("NaN"));
});

test("D9: PNG size clamps with an honest message instead of a blank image", () => {
  const ok = clampExportSize({ width: 3000, height: 2000 }, 4096);
  assert.equal(ok.clamped, false);
  assert.equal(ok.message, null);
  const big = clampExportSize({ width: 12000, height: 8000 }, 4096);
  assert.equal(big.clamped, true);
  assert.equal(big.width, 4096);
  assert.ok(big.height < 4096 && big.height > 0);
  assert.match(big.message, /4096/);
  assert.match(big.message, /blank/);
  assert.ok(big.width / big.height - 12000 / 8000 < 1e-3, "aspect ratio preserved");
});

test("D7: one gesture is one undo step, and the stack is bounded at 100", () => {
  const { scene } = drawing();
  const h = createHistory();
  beginGesture(h, scene);                       // one gesture...
  for (let i = 0; i < 50; i++) scene.vanishingPoints[0].x -= 1;   // ...many samples
  assert.equal(h.undo.length, 1);
  const restored = undo(h, scene);
  assert.equal(restored.vanishingPoints[0].x, -400);
  assert.equal(canUndo(h), false);
  const again = redo(h, restored);
  assert.equal(again.vanishingPoints[0].x, -450);

  const h2 = createHistory();
  for (let i = 0; i < UNDO_LIMIT + 25; i++) beginGesture(h2, scene);
  assert.equal(h2.undo.length, UNDO_LIMIT);
});

test("a new gesture clears the redo branch", () => {
  const { scene } = drawing();
  const h = createHistory();
  beginGesture(h, scene);
  scene.name = "changed";
  const back = undo(h, scene);
  assert.equal(h.redo.length, 1);
  beginGesture(h, back);
  assert.equal(h.redo.length, 0);
});

test("§5.4: a project round-trips, and every malformed shape is refused with a reason", () => {
  const { scene } = drawing();
  const round = parseProjectJson(JSON.stringify(scene));
  assert.equal(round.ok, true);
  assert.equal(round.scene.vertices.length, scene.vertices.length);

  const cases = [
    ["not json at all", /valid JSON/],
    [JSON.stringify({ schemaVersion: 99, canvas: { width: 1, height: 1 } }), /schemaVersion/],
    [JSON.stringify({ schemaVersion: 1, canvas: { width: 0, height: 5 }, horizon: { y: 1 }, vanishingPoints: [], vertices: [], edges: [] }), /canvas/],
    [JSON.stringify({ ...scene, vertices: [...scene.vertices, { id: scene.vertices[0].id, kind: "anchor", x: 1, y: 1 }] }), /duplicate id/],
    [JSON.stringify({ ...scene, edges: [...scene.edges, { id: "eX", a: "nope", b: scene.vertices[0].id, binding: "free" }] }), /missing vertex/],
  ];
  for (const [text, pattern] of cases) {
    const res = parseProjectJson(text);
    assert.equal(res.ok, false, `should refuse: ${String(text).slice(0, 40)}`);
    assert.match(res.reason, pattern);
  }
});

test("§5.4: a ray vertex naming a missing VP is refused, not silently loaded", () => {
  const { scene } = drawing();
  const broken = JSON.parse(JSON.stringify(scene));
  broken.vertices.find(v => v.kind === "ray").binding = { vpId: "vp-gone" };
  const res = parseProjectJson(JSON.stringify(broken));
  assert.equal(res.ok, false);
  assert.match(res.reason, /invalid binding/);
});

test("a project missing nextId gets a safe counter rather than a refusal", () => {
  const { scene } = drawing();
  const noCounter = JSON.parse(JSON.stringify(scene));
  delete noCounter.nextId;
  const res = parseProjectJson(JSON.stringify(noCounter));
  assert.equal(res.ok, true);
  assert.ok(Number.isFinite(res.scene.nextId));
  const existing = new Set([...res.scene.vertices, ...res.scene.edges, ...res.scene.vanishingPoints].map(x => x.id));
  assert.ok(!existing.has(`v${res.scene.nextId}`) && !existing.has(`e${res.scene.nextId}`));
});
