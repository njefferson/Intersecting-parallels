// render.mjs — canvas 2D drawing surface and the canvas↔screen transform (§8).
//
// SVG DOM will not hold 60fps under VP drag with thousands of nodes, so the
// screen is canvas and SVG is generated at export time only (§8).
//
// D6 / Doctrine §4: guides and committed lines differ by WEIGHT AND DASH, not
// hue — the drawing survives a grayscale render. Colour only ever reinforces.
// Draw order is the spec's: grid → horizon → construction → committed →
// vertices → ghost ray → handles.

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

function themeColors(theme) {
  // Colour reinforces; weight and dash carry the meaning (D6).
  return theme === "light"
    ? { ink: "#171C2B", guide: "#586079", grid: "#D5DCEA", paper: "#FFFFFF",
        vp: "#4A54C8", vpLocked: "#586079", bad: "#B03270", sel: "#0E6E88", ghost: "#586079" }
    : { ink: "#EAECF5", guide: "#8B93AD", grid: "#26304F", paper: "#141A2E",
        vp: "#8A97FF", vpLocked: "#8B93AD", bad: "#E0619E", sel: "#58C6E0", ghost: "#8B93AD" };
}

export function draw(ctx, view, viewport, opts = {}) {
  const {
    theme = "dark", dpr = 1, showGrid = true, showConstruction = true,
    ghost = null, selection = null, activeVpId = null, hoverId = null,
  } = opts;
  const scene = view.scene;
  const c = themeColors(theme);
  const byId = new Map(scene.vertices.map(v => [v.id, v]));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);

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

  // 2 — horizon: dashed, medium weight
  const hy = toScreen(view, { x: 0, y: scene.horizon.y }).y;
  ctx.strokeStyle = c.guide;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(0, hy);
  ctx.lineTo(viewport.width, hy);
  ctx.stroke();

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
  const batches = new Map();
  for (const edge of scene.edges) {
    if (edge.role === "construction") continue;
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
