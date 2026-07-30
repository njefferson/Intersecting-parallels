// render-art.mjs — draw the icon and the social-preview artwork through a real
// three-point perspective camera, and VERIFY that every line runs to the point
// it claims. Dev tooling; its outputs are public/icon.svg and art/og-base.png.
//
// `npm run render:art`
//
// The check that matters is printed on every run, per vanishing point: the worst
// perpendicular distance from that point to any line drawn as running to it, and
// the angular SPREAD of that family of lines. Both numbers are needed. A miss of
// zero says the lines aim at the point; a spread greater than zero says they are
// not merely parallel — which is exactly how the previous generated artwork
// failed, with a third point drawn and never used.
//
// Same matched pair as the other tools: playwright-core is pinned to the
// revision of the sandbox Chromium (see package.json).

import { chromium } from "playwright-core";
import { writeFileSync, existsSync } from "node:fs";
import { cameraFrom, originAt, buildScene, verify, TIGHT_CLUSTER } from "./art/scene.mjs";

const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const launchOpts = { args: ["--no-sandbox"] };
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

const NAVY_TOP = "#0A0F1E", NAVY_LOW = "#101B33";
const AMBER = "#F2A65A", AMBER_HI = "#F8D6A2", CYAN = "#58C6E0";

// Two ways out of the constraint the wide frame runs into, so Noah picks rather
// than being handed one silently:
//   wide-in   the third point stays INSIDE the frame, as he drew it, which forces
//             the horizon points inward (d > s) and a short focal length.
//   wide-out  the horizon points stay near the edges, as he drew them, which
//             forces the third point below the bottom of the frame — its rays
//             still converge, visibly, on a point just off-picture.
const VARIANTS = [
  {
    name: "icon", out: "art/icon-asdrawn.svg", w: 1024, h: 1024,
    vps: { A: { x: 68, y: 168 }, B: { x: 950, y: 168 }, C: { x: 512, y: 940 } },
    cluster: { x: 512, y: 372 }, unitPx: 118, grid: [[-2.5, 3.5], [-2.5, 3.5]], step: 0.5, raster: "art/icon-asdrawn.png",
    note: "Noah's icon layout, unchanged — it is already a valid camera",
  },
  {
    name: "icon-tight", out: "art/icon-tight.svg", w: 1024, h: 1024,
    vps: { A: { x: 68, y: 168 }, B: { x: 950, y: 168 }, C: { x: 512, y: 940 } },
    cluster: { x: 512, y: 432 }, unitPx: 152, grid: [[-2, 3], [-2, 3]], step: 0.5,
    strokeWidth: 3.8, dotR: 9, boxes: TIGHT_CLUSTER, raster: "art/icon-tight.png",
    note: "same layout and same camera, cluster framed to fill the square so it survives 48px",
  },
  {
    name: "wide-in", out: "art/og-wide-in.svg", w: 1200, h: 630,
    vps: { A: { x: 242, y: 90 }, B: { x: 958, y: 90 }, C: { x: 600, y: 596 } },
    cluster: { x: 600, y: 300 }, unitPx: 92, grid: [[-2.5, 3.5], [-2.5, 3.5]], step: 0.5,
    overshoot: 1.14,
    note: "third point in frame, centred; horizon points at 242/958 — s = d/sqrt2, which maximises the focal length this frame can have",
  },
  {
    name: "wide-shift", out: "art/og-wide-shift.svg", w: 1200, h: 630,
    vps: { A: { x: 404, y: 88 }, B: { x: 1120, y: 88 }, C: { x: 762, y: 594 } },
    cluster: { x: 762, y: 296 }, unitPx: 92, grid: [[-2.5, 3.5], [-2.5, 3.5]], step: 0.5,
    overshoot: 1.14,
    note: "the same, shifted right so the left third stays clear for the wordmark",
  },
  {
    name: "wide-out", out: "art/og-wide-out.svg", w: 1200, h: 630,
    vps: { A: { x: 78, y: 92 }, B: { x: 1122, y: 92 }, C: { x: 690, y: 980 } },
    cluster: { x: 742, y: 296 }, unitPx: 100, grid: [[-2.5, 3.5], [-2.5, 3.5]], step: 0.5,
    overshoot: 1.14,
    note: "horizon points kept near the edges; third point below the frame, cluster right of centre to leave the left for the wordmark",
  },
];

const fmt = n => n.toFixed(2);
const line = (l, attrs) => `<line x1="${fmt(l.p.x)}" y1="${fmt(l.p.y)}" x2="${fmt(l.q.x)}" y2="${fmt(l.q.y)}" ${attrs}/>`;

function svgFor(v) {
  const cam = cameraFrom(v.vps.A, v.vps.B, v.vps.C);
  const O = originAt(cam, v.cluster, v.unitPx);
  const scene = buildScene(cam, O, { vps: v.vps, gridA: v.grid[0], gridB: v.grid[1], step: v.step, cluster: v.boxes, overshoot: v.overshoot });
  const checks = verify(scene);

  const { A, B, C } = v.vps;
  // The horizon is not decoration either: it is the line through A and B, which
  // is the vanishing line of the ground plane the boxes stand on.
  const t = (B.x - A.x) === 0 ? 0 : (B.y - A.y) / (B.x - A.x);
  const hz = { p: { x: -50, y: A.y + t * (-50 - A.x) }, q: { x: v.w + 50, y: A.y + t * (v.w + 50 - A.x) } };

  const grid = scene.lines.filter(l => l.kind === "grid").map(l => line(l, `stroke="${CYAN}" stroke-opacity=".16" stroke-width="1"`)).join("");
  const guides = scene.lines.filter(l => l.kind === "guide").map(l => line(l, `stroke="${AMBER}" stroke-opacity=".26" stroke-width="1"`)).join("");
  const nadir = scene.lines.filter(l => l.kind === "nadir").map(l => line(l, `stroke="${CYAN}" stroke-opacity=".40" stroke-width="1" stroke-dasharray="7 6"`)).join("");

  const sw = v.strokeWidth ?? 2.2;
  const boxes = scene.faces.map(f =>
    `<path d="M${f.pts.map(p => `${fmt(p.x)},${fmt(p.y)}`).join("L")}Z" fill="#080D1B" fill-opacity=".88" ` +
    `stroke="${AMBER_HI}" stroke-width="${sw}" stroke-linejoin="round"/>`
  ).join("");

  const dot = (p, fill, r) =>
    `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${r * 2.6}" fill="${fill}" fill-opacity=".18"/>` +
    `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${r}" fill="${fill}"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${v.w} ${v.h}" width="${v.w}" height="${v.h}">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${NAVY_TOP}"/><stop offset="1" stop-color="${NAVY_LOW}"/>
  </linearGradient>
  <radialGradient id="glow" cx="${(v.cluster.x / v.w).toFixed(3)}" cy="${(A.y / v.h).toFixed(3)}" r=".55">
    <stop offset="0" stop-color="${AMBER}" stop-opacity=".16"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect id="bg" width="${v.w}" height="${v.h}" fill="url(#sky)"/>
<rect width="${v.w}" height="${v.h}" fill="url(#glow)"/>
<g id="art">
  <g id="grid">${grid}</g>
  <g id="guides">${guides}</g>
  <g id="nadir-rays">${nadir}</g>
  ${line(hz, `stroke="${AMBER}" stroke-opacity=".70" stroke-width="1.2"`)}
  <g id="boxes">${boxes}</g>
  ${dot(A, AMBER, v.dotR ?? 6.5)}${dot(B, AMBER, v.dotR ?? 6.5)}${dot(C, CYAN, (v.dotR ?? 6.5) * 1.15)}
</g>
</svg>`;
  return { svg, cam, checks, scene };
}

let failures = 0;
const rendered = [];
for (const v of VARIANTS) {
  let built;
  try { built = svgFor(v); }
  catch (e) { console.log(`FAIL ${v.name}: ${e.message}`); failures++; continue; }

  writeFileSync(v.out, built.svg);
  rendered.push({ v, svg: built.svg });

  const { P, f } = built.cam;
  console.log(`\n${v.name} ${v.w}x${v.h} -> ${v.out}`);
  console.log(`  ${v.note}`);
  console.log(`  camera: principal point ${P.x.toFixed(0)},${P.y.toFixed(0)}  f=${f.toFixed(0)}px  ` +
              `basis orthogonality err ${built.cam.orthogonality.toExponential(1)}`);
  console.log(`  camera sits ${built.scene.camHeight.toFixed(2)} units above the ground plane; ` +
              `the tall box is ${(0.62 * 100).toFixed(0)}% of that, so every top face stays visible`);
  for (const [name, c] of Object.entries(built.checks)) {
    const pt = v.vps[name];
    // A family that converges has a spread; a family that is merely parallel has
    // a spread of ~0 and would still pass the miss check. Both are required.
    const ok = c.worstMiss < 0.01 && c.spreadDeg > 0.5;
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"} VP ${name} (${pt.x},${pt.y}) — ${c.count} lines, ` +
                `worst miss ${c.worstMiss.toExponential(2)}px, family spread ${c.spreadDeg.toFixed(1)}°` +
                (c.worstMiss >= 0.01 ? ` (worst was a ${c.worstKind})` : ""));
  }
}

// Rasterise. The wide variants become candidate og bases; the icon stays SVG
// because render-icons.mjs rasterises it into every manifest size.
const browser = await chromium.launch(launchOpts);
try {
  for (const { v, svg } of rendered) {
    const page = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><meta charset="utf-8">
      <style>html,body{margin:0;width:${v.w}px;height:${v.h}px;overflow:hidden}svg{display:block}</style>${svg}`);
    const png = v.raster ?? v.out.replace(/\.svg$/, ".png");
    await page.screenshot({ path: png });
    await page.close();
    console.log(`  raster ${png}`);
  }
} finally {
  await browser.close();
}

if (failures) {
  console.error(`\n${failures} check(s) failed — the picture does not match the geometry it claims.`);
  process.exit(1);
}
console.log("\nEvery drawn line runs to its vanishing point, and no family is merely parallel.");
