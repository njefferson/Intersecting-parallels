// walk.mjs — a headless walk of the BUILT app, from the start screen, driving
// real pointer events against the real page (Doctrine §6).
//
// Unit tests prove the solver does what its author expected. This proves the
// app a person actually touches does what it promises: draw a box, drag a
// vanishing point, undo, export, reload and find the work still there, then
// cold-launch it offline. Every one of those is a claim the README and the
// About panel make; each is checked here rather than asserted.
//
// EXITS NON-ZERO on any failure — it is a gate, not a report.
//
//   node walk.mjs            run the walk
//   node walk.mjs --shots    also write screenshots to .walk-shots/

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, mkdirSync, statSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOpts = { args: ['--no-sandbox'] };
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = '.walk-shots';
if (SHOTS && !existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};
function serveRoot(root = 'public') {
  const server = createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const path = join(root, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    try { if (!statSync(path).isFile()) throw new Error('nope'); }
    catch { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const failures = [];
const steps = [];
const check = (name, ok, detail = '') => {
  steps.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  return ok;
};

const server = await serveRoot();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(launchOpts);
const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, colorScheme: 'dark' });
const page = await context.newPage();

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });

const state = () => page.evaluate(() => window.__ip);

try {
  // ---- 1. cold start ------------------------------------------------------
  await page.goto(origin + '/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 10000 });
  let s = await state();
  check('starts on a usable drawing', s.scene.vanishingPoints.length === 2,
    `${s.scene.vanishingPoints.length} vanishing points`);
  check('the canvas is sized to the stage', s.canvas.width > 0 && s.canvas.height > 0);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/1-start.png` });

  // ---- 2. draw a box ------------------------------------------------------
  await page.click('#mode-draw');
  const box = await page.locator('#canvas').boundingBox();
  const at = (x, y) => ({ x: box.x + x, y: box.y + y });

  // Four strokes: front vertical, then one to each VP, then a back vertical.
  // Deliberately drawn by hand-ish drags, exactly as a person would.
  async function stroke(from, to) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
    }
    await page.mouse.up();
  }

  const beforeEdges = (await state()).scene.edges.length;
  await stroke(at(560, 520), at(560, 380));           // vertical front edge
  await stroke(at(560, 520), at(380, 500));           // toward VP1
  await stroke(at(560, 520), at(760, 500));           // toward VP2
  s = await state();
  check('strokes become edges', s.scene.edges.length === beforeEdges + 3,
    `${s.scene.edges.length - beforeEdges} of 3 landed`);
  const bindings = s.scene.edges.map(e => (e.binding === 'free' ? 'free' : (typeof e.binding === 'string' ? e.binding : 'vp')));
  check('a stroke drawn along a guide binds to it, not to nothing',
    bindings.filter(b => b !== 'free').length >= 3, `bindings: ${bindings.join(', ')}`);

  // §2.4: shared vertices. The three strokes started at the same point, so
  // they must SHARE one vertex id — this is the mechanism the whole app rests
  // on, and it is invisible in a screenshot.
  const corner = s.scene.edges.map(e => e.a);
  check('strokes starting at the same point share one vertex (§2.4)',
    new Set(corner).size === 1, `${new Set(corner).size} distinct start vertices`);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/2-drawn.png` });

  // ---- 3. drag a vanishing point -----------------------------------------
  const before = await page.evaluate(() => window.__ip.scene.vertices.map(v => ({ id: v.id, x: v.x, y: v.y })));
  await page.evaluate(() => {
    // Bring VP1 on-screen so it has a canvas handle to grab.
    const vp = window.__ip.scene.vanishingPoints[0];
    window.__ip.moveVp(vp.id, { x: 200, y: window.__ip.scene.horizon.y });
  });
  await page.waitForTimeout(60);
  const handle = await page.evaluate(() => {
    const vp = window.__ip.scene.vanishingPoints[0];
    return window.__ip.toScreen({ x: vp.x, y: vp.y });
  });
  await page.mouse.move(box.x + handle.x, box.y + handle.y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + handle.x + i * 6, box.y + handle.y - i * 2);
  await page.mouse.up();
  await page.waitForTimeout(80);

  s = await state();
  const after = s.scene.vertices;
  check('a VP drag moves the geometry', after.some(v => {
    const b = before.find(x => x.id === v.id);
    return b && Math.hypot(v.x - b.x, v.y - b.y) > 1;
  }));
  check('no vertex went NaN under a real drag', after.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)));
  check('no edge lost an endpoint', s.scene.edges.every(e =>
    after.some(v => v.id === e.a) && after.some(v => v.id === e.b)));
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/3-dragged.png` });

  // ---- 4. undo is one step per gesture (D7) ------------------------------
  const edgesNow = s.scene.edges.length;
  await page.click('#undo');                                  // undoes the drag
  await page.waitForTimeout(50);
  s = await state();
  check('undo restores the VP drag as ONE step (D7)', s.scene.edges.length === edgesNow,
    `edges ${s.scene.edges.length}, expected ${edgesNow}`);
  await page.click('#undo');                                  // undoes the last stroke
  await page.waitForTimeout(50);
  s = await state();
  check('a second undo removes the last stroke', s.scene.edges.length === edgesNow - 1,
    `edges ${s.scene.edges.length}`);
  await page.click('#redo');
  await page.waitForTimeout(50);
  s = await state();
  check('redo puts it back', s.scene.edges.length === edgesNow);

  // ---- 5. the keyboard surface (D6) --------------------------------------
  const vpButton = page.locator('#vp-list button').first();
  await vpButton.focus();
  const xBefore = (await state()).scene.vanishingPoints[0].x;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(40);
  let xAfter = (await state()).scene.vanishingPoints[0].x;
  check('arrow keys nudge a focused vanishing point', Math.abs(xAfter - xBefore - 2) < 1e-6,
    `moved ${xAfter - xBefore}px, expected 2`);
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(40);
  const xBig = (await state()).scene.vanishingPoints[0].x;
  check('Shift makes a larger step', Math.abs(xBig - xAfter - 20) < 1e-6, `moved ${xBig - xAfter}px, expected 20`);
  check('focus stays on the control after a nudge',
    await page.evaluate(() => document.activeElement && document.activeElement.closest('#vp-list') !== null));

  // Exact numeric entry — the other half of D6's control surface.
  const yInput = page.locator('#vp-list input[type="number"]').first();
  await yInput.fill('123');
  await yInput.press('Enter');
  await page.waitForTimeout(60);
  check('typed coordinates move the point exactly',
    Math.round((await state()).scene.vanishingPoints[0].x) === 123,
    `x is ${(await state()).scene.vanishingPoints[0].x}`);

  // ---- 6. export ----------------------------------------------------------
  const svg = await page.evaluate(() => window.__ip.buildSvg(window.__ip.scene, { includeConstruction: true }));
  check('SVG declares the inkscape namespace (D9)', svg.includes('xmlns:inkscape='));
  check('SVG carries readable layer names', svg.includes('inkscape:label="committed"'));
  check('SVG is stroked, never filled', svg.includes('fill="none"') && !/fill="(?!none)/.test(svg));
  check('SVG contains a path per drawn edge',
    (svg.match(/<path /g) || []).length >= (await state()).scene.edges.length);
  check('SVG has no NaN coordinates', !svg.includes('NaN'));

  const png = await page.evaluate(async () => {
    const canvas = window.__ip.renderPng(window.__ip.scene, { width: 800, height: 600, strokeWeight: 2 });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    // Transparent background is the §5.2 promise: the corner pixel must be
    // fully transparent, and SOMETHING must have been drawn.
    const ctx = canvas.getContext('2d');
    const corner = ctx.getImageData(0, 0, 1, 1).data;
    const all = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = 0;
    for (let i = 3; i < all.length; i += 4) if (all[i] > 0) inked++;
    return { bytes: buf.length, cornerAlpha: corner[3], inked };
  });
  check('PNG renders actual ink', png.inked > 100, `${png.inked} non-transparent pixels`);
  check('PNG background is transparent (§5.2)', png.cornerAlpha === 0, `corner alpha ${png.cornerAlpha}`);

  // ---- 7. persistence across a reload (§6) --------------------------------
  await page.evaluate(() => window.__ip.flush());
  const expectEdges = (await state()).scene.edges.length;
  const expectVerts = (await state()).scene.vertices.length;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 10000 });
  s = await state();
  check('the drawing survives a reload (§6)',
    s.scene.edges.length === expectEdges && s.scene.vertices.length === expectVerts,
    `${s.scene.edges.length}/${expectEdges} edges, ${s.scene.vertices.length}/${expectVerts} vertices`);
  check('history does NOT survive a reload, as documented (D7)',
    await page.evaluate(() => document.getElementById('undo').disabled === true));
  check('reloaded geometry is finite', s.scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)));

  // ---- 8. offline cold launch (§7, acceptance test) ----------------------
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const bootedOffline = await page.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 10000 })
    .then(() => true).catch(() => false);
  check('cold launch with no network (airplane mode, §11)', bootedOffline);
  if (bootedOffline) {
    s = await state();
    check('the last drawing opens offline', s.scene.edges.length === expectEdges,
      `${s.scene.edges.length}/${expectEdges} edges`);
  }
  await context.setOffline(false);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/4-offline.png` });

  // ---- 9. nothing leaves the device (Doctrine §1, §9) --------------------
  const external = [];
  page.on('request', r => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 10000 });
  await page.click('#mode-draw');
  await stroke(at(600, 560), at(600, 420));
  await page.waitForTimeout(2400);                     // let autosave fire
  check('no request ever leaves the origin (no analytics, no upload)',
    external.length === 0, external.join(', '));

  // ---- 10. 2,000 edges at interactive framerate (§11) --------------------
  // Built through the app's own API, then dragged through 60 real solve+draw
  // cycles. The number reported is the median frame, because a mean hides the
  // stalls that are the whole reason this test exists.
  const perf = await page.evaluate(async () => {
    const ip = window.__ip;
    const scene = ip.scene;
    const vp = scene.vanishingPoints[0];
    const anchor = scene.vertices[0];
    // 2,000 edges radiating from a shared anchor, every one bound to a VP, so
    // a VP drag must re-solve all of them.
    const mod = await import('/app/solver.mjs');
    while (scene.edges.length < 2000) {
      const r = mod.addRayVertex(scene, {
        origin: anchor.id,
        binding: { vpId: vp.id },
        t: 40 + (scene.edges.length % 400),
      });
      if (!r.ok) break;
      mod.addEdge(scene, { a: anchor.id, b: r.vertex.id, binding: { vpId: vp.id } });
    }
    const frames = [];
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now();
      ip.moveVp(vp.id, { x: vp.x + (i % 2 ? 7 : -7), y: vp.y + 3 });
      await new Promise(r => requestAnimationFrame(() => r()));
      frames.push(performance.now() - t0);
    }
    frames.sort((a, b) => a - b);
    return {
      edges: scene.edges.length,
      median: frames[Math.floor(frames.length / 2)],
      worst: frames[frames.length - 1],
      finite: scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)),
    };
  });
  check('2,000 edges were actually built', perf.edges >= 2000, `${perf.edges} edges`);
  check('2,000 edges hold interactive framerate under VP drag (§11)',
    perf.median <= 33, `median ${perf.median.toFixed(1)}ms, worst ${perf.worst.toFixed(1)}ms per solve+frame`);
  check('2,000 edges stay finite under drag', perf.finite);
  steps.push(`     (headless Chromium on a CI runner — a real iPad is Noah's to confirm)`);

  check('no page errors during the whole walk', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('the walk ran to completion', false, String(err && err.stack ? err.stack.split('\n')[0] : err));
} finally {
  await browser.close();
  server.close();
}

console.log('=== app walk ===');
for (const line of steps) console.log('  ' + line);
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log('  ✗ ' + f);
  console.log('\nThis walks the app a person actually touches. It exits non-zero.');
  process.exit(1);
}
console.log(`PASS — ${steps.length} checks, start screen to offline relaunch.`);
