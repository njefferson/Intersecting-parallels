// ui.mjs — the app: input, chrome, and the accessibility surface D6 requires.
//
// Everything a pointer can do on the canvas is also reachable from the panel,
// because a canvas cannot be tabbed into (D6). The VP list is not a readout —
// it is the real control surface: a button per point, arrow-key nudge, exact
// numeric entry, lock and on-horizon toggles.
//
// Pointer rules are §3.3 as amended by D5: pen draws, touch pans and zooms;
// with touch-draws on, touch draws and navigation becomes two-finger only,
// announced by a standing indicator with an obvious exit (Doctrine §3).

import {
  createScene, addVp, moveVp, setHorizon, solveScene, SNAP_RADIUS,
} from "./solver.mjs";
import { chooseBinding, resolveEndpoint, commitStroke, nearestVertex, nearestEdge } from "./snap.mjs";
import {
  createView, fitView, toCanvas, toScreen, zoomAt, draw, vpAt, offscreenMarker, HANDLE_HIT,
} from "./render.mjs";
import {
  createHistory, beginGesture, undo as undoHistory, redo as redoHistory, canUndo, canRedo,
  makeAutosaver, loadLastScene, listScenes, loadSceneById, saveScene, parseProjectJson,
} from "./state.mjs";
import {
  buildSvg, renderPng, probeCanvasCeiling, clampExportSize, deliver,
} from "./export.mjs";

const VERSION = "0.1.0";
const NUDGE = 1, NUDGE_BIG = 20;

const $ = id => document.getElementById(id);
const el = {
  stage: $("stage"), canvas: $("canvas"), panel: $("panel"), vpList: $("vp-list"),
  inspector: $("inspector"), horizonY: $("horizon-y"), toast: $("toast"), live: $("live"),
  touchFlag: $("touch-flag"), force: $("force"),
  undo: $("undo"), redo: $("redo"),
};

const ctx = el.canvas.getContext("2d");
let scene = createScene({ name: "untitled", width: 1600, height: 1200 });
let view = createView(scene);
let history = createHistory();
let prefs = { mode: "place", assist: true, touchDraws: false, forced: "", panel: true, showConstruction: true };
let selection = null;
let ghost = null;
let activeVpId = null;
let pngCeiling = 4096;
let pendingFrame = false;
let pendingVpMove = null;   // applied on the next frame, never per pointer event

const viewport = () => ({ width: el.stage.clientWidth, height: el.stage.clientHeight });
const theme = () => (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

function say(message) { el.live.textContent = message; }

let toastTimer = null;
function toast(message, kind = "info") {
  el.toast.textContent = message;
  el.toast.dataset.kind = kind;
  el.toast.dataset.on = "true";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.dataset.on = "false"; }, kind === "error" ? 9000 : 4500);
  say(message);
}

// ---- rendering -----------------------------------------------------------

function sizeCanvas() {
  const vp = viewport();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  el.canvas.width = Math.max(1, Math.round(vp.width * dpr));
  el.canvas.height = Math.max(1, Math.round(vp.height * dpr));
  render();
}

// Coalesce every redraw onto one rAF — never one per pointermove (§8).
function render() {
  if (pendingFrame) return;
  pendingFrame = true;
  requestAnimationFrame(() => {
    pendingFrame = false;
    if (pendingVpMove) {
      moveVp(scene, pendingVpMove.vpId, pendingVpMove.at);
      pendingVpMove = null;
    }
    const vp = viewport();
    draw(ctx, view, vp, {
      theme: theme(),
      dpr: Math.min(window.devicePixelRatio || 1, 3),
      showConstruction: prefs.showConstruction,
      ghost, selection, activeVpId,
    });
    positionMarkers(vp);
  });
}

// ---- off-canvas VP markers (real buttons — §4 and D6) --------------------

const markers = new Map();
function positionMarkers(vp) {
  const seen = new Set();
  for (const point of scene.vanishingPoints) {
    const m = offscreenMarker(view, point, vp);
    if (m.onScreen) continue;
    seen.add(point.id);
    let node = markers.get(point.id);
    if (!node) {
      node = document.createElement("button");
      node.type = "button";
      node.className = "vp-marker";
      node.addEventListener("keydown", ev => vpKeys(ev, point.id));
      node.addEventListener("pointerdown", ev => startVpDrag(ev, point.id, node));
      el.stage.appendChild(node);
      markers.set(point.id, node);
    }
    node.textContent = point.label;
    node.dataset.locked = String(!!point.locked);
    node.setAttribute("aria-label",
      `${point.label}, off screen${point.locked ? ", locked" : ""}. At ${Math.round(point.x)}, ${Math.round(point.y)}. Arrow keys move it.`);
    // A marker pinned to the viewport edge can land on top of the panel, where
    // it covers the very row that controls the same point. Step it clear
    // instead: the panel keeps its content, the marker keeps its edge.
    let { x, y } = m;
    if (prefs.panel) {
      const stageBox = el.stage.getBoundingClientRect();
      const panelBox = el.panel.getBoundingClientRect();
      const left = panelBox.left - stageBox.left, right = panelBox.right - stageBox.left;
      const top = panelBox.top - stageBox.top, bottom = panelBox.bottom - stageBox.top;
      if (x > left - 28 && x < right && y > top - 24 && y < bottom + 24) {
        x = Math.max(28, left - 32);
      }
    }
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
  }
  for (const [id, node] of markers) {
    if (!seen.has(id)) { node.remove(); markers.delete(id); }
  }
}

// ---- the VP list: the control surface ------------------------------------

// Rows are REBUILT only when the set of points changes. A nudge or a drag
// updates the existing nodes in place: rebuilding the DOM a reader is holding
// destroys their focus, which made arrow-key nudge work exactly once. Restoring
// focus afterwards would have patched the symptom — not rebuilding is the fix.
let renderedVpIds = "";

function syncPanelValues() {
  el.horizonY.value = String(Math.round(scene.horizon.y));
  for (const point of scene.vanishingPoints) {
    const row = document.getElementById(`vp-${point.id}-row`);
    if (!row) return false;
    row.dataset.active = String(point.id === activeVpId);
    const focusBtn = document.getElementById(`vp-${point.id}-focus`);
    if (focusBtn) {
      focusBtn.textContent = point.label;
      focusBtn.setAttribute("aria-label", vpButtonLabel(point));
    }
    for (const axis of ["x", "y"]) {
      const input = document.getElementById(`vp-${point.id}-${axis}`);
      if (!input) return false;
      if (document.activeElement !== input) input.value = String(Math.round(point[axis]));
      input.disabled = point.locked || (axis === "y" && point.onHorizon);
    }
    const lock = document.getElementById(`vp-${point.id}-lock`);
    const horizon = document.getElementById(`vp-${point.id}-horizon`);
    if (!lock || !horizon) return false;
    lock.setAttribute("aria-pressed", String(!!point.locked));
    horizon.setAttribute("aria-pressed", String(!!point.onHorizon));
  }
  return true;
}

function vpButtonLabel(point) {
  return `${point.label} at ${Math.round(point.x)}, ${Math.round(point.y)}${point.locked ? ", locked" : ""}. Arrow keys move it; press to centre the view on it.`;
}

function renderPanel({ structural = true } = {}) {
  el.panel.dataset.on = String(prefs.panel);
  $("show-panel").setAttribute("aria-pressed", String(prefs.panel));

  const ids = scene.vanishingPoints.map(v => `${v.id}:${v.label}`).join("|");
  if (!structural && ids === renderedVpIds && syncPanelValues()) {
    renderInspector();
    return;
  }
  renderedVpIds = ids;
  el.horizonY.value = String(Math.round(scene.horizon.y));

  el.vpList.textContent = "";
  if (!scene.vanishingPoints.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No vanishing points yet. Add VP puts one on the horizon; drag it, or type its coordinates here.";
    el.vpList.appendChild(p);
  }
  for (const point of scene.vanishingPoints) {
    const row = document.createElement("div");
    row.className = "vp-row";
    row.id = `vp-${point.id}-row`;
    row.dataset.active = String(point.id === activeVpId);

    const focusBtn = document.createElement("button");
    focusBtn.type = "button";
    focusBtn.className = "btn";
    focusBtn.id = `vp-${point.id}-focus`;
    focusBtn.style.flex = "1 1 6rem";
    focusBtn.textContent = point.label;
    focusBtn.setAttribute("aria-label", vpButtonLabel(point));
    focusBtn.addEventListener("keydown", ev => vpKeys(ev, point.id));
    focusBtn.addEventListener("click", () => {
      activeVpId = point.id;
      centreOn(point);
      say(`${point.label} centred, at ${Math.round(point.x)}, ${Math.round(point.y)}`);
      renderPanel();
      render();
    });
    row.appendChild(focusBtn);

    for (const axis of ["x", "y"]) {
      const wrap = document.createElement("span");
      wrap.className = "coord";
      const label = document.createElement("label");
      const inputId = `vp-${point.id}-${axis}`;
      label.htmlFor = inputId;
      label.textContent = axis;
      const input = document.createElement("input");
      input.type = "number";
      input.id = inputId;
      input.step = "1";
      input.value = String(Math.round(point[axis]));
      input.disabled = point.locked || (axis === "y" && point.onHorizon);
      input.addEventListener("change", () => {
        const n = Number(input.value);
        if (!Number.isFinite(n)) { input.value = String(Math.round(point[axis])); return; }
        beginGesture(history, scene);
        const next = { x: point.x, y: point.y, [axis]: n };
        const res = moveVp(scene, point.id, next);
        if (!res.ok) { toast(res.reason, "error"); return; }
        afterEdit(`${point.label} moved to ${Math.round(point.x)}, ${Math.round(point.y)}`);
      });
      wrap.append(label, input);
      row.appendChild(wrap);
    }

    row.appendChild(toggleButton("Lock", point.locked, `vp-${point.id}-lock`, () => {
      beginGesture(history, scene);
      point.locked = !point.locked;
      afterEdit(`${point.label} ${point.locked ? "locked" : "unlocked"}`);
    }, `Lock ${point.label} so it cannot be dragged`));

    row.appendChild(toggleButton("On horizon", point.onHorizon, `vp-${point.id}-horizon`, () => {
      beginGesture(history, scene);
      point.onHorizon = !point.onHorizon;
      if (point.onHorizon) point.y = scene.horizon.y;
      solveScene(scene);
      afterEdit(`${point.label} ${point.onHorizon ? "slaved to the horizon" : "freed from the horizon"}`);
    }, `Keep ${point.label} on the horizon line`));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn danger";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete ${point.label}`);
    del.addEventListener("click", () => deleteVp(point));
    row.appendChild(del);

    el.vpList.appendChild(row);
  }
  renderInspector();
  renderForceOptions();
}

function toggleButton(text, on, id, onClick, label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn";
  b.id = id;
  b.textContent = text;
  b.setAttribute("aria-pressed", String(!!on));
  if (label) b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

function deleteVp(point) {
  const usedBy = scene.vertices.filter(v =>
    (v.kind === "ray" && v.binding && v.binding.vpId === point.id) ||
    (v.kind === "intersect" && v.defs.some(d => d.binding && d.binding.vpId === point.id))
  ).length;
  const usedByEdges = scene.edges.filter(e => e.binding && e.binding.vpId === point.id).length;
  if (usedBy || usedByEdges) {
    toast(`${point.label} still holds ${usedBy} point${usedBy === 1 ? "" : "s"} and ${usedByEdges} line${usedByEdges === 1 ? "" : "s"}. Rebind or delete those first — deleting it would strand them.`, "error");
    return;
  }
  beginGesture(history, scene);
  scene.vanishingPoints = scene.vanishingPoints.filter(v => v.id !== point.id);
  if (activeVpId === point.id) activeVpId = null;
  solveScene(scene);
  afterEdit(`${point.label} deleted`, { structural: true });
}

function renderInspector() {
  el.inspector.textContent = "";
  if (!selection) return;
  const box = document.createElement("div");
  box.className = "vp-row";
  const title = document.createElement("span");
  title.className = "vp-name";
  if (selection.type === "vertex") {
    const v = scene.vertices.find(x => x.id === selection.id);
    if (!v) { selection = null; return; }
    title.textContent = `Point · ${v.kind}${v.degenerate ? " · unsolvable here" : ""}`;
    box.appendChild(title);
    const detail = document.createElement("p");
    detail.className = "hint";
    detail.textContent = v.degenerate
      ? "Its two guides are parallel or its vanishing point sits on its origin, so it is holding its last good position."
      : `At ${Math.round(v.x)}, ${Math.round(v.y)}.`;
    box.appendChild(detail);
  } else {
    const e = scene.edges.find(x => x.id === selection.id);
    if (!e) { selection = null; return; }
    const name = e.binding === "free" ? "free" :
      (typeof e.binding === "string" ? e.binding :
        (scene.vanishingPoints.find(v => v.id === e.binding.vpId)?.label ?? "free"));
    title.textContent = `Line · bound to ${name}`;
    box.appendChild(title);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn danger";
    del.textContent = "Delete line";
    del.addEventListener("click", () => {
      beginGesture(history, scene);
      scene.edges = scene.edges.filter(x => x.id !== e.id);
      selection = null;
      afterEdit("Line deleted");
    });
    box.appendChild(del);
  }
  el.inspector.appendChild(box);
}

function renderForceOptions() {
  const cur = prefs.forced;
  el.force.textContent = "";
  const opts = [["", "Guide: automatic"], ["free", "Guide: none (free)"],
    ["vertical", "Guide: vertical"], ["horizontal", "Guide: horizontal"]];
  for (const point of scene.vanishingPoints) opts.push([`vp:${point.id}`, `Guide: ${point.label}`]);
  for (const [value, text] of opts) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    el.force.appendChild(o);
  }
  el.force.value = opts.some(o => o[0] === cur) ? cur : "";
  prefs.forced = el.force.value;
}

function forcedBinding() {
  if (!prefs.forced) return null;
  if (prefs.forced === "free") return "free";
  if (prefs.forced === "vertical" || prefs.forced === "horizontal") return prefs.forced;
  return { vpId: prefs.forced.slice(3) };
}

function vpKeys(ev, vpId) {
  const step = ev.shiftKey ? NUDGE_BIG : NUDGE;
  const deltas = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const d = deltas[ev.key];
  if (!d) return;
  ev.preventDefault();
  const point = scene.vanishingPoints.find(v => v.id === vpId);
  if (!point) return;
  beginGesture(history, scene);
  const res = moveVp(scene, vpId, { x: point.x + d[0], y: point.y + d[1] });
  if (!res.ok) { toast(res.reason, "error"); return; }
  activeVpId = vpId;
  afterEdit(`${point.label} at ${Math.round(point.x)}, ${Math.round(point.y)}`);
}

function centreOn(point) {
  const vp = viewport();
  view.tx = vp.width / 2 - point.x * view.scale;
  view.ty = vp.height / 2 - point.y * view.scale;
}

// After any mutation: re-render, refresh history buttons, autosave.
// `structural` says whether the SET of points changed. A value-only change
// updates nodes in place so nobody's focus is destroyed mid-gesture.
function afterEdit(message, { structural = false } = {}) {
  refreshHistoryButtons();
  renderPanel({ structural });
  render();
  autosaver.poke();
  if (message) say(message);
}

function refreshHistoryButtons() {
  el.undo.disabled = !canUndo(history);
  el.redo.disabled = !canRedo(history);
}

// ---- pointer input (§3.3 + D5) -------------------------------------------

const pointers = new Map();
let gesture = null;   // { kind: "draw"|"pan"|"vp"|"pinch", ... }

function pointerPos(ev) {
  const r = el.canvas.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

// Does this pointer draw, or navigate? D5's whole toggle lives here.
function pointerRole(ev) {
  if (ev.pointerType === "pen") return "draw";
  if (ev.pointerType === "mouse") return ev.button === 1 || spaceHeld ? "pan" : "draw";
  return prefs.touchDraws ? "draw" : "pan";           // touch
}

let spaceHeld = false;
window.addEventListener("keydown", ev => { if (ev.code === "Space") spaceHeld = true; });
window.addEventListener("keyup", ev => { if (ev.code === "Space") spaceHeld = false; });

el.canvas.addEventListener("pointerdown", ev => {
  el.canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, pointerPos(ev));

  // Two touches always navigate — with touch-draws on this is the ONLY way to
  // navigate, which is the Procreate/Clip Studio convention D5 adopts.
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = {
      kind: "pinch",
      startDist: Math.hypot(a.x - b.x, a.y - b.y),
      startScale: view.scale,
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startTx: view.tx, startTy: view.ty,
    };
    ghost = null;
    render();
    return;
  }
  if (pointers.size > 2) return;

  const p = pointerPos(ev);
  const role = pointerRole(ev);

  const hitVp = vpAt(view, p, viewport());
  if (hitVp && role === "draw") {
    if (hitVp.locked) { toast(`${hitVp.label} is locked. Unlock it in the panel to move it.`, "error"); return; }
    beginGesture(history, scene);                       // D7: one drag, one entry
    gesture = { kind: "vp", vpId: hitVp.id };
    activeVpId = hitVp.id;
    render();
    return;
  }

  if (role === "pan") {
    gesture = { kind: "pan", from: p, tx: view.tx, ty: view.ty };
    return;
  }

  if (prefs.mode === "select") {
    const c = toCanvas(view, p);
    const v = nearestVertex(scene, c, SNAP_RADIUS / view.scale);
    selection = v ? { type: "vertex", id: v.id } : null;
    if (!selection) {
      const e = nearestEdge(scene, c, SNAP_RADIUS / view.scale);
      selection = e ? { type: "edge", id: e.id } : null;
    }
    renderPanel();
    render();
    say(selection ? `Selected a ${selection.type}` : "Nothing there");
    return;
  }

  // draw / place
  const c = toCanvas(view, p);
  const startDesc = resolveEndpoint(scene, c, SNAP_RADIUS / view.scale);
  gesture = {
    kind: "draw",
    startDesc,
    startCanvas: startDesc.at,
    dir: null,
    binding: null,
    u: null,
    last: c,
  };
  ghost = null;
  render();
});

el.canvas.addEventListener("pointermove", ev => {
  if (!pointers.has(ev.pointerId)) return;
  pointers.set(ev.pointerId, pointerPos(ev));
  if (!gesture) return;

  if (gesture.kind === "pinch" && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const factor = gesture.startDist > 0 ? dist / gesture.startDist : 1;
    view.scale = gesture.startScale;
    view.tx = gesture.startTx;
    view.ty = gesture.startTy;
    zoomAt(view, gesture.startMid, factor);
    view.tx += mid.x - gesture.startMid.x;
    view.ty += mid.y - gesture.startMid.y;
    render();
    return;
  }

  const p = pointerPos(ev);

  if (gesture.kind === "pan") {
    view.tx = gesture.tx + (p.x - gesture.from.x);
    view.ty = gesture.ty + (p.y - gesture.from.y);
    render();
    return;
  }

  if (gesture.kind === "vp") {
    // §4: if the solve exceeds one frame, decouple — solve on rAF, not on
    // pointermove. A Pencil reports at up to 120Hz against a 60Hz display, so
    // solving per event does the work twice and shows half of it. The latest
    // position wins; intermediate ones were never going to be drawn.
    pendingVpMove = { vpId: gesture.vpId, at: toCanvas(view, p) };
    render();
    return;
  }

  if (gesture.kind === "draw") {
    const c = toCanvas(view, p);
    gesture.last = c;
    const dx = c.x - gesture.startCanvas.x, dy = c.y - gesture.startCanvas.y;
    const travel = Math.hypot(dx, dy);
    // §3.2: the direction is taken after ~10 canvas px of travel, and the
    // binding is decided ONCE — from then on the line follows the ray.
    if (!gesture.binding && travel >= 10) {
      const dir = { x: dx / travel, y: dy / travel };
      const chosen = chooseBinding(scene, gesture.startCanvas, dir, {
        forced: forcedBinding(), assist: prefs.assist,
      });
      gesture.binding = chosen.binding;
      gesture.u = chosen.u;
      const name = chosen.binding === "free" ? "no guide" :
        (typeof chosen.binding === "string" ? chosen.binding :
          scene.vanishingPoints.find(v => v.id === chosen.binding.vpId)?.label);
      say(`Following ${name}`);
    }
    if (gesture.binding && gesture.u) {
      const t = (c.x - gesture.startCanvas.x) * gesture.u.x + (c.y - gesture.startCanvas.y) * gesture.u.y;
      const end = { x: gesture.startCanvas.x + t * gesture.u.x, y: gesture.startCanvas.y + t * gesture.u.y };
      ghost = { origin: gesture.startCanvas, u: gesture.u, preview: { a: gesture.startCanvas, b: end } };
    } else if (gesture.binding === "free") {
      ghost = { origin: gesture.startCanvas, u: null, preview: { a: gesture.startCanvas, b: c } };
    }
    render();
  }
});

function endPointer(ev) {
  const wasGesture = gesture;
  pointers.delete(ev.pointerId);
  if (el.canvas.hasPointerCapture?.(ev.pointerId)) el.canvas.releasePointerCapture(ev.pointerId);

  if (!wasGesture) return;
  if (wasGesture.kind === "pinch") { if (pointers.size < 2) gesture = null; return; }
  if (pointers.size > 0) return;
  gesture = null;

  if (wasGesture.kind === "vp") {
    if (pendingVpMove) { moveVp(scene, pendingVpMove.vpId, pendingVpMove.at); pendingVpMove = null; }
    const point = scene.vanishingPoints.find(v => v.id === wasGesture.vpId);
    afterEdit(point ? `${point.label} at ${Math.round(point.x)}, ${Math.round(point.y)}` : null);
    return;
  }
  if (wasGesture.kind === "pan") return;

  if (wasGesture.kind === "draw") {
    ghost = null;
    const end = wasGesture.last;
    const travel = Math.hypot(end.x - wasGesture.startCanvas.x, end.y - wasGesture.startCanvas.y);
    if (travel < 6) { render(); return; }                 // a tap, not a stroke
    let binding = wasGesture.binding;
    if (!binding) {
      const dir = { x: (end.x - wasGesture.startCanvas.x) / travel, y: (end.y - wasGesture.startCanvas.y) / travel };
      binding = chooseBinding(scene, wasGesture.startCanvas, dir, { forced: forcedBinding(), assist: prefs.assist }).binding;
    }
    beginGesture(history, scene);                          // D7: the whole stroke is one step
    const endDesc = resolveEndpoint(scene, end, SNAP_RADIUS / view.scale);
    const res = commitStroke(scene, wasGesture.startDesc, endDesc, binding);
    if (!res.ok) {
      undoHistoryInPlace();
      toast(res.reason, "error");
      return;
    }
    const v = scene.vertices.find(x => x.id === res.b);
    afterEdit(v && v.kind === "intersect" ? "Line drawn, corner locked to both guides" : "Line drawn");
  }
}

function undoHistoryInPlace() {
  const restored = undoHistory(history, scene);
  if (restored) adoptScene(restored, { keepView: true });
}

el.canvas.addEventListener("pointerup", endPointer);
el.canvas.addEventListener("pointercancel", endPointer);

el.canvas.addEventListener("wheel", ev => {
  ev.preventDefault();
  zoomAt(view, pointerPos(ev), ev.deltaY < 0 ? 1.1 : 1 / 1.1);
  render();
}, { passive: false });

// A VP dragged by its off-canvas marker (§4 — never make the user zoom out).
function startVpDrag(ev, vpId, node) {
  const point = scene.vanishingPoints.find(v => v.id === vpId);
  if (!point) return;
  if (point.locked) { toast(`${point.label} is locked. Unlock it in the panel to move it.`, "error"); return; }
  ev.preventDefault();
  node.setPointerCapture(ev.pointerId);
  const start = { x: ev.clientX, y: ev.clientY };
  const origin = { x: point.x, y: point.y };
  beginGesture(history, scene);
  activeVpId = vpId;
  const move = e => {
    const dx = (e.clientX - start.x) / view.scale;
    const dy = (e.clientY - start.y) / view.scale;
    moveVp(scene, vpId, { x: origin.x + dx, y: origin.y + dy });
    render();
  };
  const up = e => {
    node.releasePointerCapture?.(e.pointerId);
    node.removeEventListener("pointermove", move);
    node.removeEventListener("pointerup", up);
    node.removeEventListener("pointercancel", up);
    afterEdit(`${point.label} at ${Math.round(point.x)}, ${Math.round(point.y)}`);
  };
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", up);
}

// ---- scene lifecycle -----------------------------------------------------

function adoptScene(next, { keepView = false } = {}) {
  scene = next;
  view.scene = scene;
  if (!keepView) fitView(view, viewport());
  selection = null;
  ghost = null;
  solveScene(scene);
  refreshHistoryButtons();
  renderPanel();
  render();
}

function newScene({ width, height, points }) {
  const s = createScene({ name: "untitled", width, height });
  setHorizon(s, Math.round(height * 0.45));
  const spread = width * 1.35;
  if (points >= 1) addVp(s, { label: "VP1", x: Math.round(width / 2 - spread), y: s.horizon.y, axis: "x", onHorizon: true });
  if (points >= 2) addVp(s, { label: "VP2", x: Math.round(width / 2 + spread), y: s.horizon.y, axis: "y", onHorizon: true });
  if (points >= 3) addVp(s, { label: "VP3", x: Math.round(width / 2), y: Math.round(height * 2.2), axis: "z", onHorizon: false });
  return s;
}

// ---- toolbar wiring ------------------------------------------------------

function setMode(mode) {
  prefs.mode = mode;
  for (const [id, m] of [["mode-place", "place"], ["mode-draw", "draw"], ["mode-select", "select"]]) {
    $(id).setAttribute("aria-pressed", String(prefs.mode === m));
  }
  say(`${mode === "place" ? "Place" : mode === "draw" ? "Draw" : "Select"} mode`);
  autosaver.poke();
}
$("mode-place").addEventListener("click", () => setMode("place"));
$("mode-draw").addEventListener("click", () => setMode("draw"));
$("mode-select").addEventListener("click", () => setMode("select"));

$("assist").addEventListener("click", () => {
  prefs.assist = !prefs.assist;
  $("assist").setAttribute("aria-pressed", String(prefs.assist));
  toast(prefs.assist ? "Guides on — strokes snap to a vanishing point" : "Guides off — strokes stay exactly as drawn");
  autosaver.poke();
});

el.force.addEventListener("change", () => {
  prefs.forced = el.force.value;
  autosaver.poke();
});

$("undo").addEventListener("click", () => {
  const restored = undoHistory(history, scene);
  if (!restored) return;
  adoptScene(restored, { keepView: true });
  say("Undone");
  autosaver.poke();
});
$("redo").addEventListener("click", () => {
  const restored = redoHistory(history, scene);
  if (!restored) return;
  adoptScene(restored, { keepView: true });
  say("Redone");
  autosaver.poke();
});

$("add-vp").addEventListener("click", () => {
  beginGesture(history, scene);
  const centre = toCanvas(view, { x: viewport().width / 2, y: viewport().height / 2 });
  const res = addVp(scene, { label: `VP${scene.vanishingPoints.length + 1}`, x: Math.round(centre.x), y: Math.round(centre.y), axis: "z", onHorizon: false });
  afterEdit(`${res.vp.label} added at ${Math.round(res.vp.x)}, ${Math.round(res.vp.y)}`, { structural: true });
});

$("show-panel").addEventListener("click", () => { prefs.panel = !prefs.panel; renderPanel(); autosaver.poke(); });
$("panel-close").addEventListener("click", () => { prefs.panel = false; renderPanel(); $("show-panel").focus(); });

el.horizonY.addEventListener("change", () => {
  const n = Number(el.horizonY.value);
  if (!Number.isFinite(n)) { el.horizonY.value = String(Math.round(scene.horizon.y)); return; }
  beginGesture(history, scene);
  setHorizon(scene, n);
  afterEdit(`Horizon at ${Math.round(scene.horizon.y)}`);
});

// D5's toggle, with the standing indicator and its obvious exit.
function setTouchDraws(on) {
  prefs.touchDraws = on;
  el.touchFlag.dataset.on = String(on);
  $("touch-draws").setAttribute("aria-pressed", String(on));
  toast(on
    ? "Touch draws. Two fingers pan and zoom."
    : "Touch pans and zooms. Use a pencil to draw.");
  autosaver.poke();
}
$("touch-draws").addEventListener("click", () => setTouchDraws(!prefs.touchDraws));
$("touch-exit").addEventListener("click", () => { setTouchDraws(false); $("touch-draws").focus(); });

// ---- export --------------------------------------------------------------

const dlgExport = $("dlg-export");
$("open-export").addEventListener("click", () => {
  $("ex-w").value = String(scene.canvas.width);
  $("ex-h").value = String(scene.canvas.height);
  dlgExport.showModal();
});

$("do-svg").addEventListener("click", async () => {
  const svg = buildSvg(scene, {
    includeConstruction: $("ex-construction").checked,
    strokeWeight: Number($("ex-weight").value) || 1,
    hairline: $("ex-hairline").checked,
  });
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const res = await deliver(blob, `${(scene.name || "drawing").replace(/[^\w.-]+/g, "-")}.svg`, { preferShare: true });
  if (res.ok) toast("SVG saved.");
  else if (res.reason !== "cancelled") toast("Could not save the SVG.", "error");
});

$("do-png").addEventListener("click", async () => {
  const want = { width: Number($("ex-w").value) || scene.canvas.width, height: Number($("ex-h").value) || scene.canvas.height };
  const size = clampExportSize(want, pngCeiling);
  const canvas = renderPng(scene, {
    width: size.width, height: size.height,
    strokeWeight: Number($("ex-weight").value) || 1,
    includeConstruction: $("ex-construction").checked,
  });
  const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
  if (!blob) { toast("This device refused to render a PNG that large. Try smaller dimensions.", "error"); return; }
  const res = await deliver(blob, `${(scene.name || "drawing").replace(/[^\w.-]+/g, "-")}.png`, { preferShare: true });
  if (res.ok) toast(size.clamped ? size.message : `PNG saved at ${size.width}×${size.height}.`, size.clamped ? "error" : "info");
  else if (res.reason !== "cancelled") toast("Could not save the PNG.", "error");
});

// ---- project -------------------------------------------------------------

const dlgProject = $("dlg-project");
$("open-project").addEventListener("click", async () => {
  $("pr-name").value = scene.name || "";
  await refreshProjectList();
  dlgProject.showModal();
});

async function refreshProjectList() {
  const list = $("pr-list");
  list.textContent = "";
  let saved = [];
  try { saved = await listScenes(); } catch { /* storage unavailable — say so below */ }
  if (!saved.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Nothing saved on this device yet. Your drawing autosaves as you work.";
    list.appendChild(p);
    return;
  }
  for (const rec of saved.sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0))) {
    const row = document.createElement("div");
    row.className = "proj-row";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = rec.name || "untitled";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn";
    open.textContent = "Open";
    open.setAttribute("aria-label", `Open ${rec.name || "untitled"}`);
    open.addEventListener("click", async () => {
      const got = await loadSceneById(rec.id);
      if (!got) { toast("That drawing could not be read.", "error"); return; }
      history = createHistory();
      adoptScene(got.scene);
      dlgProject.close();
      toast(`Opened ${got.scene.name || "untitled"}.`);
    });
    row.append(nm, open);
    list.appendChild(row);
  }
}

$("pr-name").addEventListener("change", () => {
  scene.name = $("pr-name").value.trim() || "untitled";
  autosaver.poke();
  say(`Named ${scene.name}`);
});

$("pr-new").addEventListener("click", async () => {
  const width = Math.max(16, Number($("pr-w").value) || 1600);
  const height = Math.max(16, Number($("pr-h").value) || 1200);
  const points = Number($("pr-points").value) || 2;
  await autosaver.flush();                      // the current drawing is kept, not dropped
  history = createHistory();
  adoptScene(newScene({ width, height, points }));
  dlgProject.close();
  toast(`New ${points}-point drawing, ${width}×${height}.`);
});

$("pr-save").addEventListener("click", async () => {
  const blob = new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" });
  const res = await deliver(blob, `${(scene.name || "drawing").replace(/[^\w.-]+/g, "-")}.json`, { preferShare: true });
  if (res.ok) toast("Project file saved.");
  else if (res.reason !== "cancelled") toast("Could not save the project file.", "error");
});

$("pr-load").addEventListener("click", () => $("pr-file").click());
$("pr-file").addEventListener("change", async ev => {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  const text = await file.text();
  const parsed = parseProjectJson(text);
  // Nothing is touched until the file has answered every question the load
  // would ask — a validate-then-clear that clears first eventually clears and
  // then fails (hub LESSONS).
  if (!parsed.ok) { toast(`That file was not opened: ${parsed.reason}.`, "error"); return; }
  await autosaver.flush();
  history = createHistory();
  adoptScene(parsed.scene);
  dlgProject.close();
  toast(`Opened ${scene.name || "untitled"}.`);
});

// ---- about ---------------------------------------------------------------

$("open-about").addEventListener("click", () => {
  $("about-version").textContent = `Version ${VERSION}`;
  $("dlg-about").showModal();
});

// ---- boot ----------------------------------------------------------------

const autosaver = makeAutosaver(() => scene, () => prefs);

window.addEventListener("resize", sizeCanvas);
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", render);
document.addEventListener("visibilitychange", () => { if (document.hidden) autosaver.flush(); });

(async function boot() {
  let restored = null;
  try { restored = await loadLastScene(); } catch { /* first run, or storage blocked */ }
  if (restored && restored.scene) {
    scene = restored.scene;
    if (restored.prefs) prefs = { ...prefs, ...restored.prefs };
    view.scene = scene;
    solveScene(scene);
  } else {
    scene = newScene({ width: 1600, height: 1200, points: 2 });
    view.scene = scene;
  }
  sizeCanvas();
  fitView(view, viewport());
  setMode(prefs.mode);
  $("assist").setAttribute("aria-pressed", String(prefs.assist));
  el.touchFlag.dataset.on = String(prefs.touchDraws);
  $("touch-draws").setAttribute("aria-pressed", String(prefs.touchDraws));
  refreshHistoryButtons();
  renderPanel();
  render();

  try { pngCeiling = probeCanvasCeiling(); } catch { pngCeiling = 2048; }
  $("ex-ceiling").textContent = `This device renders up to ${pngCeiling}px per side. Anything larger is scaled down rather than saved blank.`;

  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/sw.js"); } catch { /* offline support unavailable; the app still runs */ }
  }

  // A deliberate, read-mostly hook onto the running app, used by walk.mjs to
  // drive the REAL page rather than a copy of its logic (Doctrine §6). It ships
  // knowingly: this app holds no secrets and talks to no server, so the hook
  // exposes nothing a reader could not already read from their own drawing —
  // and a gate that can only test a rebuilt approximation of the app is not
  // testing the app. `scene` is live state; treat it as read-only.
  window.__ip = {
    get scene() { return scene; },
    get canvas() { return { width: el.canvas.width, height: el.canvas.height }; },
    moveVp: (id, p) => { const r = moveVp(scene, id, p); render(); return r; },
    toScreen: p => toScreen(view, p),
    buildSvg, renderPng,
    flush: () => autosaver.flush(),
    version: VERSION,
  };
})();
