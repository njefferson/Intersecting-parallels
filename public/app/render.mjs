// render.mjs — canvas 2D drawing surface and the canvas↔screen transform (§8).
//
// SVG DOM will not hold 60fps under VP drag with thousands of nodes, so the
// screen is canvas and SVG is generated at export time only (§8).
//
// D6 / Doctrine §4: guides and committed lines differ by WEIGHT AND DASH, not
// hue — the drawing survives a grayscale render. Colour only ever reinforces.
// Draw order is the spec's: grid → horizon → construction → committed →
// vertices → ghost ray → handles.

import { horizonLine } from "./solver.mjs";

export const HANDLE_HIT = 22;   // canvas-independent screen px; 44px diameter (§4)
const HANDLE_DOT = 7;           // what is drawn — small dot, large hit area (D6)
const VERTEX_DOT = 4;

export function createView(scene) {
  return { scale: 1, tx: 0, ty: 0, scene };
}

export function toScreen(view, p) {
  return { x: p.x * view.scale + view.tx, y: p.y * view.scale + view.ty };
}

export function toCanvas(view, p) {
  return { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale };
}

// Fit the document into the viewport with a margin, centred.
export function fitView(view, viewport, margin = 24) {
  const { width, height } = view.scene.canvas;
  const s = Math.min((viewport.width - margin * 2) / width, (viewport.height - margin * 2) / height);
  view.scale = s > 0 ? s : 1;
  view.tx = (viewport.width - width * view.scale) / 2;
  view.ty = (viewport.height - height * view.scale) / 2;
  return view;
}

export function zoomAt(view, screenPoint, factor, { min = 0.02, max = 64 } = {}) {
  const before = toCanvas(view, screenPoint);
  view.scale = Math.max(min, Math.min(max, view.scale * factor));
  const after = toCanvas(view, screenPoint);
  view.tx += (after.x - before.x) * view.scale;
  view.ty += (after.y - before.y) * view.scale;
  return view;
}

// Where a VP sits relative to the viewport, and — when it is outside — the
// point on the viewport edge along the direction to it (§4 off-canvas handle).
export function offscreenMarker(view, vp, viewport, inset = 30) {
  const s = toScreen(view, vp);
  const inside = s.x >= inset && s.x <= viewport.width - inset && s.y >= inset && s.y <= viewport.height - inset;
  if (inside) return { onScreen: true, x: s.x, y: s.y };
  const cx = viewport.width / 2, cy = viewport.height / 2;
  const dx = s.x - cx, dy = s.y - cy;
  const halfW = viewport.width / 2 - inset, halfH = viewport.height / 2 - inset;
  const scale = Math.min(
    Math.abs(dx) > 1e-9 ? halfW / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-9 ? halfH / Math.abs(dy) : Infinity,
  );
  const k = Number.isFinite(scale) ? scale : 0;
  return { onScreen: false, x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) };
}

// Exported so the canvas palette can be measured by a test rather than eyeballed
// (§4, SC 1.4.11). The a11y gate walks the DOM and cannot see inside a canvas, so
// the marks drawn here need their own arithmetic.
export function themeColors(theme) {
  // Colour reinforces; weight and dash carry the meaning (D6).
  return theme === "light"
    ? { ink: "#171C2B", guide: "#586079", grid: "#8A8F98", paper: "#FFFFFF",
        vp: "#4A54C8", vpLocked: "#586079", bad: "#B03270", sel: "#0E6E88", ghost: "#586079",
        // D37 — face fills. These are SURFACES, not marks: they are held to
        // "every mark stays >= 3:1 ON them", not to 3:1 themselves. Lit from
        // above, so top is lightest and the underside darkest.
        faceTop: "#F3F3F4", faceRight: "#E5E6E7", faceLeft: "#D7D7D9", faceBottom: "#C6C7C9",
        faceBack: "#EDEEEF" }
    : { ink: "#EAECF5", guide: "#8B93AD", grid: "#636A80", paper: "#141A2E",
        vp: "#8A97FF", vpLocked: "#8B93AD", bad: "#E0619E", sel: "#58C6E0", ghost: "#8B93AD",
        faceTop: "#3B4051", faceRight: "#2E3445", faceLeft: "#22273A", faceBottom: "#0C0F1B",
        faceBack: "#343A4B" };
}


// ---- D37 solids -----------------------------------------------------------
//
// A "solid" is just the set of corners its faces name. Nothing new is stored to
// make this work: the grouping is read back off the faces every frame, so it can
// never disagree with them.
function groupSolids(scene, byId) {
  const faces = scene.faces ?? [];
  if (!faces.length) return [];
  const bySolid = new Map();
  for (const f of faces) {
    let g = bySolid.get(f.solid);
    if (!g) { g = { id: f.solid, faces: [], verts: new Set() }; bySolid.set(f.solid, g); }
    g.faces.push(f);
    for (const id of f.loop) g.verts.add(id);
  }
  const out = [...bySolid.values()];
  // Painter's order without a third dimension to sort by: distance FROM THE
  // HORIZON is the depth cue, because the horizon is where distance becomes
  // infinite (D48). Farthest first, so nearer solids paint over them. This used
  // to be plain "lowest y", which put a solid above the horizon in the wrong
  // order for exactly the reason the wall picking was wrong.
  const eye = scene.eyeLevel?.y;
  const level = Number.isFinite(eye) ? eye : 0;
  for (const g of out) {
    let far = -Infinity;
    for (const id of g.verts) {
      const v = byId.get(id);
      if (v && Number.isFinite(v.y)) far = Math.max(far, Math.abs(v.y - level));
    }
    g.depth = far;
  }
  out.sort((a, b) => a.depth - b.depth);
  return out;
}

// D49 — STOP RECALCULATING WHAT THE CONSTRUCTION ALREADY KNOWS.
//
// Noah, 2026-07-31: "Why do you recalculate normals at all?"
//
// He is right and it is the question that ends this whole line of bugs. D44 read
// the near corner off SCREEN POSITION ("lowest on the page"), D48 patched that to
// distance from the horizon, and each version was wrong somewhere else. None of
// it was necessary: `buildBox` puts the anchor at the near bottom corner and runs
// both depths OUTWARD from it, so the two walls meeting at the anchor's vertical
// edge are the front pair. That is true by construction and no amount of dragging
// the box around the page changes it.
//
// The one thing that genuinely changes it is a depth going NEGATIVE (D39), which
// puts that corner on the near side of the anchor instead of the far side. And
// that is a STORED SIGN, not a measurement. Two signs, four cases, exact:
//
//   both depths +   the anchor is nearest          walls at ring[0]
//   left -, right + the left corner is nearest     walls at ring[1]
//   left +, right - the right corner is nearest    walls at ring[3]
//   both -          the back corner is nearest     walls at ring[2]
//
// No eye level, no screen y, no heuristic, and nothing to go stale.
export function nearBaseIndex(ring, byId) {
  // The ring is [anchor, leftDepth, back, rightDepth] — buildBox's own order,
  // which D44's test pins.
  const near = id => {
    const v = byId.get(id);
    return !!v && typeof v.t === "number" && v.t < 0;
  };
  const l = near(ring[1]), r = near(ring[3]);
  if (!l && !r) return 0;
  if (l && !r) return 1;
  if (!l && r) return 3;
  return 2;
}

// D49 — and the OTHER line. Whether you see the top of a horizontal face or its
// underside is decided by the HORIZON, not by the authored eye-level line.
//
// Noah, 2026-07-31, with three cubes sitting in the band between the two: "All
// these cubes fail at eye/horizon lines."
//
// The horizon is where horizontal planes at your eye height vanish, so a
// horizontal face projects below it when it is below your eye and above it when
// it is above. Eye level is a drawn reference that COINCIDES with the horizon
// whenever the points are level — which is why testing against it worked until
// the two diverged, and then failed exactly in the band where they do.
//
// Returns > 0 above the horizon, < 0 below it. Falls back to the eye-level line
// when there are not two points to define a horizon (D36), because then there is
// nothing better and the two are the same thing anyway.
function sideOfHorizon(scene, p) {
  const hz = horizonLine(scene);
  if (hz) return (p.x - hz.a.x) * hz.u.y - (p.y - hz.a.y) * hz.u.x;
  const eye = scene.eyeLevel?.y;
  return Number.isFinite(eye) ? eye - p.y : 0;
}

// D44 — which faces of a solid can be seen, INCLUDING when it is inside out.
//
// Noah, 2026-07-30: "Inverted boxes have normals reversed (I think...) - i guess
// that because the sides do not resemble a solid."
//
// He diagnosed it correctly. D37 stored two vertical faces and asserted they were
// always visible, on the reasoning that they meet at the near vertical edge and
// that edge is nearest by construction. D39 then made depths signed so a box can
// be pushed through its own origin — and the moment it inverts, the anchor is no
// longer the nearest corner. The app kept shading the same two walls, which are
// now the FAR two, so the fill sat behind the silhouette and the box stopped
// reading as an object.
//
// The walls are not stored at all now. The base ring and the top ring are stored
// (as the bottom and top faces, in matching order), and the four walls are read
// off them every frame — so they cannot be stale, and an inverted box gets the
// right pair for free. The visible pair is the two that meet at the NEAREST base
// corner; D49 has what "nearest" means, and it is not what this originally said.
//
// This also makes old drawings work unchanged: a box saved before this stored its
// walls, and those are simply ignored in favour of the ring.
function visibleFaces(solid, scene, byId) {
  // D52 — an INTERIOR. A room is a box you are inside, so every surface it has
  // faces you: the far wall, the floor, the ceiling and both side walls. The one
  // you cannot see is the opening you are looking through, which is why a room
  // stores five faces and no near one. Nothing is culled and nothing is derived —
  // a solid that has a back wall simply shows everything it has, back first.
  if (solid.faces.some(f => f.shade === "back")) {
    const rank = { back: 0, bottom: 1, top: 2, left: 3, right: 4 };
    return [...solid.faces].sort((a, b) => (rank[a.shade] ?? 9) - (rank[b.shade] ?? 9));
  }

  const bottom = solid.faces.find(f => f.shade === "bottom");
  const top = solid.faces.find(f => f.shade === "top");
  const out = [];

  // D54 — a solid made only of INCLINED planes: a roof. It stores no top and no
  // bottom, because a slope is neither — it is a top face that has been tilted —
  // so the derivation above finds nothing and, before this, drew nothing at all.
  //
  // The rule is D37's, unchanged: you see the top of a thing that sits below your
  // eye. Stand at the kerb and look up at a gable and you do not see the roof —
  // you see the wall and the underside of the eaves, which this app does not
  // model and therefore does not draw. Each plane is judged on its own middle, so
  // a roof crossing eye level loses the half that has gone over your head.
  if (!top && !bottom && solid.faces.length) {
    for (const f of solid.faces) {
      const pts = f.loop.map(id => byId.get(id)).filter(v => v && Number.isFinite(v.x) && Number.isFinite(v.y));
      if (!pts.length) continue;
      const mid = {
        x: pts.reduce((a, v) => a + v.x, 0) / pts.length,
        y: pts.reduce((a, v) => a + v.y, 0) / pts.length,
      };
      if (sideOfHorizon(scene, mid) < 0) out.push(f);
    }
    return out;
  }

  if (bottom && top && bottom.loop.length === top.loop.length && bottom.loop.length >= 3) {
    const b = bottom.loop, t = top.loop, n = b.length;
    const near = nearBaseIndex(b, byId);
    if (near >= 0) {
      // The two walls meeting at that corner: the one arriving and the one leaving.
      const walls = [];
      for (const i of [(near - 1 + n) % n, near]) {
        const k = (i + 1) % n;
        const loop = [b[i], b[k], t[k], t[i]];
        const pts = loop.map(id => byId.get(id)).filter(v => v && Number.isFinite(v.x));
        if (pts.length < 3) continue;
        walls.push({ loop, midX: pts.reduce((a, v) => a + v.x, 0) / pts.length });
      }
      // Lit from one side: the leftmost visible wall takes the darker tint. Decided
      // by position rather than by which corner it came from, so the shading stays
      // put when the box inverts instead of swapping brightness mid-drag.
      walls.sort((p, q) => p.midX - q.midX);
      walls.forEach((w, i) => out.push({ loop: w.loop, shade: i === 0 ? "left" : "right" }));
    }
  }

  // Top and bottom are decided by EYE LEVEL, which is not a shortcut — it is the
  // lesson: you see the top of a box that sits below your eye and the underside
  // of one that sits above it, and a box straddling your eye shows neither.
  for (const f of [top, bottom]) {
    if (!f) continue;
    const pts = f.loop.map(id => byId.get(id)).filter(v => v && Number.isFinite(v.x) && Number.isFinite(v.y));
    if (!pts.length) continue;
    const mid = {
      x: pts.reduce((a, v) => a + v.x, 0) / pts.length,
      y: pts.reduce((a, v) => a + v.y, 0) / pts.length,
    };
    const side = sideOfHorizon(scene, mid);
    if (f.shade === "top" && side < 0) out.push(f);      // below the horizon: you see its top
    if (f.shade === "bottom" && side > 0) out.push(f);   // above it: you see underneath
  }

  // Draw order inside a solid, and it is not arbitrary. The walls go down first;
  // the horizontal face goes LAST, because when it is visible it is the face
  // nearest the eye and occludes the parts of the walls behind it. The underside
  // needs this specifically: the base and the walls share the near base edges and
  // lie on the SAME side of them on screen, so painting the base first hid it
  // completely.
  const rank = { left: 0, right: 1, top: 2, bottom: 3 };
  out.sort((a, b2) => rank[a.shade] - rank[b2.shade]);
  return out;
}


// D40 — the edges a solid actually SHOWS.
//
// Noah, 2026-07-30: "You can see the internals of the boxes with no way to erase
// or cover the lines, otherwise."
//
// A solid was filling its faces and then stroking ALL TWELVE of its own edges
// over the top, including the three that are behind it. Filling a shape and then
// drawing its hidden edges on top of the fill is a wireframe with a grey wash,
// not a solid.
//
// An edge is shown when it lies on a face you can see — both its ends on the same
// visible face, adjacent in that face's loop. That falls out of the same eye-level
// rule that decides the faces, so hidden-line removal costs no new geometry and
// cannot disagree with the shading.
function visibleEdgeKeys(faces) {
  const keys = new Set();
  for (const f of faces) {
    for (let i = 0; i < f.loop.length; i++) {
      const a = f.loop[i], b = f.loop[(i + 1) % f.loop.length];
      keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
  }
  return keys;
}

const edgeKey = e => (e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`);

const FACE_COLOUR = { top: "faceTop", right: "faceRight", left: "faceLeft", bottom: "faceBottom", back: "faceBack" };

function fillFace(ctx, view, face, byId, c) {
  const pts = face.loop.map(id => byId.get(id)).filter(v => v && Number.isFinite(v.x) && Number.isFinite(v.y));
  if (pts.length < 3) return;              // an unsolved corner means no face, not a guess
  ctx.beginPath();
  const first = toScreen(view, pts[0]);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = toScreen(view, pts[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = c[FACE_COLOUR[face.shade]] ?? c.faceLeft;
  ctx.fill();
}

// D38 — where the rays start. A selected corner if there is one, because that is
// what the user is asking about; otherwise every anchor, which is every corner
// they placed by hand. Never every vertex: a few boxes would bury the drawing.
function raySources(scene, selection) {
  if (selection && selection.type === "vertex") {
    const v = scene.vertices.find(x => x.id === selection.id);
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return [v];
  }
  return scene.vertices.filter(v => v.kind === "anchor" && Number.isFinite(v.x) && Number.isFinite(v.y));
}

export function draw(ctx, view, viewport, opts = {}) {
  const {
    theme = "dark", dpr = 1, showGrid = true, showConstruction = true,
    ghost = null, selection = null, activeVpId = null, hoverId = null,
    extrudeHint = null,
    showSolid = false, showRays = false, showEyeLevel = true,
    faceOpacity = 1, showHidden = false,
  } = opts;
  const scene = view.scene;
  const c = themeColors(theme);
  const byId = new Map(scene.vertices.map(v => [v.id, v]));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // D43 — clear the WHOLE backing store, not the viewport rectangle.
  //
  // FOUND ON NOAH'S IPAD, 2026-07-30, on production 1.7.0: a band of squashed,
  // streaky garbage along the bottom of the canvas that survived even a Clear.
  //
  // The canvas is sized to viewport x dpr when the stage resizes. Clearing the
  // VIEWPORT rectangle is only the same thing while those two agree, and they
  // stop agreeing the moment the stage gets SHORTER without a window resize —
  // which is exactly what a wrapping toolbar does when a button changes width, or
  // Safari does when its bars come back. The uncleared strip at the bottom of the
  // buffer then keeps whatever was last drawn there, stretched by CSS into the
  // shorter box. Clearing the buffer costs the same and cannot go stale.
  ctx.clearRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);

  // document paper — the drawable area is visibly bounded
  const o = toScreen(view, { x: 0, y: 0 });
  const e = toScreen(view, { x: scene.canvas.width, y: scene.canvas.height });
  ctx.fillStyle = c.paper;
  ctx.fillRect(o.x, o.y, e.x - o.x, e.y - o.y);
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(o.x + 0.5, o.y + 0.5, e.x - o.x, e.y - o.y);

  // 1 — grid
  if (showGrid) {
    const step = 100 * view.scale;
    if (step > 12) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(o.x, o.y, e.x - o.x, e.y - o.y);
      ctx.clip();
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= scene.canvas.width; x += 100) {
        const p = toScreen(view, { x, y: 0 });
        ctx.moveTo(Math.round(p.x) + 0.5, o.y);
        ctx.lineTo(Math.round(p.x) + 0.5, e.y);
      }
      for (let y = 0; y <= scene.canvas.height; y += 100) {
        const p = toScreen(view, { x: 0, y });
        ctx.moveTo(o.x, Math.round(p.y) + 0.5);
        ctx.lineTo(e.x, Math.round(p.y) + 0.5);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // 1b — D37: solid faces, under everything that is a line. Grouped by solid and
  // drawn FARTHEST FIRST, each solid's fills immediately followed by its own
  // edges further down, so a nearer box covers a farther one instead of the two
  // becoming one wireframe blob.
  // The fills themselves are painted down in section 4, interleaved with each
  // solid's own edges. Grouping happens here because the eye-level and ray
  // sections below want to know whether there are any solids at all.
  const solids = showSolid ? groupSolids(scene, byId) : [];

  // 2 — D36: eye level and the horizon, which are NOT the same line.
  //
  // Eye level is authored and always horizontal: where the observer's eye is.
  // The horizon is the line through the vanishing points that sit on it, and if
  // there are fewer than two there is NO horizon and nothing is drawn — the app
  // does not get to invent one. When the points are level the two coincide,
  // which is the ordinary case; when they are not, the gap between them is the
  // thing being taught.
  //
  // They are told apart by DASH AND WEIGHT, not hue (§4): eye level is a long
  // dash at 1.5px, the horizon a short dash at 2px.
  if (showEyeLevel) {
    const ey = toScreen(view, { x: 0, y: scene.eyeLevel.y }).y;
    ctx.strokeStyle = c.guide;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(0, ey);
    ctx.lineTo(viewport.width, ey);
    ctx.stroke();
  }
  const horizon = horizonLine(scene);
  if (horizon) {
    const a = toScreen(view, horizon.a), b = toScreen(view, horizon.b);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const reach = viewport.width + viewport.height;
    ctx.strokeStyle = c.vp;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x - dx / len * reach, a.y - dy / len * reach);
    ctx.lineTo(b.x + dx / len * reach, b.y + dy / len * reach);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 2b — D38: rays out to every vanishing point, on request. From the selected
  // corner if there is one, otherwise from every anchor — the corners the user
  // actually placed — so the fan shows convergence without burying the drawing.
  if (showRays) {
    const from = raySources(scene, selection);
    const reach = (viewport.width + viewport.height) * 2;
    ctx.strokeStyle = c.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    for (const v of from) {
      for (const vp of scene.vanishingPoints) {
        const dx = vp.x - v.x, dy = vp.y - v.y;
        const len = Math.hypot(dx, dy);
        if (!(len > 0)) continue;
        const p = toScreen(view, v);
        const q = toScreen(view, { x: v.x + dx / len * reach, y: v.y + dy / len * reach });
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 3 — construction rays: thin, finely dashed
  if (showConstruction) {
    ctx.strokeStyle = c.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    for (const edge of scene.edges) {
      if (edge.role !== "construction") continue;
      const a = byId.get(edge.a), b = byId.get(edge.b);
      if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
      const pa = toScreen(view, a), pb = toScreen(view, b);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();
  }

  // 4 — committed edges: solid, heaviest. Selection adds weight, not just hue.
  //
  // Batched by (colour, weight, dash) into one path per style. A beginPath and
  // stroke per edge costs 2,000 driver round-trips on the drawing §11 asks
  // about, and almost every edge shares one style — so the common case becomes
  // a single stroke. Same pixels, drawn once.
  ctx.setLineDash([]);
  // Deliberately takes a plain array and no predicate. A version of this passed a
  // `skip` callback so the common path could iterate scene.edges without
  // allocating a filtered copy — which reads like an optimisation and MEASURED
  // 27.3ms -> 35.1ms at the 2,000 edges §11 asks about. A callback in the hot
  // loop cost far more than the allocation it saved. The framerate gate caught
  // it; reasoning about it did not.
  const strokeEdges = list => {
    const batches = new Map();
    for (const edge of list) {
      const a = byId.get(edge.a), b = byId.get(edge.b);
      if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
      const isSel = selection && selection.type === "edge" && selection.id === edge.id;
      const colour = isSel ? c.sel : c.ink;
      const width = (edge.style?.weight ?? 1) * 2 + (isSel ? 2 : 0);
      const dash = edge.style?.dash ? String(edge.style.dash) : "";
      const key = `${colour}|${width}|${dash}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = { colour, width, dash: dash ? dash.split(/[ ,]+/).map(Number) : [], path: new Path2D() };
        batches.set(key, batch);
      }
      const pa = toScreen(view, a), pb = toScreen(view, b);
      batch.path.moveTo(pa.x, pa.y);
      batch.path.lineTo(pb.x, pb.y);
    }
    for (const batch of batches.values()) {
      ctx.strokeStyle = batch.colour;
      ctx.lineWidth = batch.width;
      ctx.setLineDash(batch.dash);
      ctx.stroke(batch.path);
    }
  };

  const committed = scene.edges.filter(e => e.role !== "construction");
  if (showSolid && solids.length) {
    // D37 — one solid at a time, farthest first: fill, then ITS edges, so the
    // next solid's fill covers both. Drawing every fill and then every edge
    // would leave the far box's wireframe showing through the near box, which
    // is the blob this exists to remove.
    const owner = new Map();
    for (const g of solids) for (const id of g.verts) owner.set(id, g.id);
    const mine = new Map(solids.map(g => [g.id, []]));
    const loose = [];
    for (const e of committed) {
      const oa = owner.get(e.a), ob = owner.get(e.b);
      if (oa && oa === ob) mine.get(oa).push(e); else loose.push(e);
    }
    for (const g of solids) {
      const shown = visibleFaces(g, scene, byId);
      // D60 — a solid holding a DEGENERATE corner is not filled.
      //
      // When a corner is dragged exactly onto a vanishing point, the direction
      // from it to that point stops existing; the solver marks the dependent
      // corners degenerate and leaves them at their last valid position, which is
      // the right thing to store. Filling a face through those stale points draws
      // a shape nobody constructed — the crossed tangle Noah photographed. The
      // wireframe still draws, so the drawing does not vanish under the finger;
      // what stops is the app asserting a surface it cannot place.
      const unplaced = [...g.verts].some(id => byId.get(id)?.degenerate);
      ctx.save();
      ctx.globalAlpha = faceOpacity;
      if (!unplaced) for (const face of shown) fillFace(ctx, view, face, byId, c);
      ctx.restore();
      // D40 — hidden lines. At full opacity they are simply not drawn; below it
      // the solid is see-through on purpose, so drawing them back is the honest
      // thing rather than pretending a translucent object has no far side.
      const visible = visibleEdgeKeys(shown);
      const own = mine.get(g.id);
      strokeEdges(own.filter(e => visible.has(edgeKey(e))));
      if (showHidden || faceOpacity < 1) {
        ctx.save();
        ctx.globalAlpha = showHidden ? 1 : Math.max(0.25, 1 - faceOpacity);
        strokeEdges(own.filter(e => !visible.has(edgeKey(e))));
        ctx.restore();
      }
    }
    strokeEdges(loose);
  } else {
    strokeEdges(committed);
  }
  ctx.setLineDash([]);

  // 5 — vertices. A degenerate one gets a RING; everything else is drawn as a
  // SQUARE handle, because since D29 every corner can be dragged and the shape
  // says so. Before, all corners looked identical and only half of them moved —
  // Noah had to scrub each one to find out which, which is the discoverability
  // half of his report and the reason this is shape and not hue (§4): it
  // survives a greyscale render and it is legible at a glance.
  for (const v of scene.vertices) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
    const p = toScreen(view, v);
    const isSel = selection && selection.type === "vertex" && selection.id === v.id;
    ctx.fillStyle = v.degenerate ? c.bad : (isSel ? c.sel : c.ink);
    if (!v.degenerate) {
      // D30 — the three kinds of corner are three SHAPES, because they are three
      // different things and Noah could not tell them apart:
      //   anchor    filled square inside an open ring — you placed it, it is free
      //             in the plane, and it is the one that moves the whole shape
      //   ray       filled square — slides along one guide
      //   intersect open square — derived: it is where two guides cross, and it
      //             moves by adjusting the distances behind it
      // Shape, never hue (§4): it survives a greyscale render and it reads at a
      // glance instead of by scrubbing each corner to see which responds.
      const r = (isSel ? VERTEX_DOT + 1.5 : VERTEX_DOT) + 0.5;
      ctx.lineWidth = 2;
      if (v.kind === "intersect") {
        ctx.strokeStyle = isSel ? c.sel : c.ink;
        ctx.beginPath();
        ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        ctx.fill();
      }
      if (v.kind === "anchor") {
        ctx.strokeStyle = isSel ? c.sel : c.ink;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (isSel) {
        ctx.strokeStyle = c.sel;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(p.x - r - 6, p.y - r - 6, (r + 6) * 2, (r + 6) * 2);
        ctx.stroke();
      }
      continue;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, isSel ? VERTEX_DOT + 1.5 : VERTEX_DOT, 0, Math.PI * 2);
    ctx.fill();
    if (v.degenerate) {
      ctx.strokeStyle = c.bad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, VERTEX_DOT + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();                       // a cross inside the ring: unmistakable in grayscale
      ctx.moveTo(p.x - 3, p.y - 3); ctx.lineTo(p.x + 3, p.y + 3);
      ctx.moveTo(p.x + 3, p.y - 3); ctx.lineTo(p.x - 3, p.y + 3);
      ctx.stroke();
    }
  }

  // 5a — D33: the axis the second step is waiting for.
  //
  // Noah, 2026-07-30: "it would be helpful to show a double headed arrow on the
  // auto selected corner for the second step, aligned with the axis movement
  // direction, to indicate the expected user input." A standing strip says a step
  // is happening; this says WHICH WAY. Double-headed because the depth can grow or
  // shrink, and drawn in SCREEN space so it stays the same legible size at any
  // zoom — it is a pointer at the user, not part of the drawing.
  if (extrudeHint && Number.isFinite(extrudeHint.x) && Number.isFinite(extrudeHint.y)) {
    const at = toScreen(view, extrudeHint);
    // The guide's direction in screen space: with a uniform zoom this is the same
    // angle, but it is computed through the transform rather than assumed.
    const far = toScreen(view, { x: extrudeHint.x + extrudeHint.u.x * 100, y: extrudeHint.y + extrudeHint.u.y * 100 });
    const dx = far.x - at.x, dy = far.y - at.y;
    const len = Math.hypot(dx, dy) || 1;
    const u = { x: dx / len, y: dy / len };
    const REACH = 46, HEAD = 9;
    ctx.save();
    ctx.strokeStyle = c.sel;
    ctx.fillStyle = c.sel;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const s of [1, -1]) {
      const tip = { x: at.x + u.x * REACH * s, y: at.y + u.y * REACH * s };
      const base = { x: at.x + u.x * 14 * s, y: at.y + u.y * 14 * s };
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      // an arrowhead: shape, so the meaning does not depend on colour (§4)
      const n = { x: -u.y * s, y: u.x * s };
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - u.x * HEAD * s + n.x * HEAD * 0.6, tip.y - u.y * HEAD * s + n.y * HEAD * 0.6);
      ctx.lineTo(tip.x - u.x * HEAD * s - n.x * HEAD * 0.6, tip.y - u.y * HEAD * s - n.y * HEAD * 0.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 5b — CANDIDATE guide rays, from the moment a stroke begins (D15).
  //
  // A vanishing point that is off-screen has only an edge marker to aim at, and
  // that marker sits on the ray from the VIEWPORT CENTRE to the point — it is a
  // compass, not a target. Measured: VP2's marker at screen x=834 while the
  // point's true direction from the same origin left the viewport at x=1819.
  // Aiming at the marker is therefore aiming several degrees off the guide, and
  // no amount of scoring can recover an intent the gesture never contained.
  //
  // So the guide stops being something to aim at and becomes something to
  // follow: the moment a stroke starts, every candidate line through that exact
  // origin is drawn, labelled, across the whole canvas.
  if (ghost && ghost.origin && ghost.candidates?.length) {
    const far = Math.max(viewport.width, viewport.height) * 4 / view.scale;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 7]);
    for (const cand of ghost.candidates) {
      if (cand.chosen) continue;                 // the chosen one is drawn heavier below
      const a = toScreen(view, { x: ghost.origin.x - cand.u.x * far, y: ghost.origin.y - cand.u.y * far });
      const b = toScreen(view, { x: ghost.origin.x + cand.u.x * far, y: ghost.origin.y + cand.u.y * far });
      ctx.strokeStyle = c.guide;
      ctx.globalAlpha = 0.4;                     // decoration; the dash carries the meaning
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5c — the box being dragged (D21): its near edge and the two receding base
  // edges, enough to see the size and depth before letting go.
  if (ghost && ghost.box) {
    // D23: the two base edges may now be different lengths, so the preview shows
    // each at its own depth — otherwise the drag would promise a square plan and
    // deliver something else.
    const { at, height, depth, depthL, depthR } = ghost.box;
    const each = [depthL ?? depth, depthR ?? depth];
    const pts = [{ x: at.x, y: at.y - height }];
    scene.vanishingPoints.filter(v => !v.locked).slice(0, 2).forEach((vp, i) => {
      const dx = vp.x - at.x, dy = vp.y - at.y, L = Math.hypot(dx, dy) || 1;
      pts.push({ x: at.x + dx / L * each[i], y: at.y + dy / L * each[i] });
    });
    ctx.save();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    const o = toScreen(view, at);
    ctx.beginPath();
    for (const q of pts) {
      const t = toScreen(view, q);
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(t.x, t.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 6 — the active ghost ray: full length, faint, long-dashed (§3.2)
  if (ghost && ghost.origin && ghost.u) {
    const far = Math.max(viewport.width, viewport.height) * 4 / view.scale;
    const a = toScreen(view, { x: ghost.origin.x - ghost.u.x * far, y: ghost.origin.y - ghost.u.y * far });
    const b = toScreen(view, { x: ghost.origin.x + ghost.u.x * far, y: ghost.origin.y + ghost.u.y * far });
    ctx.save();
    ctx.globalAlpha = 0.55;                 // decoration only; never carries meaning
    ctx.strokeStyle = c.ghost;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([14, 8]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
    if (ghost.preview) {
      const pa = toScreen(view, ghost.preview.a), pb = toScreen(view, ghost.preview.b);
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }

  // 7 — VP handles, on-screen ones only; off-screen VPs get DOM markers so they
  // are focusable and labelled (D6).
  for (const vp of scene.vanishingPoints) {
    const m = offscreenMarker(view, vp, viewport);
    if (!m.onScreen) continue;
    const active = vp.id === activeVpId || vp.id === hoverId;
    ctx.strokeStyle = vp.locked ? c.vpLocked : c.vp;
    ctx.fillStyle = vp.locked ? c.vpLocked : c.vp;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(m.x, m.y, HANDLE_DOT, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(m.x, m.y, HANDLE_HIT - (active ? 2 : 6), 0, Math.PI * 2);
    ctx.stroke();
    if (vp.locked) {                        // locked reads as a shape, not a colour
      ctx.beginPath();
      ctx.moveTo(m.x - 5, m.y); ctx.lineTo(m.x + 5, m.y);
      ctx.stroke();
    }
  }
}

// Hit-test a VP handle in SCREEN space, so the 44px target is 44 real px at
// any zoom (§4 / Doctrine §4).
export function vpAt(view, screenPoint, viewport, radius = HANDLE_HIT) {
  let best = null, bestD = radius;
  for (const vp of view.scene.vanishingPoints) {
    const m = offscreenMarker(view, vp, viewport);
    if (!m.onScreen) continue;
    const d = Math.hypot(m.x - screenPoint.x, m.y - screenPoint.y);
    if (d <= bestD) { best = vp; bestD = d; }
  }
  return best;
}
