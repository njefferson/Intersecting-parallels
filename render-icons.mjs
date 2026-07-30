// render-icons.mjs — rasterise public/icon.svg into the PNG sizes the
// manifest declares (§7). Dev tooling only; nothing here ships in public/
// except its output.
//
// Same matched pair as the a11y gate: playwright-core is pinned to the
// revision of the sandbox Chromium (see package.json).

import { chromium } from "playwright-core";
import { readFileSync, existsSync } from "node:fs";

const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const launchOpts = { args: ["--no-sandbox"] };
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

// [file, size, source] — a maskable icon needs its art inside the safe zone (the
// inner 80%). This used to be done by SHRINKING icon.svg onto a flat navy field,
// which seams where the flat colour meets the art's own gradient, and a flat pad
// is also how white ended up at the corners of the old icon. Instead there is a
// second SVG from render-art.mjs: the same scene and the same camera through a
// wider window, so the margin is real sky and ground and the art is full bleed.
// It lives in art/, not public/ — nothing at runtime references it, and public/ is
// the deployed site rather than a place to keep build inputs.
const TARGETS = [
  ["public/icon-192.png", 192, "public/icon.svg"],
  ["public/icon-512.png", 512, "public/icon.svg"],
  ["public/icon-maskable-512.png", 512, "art/icon-maskable.svg"],
  ["public/apple-touch-icon.png", 180, "public/icon.svg"],
];

const browser = await chromium.launch(launchOpts);
try {
  for (const [path, size, source] of TARGETS) {
    const svg = readFileSync(source, "utf8");
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><meta charset="utf-8">
      <style>
        html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}
        body{background:#0B1020}
        svg{width:${size}px;height:${size}px;display:block}
      </style>
      ${svg}`);
    await page.screenshot({ path, omitBackground: false });
    await page.close();
    console.log(`${path} ${size}x${size} from ${source}`);
  }
} finally {
  await browser.close();
}
