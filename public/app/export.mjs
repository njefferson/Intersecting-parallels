// export.mjs — SVG and PNG export (§5), with D9's corrections.
//
// D9: the root <svg> MUST declare xmlns:inkscape, or inkscape:label is invalid
// and silently ignored — which reads as the layer-name acceptance test failing
// for no visible reason.
// D9: PNG export probes the real canvas ceiling and clamps with an honest
// message rather than emitting the blank image iOS produces past the limit.
//
// buildSvg is pure (string in, string out) so it is testable headless; only
// the PNG path needs a DOM.

import { effectiveBinding } from "./snap.mjs";
import { horizonLine, circlePoints } from "./solver.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function solvedEdges(scene) {
  const byId = new Map(scene.vertices.map(v => [v.id, v]));
  return scene.edges.map(e => {
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return null;
    return { edge: e, a, b };
  }).filter(Boolean);
}

function bindingGroupKey(scene, binding) {
  if (binding === "vertical") return "vertical";
  if (binding === "horizontal") return "horizontal";
  if (binding === "free") return "free";
  const vp = scene.vanishingPoints.find(v => v.id === binding.vpId);
  if (!vp) return "free";
  return `axis-${vp.axis ?? "z"}`;
}

// §5.1 — stroked paths never filled; viewBox = canvas; groups carry BOTH id
// and inkscape:label; construction omitted unless opted in.
export function buildSvg(scene, {
  includeConstruction = false,
  strokeWeight = 1,
  hairline = false,
  subgroupByBinding = true,
} = {}) {
  const { width, height } = scene.canvas;
  const strokeAttrs = `fill="none" stroke="#000000" stroke-width="${strokeWeight}" stroke-linecap="round"${hairline ? ' vector-effect="non-scaling-stroke"' : ""}`;
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  // D9: the inkscape namespace declaration is what makes inkscape:label valid.
  lines.push(`<svg xmlns="${SVG_NS}" xmlns:inkscape="${INKSCAPE_NS}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  lines.push(`  <title>${esc(scene.name || "Intersecting Parallels drawing")}</title>`);

  const all = solvedEdges(scene);
  const committed = all.filter(x => x.edge.role !== "construction");
  const construction = all.filter(x => x.edge.role === "construction");

  const pathFor = ({ edge, a, b }) =>
    `      <path id="${esc(edge.id)}" d="M ${a.x.toFixed(3)} ${a.y.toFixed(3)} L ${b.x.toFixed(3)} ${b.y.toFixed(3)}"${edge.style?.dash ? ` stroke-dasharray="${esc(edge.style.dash)}"` : ""}/>`;

  lines.push(`  <g id="committed" inkscape:label="committed" inkscape:groupmode="layer" ${strokeAttrs}>`);
  if (subgroupByBinding) {
    const groups = new Map();
    for (const item of committed) {
      // D12: group by the binding the line actually satisfies. A stored
      // binding goes stale when both ends are anchors that lined up only by
      // coincidence and a vanishing point later moved; exporting on the stored
      // label would file a line under a layer it does not belong to.
      const key = bindingGroupKey(scene, effectiveBinding(scene, item.edge));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    for (const [key, items] of [...groups].sort((x, y) => x[0].localeCompare(y[0]))) {
      lines.push(`    <g id="${esc(key)}" inkscape:label="${esc(key)}">`);
      for (const item of items) lines.push(pathFor(item));
      lines.push(`    </g>`);
    }
  } else {
    for (const item of committed) lines.push(pathFor(item));
  }
  // D62 — circles, in the committed layer with everything else that is ink. The
  // points come from the SAME `circlePoints` the screen draws with, so the
  // exported ellipse is the drawn one rather than a second implementation that
  // can drift from it. Stroked, never filled (§5.1). A quad that has gone
  // degenerate has no ellipse and exports nothing, exactly as it draws nothing.
  for (const circle of scene.circles ?? []) {
    const pts = circlePoints(scene, circle, 128);
    if (!pts) continue;
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(" ") + " Z";
    lines.push(`      <path id="${esc(circle.id)}" d="${d}"/>`);
  }
  lines.push(`  </g>`);

  if (includeConstruction) {
    lines.push(`  <g id="construction" inkscape:label="construction" inkscape:groupmode="layer" ${strokeAttrs} stroke-dasharray="4 4">`);
    lines.push(`    <path id="eye-level" d="M 0 ${scene.eyeLevel.y.toFixed(3)} L ${width} ${scene.eyeLevel.y.toFixed(3)}"/>`);
    // D36: the horizon is exported only when the points actually define one.
    const hz = horizonLine(scene);
    if (hz) {
      const dx = hz.b.x - hz.a.x, dy = hz.b.y - hz.a.y;
      const len = Math.hypot(dx, dy) || 1;
      const reach = width + scene.canvas.height;
      const x1 = (hz.a.x - dx / len * reach).toFixed(3), y1 = (hz.a.y - dy / len * reach).toFixed(3);
      const x2 = (hz.b.x + dx / len * reach).toFixed(3), y2 = (hz.b.y + dy / len * reach).toFixed(3);
      lines.push(`    <path id="horizon" d="M ${x1} ${y1} L ${x2} ${y2}"/>`);
    }
    for (const item of construction) lines.push(pathFor(item));
    lines.push(`  </g>`);
  }

  lines.push(`</svg>`);
  return lines.join("\n");
}

// D9 + §5.2 — probe the real ceiling before offering dimensions. iOS silently
// returns a BLANK image past its limit, so a rejected export with an honest
// message beats a blank file every time (Doctrine §5).
export function probeCanvasCeiling(maxTry = 16384) {
  const steps = [16384, 11180, 8192, 5793, 4096, 2896, 2048];
  for (const size of steps) {
    if (size > maxTry) continue;
    try {
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      const ctx = c.getContext("2d");
      if (!ctx) continue;
      // A canvas past the limit reads back transparent even after a fill.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(size - 1, size - 1, 1, 1);
      const px = ctx.getImageData(size - 1, size - 1, 1, 1).data;
      if (px[3] === 255) return size;
    } catch { /* try the next size down */ }
  }
  return 2048;
}

export function clampExportSize(requested, ceiling) {
  const w = Math.max(1, Math.round(requested.width));
  const h = Math.max(1, Math.round(requested.height));
  if (w <= ceiling && h <= ceiling) return { width: w, height: h, clamped: false, message: null };
  const scale = Math.min(ceiling / w, ceiling / h);
  const cw = Math.max(1, Math.floor(w * scale));
  const ch = Math.max(1, Math.floor(h * scale));
  return {
    width: cw, height: ch, clamped: true,
    message: `This device tops out at ${ceiling}px per side, so the export is ${cw}×${ch} instead of ${w}×${h}. Anything larger comes back blank, so it is refused rather than saved empty.`,
  };
}

// §5.2 — transparent background, rendered at export resolution on an offscreen
// canvas. Never an upscale of the display canvas.
export function renderPng(scene, { width, height, strokeWeight = 1, includeConstruction = false }) {
  const c = document.createElement("canvas");
  c.width = width; c.height = height;
  const ctx = c.getContext("2d");
  const sx = width / scene.canvas.width;
  const sy = height / scene.canvas.height;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = strokeWeight / Math.max(sx, sy) * Math.max(sx, sy); // weight in canvas units
  const all = solvedEdges(scene);
  if (includeConstruction) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, scene.eyeLevel.y);
    ctx.lineTo(scene.canvas.width, scene.eyeLevel.y);
    for (const { a, b } of all.filter(x => x.edge.role === "construction")) {
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  for (const { a, b } of all.filter(x => x.edge.role !== "construction")) {
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  return c;
}

// ---- delivery (§5.3) -----------------------------------------------------

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function deliver(blob, filename, { preferShare = false } = {}) {
  // Web Share API first on iPadOS when asked for, so output lands in Procreate
  // via the share sheet; Blob + <a download> is the baseline everywhere.
  if (preferShare && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return { ok: true, via: "share" };
      }
    } catch (err) {
      if (err && err.name === "AbortError") return { ok: false, via: "share", reason: "cancelled" };
    }
  }
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return { ok: true, via: "filesystem" };
    } catch (err) {
      if (err && err.name === "AbortError") return { ok: false, via: "filesystem", reason: "cancelled" };
    }
  }
  downloadBlob(blob, filename);
  return { ok: true, via: "download" };
}
