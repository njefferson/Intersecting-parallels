// render-og.mjs — composite the wordmark onto the social-preview art and
// MEASURE the contrast it achieved. Dev tooling only; the only thing that ships
// is its output, public/og.png.
//
// Why this file exists: the first og.png was the raw artwork with no words on
// it. A social tile is shown at ~360px wide inside a card, often with nothing
// but a bare domain beside it, so a tile with no name on it tells a reader
// nothing about what they are being shown. The words are the point; the art is
// the backdrop.
//
// Why it measures instead of looking right: text over a picture has no single
// background colour, and the eye is a bad judge of the worst pixel. This script
// samples the ACTUAL rendered backdrop inside each text box (rendering once
// with the text hidden), takes the lightest pixel it finds — the worst case for
// light text — and computes the real WCAG ratio against the real text colour.
// It exits non-zero below AA, same posture as a11y-gate.mjs: a gate, not advice.
//
// Same matched pair as the other tools: playwright-core is pinned to the
// revision of the sandbox Chromium (see package.json).

import { chromium } from "playwright-core";
import { readFileSync, existsSync } from "node:fs";

const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const launchOpts = { args: ["--no-sandbox"] };
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

const BASE = "art/og-base.png";     // the wordless artwork Noah supplied, cut to 1200x630
const OUT = "public/og.png";
const W = 1200, H = 630;

// AA. Every line here is large text by WCAG's definition (>=24px, or >=18.66px
// bold), so 3:1 would pass — 4.5 is required anyway, because this is read at a
// third of its size in a feed and there is no cost to the extra headroom.
const REQUIRED = 4.5;

const INK = "#F7EEDC";      // cream — the wordmark
const WARM = "#F4CE93";     // amber-light — the tagline
const COOL = "#CBD4EA";     // cool grey — the plain-English line
const SCRIM = "5, 9, 20";   // near-black navy, one shade under --bg

const art = `data:image/png;base64,${readFileSync(BASE).toString("base64")}`;

const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
  body{position:relative;background:#0B1020}
  .art{position:absolute;inset:0;width:${W}px;height:${H}px;display:block}

  /* The legibility wash. Horizontal so the sun, the tree and the right-hand
     vanishing point stay untouched; masked so the lower grid does not go muddy.
     Feathered — a hard-edged panel would read as a banner stuck on top of the
     drawing rather than as sky.
     Held at .84 rather than the .94 it started at: at .94 every measurement
     passed comfortably and the LEFT vanishing point was erased, which is a poor
     trade on a picture whose subject is three of them. It now reads faintly
     through the wash, just under the tagline, and the gate re-checks that the
     glow it lets through still clears AA. */
  .scrim{
    position:absolute;inset:0;
    background:linear-gradient(100deg,
      rgba(${SCRIM},.84) 0%, rgba(${SCRIM},.81) 26%,
      rgba(${SCRIM},.60) 46%, rgba(${SCRIM},0) 66%);
    -webkit-mask-image:linear-gradient(to bottom, #000 0%, #000 64%, transparent 84%);
    mask-image:linear-gradient(to bottom, #000 0%, #000 64%, transparent 84%);
  }

  /* A narrow column, deliberately. Set wide, the tagline ran out to x=602 and
     sat straight on the horizon glow, which is the brightest thing in the
     picture — measured 2.92:1. The choice was deepen the wash until it covered
     the horizon (which also swallows the building, the actual subject) or keep
     the words inside the part of the wash that is already deep. Narrower column,
     art intact. */
  .words{position:absolute;left:72px;top:96px;width:462px}
  /* Liberation Sans is the Arial-metric face present in this sandbox; naming it
     first keeps the render identical run to run instead of depending on
     whatever generic sans the host resolves. */
  .words > *{font-family:"Liberation Sans",Arial,Helvetica,sans-serif;margin:0}

  .mark{font-size:72px;font-weight:700;letter-spacing:-1.2px;line-height:1.04;color:${INK}}
  .rule{width:84px;height:4px;background:#F2A65A;margin:24px 0 20px;border-radius:2px}
  .tag{font-size:31px;font-weight:400;line-height:1.25;color:${WARM}}
  .what{font-size:24px;font-weight:400;line-height:1.3;margin-top:20px;color:${COOL}}

  body.measuring .mark,
  body.measuring .tag,
  body.measuring .what{visibility:hidden}
</style>
<img class="art" src="${art}" alt="">
<div class="scrim"></div>
<div class="words">
  <p class="mark" data-fg="${INK}">Intersecting<br>Parallels</p>
  <div class="rule"></div>
  <p class="tag" data-fg="${WARM}">where you stand<br>and what you see</p>
  <p class="what" data-fg="${COOL}">Free perspective drawing. Works offline.</p>
</div>`;

const browser = await chromium.launch(launchOpts);
let failures = 0;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);

  // Pass 1 — backdrop only. Layout is identical because the text is hidden with
  // visibility, not display: the boxes we are about to sample are the boxes the
  // text will occupy, not an approximation of them.
  await page.evaluate(() => document.body.classList.add("measuring"));
  const backdrop = await page.screenshot();

  const measured = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    const lum = (r, g, b) => {
      const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };

    // Sample the LINE rects, not the element box. A block is as wide as its
    // container, so its box covers empty space the glyphs never reach — and out
    // there the wash has faded and the sun is bright, which failed the first
    // run on backdrop no letter is ever drawn over. Range.getClientRects()
    // returns one tight rect per rendered line, which is where the ink is.
    const lineRects = el => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return [...r.getClientRects()].filter(b => b.width > 1 && b.height > 1);
    };

    return [...document.querySelectorAll("[data-fg]")].map(el => {
      let worst = -1, worstAt = null, widest = 0;
      for (const r of lineRects(el)) {
        // 2px of bleed: antialiased glyph edges sit just outside the line rect,
        // and a bright pixel one pixel out still lands under a letter's halo.
        const x = Math.max(0, Math.floor(r.left) - 2), y = Math.max(0, Math.floor(r.top) - 2);
        const w = Math.min(c.width - x, Math.ceil(r.width) + 4), h = Math.min(c.height - y, Math.ceil(r.height) + 4);
        widest = Math.max(widest, w);
        const px = ctx.getImageData(x, y, w, h).data;
        for (let i = 0; i < px.length; i += 4) {
          const L = lum(px[i], px[i + 1], px[i + 2]);
          if (L > worst) {
            worst = L;
            const p = i / 4;
            worstAt = { x: x + (p % w), y: y + Math.floor(p / w), rgb: [px[i], px[i + 1], px[i + 2]] };
          }
        }
      }
      return {
        label: el.className,
        fg: el.dataset.fg,
        fontPx: Math.round(parseFloat(getComputedStyle(el).fontSize)),
        lines: lineRects(el).length,
        inkWidth: widest,
        lightest: worst, lightestAt: worstAt,
      };
    });
  }, `data:image/png;base64,${backdrop.toString("base64")}`);

  // Pass 2 — the real tile.
  await page.evaluate(() => document.body.classList.remove("measuring"));
  await page.screenshot({ path: OUT });
  await page.close();

  const lumOf = hex => {
    const n = parseInt(hex.slice(1), 16);
    const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };

  console.log(`${OUT} ${W}x${H} — from ${BASE}`);
  for (const m of measured) {
    const fg = lumOf(m.fg);
    // Worst case for light text is the LIGHTEST backdrop pixel in the box.
    const ratio = (Math.max(fg, m.lightest) + 0.05) / (Math.min(fg, m.lightest) + 0.05);
    const ok = ratio >= REQUIRED;
    if (!ok) failures++;
    const at = m.lightestAt;
    console.log(
      `  ${ok ? "PASS" : "FAIL"} .${m.label} ${m.fontPx}px ${m.fg} — ${ratio.toFixed(2)}:1 ` +
      `(need ${REQUIRED}:1) vs lightest backdrop pixel rgb(${at.rgb.join(",")}) at ${at.x},${at.y} ` +
      `— ${m.lines} line(s), widest ${m.inkWidth}px of ink`
    );
  }
} finally {
  await browser.close();
}

if (failures) {
  console.error(`\n${failures} text block(s) below AA on the art. Deepen the scrim or move the block; do not ship it.`);
  process.exit(1);
}
