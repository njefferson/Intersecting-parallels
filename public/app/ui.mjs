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
  createScene, addVp, moveVp, setEyeLevel, solveScene, SNAP_RADIUS, bindingDirection, horizonLine,
  deleteVp as deleteVpFromScene, deleteVertex, moveAnchor, rebindVertex,
  clearDrawing, clearAll, manipulate, ancestorParams, migrateScene, scaleVpSpread, markIntervals, addFigure, buildRoom, axisPointCount, buildStreet, circlePoints, addVpFromLines,
} from "./solver.mjs";
import { chooseBinding, resolveEndpoint, resolveStrokeEnd, commitStroke, buildBox, buildRoof, buildCircle, splitBoxDepths, nearestVertex, nearestEdge, bindingName, effectiveBinding } from "./snap.mjs";
import {
  createView, fitView, fitAll, toCanvas, toScreen, zoomAt, draw, vpAt, offscreenMarker, HANDLE_HIT,
} from "./render.mjs";
import {
  createHistory, beginGesture, undo as undoHistory, redo as redoHistory, canUndo, canRedo,
  makeAutosaver, loadLastScene, listScenes, loadSceneById, saveScene, parseProjectJson,
  saveUnderlay, loadUnderlay, clearUnderlay,
} from "./state.mjs";
import {
  buildSvg, renderPng, probeCanvasCeiling, clampExportSize, deliver,
} from "./export.mjs";

const VERSION = "1.18.0";
const NUDGE = 1, NUDGE_BIG = 20;
// D13: in SCREEN px, because that is where a hand's noise lives — canvas px
// shrink with zoom and stop describing the gesture. D19 removed the companion
// LOCK_TRAVEL: the guide is re-picked for the whole stroke now, so it can be
// switched mid-line, and hysteresis rather than a lock keeps it steady.
const MIN_TRAVEL = 10;    // before any guide is offered at all

const $ = id => document.getElementById(id);
const el = {
  stage: $("stage"), canvas: $("canvas"), panel: $("panel"), vpList: $("vp-list"),
  inspector: $("inspector"), horizonY: $("horizon-y"), toast: $("toast"), live: $("live"),
  touchFlag: $("touch-flag"), force: $("force"), build: $("build-stamp"),
  extrudeFlag: $("extrude-flag"), extrudeSay: $("extrude-say"), setup: $("setup"),
  undo: $("undo"), redo: $("redo"), streetBlocks: $("street-blocks"),
};

const ctx = el.canvas.getContext("2d");
let scene = createScene({ name: "untitled", width: 1600, height: 1200 });
let view = createView(scene);
let history = createHistory();
let prefs = { mode: "place", assist: true, touchDraws: false, forced: "", panel: true, showConstruction: true, snap45: false, weld: true, solid: false, rays: false, eyeLevel: true, grid: true, faceOpacity: 1, showHidden: false, setup: false };
let selection = null;
let ghost = null;
let activeVpId = null;
let pngCeiling = 4096;
let pendingFrame = false;
let pendingVpMove = null;   // applied on the next frame, never per pointer event
let pendingManipulate = null;   // D29 — same, for a corner drag's inverse solve
let manipulateWarned = false;

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
    // D29 — same rule for corners: one inverse solve per FRAME, never one per
    // pointer event. The solve is 1-4% of a frame, but a finger emits far more
    // events than there are frames.
    if (pendingManipulate) {
      const r = manipulate(scene, pendingManipulate.vertexId, pendingManipulate.target);
      if (!r.ok && !manipulateWarned) { manipulateWarned = true; toast(r.reason, "error"); }
      pendingManipulate = null;
      renderPanel({ structural: false });
    }
    const vp = viewport();
    draw(ctx, view, vp, {
      theme: theme(),
      dpr: Math.min(window.devicePixelRatio || 1, 3),
      showConstruction: prefs.showConstruction,
      showSolid: prefs.solid, showRays: prefs.rays, showEyeLevel: prefs.eyeLevel,
      showGrid: prefs.grid, faceOpacity: prefs.faceOpacity, showHidden: prefs.showHidden,
      underlay,
      ghost, selection, activeVpId,
      extrudeHint: extrudeArrow(),
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
    // D27 — an off-screen marker must not read as the point itself.
    //
    // Noah, 2026-07-30: "The VP indicators, when the VP is off screen, need an
    // arrow or something because I keep confusing them as the real VP." He is
    // describing the same class of mistake D15 fixed for aiming: the marker is a
    // COMPASS, not the point. It sits on the ray from the viewport centre, so it
    // is nowhere near where the point actually is.
    //
    // So it carries an arrowhead pointing the way, and the distance in canvas px.
    // Shape and text, not colour, do the work (§4): the arrow survives a
    // greyscale render and a screen reader gets the same sentence.
    const dist = Math.round(Math.hypot(point.x - scene.canvas.width / 2, point.y - scene.canvas.height / 2));
    node.textContent = "";
    const arrow = document.createElement("span");
    arrow.className = "vp-marker-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.style.transform = `rotate(${(m.angle ?? 0)}rad)`;
    arrow.textContent = "\u27A4";                  // a solid arrowhead, rotated to point at the point
    const name = document.createElement("span");
    name.textContent = point.label;
    node.append(arrow, name);
    node.dataset.locked = String(!!point.locked);
    node.dataset.offscreen = "true";
    node.setAttribute("aria-label",
      `${point.label} is OFF SCREEN${point.locked ? ", locked" : ""}. This marker points toward it; the point itself is about ${dist} away at ${Math.round(point.x)}, ${Math.round(point.y)}. Arrow keys move it.`);
    node.title = `${point.label} is off screen — this arrow points at it, it is not the point`;
    // A marker pinned to the viewport edge can land on top of the panel, where
    // it covers the very row that controls the same point. Step it clear
    // instead: the panel keeps its content, the marker keeps its edge.
    let { x, y } = m;
    // D47 — there are two panels now, and the Setup one docks on the LEFT, so a
    // marker gets stepped away from whichever side it collides with rather than
    // always leftwards. Stepping a left-docked panel's marker further left would
    // push it off the screen entirely.
    const stageBox = el.stage.getBoundingClientRect();
    for (const [on, node2, pushLeft] of [[prefs.panel, el.panel, true], [prefs.setup, el.setup, false]]) {
      if (!on || !node2) continue;
      const box = node2.getBoundingClientRect();
      const left = box.left - stageBox.left, right = box.right - stageBox.left;
      const top = box.top - stageBox.top, bottom = box.bottom - stageBox.top;
      if (x > left - 28 && x < right + 28 && y > top - 24 && y < bottom + 24) {
        x = pushLeft ? Math.max(28, left - 32) : Math.min(stageBox.width - 28, right + 32);
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
  el.horizonY.value = String(Math.round(scene.eyeLevel.y));
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
  el.horizonY.value = String(Math.round(scene.eyeLevel.y));

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
      solveScene(scene);
      afterEdit(`${point.label} ${point.onHorizon ? "slaved to the horizon" : "freed from the horizon"}`);
    }, `On horizon — keep ${point.label} on the horizon line`));

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
  beginGesture(history, scene);
  const res = deleteVpFromScene(scene, point.id);
  if (!res.ok) { toast(res.reason, "error"); return; }
  if (activeVpId === point.id) activeVpId = null;
  if (selection) selection = null;
  // D17: say exactly what happened to the work, because "deleted" alone leaves
  // the reader wondering what it cost them.
  const parts = [];
  if (res.freed) parts.push(`${res.freed} line${res.freed === 1 ? "" : "s"} kept exactly where ${res.freed === 1 ? "it is" : "they are"}, now with no guide`);
  if (res.frozen) parts.push(`${res.frozen} point${res.frozen === 1 ? "" : "s"} frozen in place`);
  if (res.removedEdges) parts.push(`${res.removedEdges} line${res.removedEdges === 1 ? "" : "s"} that never had a position removed`);
  toast(parts.length ? `${res.label} deleted — ${parts.join(", ")}.` : `${res.label} deleted.`);
  afterEdit(null, { structural: true });
}

// Same markup as the VP panel's coordinate boxes, deliberately: it inherits the
// `.coord label` contrast pair the a11y registry already covers and the 44px
// target the class already carries, instead of introducing a second styling of
// the same idea.
function numberField(id, label, value, commit) {
  const wrap = document.createElement("span");
  wrap.className = "coord";
  const lab = document.createElement("label");
  lab.htmlFor = id;
  lab.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.id = id;
  input.step = "1";
  input.value = String(value);
  const apply = () => {
    const n = Number(input.value);
    if (!Number.isFinite(n)) { input.value = String(value); return; }
    commit(n);
  };
  input.addEventListener("change", apply);
  input.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); apply(); } });
  wrap.append(lab, input);
  return wrap;
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
    // D17: this used to be a dead end — tapping near a line's end selected the
    // point, and a point had nothing to delete.
    const usedBy = scene.edges.filter(e => e.a === v.id || e.b === v.id).length;
    const delPoint = document.createElement("button");
    delPoint.type = "button";
    delPoint.className = "btn danger";
    delPoint.textContent = usedBy ? `Delete point and ${usedBy} line${usedBy === 1 ? "" : "s"}` : "Delete point";
    delPoint.addEventListener("click", () => {
      beginGesture(history, scene);
      const res = deleteVertex(scene, v.id);
      if (!res.ok) { toast(res.reason, "error"); return; }
      selection = null;
      toast(res.removedEdges
        ? `Point deleted, with ${res.removedEdges} line${res.removedEdges === 1 ? "" : "s"} that ended on it. Undo puts it back.`
        : "Point deleted. Undo puts it back.");
      afterEdit(null);
    });

    // D23 — a corner is editable, not just deletable. NOTES claimed a box's
    // corners were "adjustable afterwards precisely because they are
    // constrained"; they were adjustable in the data model and unreachable in
    // the app, which made the claim untrue. Which control appears depends on
    // what holds the point, because that IS the honest answer:
    //   · anchor    — free in the plane, so x and y
    //   · ray       — rides one guide, so a DISTANCE along it. On a box's base
    //                 corner that distance is the depth, which is how each depth
    //                 is now set separately.
    //   · intersect — where two guides cross. Nothing to set: it is wherever they
    //                 meet, and saying so is better than offering a control that
    //                 would have to move something else behind the user's back.
    if (v.kind === "anchor") {
      box.appendChild(numberField(`vtx-${v.id}-x`, "x", Math.round(v.x), value => {
        beginGesture(history, scene);
        const r = moveAnchor(scene, v.id, { x: value, y: v.y });
        if (!r.ok) { toast(r.reason, "error"); return; }
        afterEdit(`Corner at ${Math.round(v.x)}, ${Math.round(v.y)}`);
      }));
      box.appendChild(numberField(`vtx-${v.id}-y`, "y", Math.round(v.y), value => {
        beginGesture(history, scene);
        const r = moveAnchor(scene, v.id, { x: v.x, y: value });
        if (!r.ok) { toast(r.reason, "error"); return; }
        afterEdit(`Corner at ${Math.round(v.x)}, ${Math.round(v.y)}`);
      }));
    } else if (v.kind === "ray") {
      const along = bindingName(scene, v.binding);
      box.appendChild(numberField(`vtx-${v.id}-t`, "distance", Math.round(v.t), value => {
        beginGesture(history, scene);
        const r = rebindVertex(scene, v.id, { t: value });
        if (!r.ok) { toast(r.reason, "error"); return; }
        afterEdit(`${Math.round(value)} along ${along}`);
      }));
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = `Rides ${along}. Distance is signed — a negative number goes the other way along the same guide.`;
      box.appendChild(note);
    } else {
      // D29 — an intersect corner has no coordinates of its own, but it is no
      // longer a dead end: it moves by adjusting the numbers behind it, and the
      // panel says which those are and offers them. Before, this was a sentence
      // and nothing else, while the drag silently did nothing at all.
      const params = ancestorParams(scene, v.id)
        .map(id => scene.vertices.find(x => x.id === id))
        .filter(Boolean);
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = params.length
        ? `Held where two guides cross. Dragging it, or nudging it with the arrow keys, adjusts the ${params.length} distance${params.length === 1 ? "" : "s"} below.`
        : "Held where two guides cross, and everything that defines it is fixed.";
      box.appendChild(note);
      for (const p of params) {
        box.appendChild(numberField(`vtx-${p.id}-t`, bindingName(scene, p.binding), Math.round(p.t), value => {
          beginGesture(history, scene);
          const r = rebindVertex(scene, p.id, { t: value });
          if (!r.ok) { toast(r.reason, "error"); return; }
          afterEdit(`${Math.round(value)} along ${bindingName(scene, p.binding)}`);
        }));
      }
    }
    box.appendChild(delPoint);
  } else {
    const e = scene.edges.find(x => x.id === selection.id);
    if (!e) { selection = null; return; }
    // D12: report the binding the geometry still satisfies, not the stored
    // label — a line the reader can see is not converging must not be
    // described as bound.
    const live = effectiveBinding(scene, e);
    title.textContent = live === "free"
      ? "Line · no guide"
      : `Line · bound to ${bindingName(scene, live)}`;
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

// D15: the candidate guide lines through a stroke's origin — one per unlocked
// vanishing point, plus the two axes. Drawn faint until one is chosen.
function candidateRays(origin) {
  const out = [];
  for (const vp of scene.vanishingPoints) {
    if (vp.locked) continue;
    const u = bindingDirection(scene, origin, { vpId: vp.id });
    if (u) out.push({ u, label: vp.label, vpId: vp.id });
  }
  out.push({ u: { x: 0, y: 1 }, label: "vertical" });
  out.push({ u: { x: 1, y: 0 }, label: "horizontal" });
  if (prefs.snap45) {
    out.push({ u: { x: Math.SQRT1_2, y: Math.SQRT1_2 }, label: "45°" });
    out.push({ u: { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, label: "135°" });
  }
  return out;
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
  refreshAddVp();          // D41: same refresh, so it can never lag the scene
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
  // Capture can throw when the pointer is already gone (Safari does this on a
  // fast tap). Losing capture costs a little tracking accuracy; throwing here
  // would abandon the stroke entirely.
  try { el.canvas.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
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
    // D17: SNAP_RADIUS is 12px — a drawing tolerance, and far too small to be
    // a TAP target. Doctrine §4 wants 44px, so selecting uses HANDLE_HIT (22px
    // radius) like every other handle. Noah could not delete a line because he
    // could not hit one.
    const pick = HANDLE_HIT / view.scale;
    const v = nearestVertex(scene, c, pick);
    selection = v ? { type: "vertex", id: v.id } : null;
    if (selection) el.canvas.focus({ preventScroll: true });   // D26: the keys need a home
    if (!selection) {
      const e = nearestEdge(scene, c, pick);
      selection = e ? { type: "edge", id: e.id } : null;
    }
    // D26 — and it can be DRAGGED. Noah, 2026-07-30: "I tried dragging a box
    // corner with my finger and it would not move." It did not: a corner had a
    // numeric field and nothing else, which fails §3's direct manipulation ("what
    // he touches must respond") even though it satisfied the non-drag half of
    // §4's pair. Both halves are required, and the keyboard nudge above is this
    // drag's declared alternative.
    if (v) {
      gesture = {
        kind: "vertex",
        vertexId: v.id,
        kindOf: v.kind,
        startCanvas: c,
        startPos: { x: v.x, y: v.y },
        startT: v.t,
        moved: false,
      };
    }
    renderPanel();
    render();
    if (selection) say(`Selected a ${selection.type}`);
    else toast("Nothing there — tap closer to a line or one of its ends", "info");
    return;
  }

  // D31 — the second step. It takes precedence over starting another box,
  // because that is what "immediately draggable" means: the drag you make next
  // is the one that finishes this box.
  if (extruding) {
    const ray = scene.vertices.find(v => v.id === extruding.rayId);
    if (ray) {
      gesture = {
        kind: "extrude",
        rayId: ray.id,
        startCanvas: toCanvas(view, p),
        startPos: { x: ray.x, y: ray.y },
        moved: false,
      };
      render();
      return;
    }
    endExtrude(false);
  }

  if (prefs.mode === "box") {
    // D21: one drag builds the whole box. Its start is the near bottom corner,
    // which may join an existing end like any other start (D20).
    const c0 = toCanvas(view, p);
    const startDesc = resolveEndpoint(scene, c0, SNAP_RADIUS / view.scale, { join: prefs.weld });
    gesture = { kind: "box", at: startDesc.at, height: 0, depthL: 0, depthR: 0, last: c0 };
    render();
    return;
  }

  // draw / place
  const c = toCanvas(view, p);
  // D20: a stroke's START may join an existing end. Joining there cannot change
  // any direction, because the guide is computed THROUGH the start point — and
  // starting a new line exactly on an existing corner is most of what "connect
  // line ends" means.
  const startDesc = resolveEndpoint(scene, c, SNAP_RADIUS / view.scale, { join: prefs.weld });
  gesture = {
    kind: "draw",
    startDesc,
    startCanvas: startDesc.at,
    dir: null,
    binding: null,
    u: null,
    last: c,
    // D11: a fingertip aims coarser than a stylus, so the band it snaps within
    // is wider. Captured at pointerdown — one stroke, one instrument.
    pointerType: ev.pointerType,
    // D15: every guide available from THIS origin, so the line to follow is
    // visible from the first moment instead of having to be aimed at.
    candidates: candidateRays(startDesc.at),
  };
  ghost = { origin: gesture.startCanvas, u: null, candidates: gesture.candidates };
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

  if (gesture.kind === "extrude") {
    const c = toCanvas(view, p);
    const dx = c.x - gesture.startCanvas.x, dy = c.y - gesture.startCanvas.y;
    if (!gesture.moved && Math.hypot(dx, dy) * view.scale < 4) return;
    if (!gesture.moved) { beginGesture(history, scene); gesture.moved = true; }   // D7
    // Same manipulate() as every other move: it projects onto that guide, so the
    // depth follows the drag however the finger travels.
    pendingManipulate = {
      vertexId: gesture.rayId,
      target: { x: gesture.startPos.x + dx, y: gesture.startPos.y + dy },
    };
    render();
    return;
  }

  if (gesture.kind === "vertex") {
    const c = toCanvas(view, p);
    const v = scene.vertices.find(x => x.id === gesture.vertexId);
    if (!v) return;
    const dx = c.x - gesture.startCanvas.x, dy = c.y - gesture.startCanvas.y;
    if (!gesture.moved && Math.hypot(dx, dy) * view.scale < 4) return;   // a tap, not a drag
    if (!gesture.moved) {
      // D7 — history opens at the moment it becomes a drag, so a tap that only
      // selects leaves no empty step behind. (Before D29 this was a
      // restore-and-reapply dance at release, which could not work for a corner
      // whose position is not stored anywhere.)
      beginGesture(history, scene);
      gesture.moved = true;
    }
    // D29 — the grab offset is preserved: the corner follows the finger from
    // where it was picked up, rather than jumping its centre to the fingertip.
    pendingManipulate = {
      vertexId: v.id,
      target: { x: gesture.startPos.x + dx, y: gesture.startPos.y + dy },
    };
    render();
    return;
  }

  if (gesture.kind === "box") {
    const c = toCanvas(view, p);
    gesture.last = c;
    const split = splitBoxDepths(scene, gesture.at, c);      // D23
    gesture.height = split.height;
    gesture.depthL = split.depthL;
    gesture.depthR = split.depthR;
    ghost = { origin: gesture.at, u: null, box: { at: gesture.at, height: split.height, depthL: split.depthL, depthR: split.depthR } };
    render();
    return;
  }

  if (gesture.kind === "draw") {
    const c = toCanvas(view, p);
    gesture.last = c;
    const dx = c.x - gesture.startCanvas.x, dy = c.y - gesture.startCanvas.y;
    const travel = Math.hypot(dx, dy);
    // D13 — decide the guide from a sample worth trusting.
    //
    // §3.2 says take the direction after ~10 CANVAS px and decide once. At a
    // fit-to-screen zoom that is about five SCREEN pixels, which on a fingertip
    // is the roll of the finger settling, not an aim. Measured on Noah's scene:
    // a stroke aimed at VP2 came out 9.2° off its guide while VP1's line — the
    // same line ridden backwards — sat 9.6° away, so which point captured the
    // stroke was a coin toss, and one in six landed on VP1 and missed VP2 by
    // 700px.
    //
    // So the sample is measured in SCREEN px, where the hand's noise actually
    // lives. §3.2's "decide once" is gone entirely (D19): the guide is re-picked
    // for the whole stroke so it can be switched mid-line, and hysteresis rather
    // than a lock is what stops the line wandering under the finger.
    const screenTravel = travel * view.scale;
    if (screenTravel >= MIN_TRAVEL) {
      const dir = { x: dx / travel, y: dy / travel };
      // D19: re-picked on every move, for the whole stroke — swing the finger
      // toward another guide and the line goes with it. `current` is the
      // incumbent, which a rival must out-fit by SWITCH_MARGIN to take over.
      const chosen = chooseBinding(scene, gesture.startCanvas, dir, {
        forced: forcedBinding(), assist: prefs.assist,
        diagonals: prefs.snap45, current: gesture.binding,
      });
      const changed = JSON.stringify(chosen.binding) !== JSON.stringify(gesture.binding);
      gesture.binding = chosen.binding;
      gesture.u = chosen.u;
      if (changed) say(`Following ${bindingName(scene, chosen.binding)}`);
    }
    const cands = (gesture.candidates || []).map(k => ({
      ...k,
      chosen: !!(gesture.u && Math.abs(k.u.x * gesture.u.x + k.u.y * gesture.u.y) > 0.9999),
    }));
    if (gesture.binding && gesture.u) {
      const t = (c.x - gesture.startCanvas.x) * gesture.u.x + (c.y - gesture.startCanvas.y) * gesture.u.y;
      const end = { x: gesture.startCanvas.x + t * gesture.u.x, y: gesture.startCanvas.y + t * gesture.u.y };
      ghost = { origin: gesture.startCanvas, u: gesture.u, candidates: cands, preview: { a: gesture.startCanvas, b: end } };
    } else if (gesture.binding === "free") {
      ghost = { origin: gesture.startCanvas, u: null, candidates: cands, preview: { a: gesture.startCanvas, b: c } };
    } else {
      ghost = { origin: gesture.startCanvas, u: null, candidates: cands };
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

  if (wasGesture.kind === "extrude") {
    if (!wasGesture.moved) { render(); return; }        // a tap keeps the box as it is
    if (pendingManipulate) {
      manipulate(scene, pendingManipulate.vertexId, pendingManipulate.target);
      pendingManipulate = null;
    }
    const ray = scene.vertices.find(v => v.id === wasGesture.rayId);
    endExtrude(false);
    afterEdit(ray ? `Depth toward ${bindingName(scene, ray.binding)} set to ${Math.round(Math.abs(ray.t))}` : null);
    return;
  }

  if (wasGesture.kind === "vertex") {
    manipulateWarned = false;
    if (!wasGesture.moved) { render(); return; }              // a tap that selected, nothing more
    if (pendingManipulate) {
      manipulate(scene, pendingManipulate.vertexId, pendingManipulate.target);
      pendingManipulate = null;
    }
    const v = scene.vertices.find(x => x.id === wasGesture.vertexId);
    afterEdit(v ? describeVertex(v) : null);
    return;
  }

  if (wasGesture.kind === "box") {
    ghost = null;
    if (wasGesture.height < 4) { render(); return; }        // a tap, not a box
    beginGesture(history, scene);                            // D7: one gesture, one undo
    const res = buildBox(scene, {
      at: wasGesture.at, height: wasGesture.height,
      depthL: wasGesture.depthL, depthR: wasGesture.depthR,
    });
    if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
    afterEdit(`Box drawn — ${res.edges.length} lines, every corner held by two guides.`);
    beginExtrude(res);                                   // D31: the second step, immediately
    return;
  }

  if (wasGesture.kind === "draw") {
    ghost = null;
    const end = wasGesture.last;
    const travel = Math.hypot(end.x - wasGesture.startCanvas.x, end.y - wasGesture.startCanvas.y);
    if (travel < 6) { render(); return; }                 // a tap, not a stroke
    // D19: the guide in hand when the finger lifted is the guide, because it is
    // the one that was on screen. A stroke too short to have picked one is
    // decided from the whole gesture.
    let binding = wasGesture.binding;
    if (!binding) {
      const dir = { x: (end.x - wasGesture.startCanvas.x) / travel, y: (end.y - wasGesture.startCanvas.y) / travel };
      binding = chooseBinding(scene, wasGesture.startCanvas, dir, {
        forced: forcedBinding(), assist: prefs.assist, diagonals: prefs.snap45,
      }).binding;
    }
    beginGesture(history, scene);                          // D7: the whole stroke is one step
    // D20: the end may merge into an existing end that lies ON this guide, or
    // stop at a bound line crossing it — otherwise it stays on the guide where
    // the finger left it. Joining never changes the direction.
    //
    // `u` is recomputed rather than taken from the gesture: a stroke short
    // enough to be decided only at release has no direction cached, and without
    // one resolveStrokeEnd would fall back to merging with ANY nearby point —
    // the exact off-guide join this amendment exists to prevent.
    const endU = wasGesture.u
      ?? (binding === "free" ? null : bindingDirection(scene, wasGesture.startCanvas, binding));
    const endDesc = resolveStrokeEnd(scene, wasGesture.startCanvas, binding, endU,
      end, SNAP_RADIUS / view.scale, { weld: prefs.weld });   // D22
    const res = commitStroke(scene, wasGesture.startDesc, endDesc, binding);
    if (!res.ok) {
      undoHistoryInPlace();
      toast(res.reason, "error");
      return;
    }
    const v = scene.vertices.find(x => x.id === res.b);
    afterEdit(v && v.kind === "intersect"
      ? `Line drawn along ${bindingName(scene, binding)}, corner locked to both guides`
      : `Line drawn along ${bindingName(scene, binding)}`);
    // D12's demotion cannot fire from drawing any more: D16 turned endpoint
    // joining off, so both ends of a stroke are created by us and always sit on
    // the guide. It stays in the data layer as a guard against a hand-edited
    // project file, and it no longer has a message here — under D18 the app does
    // not tell anyone it drew a plain line, because it does not draw one.
    if (res.demoted) say(`Line drawn along no guide`);
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
  // D36a — EVERY scene enters here: from storage at boot, from a project file,
  // from undo, from New. So the migration runs here and nowhere else, because a
  // migration that only guards one door is not a migration. This is the fix for
  // "There are no VPs on the page and I cannot add any" — the points were never
  // gone, the first render just threw on a field an older file did not have.
  scene = migrateScene(next);
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
  setEyeLevel(s, Math.round(height * 0.45));
  const spread = width * 1.35;
  if (points >= 1) addVp(s, { label: "VP1", x: Math.round(width / 2 - spread), y: s.eyeLevel.y, axis: "x", onHorizon: true });
  if (points >= 2) addVp(s, { label: "VP2", x: Math.round(width / 2 + spread), y: s.eyeLevel.y, axis: "y", onHorizon: true });
  if (points >= 3) addVp(s, { label: "VP3", x: Math.round(width / 2), y: Math.round(height * 2.2), axis: "z", onHorizon: false });
  return s;
}

// D26 — a SELECTED thing answers the arrow keys.
//
// Noah, 2026-07-30: "The arrow keys on my keyboard are not moving anything."
// Measured on the shipped build: tapping a corner filled the inspector, left focus
// on <body>, and three arrow presses moved it 0px. The nudge existed only on the
// vanishing-point rows in the panel — a keyboard path for one kind of object and
// nothing for the rest, which is not what §4 asks for.
//
// This is also the non-drag path §4 requires for the corner drag added beside it:
// every drag has a keyboard equivalent, and here they are the same nudge.
function describeVertex(v) {
  if (v.kind === "ray") return `${Math.round(v.t)} along ${bindingName(scene, v.binding)}`;
  return `Corner at ${Math.round(v.x)}, ${Math.round(v.y)}`;
}

function nudgeSelection(dx, dy, big) {
  if (!selection || selection.type !== "vertex") return false;
  const v = scene.vertices.find(x => x.id === selection.id);
  if (!v) return false;
  const step = big ? NUDGE_BIG : NUDGE;
  // D29 — the arrow keys go through the SAME manipulate() the drag uses. They
  // were separate code paths and had already drifted apart once (F-05): a corner
  // that could not be dragged also could not be nudged, and each gap was
  // invisible to the other. One entry, one behaviour, for every kind of corner.
  const before = { x: v.x, y: v.y };
  beginGesture(history, scene);
  const r = manipulate(scene, v.id, { x: v.x + dx * step, y: v.y + dy * step });
  if (!r.ok) { undoHistoryInPlace(); toast(r.reason, "error"); return true; }
  if (Math.hypot(v.x - before.x, v.y - before.y) < 1e-9) {
    undoHistoryInPlace();
    say("That direction runs across this corner's guides, so it cannot move that way.");
    return true;
  }
  afterEdit(describeVertex(v));
  return true;
}

// The canvas is focusable so the keys have somewhere to land, and a selection made
// by tapping puts focus there (§4: keyboard always).
el.canvas.setAttribute("tabindex", "0");
el.canvas.addEventListener("keydown", ev => {
  const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const d = map[ev.key];
  if (!d) return;
  if (nudgeSelection(d[0], d[1], ev.shiftKey)) ev.preventDefault();
});

// Escape leaves the second step the same way the Done button does — keeping the
// box, never discarding it.
window.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && extruding) { endExtrude(); ev.preventDefault(); }
});

// D28 — the first-run explanation.
//
// §4: interrupting surfaces are EXPECTED, and what is not negotiable is the way
// out. The close is wired FIRST, before anything that could fail — a panel whose
// dismiss depends on its content is a trap the moment the content fails — and
// there are two of them, top and bottom. Nothing about it is conditional.
const dlgWelcome = $("dlg-welcome");
const SEEN_KEY = "ip-welcome-seen";
function closeWelcome() {
  if (dlgWelcome?.open) dlgWelcome.close();
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode: it just shows again */ }
  // Focus lands somewhere real rather than on <body>.
  $("mode-draw")?.focus({ preventScroll: true });
}
$("welcome-close")?.addEventListener("click", closeWelcome);
$("welcome-close-foot")?.addEventListener("click", closeWelcome);
dlgWelcome?.addEventListener("close", () => {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
});
// Escape must work too, and a <dialog> gives that for free — but only if it is
// not cancelled, so nothing here preventDefaults `cancel`.
// A first-run panel that can never be seen again is a worse deal than one you can
// re-open, so About offers it back.
$("show-welcome")?.addEventListener("click", () => {
  $("dlg-about")?.close();
  dlgWelcome?.showModal();
  $("welcome-close")?.focus({ preventScroll: true });
});

function maybeShowWelcome() {
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch { seen = false; }
  if (seen || !dlgWelcome) return;
  dlgWelcome.showModal();
  $("welcome-close")?.focus({ preventScroll: true });
}

// D31 — a box is two steps, and the second one is automatic.
//
// Noah, 2026-07-30: "Drawing a box *should* be a two-step process, but it should
// be automatic - first square goes in, then the other axis is immediately
// draggable." A drag carries two numbers and a box needs three, so the first drag
// states the near face — height, and depth toward the vanishing point you drag
// toward — and the remaining depth is left live under the finger instead of
// needing a handle to be found and grabbed.
//
// It is a state, so it announces itself and carries its own exit (§3), it never
// expires (§4: no timed gestures), and ending it always KEEPS what is drawn —
// there is nothing to lose by walking away.
let extruding = null;    // { rayId, label } — the depth still to be set

function showExtrude(on, message) {
  if (el.extrudeFlag) el.extrudeFlag.dataset.on = String(!!on);
  if (on && message && el.extrudeSay) el.extrudeSay.textContent = message;
}

function beginExtrude(res) {
  // The axis still at its floor is the one to offer: the first drag gave its
  // distance to whichever side it leaned toward.
  const base = [res.corners.leftBottom, res.corners.rightBottom];
  if (!base.every(Boolean)) return;
  const shallow = Math.abs(base[0].t) <= Math.abs(base[1].t) ? base[0] : base[1];
  extruding = { rayId: shallow.id, label: bindingName(scene, shallow.binding) };
  // §4 — the second step needs a non-drag path, and the cheapest honest one is to
  // SELECT the corner it is about: the arrow keys and the panel's distance field
  // then act on exactly what the drag would, with no extra control invented.
  selection = { type: "vertex", id: shallow.id };
  el.canvas.focus({ preventScroll: true });
  renderPanel();
  showExtrude(true, `Box: now drag anywhere to set the depth toward ${extruding.label}`);
  say(`Box drawn. Drag anywhere — or use the arrow keys, this corner is already selected — to set its depth toward ${extruding.label}. Done keeps it as it is.`);
  render();                 // D33: the arrow belongs to this state, so it paints with it
}

// D33 — "show a double headed arrow on the auto selected corner for the second
// step, aligned with the axis movement direction, to indicate the expected user
// input." The strip says a step is happening; this says WHICH WAY, on the corner
// it is about. Derived from the live scene every frame rather than remembered, so
// it cannot drift from the guide it claims to describe: move the VP mid-step and
// the arrow turns with it. Returns null whenever there is nothing honest to draw.
function extrudeArrow() {
  if (!extruding) return null;
  const ray = scene.vertices.find(v => v.id === extruding.rayId);
  if (!ray || ray.degenerate) return null;
  const origin = scene.vertices.find(v => v.id === ray.origin);
  if (!origin) return null;
  const u = bindingDirection(scene, { x: origin.x, y: origin.y }, ray.binding);
  if (!u || !Number.isFinite(ray.x) || !Number.isFinite(ray.y)) return null;
  return { id: ray.id, x: ray.x, y: ray.y, u };
}

function endExtrude(announce = true) {
  if (!extruding) return;
  extruding = null;
  showExtrude(false);
  render();                 // D33: and it leaves with it — Escape and Done included
  if (announce) say("Box finished.");
}
$("extrude-done")?.addEventListener("click", () => endExtrude());

// ---- toolbar wiring ------------------------------------------------------

// ---- D34 — drawing without a drag (closes F-04) --------------------------
//
// Every other interaction in this app had a non-drag path; the one that did not
// was the primary creative act. The interactions gate has been reporting it as a
// GAP on every run since it was built, which is better than silence and is still
// not a fix.
//
// The path is deliberately NOT a new way to specify geometry — no coordinate
// entry dialog, no wizard. It puts the object on the paper at a sane default and
// then hands it to the controls that already exist: the far end of a line is
// SELECTED, so the arrow keys slide it along its guide and the inspector carries
// its distance as a number; a box goes straight into D31's second step, whose
// keyboard path was already built and gated. Same shapes, same solver, same
// undo — the only thing removed is the requirement to drag.
const KEY_LINE_LENGTH = 200;   // canvas units — visible at fit zoom, then adjusted
const KEY_BOX_HEIGHT = 200;
const KEY_BOX_DEPTH = 200;

// Where a keyboard-drawn object goes: the middle of what you are looking at,
// clamped into the paper so it can never land outside the document.
function viewCentre() {
  const vp = viewport();
  const p = toCanvas(view, { x: vp.width / 2, y: vp.height / 2 });
  return {
    x: Math.max(0, Math.min(scene.canvas.width, p.x)),
    y: Math.max(0, Math.min(scene.canvas.height, p.y)),
  };
}

// A drag picks its guide from the direction of travel. With no travel, the
// honest answer is the one the toolbar is already showing: the forced guide if
// the user set one, otherwise the first usable vanishing point, otherwise
// horizontal — which is what a scene with no points can support.
function keyboardBinding() {
  const forced = forcedBinding();
  if (forced) return forced;
  const vp = scene.vanishingPoints.find(v => !v.locked);
  return vp ? { vpId: vp.id } : "horizontal";
}

function addLineWithoutDragging() {
  endExtrude(false);
  const at = viewCentre();
  const binding = keyboardBinding();
  // "free" has no guide to follow, so it gets the one direction that needs no
  // scene to be meaningful. Everything else asks the solver, and a guide that
  // cannot give a direction from here says so rather than drawing nothing.
  const u = binding === "free" ? { x: 1, y: 0 } : bindingDirection(scene, at, binding);
  if (!u) {
    toast("That guide has no direction from the middle of the view — move the point, or pick another guide", "error");
    return;
  }
  const end = { x: at.x + u.x * KEY_LINE_LENGTH, y: at.y + u.y * KEY_LINE_LENGTH };
  beginGesture(history, scene);                            // D7: one button, one undo
  const startDesc = resolveEndpoint(scene, at, SNAP_RADIUS / view.scale, { join: prefs.weld });
  const endDesc = resolveStrokeEnd(scene, at, binding, u, end, SNAP_RADIUS / view.scale, { weld: prefs.weld });
  const res = commitStroke(scene, startDesc, endDesc, binding);
  if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
  selection = { type: "vertex", id: res.b };
  el.canvas.focus({ preventScroll: true });
  afterEdit(`Line drawn along ${bindingName(scene, binding)}. Its far end is selected — the arrow keys move it, or type its distance in Points.`);
}

function addBoxWithoutDragging() {
  endExtrude(false);
  const at = viewCentre();
  beginGesture(history, scene);
  // One depth set, the other left at its floor — exactly the state the first
  // drag leaves behind, so the second step that follows is the same step.
  const res = buildBox(scene, { at, height: KEY_BOX_HEIGHT, depthL: KEY_BOX_DEPTH, depthR: 1 });
  if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
  afterEdit(`Box drawn — ${res.edges.length} lines, every corner held by two guides.`);
  beginExtrude(res);
}

// D37/D38 — three ways of LOOKING at the drawing. None of them changes it, so
// none of them opens a history step; they are view state, saved with the other
// preferences so a reload comes back the way it was left.
function viewToggle(id, key, onText, offText) {
  const b = $(id);
  if (!b) return;
  b.setAttribute("aria-pressed", String(!!prefs[key]));
  b.addEventListener("click", () => {
    prefs[key] = !prefs[key];
    b.setAttribute("aria-pressed", String(prefs[key]));
    say(prefs[key] ? onText : offText);
    render();
    autosaver.poke();
  });
}
viewToggle("solid", "solid",
  "Solid on — boxes are shaded, and whether you see a top or an underside follows eye level",
  "Solid off — wireframe");
viewToggle("rays", "rays",
  "Rays on — lines run out to every vanishing point from the selected corner, or from every corner you placed",
  "Rays off");
viewToggle("grid", "grid",
  "Grid shown",
  "Grid hidden — the paper is plain now");
viewToggle("show-hidden", "showHidden",
  "Hidden lines shown — you can see the far side of a solid",
  "Hidden lines removed — a solid covers its own far side");
// D40 — a select rather than a slider. A slider IS a drag (SC 2.5.7), and this
// app's whole argument is that nothing should require one.
$("face-opacity")?.addEventListener("change", ev => {
  const n = Number(ev.target.value);
  if (!Number.isFinite(n)) return;
  prefs.faceOpacity = Math.max(0, Math.min(1, n));
  say(`Shading ${Math.round(prefs.faceOpacity * 100)} per cent`);
  render();
  autosaver.poke();
});

viewToggle("eye-level", "eyeLevel",
  "Eye level shown",
  "Eye level hidden — the horizon, where the points define one, is still drawn");

// D42 — square, cube, skyscraper. The exercise Noah asked for, as three moves.
//
// A cube here is EQUAL DISTANCES ALONG EACH GUIDE, not a measuring-point
// construction. That is deliberate and it is the difference between the two
// requests: a true cube needs a fourth point on the horizon and gives you
// geometry; this gives you a shape that READS as a cube and exaggerates as it
// leaves the centre of the paper, which is what forced perspective is for.
// D45 — a cube's edge is a fraction of how far away the points are, not a fixed
// number of canvas units.
//
// Noah placed one after pressing Stronger and got a slab spanning the paper. A
// fixed 220 is a sensible cube when the points are 2,000 away and a wildly
// foreshortened plank when they are 400 away, because what matters is the edge
// AS A FRACTION of the distance to the point it runs toward. Sized from the
// nearest point, a cube looks like a cube at any setting of the dial — and gets
// more dramatic as you exaggerate, which is the whole idea.
const CUBE_FRACTION = 0.18;      // of the distance to the nearest vanishing point
const CUBE_MIN = 40, CUBE_MAX = 420;
const STRETCH = 1.25;                  // and 1/1.25 the other way, so it is reversible
const SPREAD_STEP = 0.8;               // in = stronger; 1/0.8 = out = gentler

function cubeEdge(at) {
  const usable = scene.vanishingPoints.filter(v => !v.locked);
  if (!usable.length) return CUBE_MIN * 4;
  const nearest = Math.min(...usable.map(v => Math.hypot(v.x - at.x, v.y - at.y)));
  if (!Number.isFinite(nearest)) return CUBE_MIN * 4;
  // The floor never wins over the geometry: with the points driven very close, a
  // 40-unit minimum could exceed the distance to the point the edge runs toward,
  // which is past where the construction means anything (a corner cannot reach its
  // own vanishing point). Half that distance is the hard ceiling.
  const ceiling = Math.min(CUBE_MAX, nearest * 0.5);
  return Math.round(Math.max(Math.min(CUBE_MIN, ceiling), Math.min(ceiling, nearest * CUBE_FRACTION)));
}

function addCube() {
  endExtrude(false);
  const at = viewCentre();
  const edge = cubeEdge(at);
  beginGesture(history, scene);
  const res = buildBox(scene, { at, height: edge, depthL: edge, depthR: edge });
  if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
  selection = { type: "vertex", id: res.corners.nearTop.id };
  el.canvas.focus({ preventScroll: true });
  afterEdit("Cube drawn — equal along all three guides. Taller stretches it into a tower.");
}

// The solid to act on: the one the selection belongs to, else the last one made.
function currentSolid() {
  const faces = scene.faces ?? [];
  if (!faces.length) return null;
  if (selection && selection.type === "vertex") {
    const owner = faces.find(f => f.loop.includes(selection.id));
    if (owner) return owner.solid;
  }
  return faces[faces.length - 1].solid;
}

// A box's whole height hangs off ONE ray vertex — the near top corner, bound to
// vertical. Every other upper corner is derived from it, so stretching the box
// is stretching that single number and letting the solver do the rest.
function stretchSolid(factor) {
  const solid = currentSolid();
  if (!solid) { toast("Draw a box first — there is nothing to stretch", "error"); return; }
  const ids = new Set((scene.faces ?? []).filter(f => f.solid === solid).flatMap(f => f.loop));
  const riser = scene.vertices.find(v => ids.has(v.id) && v.kind === "ray" && v.binding === "vertical");
  if (!riser) { toast("That shape has no upright edge to stretch", "error"); return; }
  beginGesture(history, scene);
  riser.t *= factor;
  solveScene(scene);
  if (!scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y))) {
    undoHistoryInPlace();
    toast("That would push the shape past what this construction can hold", "error");
    return;
  }
  afterEdit(`${factor > 1 ? "Taller" : "Shorter"} — height now ${Math.round(Math.abs(riser.t))}`);
}

function changeSpread(k) {
  beginGesture(history, scene);
  const res = scaleVpSpread(scene, k);
  if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
  afterEdit(k < 1
    ? "Stronger — the points came in, so everything converges harder"
    : "Gentler — the points went out, so the perspective calms down", { structural: true });
}

// D50 — equal intervals in depth. Divide splits the selected corner's distance
// into equal steps; Repeat carries that step further away. Both act on a corner
// that RIDES a vanishing point guide, because that is the direction depth runs
// in, and both make ordinary ray corners on the same guide — so the run of marks
// is held by the construction and moves when the point does.
function spaceAlongGuide(mode) {
  if (!selection || selection.type !== "vertex") {
    toast("Select a corner that runs to a vanishing point first — that is the direction to space along", "error");
    return;
  }
  const n = Number($("interval-count")?.value ?? 4);
  if (!Number.isFinite(n) || n < 2) return;
  beginGesture(history, scene);
  const res = markIntervals(scene, selection.id, mode === "divide" ? { parts: n } : { times: n });
  if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
  const short = res.made.length < res.asked
    ? ` ${res.asked - res.made.length} would have landed past the vanishing point and were left out.`
    : "";
  afterEdit(mode === "divide"
    ? `Divided into ${n} — ${res.made.length} marks, evenly spaced in depth.${short}`
    : `Repeated ${n} intervals — ${res.made.length} marks, each the same distance apart in the world.${short}`);
}
// D51 — a height gauge standing on the ground. It goes where the SELECTED corner
// is if there is one, so you can measure against something you have drawn;
// otherwise the middle of the view, like the other Add buttons.
function placeFigure() {
  endExtrude(false);
  const ratio = Number($("figure-ratio")?.value ?? 1);
  let at = viewCentre();
  if (selection && selection.type === "vertex") {
    const v = scene.vertices.find(x => x.id === selection.id);
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) at = { x: v.x, y: v.y };
  }
  beginGesture(history, scene);
  const res = addFigure(scene, { at, ratio });
  if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
  selection = { type: "vertex", id: res.feet.id };
  el.canvas.focus({ preventScroll: true });
  const label = $("figure-ratio")?.selectedOptions?.[0]?.textContent ?? `${ratio}x`;
  afterEdit(ratio === 1
    ? `${label} placed — its eye sits on the horizon, which is what makes it the right size there. Its feet are selected; move them and it re-measures.`
    : `${label} placed — ${ratio} times your own eye height at that spot. Its feet are selected; move them and it re-measures.`);
}
$("add-figure")?.addEventListener("click", placeFigure);

$("divide-depth")?.addEventListener("click", () => spaceAlongGuide("divide"));
$("repeat-depth")?.addEventListener("click", () => spaceAlongGuide("repeat"));

// D52 — a room. The opening is sized from the paper rather than from the points,
// because it is a hole in the picture plane, not something receding: it is the
// frame you are looking through.
function addRoom() {
  endExtrude(false);
  const w = scene.canvas.width, h = scene.canvas.height;
  const width = Math.round(w * 0.5), height = Math.round(h * 0.5);
  const at = { x: Math.round((w - width) / 2), y: Math.round((h - height) / 2) };
  // Look at the point nearest the middle of the opening — that is the one you
  // are facing, and in a one-point interior it is the only one that matters.
  const centre = { x: at.x + width / 2, y: at.y + height / 2 };
  // A room runs away to a point you are FACING, which means one on the paper —
  // the classic one-point interior. A point far off to the side builds a tunnel
  // running sideways past you, which is valid geometry and is not a room, so it
  // is refused with the instruction rather than drawn. D46: a point on the paper
  // is the most ordinary construction there is.
  const usable = scene.vanishingPoints.filter(v => !v.locked);
  const onPaper = usable.filter(v => v.x > 0 && v.x < w && v.y > 0 && v.y < h);
  if (!onPaper.length) {
    toast("A room runs away to a point you are facing. Move a vanishing point onto the paper — near the middle is the classic one-point interior.", "error");
    return;
  }
  const facing = onPaper.reduce((best, v) =>
    Math.hypot(v.x - centre.x, v.y - centre.y) < Math.hypot(best.x - centre.x, best.y - centre.y) ? v : best);
  beginGesture(history, scene);
  const res = buildRoom(scene, { at, width, height, vpId: facing?.id, depth: 0.6 });
  if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
  selection = { type: "vertex", id: res.far[0].id };
  el.canvas.focus({ preventScroll: true });
  afterEdit(`Room drawn, running back to ${res.vp.label}. Turn on Solid to see the walls; move ${res.vp.label} to look somewhere else and the whole room follows.`);
}
// D67 — a photograph to draw over, kept on the device and drawn UNDER the work.
//
// The image is placed in canvas coordinates, so it pans and zooms with the
// drawing — an underlay you cannot line up with is no use. It is stored as a blob
// in IndexedDB rather than inside the project JSON, which keeps a project file
// small and the photograph private; the cost, stated rather than discovered, is
// that a project moved to another device arrives without its image.
let underlay = null;

async function useUnderlayBlob(blob, { save = true } = {}) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("that file is not an image this browser can read"));
      i.src = url;
    });
    // Fit it to the paper, keeping its shape: a photograph stretched to the page
    // would make every angle in it a lie, and angles are the whole point here.
    const cw = scene.canvas.width, ch = scene.canvas.height;
    const k = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    underlay = { img, url, x: (cw - w) / 2, y: (ch - h) / 2, width: w, height: h,
      opacity: parseFloat($("underlay-opacity")?.value ?? "0.6") };
    if (save) await saveUnderlay(scene.id, blob);
    render();
    return { ok: true };
  } catch (e) {
    URL.revokeObjectURL(url);
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

$("underlay-file")?.addEventListener("change", async ev => {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  const res = await useUnderlayBlob(file);
  if (!res.ok) { toast(res.reason, "error"); return; }
  say("Reference image placed under the drawing. It stays on this device.");
});

$("underlay-opacity")?.addEventListener("change", () => {
  if (!underlay) return;
  underlay.opacity = parseFloat($("underlay-opacity").value);
  render();
});

$("underlay-clear")?.addEventListener("click", async () => {
  if (!underlay) { toast("There is no reference image to remove", "error"); return; }
  URL.revokeObjectURL(underlay.url);
  underlay = null;
  await clearUnderlay(scene.id);
  render();
  say("Reference image removed. Nothing you drew has changed.");
});

// D65 — a point made from two lines you have drawn, and BOUND to them.
//
// Two taps rather than a drag: select a line, press Mark line, select another,
// press Mark line, and Make point lights up. The marked pair is shown in the
// button's own label so there is never a hidden mode — §3's rule that a state you
// are in says so.
let markedLines = [];

function markLine() {
  if (!selection || selection.type !== "edge") {
    toast("Select a line first — tap one in Select mode, then Mark line", "error");
    return;
  }
  if (markedLines.includes(selection.id)) {
    markedLines = markedLines.filter(id => id !== selection.id);
  } else {
    markedLines = [...markedLines, selection.id].slice(-2);
  }
  refreshMarks();
}

function refreshMarks() {
  markedLines = markedLines.filter(id => (scene.edges ?? []).some(e => e.id === id));
  const b = $("vp-from-lines");
  if (b) b.disabled = markedLines.length !== 2;
  const m = $("mark-line");
  if (m) m.setAttribute("aria-label", markedLines.length
    ? `Mark line — ${markedLines.length} of 2 marked`
    : "Mark line for making a vanishing point");
  say(markedLines.length === 2
    ? "Two lines marked. Make point puts a vanishing point where they cross."
    : `${markedLines.length} of 2 lines marked.`);
}

function makeVpFromLines() {
  if (markedLines.length !== 2) return;
  beginGesture(history, scene);
  const res = addVpFromLines(scene, { edgeA: markedLines[0], edgeB: markedLines[1] });
  if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
  markedLines = [];
  refreshMarks();
  afterEdit(`${res.vp.label} placed where those two lines cross, and bound to them — move either line and the point follows.`);
}

// D62 — a circle in perspective: a square seen at an angle, with the ellipse the
// camera would have made inscribed in it. Wheels, arches, domes, cups, manholes.
function addCircle() {
  endExtrude(false);
  const w = scene.canvas.width, h = scene.canvas.height;
  const anchor = selection && selection.type === "vertex"
    ? scene.vertices.find(v => v.id === selection.id)
    : null;
  const at = anchor ? { x: anchor.x, y: anchor.y } : { x: Math.round(w * 0.42), y: Math.round(h * 0.66) };
  beginGesture(history, scene);
  const res = buildCircle(scene, { at });
  if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
  selection = { type: "vertex", id: res.quad[2].id };
  el.canvas.focus({ preventScroll: true });
  afterEdit("Circle drawn, inscribed in a square lying on the ground. Drag any of its four corners, or a vanishing point, and the ellipse follows — it holds no shape of its own.");
}

// D61 — a street: buildings down both sides, crossroads, and the alleys behind.
//
// Noah, 2026-08-01: "buildings on both sides of a road with one point perspective
// and alleys/crossroads all sound cool. Maybe draw a grid of lines that act as
// streets and then plot them with buildings?" This is that, in one action — the
// grid IS the streets, and the plots it makes are what the buildings stand on.
//
// The heights are a fixed pattern rather than a random one, and the zeroes in it
// are deliberate: a zero leaves its plot open, which is what puts gaps between
// the blocks. A random skyline would look livelier and would not be reproducible
// — you could never get the same street back, and neither could a test.
const SKYLINE = [3, 5, 0, 4, 6, 2, 4, 0, 5, 3, 7, 2];

function addStreet(withBuildings = true) {
  endExtrude(false);
  const w = scene.canvas.width, h = scene.canvas.height;
  const usable = scene.vanishingPoints.filter(v => !v.locked);
  const onPaper = usable.filter(v => v.x > 0 && v.x < w && v.y > 0 && v.y < h);
  if (!onPaper.length) {
    toast("A street runs away from where you stand. Move a vanishing point onto the paper — that is the end of the road.", "error");
    return;
  }
  // The point you are facing is the one nearest the middle of the page.
  const mid = { x: w / 2, y: h / 2 };
  const facing = onPaper.reduce((best, v) =>
    Math.hypot(v.x - mid.x, v.y - mid.y) < Math.hypot(best.x - mid.x, best.y - mid.y) ? v : best);
  const blocks = Math.max(1, Math.min(8, parseInt(el.streetBlocks?.value, 10) || 4));

  // Where the near kerb goes, and how tall the blocks are, are ONE decision.
  // Standing in a street, a building a few times your own height fills the sky —
  // that is true, and drawn straight it puts every near building off the top of
  // the page with nothing readable left. So the near kerb is placed a fair way
  // down the page for depth, and then the whole skyline is scaled by the one
  // factor that makes the tallest block land inside the paper. The blocks keep
  // their proportions to each other; what changes is how far away you stand.
  const ground = facing.y + Math.max(140, (h - facing.y) * 0.55);
  const span = ground - facing.y;
  const tallest = Math.max(...SKYLINE);
  const k = span > 1 ? Math.min(1, (ground - h * 0.03) / (span * tallest)) : 1;
  const storeys = SKYLINE.map(v => (v > 0 ? v * k : 0));

  const at = { x: facing.x, y: Math.min(ground, h * 0.98) };
  beginGesture(history, scene);
  const res = buildStreet(scene, {
    vpId: facing.id, at, width: Math.round(w * 0.26), block: Math.round(w * 0.22),
    blocks, storeys: withBuildings ? storeys : null,
  });
  if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
  selection = null;
  el.canvas.focus({ preventScroll: true });
  afterEdit(withBuildings
    ? `Street drawn: ${blocks} block${blocks === 1 ? "" : "s"} running back to ${res.vp.label}, ${res.buildings.length} buildings and ${res.plots.length - res.buildings.length} open lots. Turn on Solid to mass them; drag ${res.vp.label} and the whole city turns.`
    : `Street plan drawn: ${blocks} block${blocks === 1 ? "" : "s"} running back to ${res.vp.label}, with ${res.plots.length} plots and no buildings. Draw your own on it — every line is held by ${res.vp.label}.`);
}

// D53 — a roof on the last box drawn, or on the box the selection belongs to.
// It needs a BOX rather than a point, because a gable is defined by the building
// underneath it: the ridge runs along one of its axes and sits over its middle.
function addRoofToBox() {
  endExtrude(false);
  const boxes = (scene.faces ?? []).filter(f => String(f.solid).startsWith("box"));
  if (!boxes.length) { toast("Draw a box first — a roof sits on a building", "error"); return; }
  let solid = boxes[boxes.length - 1].solid;
  if (selection && selection.type === "vertex") {
    const owner = boxes.find(f => f.loop.includes(selection.id));
    if (owner) solid = owner.solid;
  }
  // Recover the box's corners from its rings. D63 stores six faces, and the
  // BOTTOM one is wound the opposite way to the top so the solid closes — so it
  // has to be reversed back before it can be read as a ring in the top's order.
  // Reading it raw silently produced a mirrored corner set and no roof at all.
  const ring = sh => (scene.faces ?? []).find(f => f.solid === solid && f.shade === sh)?.loop ?? [];
  const b = [...ring("bottom")].reverse().map(id => scene.vertices.find(v => v.id === id));
  const t = ring("top").map(id => scene.vertices.find(v => v.id === id));
  if (b.length !== 4 || t.length !== 4 || [...b, ...t].some(v => !v)) {
    toast("That box is missing corners a roof would need", "error");
    return;
  }
  const corners = {
    nearBottom: b[0], leftBottom: b[1], backBottom: b[2], rightBottom: b[3],
    nearTop: t[0], leftTop: t[1], backTop: t[2], rightTop: t[3],
  };
  beginGesture(history, scene);
  const res = buildRoof(scene, { corners, pitch: 0.5 });
  if (!res.ok) { undoHistoryInPlace(); toast(res.reason, "error"); return; }
  selection = { type: "vertex", id: res.peakNear.id };
  el.canvas.focus({ preventScroll: true });
  const named = res.slopes.filter(Boolean).map(v => v.label).join(" and ");
  afterEdit(`Roof added — the ridge sits over the middle of the box, and the rafters run to ${named || "their own slope points"}. Those points are in Points, and they follow the wall they hang from.`);
}
$("add-roof")?.addEventListener("click", addRoofToBox);

$("add-room")?.addEventListener("click", addRoom);
$("add-circle")?.addEventListener("click", addCircle);
$("mark-line")?.addEventListener("click", markLine);
$("vp-from-lines")?.addEventListener("click", makeVpFromLines);
$("add-street")?.addEventListener("click", () => addStreet(true));
$("add-streetplan")?.addEventListener("click", () => addStreet(false));

$("add-cube")?.addEventListener("click", addCube);
$("taller")?.addEventListener("click", () => stretchSolid(STRETCH));
$("shorter")?.addEventListener("click", () => stretchSolid(1 / STRETCH));
$("stronger")?.addEventListener("click", () => changeSpread(SPREAD_STEP));
$("gentler")?.addEventListener("click", () => changeSpread(1 / SPREAD_STEP));

$("add-line")?.addEventListener("click", addLineWithoutDragging);
$("add-box")?.addEventListener("click", addBoxWithoutDragging);

function setMode(mode) {
  endExtrude(false);          // switching tools ends the pending step, keeping the box
  prefs.mode = mode;
  for (const [id, m] of [["mode-place", "place"], ["mode-draw", "draw"], ["mode-box", "box"], ["mode-select", "select"]]) {
    $(id)?.setAttribute("aria-pressed", String(prefs.mode === m));
  }
  const names = { place: "Place", draw: "Draw", box: "Box", select: "Select" };
  say(`${names[mode] ?? mode} mode`);
  if (mode === "box") toast("Box mode — drag from the near bottom corner: up for height, sideways for depth. Then drag any corner to reshape it.");
  autosaver.poke();
}
$("mode-place").addEventListener("click", () => setMode("place"));
$("mode-draw").addEventListener("click", () => setMode("draw"));
$("mode-box")?.addEventListener("click", () => setMode("box"));
$("mode-select").addEventListener("click", () => setMode("select"));

$("assist").addEventListener("click", () => {
  prefs.assist = !prefs.assist;
  $("assist").setAttribute("aria-pressed", String(prefs.assist));
  toast(prefs.assist ? "Guides on — strokes snap to a vanishing point" : "Guides off — strokes stay exactly as drawn");
  autosaver.poke();
});

// D16: the 45° pair is the ONE optional extra Noah allowed, and it starts off.
// D22 — welding, as a toggle rather than a verdict. Default ON: that is 0.5.0's
// behaviour, and the reason it exists is that Noah's cube fell apart without it.
// Off is the 0.2.0 behaviour he originally asked for, and it is a legitimate
// choice — the guide still decides direction either way (D18), so this can never
// hand back a line that belongs to nothing.
$("weld")?.addEventListener("click", () => {
  prefs.weld = !prefs.weld;
  $("weld")?.setAttribute("aria-pressed", String(prefs.weld));
  toast(prefs.weld
    ? "Weld on — a line end that lands on its guide joins the corner it finds there, so shapes hold together when you move a point"
    : "Weld off — every end stops exactly where you lift, joining nothing. Guides still decide direction.");
});

$("snap45")?.addEventListener("click", () => {
  prefs.snap45 = !prefs.snap45;
  $("snap45")?.setAttribute("aria-pressed", String(prefs.snap45));
  toast(prefs.snap45
    ? "45° guides on — vanishing points, vertical, horizontal and 45°"
    : "45° guides off — vanishing points, vertical and horizontal only");
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

// D41 — the number of vanishing points is a property of the SCENE, not a button
// you can lean on.
//
// Noah, 2026-07-30: "Adding or removing VPs has no effect on existing geometry.
// Scenes should be scoped to the number of vanishing points on the screen ...
// that number probably should not be changed, unless you can redraw the drawing."
//
// He is right twice over. A new point cannot retro-fit itself to lines that were
// built without it, so offering the button once there is a drawing offers a
// change the app cannot honour. And a single rectilinear object has at most three
// vanishing points — one per axis — so a fourth is not a stricter setting, it is
// a point nothing can ever bind to.
//
// It is also how he ended up with a screen full of them: on 1.5.0 the app was
// dead but this button still worked, so every hopeful tap added one more.
const MAX_VPS = 3;

$("add-vp").addEventListener("click", () => {
  if (axisPointCount(scene) >= MAX_VPS) {
    toast(`Three is the limit: one vanishing point per axis is all a box has. A fourth would have nothing to bind to.`, "error");
    return;
  }
  if (scene.edges.length || scene.vertices.length) {
    toast("There is already a drawing here, and a new point cannot reach back into lines that were built without it. Start a new drawing from Project to change the number of points.", "error");
    return;
  }
  beginGesture(history, scene);
  const centre = toCanvas(view, { x: viewport().width / 2, y: viewport().height / 2 });
  const res = addVp(scene, { label: `VP${scene.vanishingPoints.length + 1}`, x: Math.round(centre.x), y: Math.round(centre.y), axis: "z", onHorizon: false });
  afterEdit(`${res.vp.label} added at ${Math.round(res.vp.x)}, ${Math.round(res.vp.y)}`, { structural: true });
});

// The button says so before it is pressed, rather than only after (§3).
function refreshAddVp() {
  const b = $("add-vp");
  if (!b) return;
  const full = axisPointCount(scene) >= MAX_VPS;
  const drawn = scene.edges.length > 0 || scene.vertices.length > 0;
  b.disabled = full || drawn;
  // D56 / SC 2.5.3 Label in Name: the name STARTS with the words on the button,
  // so saying "Add VP" activates it. It used to read "Add a vanishing point…",
  // which spells the thing out nicely and matches nothing anyone would say.
  b.setAttribute("aria-label", full
    ? "Add VP — a vanishing point; unavailable, three is the limit"
    : drawn
      ? "Add VP — unavailable once there is a drawing; start a new drawing to change the number of points"
      : "Add VP — add a vanishing point");
}

// §4 / SC 2.5.1 — pinch and two-finger pan are accelerators; these are the door.
// Zoom about the CENTRE of the viewport, which is where someone looking at the
// drawing is looking, and announce the result rather than leaving it to be
// inferred from motion.
function zoomBy(factor) {
  const vp = viewport();
  zoomAt(view, { x: vp.width / 2, y: vp.height / 2 }, factor);
  render();
  say(`Zoom ${Math.round(view.scale * 100)}%`);
}
$("zoom-in")?.addEventListener("click", () => zoomBy(1.25));
$("zoom-out")?.addEventListener("click", () => zoomBy(1 / 1.25));
$("zoom-fit-all")?.addEventListener("click", () => {
  fitAll(view, viewport(), scene);
  render();
  const off = scene.vanishingPoints.filter(v => v.x < 0 || v.x > scene.canvas.width || v.y < 0 || v.y > scene.canvas.height).length;
  say(off
    ? `Showing the paper and all ${scene.vanishingPoints.length} points — ${off} of them off the paper. Fit comes back to the drawing.`
    : `Showing the paper and all ${scene.vanishingPoints.length} points. Fit comes back to the drawing.`);
});
$("zoom-fit")?.addEventListener("click", () => {
  fitView(view, viewport());
  render();
  say(`Fitted the whole drawing — zoom ${Math.round(view.scale * 100)}%`);
});

$("show-panel").addEventListener("click", () => { prefs.panel = !prefs.panel; renderPanel(); autosaver.poke(); });

// D47 — the Setup panel. Same shape as the points panel: a preference, saved,
// with its own way out (§3), and it never covers the points list because it docks
// on the other side.
function renderSetup() {
  if (el.setup) el.setup.dataset.on = String(!!prefs.setup);
  $("show-setup")?.setAttribute("aria-pressed", String(!!prefs.setup));
  render();          // the off-screen markers step clear of whichever panel is open
}
$("show-setup")?.addEventListener("click", () => {
  prefs.setup = !prefs.setup;
  renderSetup();
  say(prefs.setup ? "Setup panel shown" : "Setup panel hidden");
  autosaver.poke();
});
$("setup-close")?.addEventListener("click", () => {
  prefs.setup = false;
  renderSetup();
  $("show-setup")?.focus();
});
$("panel-close").addEventListener("click", () => { prefs.panel = false; renderPanel(); $("show-panel").focus(); });

el.horizonY.addEventListener("change", () => {
  const n = Number(el.horizonY.value);
  if (!Number.isFinite(n)) { el.horizonY.value = String(Math.round(scene.eyeLevel.y)); return; }
  beginGesture(history, scene);
  setEyeLevel(scene, n);
  afterEdit(`Eye level at ${Math.round(scene.eyeLevel.y)}`);
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

// D24 — clearing the screen, guarded proportionately.
//
// It is one undo step, so this does not need Quietkeep's typed-word guard (that
// is for the irreversible). It does need three things:
//   · the COUNT comes from the scene, not from a sentence someone wrote. The copy
//     on screen is written by the same code that would be wrong (hub LESSONS).
//   · the count is computed and written BEFORE the button becomes a confirm, so
//     there is never a moment where the confirm is live above a stale number.
//   · arming one of the two cannot arm the other. Two guarded actions sharing a
//     satisfied confirmation is how a safe click ends up authorising a different
//     target, so touching either button disarms the other.
let armedClear = null;
let armedTimer = null;
// An armed destructive control must not stay armed while attention is elsewhere.
const ARM_EXPIRY = 6000;
const clearButtons = () => [
  ["pr-clear-drawing", "Clear the drawing, keep the points"],
  ["pr-clear-all", "Clear everything, points too"],
  ["clear-drawing", "Clear"],                 // the toolbar one: label stays put
];
// D32 — put the confirmation where the question was asked. `fixed` positioning
// against the button's own rect, clamped into the viewport, so it lands under the
// button on any width instead of at the bottom of the screen.
function showArmPrompt(buttonId, text) {
  const node = $("arm-prompt"), btn = $(buttonId);
  if (!node || !btn) return;
  node.textContent = text;
  node.dataset.on = "true";
  const r = btn.getBoundingClientRect();
  const w = node.getBoundingClientRect().width;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  node.style.left = `${left}px`;
  node.style.top = `${Math.min(r.bottom + 8, window.innerHeight - node.getBoundingClientRect().height - 8)}px`;
}
function hideArmPrompt() {
  const node = $("arm-prompt");
  if (node) { node.dataset.on = "false"; node.textContent = ""; }
}

function disarmClears(except = null) {
  for (const [id, label] of clearButtons()) {
    if (id === except) continue;
    const b = $(id);
    if (b) {
      // The toolbar button keeps its short label — a toolbar that reflows when you
      // arm a button moves every control next to it under the finger.
      if (id !== "clear-drawing") b.textContent = label;
      b.dataset.armed = "false";
      b.removeAttribute("aria-label");
    }
  }
  if (armedTimer) { clearTimeout(armedTimer); armedTimer = null; }
  if (!except) hideArmPrompt();
  if (armedClear !== except) armedClear = except;
}

function wireClear(id, describe, run) {
  $(id)?.addEventListener("click", () => {
    const b = $(id);
    if (armedClear !== id) {
      const what = describe();                      // counted from the scene, now
      if (!what.ok) { disarmClears(); toast(what.reason, "info"); return; }
      disarmClears(id);                             // the others go back to their labels
      b.dataset.armed = "true";
      if (id === "clear-drawing") {
        // No room to grow a label in a toolbar, so the count goes to the button's
        // accessible name and to a prompt anchored UNDER the button (D32). It used
        // to go to the toast at the bottom of the screen, which asks a question in
        // one corner and answers it in another.
        b.setAttribute("aria-label", `Clear. Armed: tap again to ${what.action}.`);
        showArmPrompt(id, `Tap Clear again to ${what.action}.`);
        say(`${what.action}. Tap Clear again to confirm.`);
      } else {
        b.textContent = `Tap again to ${what.action}`;
        say(`${what.action}. Tap the same button again to confirm, or anything else to cancel.`);
      }
      armedTimer = setTimeout(() => {
        if (armedClear === id) { disarmClears(); say("Clear cancelled — it was left armed too long."); }
      }, ARM_EXPIRY);
      return;
    }
    disarmClears();
    beginGesture(history, scene);                   // D7: one gesture, one undo
    const res = run();
    if (!res.ok) { toast(res.reason, "info"); return; }
    selection = null;
    ghost = null;
    afterEdit(res.said);
  });
}

wireClear("pr-clear-drawing", () => describeDrawingClear(), () => runDrawingClear());

// The toolbar Clear is the SAME action as the dialog's first button, wired through
// the same guard rather than reimplemented beside it.
const describeDrawingClear = () => {
  const edges = scene.edges.length, points = scene.vanishingPoints.length;
  if (!edges && !scene.vertices.length) return { ok: false, reason: "there is nothing drawn yet" };
  return {
    ok: true,
    action: `clear ${edges} line${edges === 1 ? "" : "s"} and keep ${points} point${points === 1 ? "" : "s"}`,
  };
};
const runDrawingClear = () => {
  const r = clearDrawing(scene);
  return r.ok
    ? { ok: true, said: `Drawing cleared — ${r.edges} line${r.edges === 1 ? "" : "s"} gone, ${r.keptPoints} vanishing point${r.keptPoints === 1 ? "" : "s"} kept. Undo puts it back.` }
    : r;
};
wireClear("clear-drawing", describeDrawingClear, runDrawingClear);

wireClear("pr-clear-all",
  () => {
    const edges = scene.edges.length, points = scene.vanishingPoints.length;
    if (!edges && !scene.vertices.length && !points) return { ok: false, reason: "the sheet is already empty" };
    return {
      ok: true,
      action: `clear ${edges} line${edges === 1 ? "" : "s"} and ${points} vanishing point${points === 1 ? "" : "s"}`,
    };
  },
  () => {
    const r = clearAll(scene);
    return r.ok
      ? { ok: true, said: `Everything cleared — ${r.edges} line${r.edges === 1 ? "" : "s"} and ${r.points} point${r.points === 1 ? "" : "s"} gone. The horizon and the drawing size are unchanged. Undo puts it back.` }
      : r;
  });

// Leaving the dialog, or doing anything else in it, cancels a pending confirm:
// an armed destructive button must never be found still armed later.
dlgProject.addEventListener("close", () => disarmClears());
for (const id of ["undo", "redo", "add-vp", "mode-place", "mode-draw", "mode-box", "mode-select",
                  "open-export", "open-project", "open-about", "weld", "snap45"]) {
  $(id)?.addEventListener("click", () => { if (armedClear === "clear-drawing") disarmClears(); });
}
for (const id of ["pr-new", "pr-save", "pr-load", "pr-name", "pr-w", "pr-h", "pr-points"]) {
  $(id)?.addEventListener("click", () => disarmClears());
  $(id)?.addEventListener("input", () => disarmClears());
}

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

// The build stamp is written at BOOT, not when some dialog opens: its whole
// purpose is that a screenshot taken at any moment says which build it is.
if (el.build) el.build.textContent = VERSION;

const autosaver = makeAutosaver(() => scene, () => prefs);

window.addEventListener("resize", sizeCanvas);
// D43 — the stage changes size WITHOUT a window resize: the toolbar wraps to a
// different number of rows when a button's text changes width, and Safari's bars
// come and go. A resize listener alone leaves the canvas the wrong size until
// something else happens to fire one.
if (typeof ResizeObserver === "function") {
  new ResizeObserver(() => sizeCanvas()).observe(el.stage);
}
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", render);
document.addEventListener("visibilitychange", () => { if (document.hidden) autosaver.flush(); });

(async function boot() {
  let restored = null;
  try { restored = await loadLastScene(); } catch { /* first run, or storage blocked */ }
  if (restored && restored.scene) {
    // Belt as well as braces: loadLastScene migrates, and this repeats it because
    // boot does NOT go through adoptScene and a scene reaching render() without
    // the fields render() reads takes the whole app down before window.__ip even
    // exists — no canvas, no panel, no way to add a point. That is exactly what
    // 1.5.0 did to Noah's saved drawing.
    scene = migrateScene(restored.scene);
    if (restored.prefs) prefs = { ...prefs, ...restored.prefs };
    $("snap45")?.setAttribute("aria-pressed", String(prefs.snap45));
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
  renderSetup();
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
  maybeShowWelcome();                       // D28, after the app is ready behind it

  window.__ip = {
    get scene() { return scene; },
    // D62 — the walk checks the ellipse against a conic fit, so it needs the same
    // sampler the screen draws with rather than a copy of the maths.
    circlePoints,
    draw: () => render(),
    // D67 — the walk checks the image is really kept on the device, not just drawn.
    loadUnderlay,
    // D64 — the walk checks that Fit points actually brings every point onto
    // the screen, which is a fact about the VIEW rather than about the scene.
    view: () => ({ scale: view.scale, tx: view.tx, ty: view.ty }),
    get canvas() { return { width: el.canvas.width, height: el.canvas.height }; },
    // Goes through the same panel refresh the app's own paths use, so a
    // screenshot taken after a scripted move never shows stale coordinates
    // beside fresh geometry.
    moveVp: (id, p) => { const r = moveVp(scene, id, p); renderPanel({ structural: false }); render(); return r; },
    // D23: the walk drives the inspector's own controls, so it needs to be able
    // to select a corner the way a tap does — same path, same refresh, so what it
    // measures is the real control and not a rebuilt copy of it.
    select: sel => { selection = sel; renderInspector(); render(); return selection; },
    // D34 — the walk has to be able to ask what a keyboard path left selected,
    // because "and now the arrow keys work on it" is the whole claim.
    get selection() { return selection; },
    // D29 — the walk drives the real manipulate path rather than a copy of it.
    manipulate: (id, target) => { const r = manipulate(scene, id, target); renderPanel({ structural: false }); render(); return r; },
    ancestors: id => ancestorParams(scene, id),
    // D36 — the walk has to be able to ask whether there IS a horizon, which is
    // a question about the points, not about a stored line.
    horizon: () => horizonLine(scene),
    // D33 — the hint the renderer is given, so the walk can check the arrow
    // points along the guide instead of trusting that it does.
    extrudeArrow: () => extrudeArrow(),
    toScreen: p => toScreen(view, p),
    zoom: () => view.scale,
    buildSvg, renderPng,
    flush: () => autosaver.flush(),
    version: VERSION,
  };
})();
