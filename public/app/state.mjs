// state.mjs — undo/redo (D7) and persistence (§6).
//
// D7: one gesture, one undo step. The caller marks the START of a gesture;
// everything until the next mark coalesces. The stack holds constraint-graph
// snapshots (the scene IS the constraint graph — §2.1), bounded to 100.
// Scene state persists across sessions; HISTORY DOES NOT — stated in NOTES.md
// so no session assumes otherwise.

export const UNDO_LIMIT = 100;

export function createHistory() {
  return { undo: [], redo: [] };
}

// Call at gesture start (pointerdown, before the first mutation), never per
// rAF sample — a VP drag is ONE entry (D7).
export function beginGesture(history, scene) {
  history.undo.push(JSON.stringify(scene));
  if (history.undo.length > UNDO_LIMIT) history.undo.shift();
  history.redo.length = 0;
}

export function canUndo(history) { return history.undo.length > 0; }
export function canRedo(history) { return history.redo.length > 0; }

// Both return the scene to adopt, or null. The caller re-solves after adopt.
export function undo(history, currentScene) {
  if (!history.undo.length) return null;
  history.redo.push(JSON.stringify(currentScene));
  return JSON.parse(history.undo.pop());
}

export function redo(history, currentScene) {
  if (!history.redo.length) return null;
  history.undo.push(JSON.stringify(currentScene));
  return JSON.parse(history.redo.pop());
}

// ---- project JSON (§5.4) -------------------------------------------------

// Validation asks every question a load will ask (hub LESSONS: validation at a
// destructive boundary must match the write's own constraints). Returns
// { ok, scene } or { ok:false, reason }. Never mutates anything on failure —
// the caller only swaps scenes in after ok.
export function parseProjectJson(text) {
  let raw;
  try { raw = JSON.parse(text); }
  catch { return { ok: false, reason: "not valid JSON" }; }
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "not a project object" };
  // D36 raised the schema to 2 (eye level split from the horizon, faces added).
  // Version 1 files still load — they are MIGRATED below, not refused. A drawing
  // tool that cannot open its own older files has destroyed the user's work as
  // surely as deleting it.
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) {
    return { ok: false, reason: `unknown schemaVersion ${raw.schemaVersion} — this build reads versions 1 and 2` };
  }
  if (!raw.canvas || !Number.isFinite(raw.canvas.width) || !Number.isFinite(raw.canvas.height) || raw.canvas.width <= 0 || raw.canvas.height <= 0) {
    return { ok: false, reason: "canvas dimensions missing or not positive numbers" };
  }
  if (raw.schemaVersion === 1) {
    // v1 stored one line called `horizon` and slaved points to it. That line was
    // always the OBSERVER'S EYE LEVEL — the horizon proper is wherever the points
    // put it — so it migrates to eyeLevel under its true name, unchanged in value.
    if (!raw.horizon || !Number.isFinite(raw.horizon.y)) return { ok: false, reason: "horizon missing" };
    raw.eyeLevel = { y: raw.horizon.y };
    delete raw.horizon;
    raw.schemaVersion = 2;
  }
  if (!raw.eyeLevel || !Number.isFinite(raw.eyeLevel.y)) return { ok: false, reason: "eye level missing" };
  if (!Array.isArray(raw.faces)) raw.faces = [];
  for (const key of ["vanishingPoints", "vertices", "edges"]) {
    if (!Array.isArray(raw[key])) return { ok: false, reason: `${key} is not a list` };
  }
  const ids = new Set();
  for (const list of [raw.vanishingPoints, raw.vertices, raw.edges]) {
    for (const item of list) {
      if (typeof item.id !== "string" || !item.id) return { ok: false, reason: "an item has no id" };
      if (ids.has(item.id)) return { ok: false, reason: `duplicate id "${item.id}"` };
      ids.add(item.id);
    }
  }
  const vertexIds = new Set(raw.vertices.map(v => v.id));
  const vpIds = new Set(raw.vanishingPoints.map(v => v.id));
  const bindingOk = b => b === "vertical" || b === "horizontal" || (b && typeof b === "object" && vpIds.has(b.vpId));
  for (const v of raw.vertices) {
    if (v.kind === "anchor") {
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return { ok: false, reason: `anchor "${v.id}" has no position` };
    } else if (v.kind === "ray") {
      if (!vertexIds.has(v.origin)) return { ok: false, reason: `ray vertex "${v.id}" names a missing origin` };
      if (!bindingOk(v.binding)) return { ok: false, reason: `ray vertex "${v.id}" has an invalid binding` };
      if (!Number.isFinite(v.t)) return { ok: false, reason: `ray vertex "${v.id}" has no t` };
    } else if (v.kind === "intersect") {
      if (!Array.isArray(v.defs) || v.defs.length !== 2) return { ok: false, reason: `intersect vertex "${v.id}" needs two defs` };
      for (const d of v.defs) {
        if (!vertexIds.has(d.origin)) return { ok: false, reason: `intersect vertex "${v.id}" names a missing origin` };
        if (!bindingOk(d.binding)) return { ok: false, reason: `intersect vertex "${v.id}" has an invalid binding` };
      }
    } else {
      return { ok: false, reason: `vertex "${v.id}" has unknown kind "${v.kind}"` };
    }
  }
  // A face naming a corner that is not there is dropped rather than refused: the
  // shading is a view of the drawing, and losing it must never cost the drawing.
  raw.faces = raw.faces.filter(f => Array.isArray(f?.loop) && f.loop.length >= 3 && f.loop.every(id => vertexIds.has(id)));
  for (const e of raw.edges) {
    if (!vertexIds.has(e.a) || !vertexIds.has(e.b)) return { ok: false, reason: `edge "${e.id}" names a missing vertex` };
    const eb = e.binding === "free" || bindingOk(e.binding);
    if (!eb) return { ok: false, reason: `edge "${e.id}" has an invalid binding` };
  }
  if (!Number.isFinite(raw.nextId)) {
    // Recoverable: derive a safe counter rather than refuse.
    raw.nextId = ids.size + 1;
    let n = raw.nextId;
    while ([...ids].some(id => id.endsWith(String(n)))) n += 1;
    raw.nextId = n + 1;
  }
  return { ok: true, scene: raw };
}

// ---- IndexedDB (§6: not localStorage — size and synchronous blocking) ----

const DB_NAME = "intersecting-parallels";
const DB_VERSION = 1;
const STORE = "scenes";
const META = "meta";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function saveScene(scene, prefs) {
  const db = await openDb();
  try {
    await tx(db, STORE, "readwrite", s => s.put({ ...scene, _prefs: prefs ?? null }));
    await tx(db, META, "readwrite", s => s.put({ key: "lastOpen", sceneId: scene.id }));
  } finally { db.close(); }
}

export async function loadLastScene() {
  const db = await openDb();
  try {
    const last = await tx(db, META, "readonly", s => s.get("lastOpen"));
    if (!last || !last.sceneId) return null;
    const rec = await tx(db, STORE, "readonly", s => s.get(last.sceneId));
    if (!rec) return null;
    const { _prefs, ...scene } = rec;
    return { scene, prefs: _prefs ?? null };
  } finally { db.close(); }
}

export async function listScenes() {
  const db = await openDb();
  try {
    const all = await tx(db, STORE, "readonly", s => s.getAll());
    return (all ?? []).map(r => ({ id: r.id, name: r.name, modifiedAt: r.modifiedAt }));
  } finally { db.close(); }
}

export async function loadSceneById(id) {
  const db = await openDb();
  try {
    const rec = await tx(db, STORE, "readonly", s => s.get(id));
    if (!rec) return null;
    const { _prefs, ...scene } = rec;
    return { scene, prefs: _prefs ?? null };
  } finally { db.close(); }
}

export async function deleteScene(id) {
  const db = await openDb();
  try { await tx(db, STORE, "readwrite", s => s.delete(id)); }
  finally { db.close(); }
}

// Debounced autosave (§6: 2s idle + visibilitychange, wired by the caller).
export function makeAutosaver(getScene, getPrefs, delayMs = 2000) {
  let timer = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    return saveScene(getScene(), getPrefs()).catch(() => {});
  };
  return {
    poke() { if (timer) clearTimeout(timer); timer = setTimeout(flush, delayMs); },
    flush,
  };
}
