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
import { cameraFrom, originAt, buildScene, verify, TIGHT_CLUSTER, city } from "./art/scene.mjs";

const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const launchOpts = { args: ["--no-sandbox"] };
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

const NAVY_TOP = "#0A0F1E", NAVY_LOW = "#101B33";
const AMBER = "#F2A65A", AMBER_HI = "#F8D6A2", CYAN = "#58C6E0";

// Two ways out of the constraint the wide frame runs into, so the choice is made
// deliberately rather than handed over silently:
//   wide-in   the third point stays INSIDE the frame, as the reference sketch has
//             it, which forces the horizon points inward (d > s) and a short focal length.
//   wide-out  the horizon points stay near the edges, as the sketch has them, which
//             forces the third point below the bottom of the frame — its rays
//             still converge, visibly, on a point just off-picture.
// The camera stays CLOSE and the lens stays wide. THE RULING: extreme
// perspective is not a problem to be softened, it is the subject —
// pushing the city back to soften the near corner was
// sanding off the subject of the app. What close framing costs is composure, not
// correctness, so it is bought back by LAYOUT: the lots nearest the camera on the
// nadir's side are left empty, which keeps the third vanishing point visible at
// the end of an open street instead of buried under a foreground tower.
const DOWNTOWN = city({
  module: 1.05, block: 0.67, i: [-2, 2], j: [-2, 1],
  pad: { aLo: -1.6, bLo: -1.7, aHi: 0.5, bHi: 0.5 },   // streets run on toward the camera
  // The nearest lots take narrower footprints. Measured against the icon window:
  // full-width, lot -2,0 painted out to x=1173 against an edge at 1182, so it read
  // as sliced off. Narrower, and taller to match, they read as towers instead of
  // tabletops. (THE FIX ASKED FOR: either remove the buildings on the right that
  // run off the icon, or reshape them narrower to fit.)
  shrink: { "-1,-1": [0.72, 0.72], "-1,0": [0.74, 0.70], "-1,1": [0.62, 0.58] },
  // Height runs with DISTANCE, and that is forced, not styled: a tower taller than
  // the camera crosses the horizon, and a NEAR one doing that leaves the top of the
  // frame entirely (measured at 440px above it). So the towers that break eye level
  // stand mid-distance, and the near lots are low — which is exactly the
  // arrangement in the reference sketch.
  heights: {   // -2,-1 and -2,-2 empty: the nearest lot projects to y=4869, a stray slab across the icon window's bottom edge
                   "-1,-1": 0.46, "-1,0": 0.52, "-1,1": 0.34,   // -1,-2 empty: it covered the nadir
                    "0,-1": 0.94,  "0,0": 1.34,  "0,1": 0.80,   // 0,-2 empty
     "1,-2": 0.52,  "1,-1": 1.14,                "1,1": 1.06,   // 1,0 empty lot
     "2,-2": 0.44,  "2,-1": 0.72,  "2,0": 1.22,  "2,1": 0.64,
  },
});

const SKYLINE = city({
  module: 1.05, block: 0.67, i: [0, 2], j: [0, 2],
  pad: { aLo: -1.9, bLo: -1.6, aHi: 0.4, bHi: 0.4 },
  heights: {
     "0,0": 0.44,  "0,1": 0.86,  "0,2": 0.34,
     "1,0": 0.70,  "1,1": 1.42,  "1,2": 0.58,
     "2,0": 0.40,  "2,1": 1.02,  "2,2": 0.48,
  },
});

// The chosen social-tile composition, named, because the icon is now a square
// WINDOW onto this same scene rather than a second drawing of it. THE QUESTION
// that settled it: could the icon not simply be a crop of the social tile? It
// can, and it should: a
// crop cannot disagree about the perspective, whereas two separately framed scenes
// with different camera distances did — which is the discrepancy that was spotted.
//
// It cannot be a crop of the PIXELS, though. The sketch's two horizon points are 662px
// apart and the tile is 630px tall, so no square region of the raster contains
// both. Taking the window in scene coordinates instead gives the same lines with
// more sky above them, which is a crop of the drawing rather than of the file.
const WIDE_SHIFT = {
  name: "wide-shift", out: "art/og-wide-shift.svg", raster: "art/og-base.png", w: 1200, h: 630,
  vps: { A: { x: 431, y: 88 }, B: { x: 1093, y: 88 }, C: { x: 762, y: 556 } },
  cluster: { x: 792, y: 336 }, unitPx: 104, hScale: 0.80, grid: [[-2.5, 3.5], [-2.5, 3]], step: 0.5,
  overshoot: 1.14, roads: DOWNTOWN, boxes: DOWNTOWN.boxes,
  note: "shifted right for the wordmark; nadir pulled up to 556 (s = d/sqrt2 keeps the focal length as long as this frame allows); city five blocks wide with the streets running on toward the camera",
};

const VARIANTS = [
  {
    name: "icon-asdrawn", out: "art/icon-asdrawn.svg", w: 1024, h: 1024,
    vps: { A: { x: 68, y: 168 }, B: { x: 950, y: 168 }, C: { x: 512, y: 940 } },
    cluster: { x: 512, y: 452 }, unitPx: 118, hScale: 0.80, grid: [[-2.5, 3.5], [-2.5, 3.5]], step: 0.5, raster: "art/icon-asdrawn.png",
    note: "the reference icon layout, unchanged — it is already a valid camera",
  },
  {
    name: "icon-tight", out: "art/icon-tight.svg", w: 1024, h: 1024,
    vps: { A: { x: 68, y: 168 }, B: { x: 950, y: 168 }, C: { x: 512, y: 940 } },
    cluster: { x: 452, y: 592 }, unitPx: 124, hScale: 0.80, grid: [[-2, 3], [-2, 3]], step: 0.5,
    strokeWidth: 3.8, dotR: 9, boxes: SKYLINE.boxes, roads: SKYLINE, raster: "art/icon-tight.png",
    note: "same layout and same camera, cluster framed to fill the square so it survives 48px",
  },
  {
    name: "wide-in", out: "art/og-wide-in.svg", w: 1200, h: 630,
    vps: { A: { x: 242, y: 90 }, B: { x: 958, y: 90 }, C: { x: 600, y: 596 } },
    cluster: { x: 600, y: 368 }, unitPx: 92, hScale: 0.78, grid: [[-2.5, 3.5], [-2.5, 3.5]], step: 0.5,
    overshoot: 1.14,
    note: "third point in frame, centred; horizon points at 242/958 — s = d/sqrt2, which maximises the focal length this frame can have",
  },
  WIDE_SHIFT,
  {
    ...WIDE_SHIFT,
    name: "icon-crop", out: "art/icon-crop.svg", raster: "art/icon-crop.png",
    w: 1024, h: 1024,
    // Square window in SCENE coordinates: wide enough to hold both horizon points
    // at its edges, tall enough to reach past the nadir, extending above y=0 for
    // the sky the wide frame never had room for.
    window: { x: 421, y: -66, size: 682 },
    strokeWidth: 3.0, dotR: 8,
    note: "tight window — both horizon points sit right on the edges",
  },
  {
    ...WIDE_SHIFT,
    name: "icon", out: "public/icon.svg", raster: "art/icon-crop-wide.png",
    w: 1024, h: 1024,
    // Same centre, wider window. Pulling the horizon points inside the middle 80%
    // matters: a maskable icon is cropped by the launcher, and at the tight window
    // both dots are within 7% of the edge, so a launcher would eat them.
    window: { x: 342, y: -145, size: 840 },
    strokeWidth: 3.4, dotR: 9.5,
    note: "CHOSEN — wider window; horizon points inside the middle 80%, so a maskable crop keeps them",
  },
  {
    ...WIDE_SHIFT,
    name: "icon-maskable", out: "art/icon-maskable.svg", raster: "art/icon-maskable.png",
    w: 1024, h: 1024,
    // A maskable icon is cropped to a circle-ish shape by the launcher, so its art
    // must sit inside the inner 80%. The old pipeline achieved that by SHRINKING the
    // whole icon onto a flat navy field, which leaves a seam where the flat colour
    // meets the art's own gradient — and a flat pad is also what put white at the
    // corners of the previous icon. A wider window instead is full bleed: same scene,
    // same camera, just more sky and ground around it, so there is nothing to seam.
    window: { x: 236, y: -251, size: 1052 },
    strokeWidth: 4.0, dotR: 11,
    note: "maskable — same scene through a wider window, so the safe zone is real margin rather than a shrunk copy",
  },
  {
    name: "wide-out", out: "art/og-wide-out.svg", w: 1200, h: 630,
    vps: { A: { x: 78, y: 92 }, B: { x: 1122, y: 92 }, C: { x: 690, y: 980 } },
    cluster: { x: 742, y: 360 }, unitPx: 100, hScale: 0.80, grid: [[-2.5, 3.5], [-2.5, 3.5]], step: 0.5,
    overshoot: 1.14,
    note: "horizon points kept near the edges; third point below the frame, cluster right of centre to leave the left for the wordmark",
  },
];

let failures = 0;
const fmt = n => n.toFixed(2);
const line = (l, attrs) => `<line x1="${fmt(l.p.x)}" y1="${fmt(l.p.y)}" x2="${fmt(l.q.x)}" y2="${fmt(l.q.y)}" ${attrs}/>`;

function svgFor(v) {
  const cam = cameraFrom(v.vps.A, v.vps.B, v.vps.C);
  const O = originAt(cam, v.cluster, v.unitPx);
  const scene = buildScene(cam, O, { vps: v.vps, gridA: v.grid[0], gridB: v.grid[1], step: v.step, cluster: v.boxes, overshoot: v.overshoot, hScale: v.hScale, roads: v.roads });
  const checks = verify(scene);

  const { A, B, C } = v.vps;
  // The horizon is not decoration either: it is the line through A and B, which
  // is the vanishing line of the ground plane the boxes stand on.
  const t = (B.x - A.x) === 0 ? 0 : (B.y - A.y) / (B.x - A.x);
  const hzL = (v.window?.x ?? 0) - 50, hzR = hzL + (v.window?.size ?? v.w) + 100;
  const hz = { p: { x: hzL, y: A.y + t * (hzL - A.x) }, q: { x: hzR, y: A.y + t * (hzR - A.x) } };

  const grid = scene.lines.filter(l => l.kind === "grid").map(l => line(l, `stroke="${CYAN}" stroke-opacity=".09" stroke-width="1"`)).join("");
  const roads = scene.lines.filter(l => l.kind === "road").map(l => line(l, `stroke="${CYAN}" stroke-opacity=".34" stroke-width="1.3"`)).join("");
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

  // viewBox is the window; width/height are the output size. The background rect
  // is drawn over the window, not over the tile, or a windowed render would show
  // bare page where the tile's own rect stops.
  const win = v.window ?? { x: 0, y: 0, w: v.w, h: v.h };
  const vb = { x: win.x, y: win.y, w: win.size ?? win.w, h: win.size ?? win.h };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${v.w}" height="${v.h}">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${NAVY_TOP}"/><stop offset="1" stop-color="${NAVY_LOW}"/>
  </linearGradient>
  <radialGradient id="glow" cx="${(v.cluster.x / v.w).toFixed(3)}" cy="${(A.y / v.h).toFixed(3)}" r=".55">
    <stop offset="0" stop-color="${AMBER}" stop-opacity=".16"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect id="bg" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="url(#sky)"/>
<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="url(#glow)"/>
<g id="art">
  <g id="grid">${grid}</g>
  <g id="roads">${roads}</g>
  <g id="guides">${guides}</g>
  <g id="nadir-rays">${nadir}</g>
  ${line(hz, `stroke="${AMBER}" stroke-opacity=".70" stroke-width="1.2"`)}
  <g id="boxes">${boxes}</g>
  ${dot(A, AMBER, v.dotR ?? 6.5)}${dot(B, AMBER, v.dotR ?? 6.5)}${dot(C, CYAN, (v.dotR ?? 6.5) * 1.15)}
</g>
</svg>`;
  return { svg, cam, checks, scene };
}

const rendered = [];
for (const v of VARIANTS) {
  let built;
  try { built = svgFor(v); }
  catch (e) { console.log(`FAIL ${v.name}: ${e.message}`); failures++; continue; }

  writeFileSync(v.out, built.svg);
  if (v.raster === "art/og-base.png") {
    // The wordmark tool needs to know where the three points are, because its
    // legibility wash covers the left one — measured at 1.60:1 against its own sky,
    // which is erased. It redraws them on top. This sidecar exists so those
    // coordinates are never retyped into a second file and left to drift.
    writeFileSync("art/og-base.json", JSON.stringify({
      w: v.w, h: v.h, vps: v.vps, horizonY: v.vps.A.y,
      amber: AMBER, cyan: CYAN, dotR: v.dotR ?? 6.5,
    }, null, 2) + "\n");
  }
  rendered.push({ v, svg: built.svg });

  const { P, f } = built.cam;
  console.log(`\n${v.name} ${v.w}x${v.h} -> ${v.out}`);
  console.log(`  ${v.note}`);
  console.log(`  camera: principal point ${P.x.toFixed(0)},${P.y.toFixed(0)}  f=${f.toFixed(0)}px  ` +
              `basis orthogonality err ${built.cam.orthogonality.toExponential(1)}`);
  const sc = built.scene;
  const over = v.vps.A.y - sc.topY;
  console.log(`  camera sits ${sc.camHeight.toFixed(2)} units above the ground plane`);
  if (sc.covering.length) {
    console.log(`  FAIL the third vanishing point is hidden behind lot(s) ${sc.covering.join(", ")} — empty them`);
    failures++;
  }
  console.log(`  tallest tower: base y=${sc.baseY.toFixed(0)}, top y=${sc.topY.toFixed(0)} — ` +
              `${over > 0 ? `${over.toFixed(0)}px ABOVE the horizon (y=${v.vps.A.y}), so no roof, as intended`
                          : `${(-over).toFixed(0)}px below the horizon`}` +
              `${sc.topY < 0 ? "  <-- OFF THE TOP OF THE FRAME" : ""}`);
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
