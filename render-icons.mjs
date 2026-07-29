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

const svg = readFileSync("public/icon.svg", "utf8");

// [file, size, maskable] — a maskable icon needs its art inside the safe zone
// (the inner 80%), so it is drawn smaller on a full-bleed field.
const TARGETS = [
  ["public/icon-192.png", 192, false],
  ["public/icon-512.png", 512, false],
  ["public/icon-maskable-512.png", 512, true],
  ["public/apple-touch-icon.png", 180, false],
];

const browser = await chromium.launch(launchOpts);
try {
  for (const [path, size, maskable] of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const inset = maskable ? Math.round(size * 0.1) : 0;
    await page.setContent(`<!doctype html><meta charset="utf-8">
      <style>
        html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}
        body{background:#0B1020;display:grid;place-items:center}
        .art{width:${size - inset * 2}px;height:${size - inset * 2}px}
        .art svg{width:100%;height:100%;display:block}
      </style>
      <div class="art">${svg}</div>`);
    await page.screenshot({ path, omitBackground: false });
    await page.close();
    console.log(`${path} ${size}x${size}${maskable ? " maskable" : ""}`);
  }
} finally {
  await browser.close();
}
