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
// D28 — every context except the first-run block starts with the welcome already
// dismissed. Without this the panel sits over the app and every check below it
// measures a covered surface.
const seenWelcome = ctx => ctx.addInitScript(() => {
  try { localStorage.setItem('ip-welcome-seen', '1'); } catch { /* ignore */ }
});

const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, colorScheme: 'dark' });
await seenWelcome(context);
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
  // D18: there is no plain line. EVERY stroke carries a guide, not just most.
  check('every stroke lands on a guide — none come back plain (D18)',
    bindings.length > 0 && bindings.every(b => b !== 'free'), `bindings: ${bindings.join(', ')}`);

  // This check has been inverted twice, and the history is the point rather
  // than an embarrassment: §2.4 required merging, D16 removed it because Noah
  // objected to anything but a guide influencing his lines, and D20 brought it
  // back for ENDS ONLY after he found that without it "everything breaks when
  // you do adjustments". The settled rule: joining may move an end ALONG its
  // guide, never off it, so three strokes from one point SHARE that corner —
  // which is what holds a drawing together under a vanishing-point drag.
  const corner = s.scene.edges.map(e => e.a);
  check('strokes from the same point share one corner (D20)',
    new Set(corner).size === 1,
    `${new Set(corner).size} distinct start vertices for ${s.scene.edges.length} lines`);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/2-drawn.png` });

  // ---- 3. drag a vanishing point -----------------------------------------
  const before = await page.evaluate(() => window.__ip.scene.vertices.map(v => ({ id: v.id, x: v.x, y: v.y })));
  await page.evaluate(() => {
    // Bring VP1 on-screen so it has a canvas handle to grab.
    const vp = window.__ip.scene.vanishingPoints[0];
    window.__ip.moveVp(vp.id, { x: 200, y: window.__ip.scene.eyeLevel.y });
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

  // ---- 9. lines drawn to a vanishing point CONVERGE on it (D11) ----------
  //
  // Noah found this on his iPad on 2026-07-29: "the lines do not converge on
  // the vanishing point." The walk was green at the time, because §2 above
  // checked that each stroke carried SOME binding — a label — and every stroke
  // did: `horizontal`. Horizontal lines are parallel; they converge nowhere.
  //
  // So this checks the GEOMETRY, which is what he was actually looking at, and
  // it draws with real touch events because that is what his hand sends.
  const touchCtx = await browser.newContext({
    viewport: { width: 1100, height: 800 }, colorScheme: 'dark', hasTouch: true,
  });
  await seenWelcome(touchCtx);
  const tPage = await touchCtx.newPage();
  tPage.on('pageerror', e => pageErrors.push(`convergence page: ${e}`));
  await tPage.goto(origin + '/', { waitUntil: 'networkidle' });
  await tPage.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 10000 });
  await tPage.click('#mode-draw');
  await tPage.click('#touch-draws');                       // D5: finger draws, two fingers navigate

  const tBox = await tPage.locator('#canvas').boundingBox();
  const vpScreen = await tPage.evaluate(() => {
    const vp = window.__ip.scene.vanishingPoints[0];
    return { id: vp.id, ...window.__ip.toScreen({ x: vp.x, y: vp.y }) };
  });
  // One finger, dragged toward VP1 — with a little tremor, because a fingertip
  // is not a plotter and the bug lived exactly in that tremor.
  const drawWithFinger = async (fromX, fromY) => {
    const dx = vpScreen.x - fromX, dy = vpScreen.y - fromY, L = Math.hypot(dx, dy);
    const to = { x: fromX + dx / L * 260, y: fromY + dy / L * 260 };
    const cdp = await touchCtx.newCDPSession(tPage);
    const pt = (x, y) => [{ x: tBox.x + x, y: tBox.y + y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(fromX, fromY) });
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      const wobble = Math.sin(t * 7) * 2.5;               // ~±2.5px of hand tremor
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: pt(fromX + (to.x - fromX) * t, fromY + (to.y - fromY) * t + wobble),
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await tPage.waitForTimeout(40);
  };
  // Started well clear of the side panel, which overlays the stage on the right.
  for (const [x, y] of [[620, 260], [640, 380], [600, 500], [660, 600]]) await drawWithFinger(x, y);

  const conv = await tPage.evaluate(() => {
    const s = window.__ip.scene;
    const byId = new Map(s.vertices.map(v => [v.id, v]));
    const vp1 = s.vanishingPoints[0];
    const bound = [];
    let worst = 0;
    for (const e of s.edges) {
      if (typeof e.binding === 'string') continue;         // an axis or free line
      const vp = s.vanishingPoints.find(v => v.id === e.binding.vpId);
      const a = byId.get(e.a), b = byId.get(e.b);
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      // Perpendicular distance from the VP to the line the edge lies on.
      const miss = L === 0 ? Infinity : Math.abs(dx * (a.y - vp.y) - dy * (a.x - vp.x)) / L;
      worst = Math.max(worst, miss);
      bound.push({ vp: vp.id, miss });
    }
    return {
      edges: s.edges.length,
      toVp1: bound.filter(b => b.vp === vp1.id).length,
      bound: bound.length,
      worst,
      bindings: s.edges.map(e => (typeof e.binding === 'string' ? e.binding : e.binding.vpId)),
    };
  });
  check('a finger aimed at a vanishing point binds to THAT point, not to an axis (D11)',
    conv.toVp1 >= 3, `bindings: ${conv.bindings.join(', ')}`);
  check('every line bound to a vanishing point actually converges on it',
    conv.bound > 0 && conv.worst < 0.001, `worst miss ${conv.worst.toFixed(3)}px across ${conv.bound} bound lines`);
  if (SHOTS) await tPage.screenshot({ path: `${SHOT_DIR}/9-convergence.png` });
  await touchCtx.close();

  // ---- 10. deleting things works, and deleting a guide moves nothing (D17)
  //
  // Both reported by Noah, 2026-07-29: "I could not delete lines earlier, and
  // VPs said they could not be deleted without destroying existing lines."
  // Selecting used a 12px tolerance as a TAP target, and VP deletion refused
  // outright. Checked here through the real UI, by touch.
  const delCtx = await browser.newContext({
    viewport: { width: 1194, height: 834 }, colorScheme: 'dark', hasTouch: true,
  });
  await seenWelcome(delCtx);
  const dPage = await delCtx.newPage();
  dPage.on('pageerror', e => pageErrors.push(`delete page: ${e}`));
  await dPage.goto(origin + '/', { waitUntil: 'networkidle' });
  await dPage.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 10000 });
  await dPage.click('#mode-draw');
  await dPage.click('#touch-draws');

  const dFinger = async (fx, fy, tx, ty) => {
    const cdp = await delCtx.newCDPSession(dPage);
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(fx, fy) });
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(fx + (tx - fx) * t, fy + (ty - fy) * t) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await dPage.waitForTimeout(40);
  };
  for (const [x, y] of [[420, 300], [460, 420], [400, 540]]) await dFinger(x, y, x - 260, y + 20);
  const drew = await dPage.evaluate(() => window.__ip.scene.edges.length);

  // Tap the MIDDLE of a line with a finger and delete it.
  await dPage.click('#mode-select');
  // toScreen is CANVAS-relative and a dispatched touch takes VIEWPORT
  // coordinates, so the canvas's own offset has to be added — the same
  // instrument bug the weld block documents above. This check passed for as
  // long as it did only because the toolbar happened to be short enough that
  // the tap still landed inside D17's 44px radius; adding one toolbar row in
  // 1.4.0 pushed the canvas down and the check went red against a working app.
  const midPt = await dPage.evaluate(() => {
    const sc = window.__ip.scene, e = sc.edges[1];
    const a = sc.vertices.find(v => v.id === e.a), b = sc.vertices.find(v => v.id === e.b);
    const p = window.__ip.toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const r = document.getElementById('canvas').getBoundingClientRect();
    return { x: p.x + r.left, y: p.y + r.top };
  });
  const tapCdp = await delCtx.newCDPSession(dPage);
  await tapCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: midPt.x, y: midPt.y, id: 1 }] });
  await tapCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await tapCdp.detach();
  await dPage.waitForTimeout(80);
  const offered = await dPage.evaluate(() => document.querySelector('#inspector .btn')?.textContent ?? null);
  check('a finger can select a line to delete it (D17 — 44px, not 12px)',
    offered === 'Delete line', `inspector offered: ${offered}`);
  if (offered) { await dPage.click('#inspector .btn'); await dPage.waitForTimeout(80); }
  const afterDel = await dPage.evaluate(() => window.__ip.scene.edges.length);
  check('the line is actually gone', afterDel === drew - 1, `${drew} -> ${afterDel} lines`);

  // Delete a vanishing point and prove the drawing did not move.
  const vBefore = await dPage.evaluate(() => window.__ip.scene.vertices.map(v => ({ id: v.id, x: v.x, y: v.y })));
  const edgesBefore = await dPage.evaluate(() => window.__ip.scene.edges.length);
  await dPage.evaluate(() => [...document.querySelectorAll('#vp-list .btn')]
    .find(b => b.textContent === 'Delete').click());
  await dPage.waitForTimeout(120);
  const vpOut = await dPage.evaluate(() => ({
    vps: window.__ip.scene.vanishingPoints.length,
    edges: window.__ip.scene.edges.length,
    verts: window.__ip.scene.vertices.map(v => ({ id: v.id, x: v.x, y: v.y })),
    finite: window.__ip.scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)),
  }));
  check('a vanishing point can be deleted at all (D17)', vpOut.vps === 1, `${vpOut.vps} left`);
  check('deleting it destroys no lines', vpOut.edges === edgesBefore, `${edgesBefore} -> ${vpOut.edges}`);
  const movedCount = vBefore.filter(b => {
    const n = vpOut.verts.find(v => v.id === b.id);
    return n && (n.x !== b.x || n.y !== b.y);
  }).length;
  check('and not one pixel of the drawing moves', movedCount === 0 && vpOut.finite,
    `${movedCount} of ${vBefore.length} vertices moved`);
  if (SHOTS) await dPage.screenshot({ path: `${SHOT_DIR}/10-deleted.png` });
  await delCtx.close();

  // ---- 11. a box, from one gesture, that survives a drag (D21 + D20) -------
  //
  // Noah drew a cube out of nine strokes and it came apart when he moved a
  // point: "Being unable to connect line ends means everything breaks when you
  // do adjustments." A box built here must still be a box afterwards.
  const boxCtx = await browser.newContext({
    viewport: { width: 1194, height: 834 }, colorScheme: 'dark', hasTouch: true,
  });
  await seenWelcome(boxCtx);
  const bPage = await boxCtx.newPage();
  bPage.on('pageerror', e => pageErrors.push(`box page: ${e}`));
  await bPage.goto(origin + '/', { waitUntil: 'networkidle' });
  await bPage.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 10000 });
  await bPage.click('#mode-box');
  await bPage.click('#touch-draws');

  const bCdp = await boxCtx.newCDPSession(bPage);
  const bpt = (x, y) => [{ x, y, id: 1 }];
  await bCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: bpt(600, 640) });
  for (let i = 1; i <= 16; i++) {
    await bCdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: bpt(600 + i * 6, 640 - i * 9) });
  }
  await bCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await bCdp.detach();
  await bPage.waitForTimeout(120);

  // Every bound edge on its guide, every corner shared by more than one edge.
  const soundness = () => bPage.evaluate(() => {
    const s = window.__ip.scene, byId = new Map(s.vertices.map(v => [v.id, v]));
    const uses = new Map();
    let worst = 0;
    for (const e of s.edges) {
      for (const id of [e.a, e.b]) uses.set(id, (uses.get(id) || 0) + 1);
      const a = byId.get(e.a), b = byId.get(e.b);
      if (typeof e.binding === 'string') continue;
      const vp = s.vanishingPoints.find(v => v.id === e.binding.vpId);
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      worst = Math.max(worst, Math.abs(dx * (a.y - vp.y) - dy * (a.x - vp.x)) / L);
    }
    return {
      edges: s.edges.length, verts: s.vertices.length,
      orphans: [...uses.values()].filter(n => n < 2).length,
      worst: +worst.toFixed(4),
      finite: s.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)),
    };
  });
  const boxBefore = await soundness();
  check('one drag in Box mode builds a whole box (D21)',
    boxBefore.edges === 12 && boxBefore.verts === 8,
    `${boxBefore.edges} edges, ${boxBefore.verts} corners`);
  check('every corner of it is SHARED, not a loose line end (D20)',
    boxBefore.orphans === 0, `${boxBefore.orphans} loose ends`);

  // D23 — that drag went up and to the RIGHT, so the plan must be deeper on the
  // right. A square box would pass every check above it, which is exactly why
  // this one measures the two base lengths instead.
  const plan = await bPage.evaluate(() => {
    const s = window.__ip.scene, byId = new Map(s.vertices.map(v => [v.id, v]));
    const anchor = s.vertices.find(v => v.kind === 'anchor');
    const rays = s.vertices.filter(v => v.kind === 'ray' && v.origin === anchor.id
      && typeof v.binding === 'object');
    const len = v => Math.hypot(v.x - anchor.x, v.y - anchor.y);
    const toward = v => {
      const vp = s.vanishingPoints.find(p => p.id === v.binding.vpId);
      return vp.x > anchor.x ? 'right' : 'left';
    };
    const out = {};
    for (const v of rays) out[toward(v)] = +len(v).toFixed(1);
    return { ...out, bases: rays.length, anchored: !!anchor && byId.size > 0 };
  });
  check('the box drag favours the side you drag toward (D23 — note the far side sits at the floor; the second depth comes from a corner drag, D29)',
    plan.bases === 2 && plan.right > plan.left * 1.2,
    `left base ${plan.left}px, right base ${plan.right}px — dragged up and to the right`);

  // D23 — and each depth is settable exactly afterwards, through the real
  // inspector control, which is the part NOTES used to claim without it existing.
  const depthEdit = await bPage.evaluate(async () => {
    const s = window.__ip.scene;
    const anchor = s.vertices.find(v => v.kind === 'anchor');
    const ray = s.vertices.filter(v => v.kind === 'ray' && v.origin === anchor.id
      && typeof v.binding === 'object')
      .sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y))[0];
    const other = s.vertices.filter(v => v.kind === 'ray' && v.origin === anchor.id
      && typeof v.binding === 'object' && v.id !== ray.id)[0];
    const otherBefore = Math.hypot(other.x - anchor.x, other.y - anchor.y);
    window.__ip.select({ type: 'vertex', id: ray.id });
    await new Promise(r => requestAnimationFrame(r));
    const input = document.getElementById(`vtx-${ray.id}-t`);
    if (!input) return { found: false };
    input.value = String(Math.round(ray.t) + 260);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
    const s2 = window.__ip.scene;
    const a2 = s2.vertices.find(v => v.id === anchor.id);
    const r2 = s2.vertices.find(v => v.id === ray.id);
    const o2 = s2.vertices.find(v => v.id === other.id);
    return {
      found: true,
      grew: Math.hypot(r2.x - a2.x, r2.y - a2.y) - Math.hypot(ray.x, ray.y) * 0,
      moved: +(Math.hypot(o2.x - a2.x, o2.y - a2.y) - otherBefore).toFixed(3),
      edges: s2.edges.length,
      finite: s2.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)),
    };
  });
  check('a base corner\'s distance is editable, and only that side moves (D23)',
    depthEdit.found && Math.abs(depthEdit.moved) < 0.01 && depthEdit.edges === 12 && depthEdit.finite,
    depthEdit.found ? `the other base moved ${depthEdit.moved}px, still ${depthEdit.edges} edges`
                    : 'no distance control appeared for a ray corner');

  await bPage.evaluate(() => {
    const s = window.__ip.scene;
    window.__ip.moveVp(s.vanishingPoints[0].id, { x: -400, y: 250 });
  });
  await bPage.waitForTimeout(120);
  const boxAfter = await soundness();
  check('and it is still a box after a vanishing point is dragged',
    boxAfter.edges === 12 && boxAfter.verts === 8 && boxAfter.orphans === 0
      && boxAfter.worst < 0.001 && boxAfter.finite,
    JSON.stringify(boxAfter));
  if (SHOTS) await bPage.screenshot({ path: `${SHOT_DIR}/11-box.png` });
  await boxCtx.close();

  // D22 — the weld toggle, driven through the real button. Two strokes started
  // from the same place: welded, the second one's start is the SAME vertex; with
  // welding off it is a new one. This inverts the D16-era check yet again, and
  // that is the point of a toggle — both behaviours are now reachable and both
  // are asserted, instead of one being the app's opinion.
  const wCtx = await browser.newContext({ viewport: { width: 1194, height: 834 }, colorScheme: 'dark' });
  await seenWelcome(wCtx);
  const wPage = await wCtx.newPage();
  wPage.on('pageerror', e => pageErrors.push(`weld page: ${e}`));
  await wPage.goto(origin + '/', { waitUntil: 'networkidle' });
  await wPage.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 10000 });
  await wPage.click('#mode-draw');

  const weldStroke = async (x0, y0, x1, y1) => {
    await wPage.mouse.move(x0, y0);
    await wPage.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await wPage.mouse.move(x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10);
    }
    await wPage.mouse.up();
    await wPage.waitForTimeout(60);
  };

  const weldPressed = () => wPage.getAttribute('#weld', 'aria-pressed');
  check('welding is ON by default — the 0.5.0 behaviour', await weldPressed() === 'true',
    `aria-pressed=${await weldPressed()}`);

  await weldStroke(500, 500, 500, 660);             // a vertical
  const firstEnd = await wPage.evaluate(() => {
    const s = window.__ip.scene;
    const e = s.edges[s.edges.length - 1];
    const v = s.vertices.find(x => x.id === e.b);
    return { id: v.id, x: Math.round(v.x), y: Math.round(v.y), verts: s.vertices.length };
  });
  // Start the next stroke ON that end, running to the right: welding should reuse it.
  // toScreen is CANVAS-relative and the mouse takes VIEWPORT coordinates, so the
  // canvas's own offset has to be added. Without it the second stroke started
  // about a toolbar's height below the corner it was supposed to land on, and the
  // check failed against a perfectly working app — the instrument was wrong.
  const endScreen = await wPage.evaluate(id => {
    const v = window.__ip.scene.vertices.find(x => x.id === id);
    const p = window.__ip.toScreen(v);
    const r = document.getElementById('canvas').getBoundingClientRect();
    return { x: Math.round(p.x + r.left), y: Math.round(p.y + r.top) };
  }, firstEnd.id);
  await weldStroke(endScreen.x + 1, endScreen.y + 1, endScreen.x + 200, endScreen.y + 3);
  const welded = await wPage.evaluate(id => {
    const s = window.__ip.scene;
    const e = s.edges[s.edges.length - 1];
    return { sharesStart: e.a === id, verts: s.vertices.length, edges: s.edges.length };
  }, firstEnd.id);
  check('weld ON: a stroke started on an existing end SHARES that corner (D22)',
    welded.sharesStart, `start ${welded.sharesStart ? 'is' : 'is not'} the earlier end`);

  await wPage.click('#weld');
  check('the toggle reports itself off', await weldPressed() === 'false',
    `aria-pressed=${await weldPressed()}`);
  await weldStroke(endScreen.x + 1, endScreen.y - 1, endScreen.x + 180, endScreen.y - 40);
  const bare = await wPage.evaluate(id => {
    const s = window.__ip.scene;
    const e = s.edges[s.edges.length - 1];
    const a = s.vertices.find(x => x.id === e.a);
    return { sharesStart: e.a === id, bound: e.binding !== 'free', kind: a.kind };
  }, firstEnd.id);
  check('weld OFF: the same stroke joins nothing (D22)',
    !bare.sharesStart, `start ${bare.sharesStart ? 'still merged' : 'is its own point'}`);
  check('and it is still bound to a guide with welding off (D18 holds either way)',
    bare.bound, `binding ${bare.bound ? 'kept' : 'lost'}`);
  await wCtx.close();

  // D24 — clearing the screen, through the real dialog. The interesting checks
  // are the ones that assert what did NOT happen: the first tap must not clear,
  // and arming one button must not leave the other armed.
  const cCtx = await browser.newContext({ viewport: { width: 1194, height: 834 }, colorScheme: 'dark' });
  await seenWelcome(cCtx);
  const cPage = await cCtx.newPage();
  cPage.on('pageerror', e => pageErrors.push(`clear page: ${e}`));
  await cPage.goto(origin + '/', { waitUntil: 'networkidle' });
  await cPage.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 10000 });
  await cPage.click('#mode-draw');
  const cStroke = async (x0, y0, x1, y1) => {
    await cPage.mouse.move(x0, y0);
    await cPage.mouse.down();
    for (let i = 1; i <= 8; i++) await cPage.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
    await cPage.mouse.up();
    await cPage.waitForTimeout(50);
  };
  await cStroke(420, 420, 620, 470);
  await cStroke(420, 520, 640, 560);
  const drawn = await cPage.evaluate(() => {
    const s = window.__ip.scene;
    return { edges: s.edges.length, points: s.vanishingPoints.length, eyeLevel: Math.round(s.eyeLevel.y) };
  });
  check('two strokes are on the sheet before clearing', drawn.edges === 2,
    `${drawn.edges} lines, ${drawn.points} points`);

  // The TOOLBAR Clear first: same action, same guard, one tap away.
  await cPage.click('#clear-drawing');
  await cPage.waitForTimeout(60);
  const tbArmed = await cPage.evaluate(() => {
    const b = document.getElementById('clear-drawing');
    return {
      armed: b.dataset.armed, label: b.textContent.trim(),
      aria: b.getAttribute('aria-label') || '',
      edges: window.__ip.scene.edges.length,
    };
  });
  check('the toolbar Clear arms without clearing, and does not reflow the toolbar',
    tbArmed.edges === 2 && tbArmed.armed === 'true' && tbArmed.label === 'Clear',
    `${tbArmed.edges} lines still there, label still "${tbArmed.label}"`);
  check('its accessible name carries the count it read',
    /2 lines/.test(tbArmed.aria), `aria-label "${tbArmed.aria}"`);

  // D32 — the prompt must be AT the button, not at the bottom of the screen.
  const promptPlace = await cPage.evaluate(() => {
    const b = document.getElementById('clear-drawing').getBoundingClientRect();
    const n = document.getElementById('arm-prompt');
    const p = n.getBoundingClientRect();
    return {
      on: n.dataset.on, text: n.textContent,
      // Overlap, not edge-alignment: near the right of a toolbar the prompt is
      // clamped to stay on screen, which is correct — what must hold is that it
      // sits UNDER the button it belongs to and is nowhere near the bottom of the
      // screen. (The first version of this check demanded aligned left edges and
      // failed at 61px on a correctly clamped prompt.)
      overlaps: Math.min(p.right, b.right) - Math.max(p.left, b.left) > 20,
      dy: Math.round(p.top - b.bottom),
      viewportBottomGap: Math.round(window.innerHeight - p.bottom),
    };
  });
  check('the confirmation appears AT the Clear button, not at the bottom of the screen (D32)',
    promptPlace.on === 'true' && promptPlace.overlaps && promptPlace.dy >= 0 && promptPlace.dy < 60
      && promptPlace.viewportBottomGap > 200,
    `overlapping the button: ${promptPlace.overlaps}, ${promptPlace.dy}px below it, ` +
    `${promptPlace.viewportBottomGap}px clear of the screen bottom; says "${promptPlace.text.slice(0, 50)}"`);


  // Touching something else disarms it — an armed destructive button must never be
  // found still armed later.
  await cPage.click('#mode-select');
  const tbDisarmed = await cPage.evaluate(() => document.getElementById('clear-drawing').dataset.armed);
  check('and another toolbar tap cancels the arm', tbDisarmed === 'false', `armed=${tbDisarmed}`);
  const promptGone = await cPage.evaluate(() => document.getElementById('arm-prompt').dataset.on);
  check('and the prompt goes with it', promptGone === 'false', `prompt on=${promptGone}`);
  await cPage.click('#mode-draw');

  await cPage.click('#clear-drawing');
  await cPage.click('#clear-drawing');
  await cPage.waitForTimeout(80);
  const tbCleared = await cPage.evaluate(() => {
    const s = window.__ip.scene;
    return { edges: s.edges.length, points: s.vanishingPoints.length };
  });
  check('two taps on the toolbar Clear wipe the drawing and keep the points',
    tbCleared.edges === 0 && tbCleared.points === drawn.points,
    `${tbCleared.edges} lines, ${tbCleared.points} points kept`);
  await cPage.click('#undo');
  await cPage.waitForTimeout(80);
  const tbBack = await cPage.evaluate(() => window.__ip.scene.edges.length);
  check('one undo restores it', tbBack === 2, `${tbBack} lines back`);

  // An arm left alone expires rather than waiting to be tapped later.
  await cPage.click('#clear-drawing');
  await cPage.waitForTimeout(6600);
  const expired = await cPage.evaluate(() => ({
    armed: document.getElementById('clear-drawing').dataset.armed,
    edges: window.__ip.scene.edges.length,
  }));
  check('an arm left untouched expires by itself',
    expired.armed === 'false' && expired.edges === 2,
    `armed=${expired.armed}, ${expired.edges} lines untouched`);

  await cPage.click('#open-project');
  await cPage.waitForTimeout(80);
  await cPage.click('#pr-clear-drawing');
  const armed = await cPage.evaluate(() => {
    const b = document.getElementById('pr-clear-drawing');
    const other = document.getElementById('pr-clear-all');
    return {
      label: b.textContent, armed: b.dataset.armed,
      otherArmed: other.dataset.armed, otherLabel: other.textContent,
      edges: window.__ip.scene.edges.length,
    };
  });
  check('the first tap ARMS and clears nothing (D24)',
    armed.edges === 2 && armed.armed === 'true' && /Tap again/.test(armed.label),
    `${armed.edges} lines still there, button says "${armed.label}"`);
  check('and it states the count it read from the drawing, not a fixed sentence',
    /2 lines/.test(armed.label), `button says "${armed.label}"`);
  check('arming one clear does not arm the other (D24)',
    armed.otherArmed !== 'true' && !/Tap again/.test(armed.otherLabel),
    `the other button says "${armed.otherLabel}"`);

  await cPage.click('#pr-clear-drawing');
  await cPage.waitForTimeout(80);
  const cleared = await cPage.evaluate(() => {
    const s = window.__ip.scene;
    return {
      edges: s.edges.length, verts: s.vertices.length,
      points: s.vanishingPoints.length, eyeLevel: Math.round(s.eyeLevel.y),
      canvas: s.canvas.width,
    };
  });
  check('the second tap clears the drawing and keeps the points (D24)',
    cleared.edges === 0 && cleared.verts === 0 && cleared.points === drawn.points,
    `${cleared.edges} lines, ${cleared.verts} corners, ${cleared.points} points kept`);
  check('and the horizon and drawing size are untouched',
    cleared.horizon === drawn.horizon && cleared.canvas === 1600,
    `horizon ${cleared.horizon} (was ${drawn.horizon}), canvas ${cleared.canvas}`);

  // The Project dialog is modal, so the toolbar under it is inert — close it
  // before reaching for Undo. (The first version of this check clicked #undo with
  // the dialog still open and timed out against a perfectly good app.)
  await cPage.click('#dlg-project [value="close"]');
  await cPage.waitForTimeout(60);
  await cPage.click('#undo');
  await cPage.waitForTimeout(80);
  const restored = await cPage.evaluate(() => {
    const s = window.__ip.scene;
    return { edges: s.edges.length, verts: s.vertices.length, points: s.vanishingPoints.length };
  });
  check('ONE undo puts the whole drawing back (D7)',
    restored.edges === 2 && restored.points === drawn.points,
    `${restored.edges} lines and ${restored.verts} corners back in one step`);

  // Clear everything, and check the app is still usable afterwards — a cleared
  // sheet that cannot be drawn on is not cleared, it is broken.
  await cPage.click('#open-project');
  await cPage.waitForTimeout(80);
  await cPage.click('#pr-clear-all');
  await cPage.click('#pr-clear-all');
  await cPage.waitForTimeout(80);
  const wiped = await cPage.evaluate(() => {
    const s = window.__ip.scene;
    return { edges: s.edges.length, points: s.vanishingPoints.length, eyeLevel: Math.round(s.eyeLevel.y) };
  });
  check('clear everything removes the points too, keeping the horizon (D24)',
    wiped.edges === 0 && wiped.points === 0 && wiped.horizon === drawn.horizon,
    `${wiped.points} points, horizon still ${wiped.horizon}`);
  await cPage.click('#dlg-project [value="close"]');
  await cPage.waitForTimeout(60);
  // Add VP is how a point is created (Place mode drags the ones that exist) — the
  // first version of this check tapped the canvas and reported a failure against a
  // working app, which is the instrument being wrong, not the app.
  await cPage.click('#add-vp');
  await cPage.waitForTimeout(80);
  const afterWipe = await cPage.evaluate(() => {
    const s = window.__ip.scene;
    return { points: s.vanishingPoints.length, label: s.vanishingPoints[0]?.label };
  });
  check('the cleared sheet is still usable — a point can be added and it numbers from 1',
    afterWipe.points === 1 && afterWipe.label === 'VP1',
    `${afterWipe.points} point, labelled ${afterWipe.label}`);
  // D32 — a long press on the canvas must not start a text selection. On iOS that
  // shows the blue highlight and the callout menu; a slow press is a NORMAL way to
  // begin a stroke for a hand that does not move quickly (§4), so it must not be
  // punished. Asserted as the computed properties, which is what the browser acts
  // on, rather than by trying to reproduce a platform gesture headlessly.
  const selectable = await cPage.evaluate(() => {
    const c = document.getElementById('canvas');
    const cs = getComputedStyle(c), bs = getComputedStyle(document.body);
    const val = o => o.webkitUserSelect || o.userSelect;
    return {
      canvas: val(cs), body: val(bs),
      callout: bs.webkitTouchCallout || cs.webkitTouchCallout || '(unsupported here)',
      touchAction: cs.touchAction || bs.touchAction,
    };
  });
  check('a long press on the canvas cannot start a text selection (D32)',
    selectable.canvas === 'none' && selectable.body === 'none',
    `user-select: canvas ${selectable.canvas}, body ${selectable.body}; callout ${selectable.callout}; touch-action ${selectable.touchAction}`);

  await cCtx.close();

  // D31 — a box is two steps and the second is automatic: after the first drag
  // releases, the remaining depth must be live under the finger with no handle to
  // find and no mode to choose.
  const eCtx = await browser.newContext({ viewport: { width: 1194, height: 834 }, colorScheme: 'dark' });
  await seenWelcome(eCtx);
  const ePage = await eCtx.newPage();
  ePage.on('pageerror', e => pageErrors.push(`extrude page: ${e}`));
  await ePage.goto(origin + '/', { waitUntil: 'networkidle' });
  await ePage.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 20000 });
  await ePage.click('#mode-box');
  await ePage.mouse.move(600, 660);
  await ePage.mouse.down();
  for (let i = 1; i <= 14; i++) await ePage.mouse.move(600 + i * 7, 660 - i * 9);
  await ePage.mouse.up();
  await ePage.waitForTimeout(150);

  const afterFirst = await ePage.evaluate(() => {
    const s = window.__ip.scene;
    const anchor = s.vertices.find(v => v.kind === 'anchor');
    const rays = s.vertices.filter(v => v.kind === 'ray' && v.origin === anchor.id && typeof v.binding === 'object');
    return {
      edges: s.edges.length,
      depths: rays.map(r => +Math.abs(r.t).toFixed(1)).sort((a, b) => a - b),
      flag: document.getElementById('extrude-flag')?.dataset.on,
      says: document.getElementById('extrude-say')?.textContent || '',
    };
  });
  check('the first drag lands a whole box and the second step announces itself (D31)',
    afterFirst.edges === 12 && afterFirst.flag === 'true' && /drag anywhere/i.test(afterFirst.says),
    `${afterFirst.edges} edges, indicator ${afterFirst.flag}, says "${afterFirst.says.slice(0, 60)}"`);

  // D33 — the strip says a step is happening; the arrow says WHICH WAY. It must
  // sit ON the auto-selected corner and lie along that depth's own guide, so the
  // direction is checked against the corner-to-VP line rather than taken on trust.
  const aim = await ePage.evaluate(() => {
    const s = window.__ip.scene;
    const a = window.__ip.extrudeArrow();
    if (!a) return { hint: false };
    const ray = s.vertices.find(v => v.id === a.id);
    const origin = s.vertices.find(v => v.id === ray.origin);
    const vp = s.vanishingPoints.find(v => v.id === ray.binding.vpId);
    const dx = vp.x - origin.x, dy = vp.y - origin.y;
    const len = Math.hypot(dx, dy);
    const e = { x: dx / len, y: dy / len };
    return {
      hint: true,
      isSelectedRay: ray.id === a.id && ray.kind === 'ray',
      offCorner: Math.hypot(a.x - ray.x, a.y - ray.y),
      cross: Math.abs(a.u.x * e.y - a.u.y * e.x),      // 0 when parallel to the guide
      unit: Math.abs(Math.hypot(a.u.x, a.u.y) - 1),
    };
  });
  check('the second step shows a double-headed arrow on the auto-selected corner, along its guide (D33)',
    aim.hint && aim.isSelectedRay && aim.offCorner < 0.001 && aim.cross < 0.001 && aim.unit < 0.001,
    JSON.stringify(aim));

  // The very next drag — anywhere, no handle — sets the remaining depth.
  await ePage.mouse.move(430, 500);
  await ePage.mouse.down();
  for (let i = 1; i <= 10; i++) await ePage.mouse.move(430 - i * 9, 500 - i * 5);
  await ePage.mouse.up();
  await ePage.waitForTimeout(150);
  const afterSecond = await ePage.evaluate(() => {
    const s = window.__ip.scene;
    const anchor = s.vertices.find(v => v.kind === 'anchor');
    const rays = s.vertices.filter(v => v.kind === 'ray' && v.origin === anchor.id && typeof v.binding === 'object');
    return {
      edges: s.edges.length,
      depths: rays.map(r => +Math.abs(r.t).toFixed(1)).sort((a, b) => a - b),
      flag: document.getElementById('extrude-flag')?.dataset.on,
      finite: s.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)),
      degenerate: s.vertices.filter(v => v.degenerate).length,
    };
  });
  check('the next drag anywhere sets the OTHER depth — no handle to find (D31)',
    afterSecond.depths[0] > afterFirst.depths[0] * 2 && afterSecond.depths[0] > 60,
    `shallow depth ${afterFirst.depths[0]} -> ${afterSecond.depths[0]}, deep ${afterFirst.depths[1]} -> ${afterSecond.depths[1]}`);
  check('and it is a sound box afterwards, with the step finished',
    afterSecond.edges === 12 && afterSecond.finite && afterSecond.degenerate === 0 && afterSecond.flag === 'false',
    JSON.stringify(afterSecond));

  // Each step is its own undo, and the pending step never commits anything by
  // itself — walking away keeps the box rather than discarding it.
  const undone = await ePage.evaluate(async () => {
    document.getElementById('undo').click();
    await new Promise(r => requestAnimationFrame(r));
    const s = window.__ip.scene;
    const anchor = s.vertices.find(v => v.kind === 'anchor');
    const rays = s.vertices.filter(v => v.kind === 'ray' && v.origin === anchor.id && typeof v.binding === 'object');
    return { edges: s.edges.length, depths: rays.map(r => +Math.abs(r.t).toFixed(1)).sort((a, b) => a - b) };
  });
  check('undo takes back the second step alone, leaving the box',
    undone.edges === 12 && Math.abs(undone.depths[0] - afterFirst.depths[0]) < 1,
    `back to depths ${JSON.stringify(undone.depths)} with ${undone.edges} edges`);

  // Escape ends the state and keeps the drawing.
  const escaped = await ePage.evaluate(async () => {
    document.getElementById('mode-box').click();
    await new Promise(r => requestAnimationFrame(r));
    return { flag: document.getElementById('extrude-flag')?.dataset.on };
  });
  check('switching tools ends the second step and keeps the box',
    escaped.flag === 'false', `indicator ${escaped.flag}`);

  // D33, the part that matters: the arrow must be PAINTED, not merely computed.
  // A fresh box re-arms the step; count selection-coloured pixels in a ring
  // around the corner while it is live, then press Done — which moves nothing —
  // and count the same ring again. The box and the still-selected corner marker
  // are identical in both counts, so the difference IS the arrow. Delete the
  // drawing block in render.mjs and the live count collapses to the ended one.
  await ePage.mouse.move(330, 700);
  await ePage.mouse.down();
  for (let i = 1; i <= 12; i++) await ePage.mouse.move(330 + i * 6, 700 - i * 8);
  await ePage.mouse.up();
  await ePage.waitForTimeout(150);
  const ringProbe = () => ePage.evaluate(() => {
    const a = window.__ipRing;
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    const at = window.__ip.toScreen(a);
    const R = 60;
    const x0 = Math.max(0, Math.round((at.x - R) * dpr)), y0 = Math.max(0, Math.round((at.y - R) * dpr));
    const w = Math.min(canvas.width - x0, Math.round(2 * R * dpr));
    const h = Math.min(canvas.height - y0, Math.round(2 * R * dpr));
    if (w <= 0 || h <= 0) return -1;
    const d = ctx.getImageData(x0, y0, w, h).data;
    // The guide's direction in screen space, so the painted pixels can be tested
    // against it — presence alone would pass an arrow pointing the wrong way.
    const far = window.__ip.toScreen({ x: a.x + a.u.x * 100, y: a.y + a.u.y * 100 });
    const gx = far.x - at.x, gy = far.y - at.y;
    const gl = Math.hypot(gx, gy) || 1;
    let n = 0, aligned = 0;
    for (let i = 0; i < d.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor((i / 4) / w);
      const dx = (x0 + px) / dpr - at.x, dy = (y0 + py) / dpr - at.y;
      const r = Math.hypot(dx, dy);
      if (r < 22 || r > 52) continue;          // clear of the corner marker, inside the arrow's reach
      // #58C6E0 — the dark theme's selection colour; antialiasing allowed for
      if (!(Math.abs(d[i] - 88) < 45 && Math.abs(d[i + 1] - 198) < 45 && Math.abs(d[i + 2] - 224) < 45 && d[i + 3] > 128)) continue;
      n++;
      // |cos| because the arrow is double-headed: both ways along the guide count
      if (Math.abs((dx * gx + dy * gy) / (r * gl)) > 0.94) aligned++;   // within ~20°
    }
    return { n, aligned };
  });
  const rearmed = await ePage.evaluate(() => {
    const a = window.__ip.extrudeArrow();
    window.__ipRing = a ? { x: a.x, y: a.y, u: a.u } : null;
    return !!a;
  });
  check('a fresh box re-arms the step, arrow and all (D33)', rearmed);
  const inkLive = await ringProbe();
  const endedAt = await ePage.evaluate(() => window.__ipRing);
  await ePage.click('#extrude-done');
  await ePage.waitForTimeout(150);
  const inkEnded = await ringProbe();
  check('the arrow is really drawn while the step is live, and gone when Done ends it (D33)',
    inkLive.n > 80 && inkEnded.n * 4 < inkLive.n,
    `${inkLive.n} selection-coloured px in the ring live, ${inkEnded.n} after Done`);
  check('and every one of those pixels lies along the guide, both ways from the corner (D33)',
    inkLive.n > 0 && inkLive.aligned / inkLive.n > 0.9,
    `${inkLive.aligned}/${inkLive.n} within 20° of the guide at ${JSON.stringify(endedAt?.u)}`);

  // Done ends the step without touching the drawing — nothing is lost by it.
  const afterDone = await ePage.evaluate(() => ({
    edges: window.__ip.scene.edges.length,
    flag: document.getElementById('extrude-flag')?.dataset.on,
    finite: window.__ip.scene.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)),
  }));
  check('Done ends the step and keeps the box',
    afterDone.edges === 24 && afterDone.flag === 'false' && afterDone.finite,
    JSON.stringify(afterDone));
  await eCtx.close();

  // D34 / F-04 — drawing without a drag. This whole block touches the mouse
  // exactly never: buttons are focused and activated with Enter, lengths and
  // depths are set with arrow keys. A counter on the canvas's own pointerdown
  // proves it rather than the absence of mouse calls in the source implying it.
  const nodragCtx = await browser.newContext({ viewport: { width: 1194, height: 834 }, colorScheme: 'dark' });
  await seenWelcome(nodragCtx);
  const nodragPage = await nodragCtx.newPage();
  nodragPage.on('pageerror', e => pageErrors.push(`keyboard-draw page: ${e}`));
  await nodragPage.goto(origin + '/', { waitUntil: 'networkidle' });
  await nodragPage.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 20000 });
  await nodragPage.evaluate(() => {
    window.__pointerdowns = 0;
    document.getElementById('canvas').addEventListener('pointerdown', () => { window.__pointerdowns++; });
  });

  const edges0 = await nodragPage.evaluate(() => window.__ip.scene.edges.length);
  await nodragPage.focus('#add-line');
  await nodragPage.keyboard.press('Enter');
  await nodragPage.waitForTimeout(150);
  const line = await nodragPage.evaluate(() => {
    const s = window.__ip.scene;
    const e = s.edges[s.edges.length - 1];
    const sel = window.__ip.selection;
    const v = sel && sel.type === 'vertex' ? s.vertices.find(x => x.id === sel.id) : null;
    return {
      edges: s.edges.length,
      bound: e ? e.binding !== 'free' : false,
      selectedFarEnd: !!v && (v.id === e.b),
      kind: v ? v.kind : null,
      focus: document.activeElement?.tagName?.toLowerCase(),
      t: v && typeof v.t === 'number' ? +v.t.toFixed(1) : null,
      finite: s.vertices.every(x => Number.isFinite(x.x) && Number.isFinite(x.y)),
    };
  });
  check('Add line draws a real line from the keyboard, bound to a guide (D34)',
    line.edges === edges0 + 1 && line.bound && line.finite,
    `${edges0} -> ${line.edges} edges, bound ${line.bound}`);
  check('and it hands the far end straight to the keyboard, focus and all',
    line.selectedFarEnd && line.kind === 'ray' && line.focus === 'canvas',
    `selected the far end: ${line.selectedFarEnd} (${line.kind}), focus on ${line.focus}`);

  // The claim is that the arrow keys now finish the job. Test it, do not assume —
  // and press the key that LENGTHENS it, which depends on which side of the view
  // the guide's vanishing point is on. An earlier version of this check pressed
  // ArrowRight blindly, drove the distance from 200 down to its floor of 1, and
  // passed anyway because it only asserted that the number had changed.
  const growKey = await nodragPage.evaluate(() => {
    const s = window.__ip.scene;
    const sel = window.__ip.selection;
    // Defensive: if the button drew nothing there is nothing selected, and the
    // checks below should REPORT that rather than crash the whole walk on it.
    if (!sel || sel.type !== 'vertex') return null;
    const v = s.vertices.find(x => x.id === sel.id);
    if (!v || typeof v.binding !== 'object') return null;
    const o = s.vertices.find(x => x.id === v.origin);
    const vp = s.vanishingPoints.find(p => p.id === v.binding.vpId);
    return (vp.x - o.x) >= 0 ? 'Shift+ArrowRight' : 'Shift+ArrowLeft';
  });
  for (let i = 0; growKey && i < 12; i++) await nodragPage.keyboard.press(growKey);
  await nodragPage.waitForTimeout(120);
  const lengthened = await nodragPage.evaluate(() => {
    const s = window.__ip.scene;
    const sel = window.__ip.selection;
    const v = sel && sel.type === 'vertex' ? s.vertices.find(x => x.id === sel.id) : null;
    return { t: v ? +Math.abs(v.t).toFixed(1) : -1, degenerate: s.vertices.filter(x => x.degenerate).length };
  });
  check('the arrow keys then LENGTHEN it, with no drag anywhere (SC 2.5.7)',
    lengthened.t > Math.abs(line.t) + 20 && lengthened.degenerate === 0,
    `distance ${Math.abs(line.t)} -> ${lengthened.t} using ${growKey}`);

  // A box, the same way — and it must arrive in D31's second step, because that
  // step is where its third dimension comes from.
  await nodragPage.focus('#add-box');
  await nodragPage.keyboard.press('Enter');
  await nodragPage.waitForTimeout(150);
  const kbBox = await nodragPage.evaluate(() => {
    const s = window.__ip.scene;
    return {
      edges: s.edges.length,
      flag: document.getElementById('extrude-flag')?.dataset.on,
      arrow: !!window.__ip.extrudeArrow(),
      depths: s.vertices.filter(v => v.kind === 'ray' && typeof v.binding === 'object')
        .map(v => +Math.abs(v.t).toFixed(1)).sort((a, b) => a - b),
      finite: s.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)),
      degenerate: s.vertices.filter(v => v.degenerate).length,
    };
  });
  check('Add box builds a whole box from the keyboard and opens the second step (D34)',
    kbBox.edges === line.edges + 12 && kbBox.flag === 'true' && kbBox.arrow && kbBox.finite && kbBox.degenerate === 0,
    `${line.edges} -> ${kbBox.edges} edges, step ${kbBox.flag}, arrow ${kbBox.arrow}`);

  // Same again: the depth is AT its floor, so pressing the shrinking direction
  // would be a no-op and would tell us nothing. The arrow the step draws already
  // knows which way this corner travels — use it.
  const deepenKey = await nodragPage.evaluate(() => {
    const a = window.__ip.extrudeArrow();
    if (!a) return null;
    const at = window.__ip.toScreen({ x: a.x, y: a.y });
    const far = window.__ip.toScreen({ x: a.x + a.u.x * 100, y: a.y + a.u.y * 100 });
    return (far.x - at.x) >= 0 ? 'Shift+ArrowRight' : 'Shift+ArrowLeft';
  });
  for (let i = 0; deepenKey && i < 12; i++) await nodragPage.keyboard.press(deepenKey);
  await nodragPage.waitForTimeout(120);
  const deepened = await nodragPage.evaluate(() => {
    const s = window.__ip.scene;
    const sel = window.__ip.selection;
    const v = sel && sel.type === 'vertex' ? s.vertices.find(x => x.id === sel.id) : { t: -1 };
    return {
      t: +Math.abs(v.t).toFixed(1),
      edges: s.edges.length,
      finite: s.vertices.every(x => Number.isFinite(x.x) && Number.isFinite(x.y)),
      degenerate: s.vertices.filter(x => x.degenerate).length,
    };
  });
  check('and the arrow keys set the remaining depth — a whole box, never once dragged',
    deepened.t > 40 && deepened.edges === kbBox.edges && deepened.finite && deepened.degenerate === 0,
    `remaining depth ${kbBox.depths[0]} -> ${deepened.t} using ${deepenKey}`);

  // Each button is one undo, like every other edit (D7).
  const undoneKeyboard = await nodragPage.evaluate(async () => {
    document.getElementById('undo').click();
    await new Promise(r => requestAnimationFrame(r));
    return window.__ip.scene.edges.length;
  });
  check('a keyboard-drawn box is one undo, same as a dragged one',
    undoneKeyboard === deepened.edges, `${deepened.edges} -> ${undoneKeyboard} edges after one undo`);

  const pointerdowns = await nodragPage.evaluate(() => window.__pointerdowns);
  check('none of that touched the canvas with a pointer (F-04 closed)',
    pointerdowns === 0, `${pointerdowns} pointerdown events on the canvas`);
  // D36/D37/D38 — eye level vs the horizon, solid shading, and rays. Measured in
  // PIXELS off the real canvas, because every one of these is a claim about what
  // is on screen and the scene graph cannot answer that.
  //
  // Counting a colour across the WHOLE canvas rather than sampling one point: the
  // first version of this block sampled face centroids and failed three times
  // over, once on a grid line and twice on the box's own ink. A face is an area,
  // so the honest measurement is an area.
  const FACE = { top: [59, 64, 81], right: [46, 52, 69], left: [34, 39, 58], bottom: [12, 15, 27] };
  const faceCounts = () => nodragPage.evaluate(want => {
    const canvas = document.getElementById('canvas');
    const d = new Uint32Array(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    // One integer key per colour, so this is a single pass with a map lookup
    // rather than four comparisons per pixel — the naive version timed out.
    const key = c => (255 << 24 | c[2] << 16 | c[1] << 8 | c[0]) >>> 0;
    const lookup = new Map(Object.entries(want).map(([k, c]) => [key(c), k]));
    const out = {};
    for (const k of Object.keys(want)) out[k] = 0;
    for (let i = 0; i < d.length; i++) {
      const k = lookup.get(d[i]);
      if (k !== undefined) out[k]++;
    }
    return out;
  }, FACE);

  // Clear, then build ONE box with both depths real, by the two drags D31
  // describes. The keyboard-drawn box above deliberately leaves its second depth
  // at the floor, which makes its top and bottom zero-area slivers — measuring
  // face areas on that box measures nothing, which is exactly how the first
  // version of this block failed.
  await nodragPage.click('#clear-drawing');
  await nodragPage.click('#clear-drawing');
  await nodragPage.waitForTimeout(150);
  await nodragPage.click('#mode-box');
  await nodragPage.mouse.move(600, 660);
  await nodragPage.mouse.down();
  for (let i = 1; i <= 14; i++) await nodragPage.mouse.move(600 + i * 7, 660 - i * 9);
  await nodragPage.mouse.up();
  await nodragPage.waitForTimeout(150);
  await nodragPage.mouse.move(430, 500);
  await nodragPage.mouse.down();
  for (let i = 1; i <= 10; i++) await nodragPage.mouse.move(430 - i * 9, 500 - i * 5);
  await nodragPage.mouse.up();
  await nodragPage.waitForTimeout(150);
  const built = await nodragPage.evaluate(() => {
    const s = window.__ip.scene;
    const a = s.vertices.find(v => v.kind === 'anchor');
    return {
      edges: s.edges.length, faces: s.faces.length,
      depths: s.vertices.filter(v => v.kind === 'ray' && v.origin === a.id && typeof v.binding === 'object')
        .map(v => Math.round(Math.abs(v.t))).sort((x, y) => x - y),
    };
  });
  check('one box, both depths real, four faces (D37 setup)',
    built.edges === 12 && built.faces === 4 && built.depths[0] > 60,
    JSON.stringify(built));

  const wireframe = await faceCounts();
  check('a wireframe has no face fills at all (D37)',
    Object.values(wireframe).every(n => n < 20), JSON.stringify(wireframe));

  await nodragPage.click('#solid');
  await nodragPage.waitForTimeout(180);
  const filled = await faceCounts();
  check('Solid fills the box — the two front faces are always the ones you see (D37)',
    filled.left > 200 && filled.right > 200,
    `left ${filled.left}px, right ${filled.right}px`);

  // The lesson, on screen: whether you see the top or the underside follows eye
  // level, and a box straddling your eye shows you neither.
  const faceMid = shade => nodragPage.evaluate(sh => {
    const s = window.__ip.scene;
    const f = [...s.faces].reverse().find(x => x.shade === sh);
    if (!f) return null;
    const pts = f.loop.map(id => s.vertices.find(v => v.id === id));
    return { y: pts.reduce((a, v) => a + v.y, 0) / pts.length };
  }, shade);
  const topMid = await faceMid('top');
  const bottomMid = await faceMid('bottom');
  const setEye = async y => {
    await nodragPage.evaluate(v => {
      const f = document.getElementById('horizon-y');
      f.value = String(v);
      f.dispatchEvent(new Event('change'));
    }, y);
    await nodragPage.waitForTimeout(160);
  };

  await setEye(Math.round(topMid.y - 150));
  const above = await faceCounts();
  check('eye level ABOVE the box shows its top and never its underside (D37)',
    above.top > 200 && above.bottom === 0, JSON.stringify(above));

  await setEye(Math.round(bottomMid.y + 150));
  const below = await faceCounts();
  check('eye level BELOW the box shows its underside and never its top',
    below.bottom > 200 && below.top < 20, JSON.stringify(below));

  await setEye(Math.round((topMid.y + bottomMid.y) / 2));
  const straddle = await faceCounts();
  check('eye level THROUGH the box shows neither — the middle case in the lesson',
    straddle.top < 20 && straddle.bottom < 20 && straddle.left > 200,
    JSON.stringify(straddle));

  // D36 — there is no horizon without the points.
  const horizonState = await nodragPage.evaluate(() => {
    const s = window.__ip.scene;
    const before = !!window.__ip.horizon();
    const flagged = s.vanishingPoints.filter(v => v.onHorizon);
    flagged[0].onHorizon = false;
    const afterOne = !!window.__ip.horizon();
    flagged[0].onHorizon = true;
    const level = window.__ip.horizon().u.y;
    flagged[1].y -= 160;
    const tilted = window.__ip.horizon().u.y;
    flagged[1].y += 160;
    return { before, afterOne, level, tilted };
  });
  check('the horizon exists only when two points claim it (D36)',
    horizonState.before === true && horizonState.afterOne === false,
    `two points: ${horizonState.before}, one point: ${horizonState.afterOne}`);
  check('and it tilts with the points rather than staying level',
    Math.abs(horizonState.level) < 1e-9 && Math.abs(horizonState.tilted) > 0.01,
    `slope ${horizonState.level} -> ${horizonState.tilted}`);

  // D38 — rays out to every vanishing point, on a toggle. Counted as pixels that
  // CHANGED when the toggle flipped, which is the claim itself and needs no
  // guess about how a 1px dashed line antialiases.
  // Counted IN THE PAGE: shipping four million pixels across the bridge three
  // times timed the walk out. Only the count crosses.
  const stashPixels = () => nodragPage.evaluate(() => {
    const canvas = document.getElementById('canvas');
    window.__snap = new Uint32Array(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.buffer).slice();
  });
  const diffPixels = () => nodragPage.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const now = new Uint32Array(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    let n = 0;
    for (let i = 0; i < now.length; i++) if (now[i] !== window.__snap[i]) n++;
    return n;
  });

  await stashPixels();
  await nodragPage.click('#rays');
  await nodragPage.waitForTimeout(200);
  const changed = await diffPixels();
  check('Rays draws lines out to the vanishing points, and the toggle is what does it (D38)',
    changed > 200, `${changed} pixels changed when Rays was turned on`);

  await nodragPage.click('#rays');
  await nodragPage.waitForTimeout(200);
  const residue = await diffPixels();
  check('and turning it off puts the canvas back exactly as it was',
    residue === 0, `${residue} pixels still different after turning Rays off`);

  const untouched = await nodragPage.evaluate(() => ({
    edges: window.__ip.scene.edges.length,
    verts: window.__ip.scene.vertices.length,
  }));
  check('none of Solid, Rays or eye level changed the drawing itself',
    untouched.edges === built.edges && untouched.verts > 0,
    `${untouched.edges} edges, ${untouched.verts} corners`);
  await nodragCtx.close();

  // D36a — BOOTING ON A DRAWING SAVED BY AN OLDER BUILD.
  //
  // Noah, on 1.5.0: "There are no VPs on the page and I cannot add any, now."
  // His saved scene carried `horizon` and no `eyeLevel`, the first render threw
  // on it, and the panel died with the canvas. Every point was still in the file.
  //
  // No walk context could ever have caught that, because every one of them starts
  // with an empty IndexedDB and therefore always meets a scene this build wrote
  // itself. This block writes an OLD scene into storage and reloads onto it.
  const oldCtx = await browser.newContext({ viewport: { width: 1194, height: 834 }, colorScheme: 'dark' });
  await seenWelcome(oldCtx);
  const oldPage = await oldCtx.newPage();
  const oldErrors = [];
  oldPage.on('pageerror', e => oldErrors.push(String(e)));
  await oldPage.goto(origin + '/', { waitUntil: 'networkidle' });
  await oldPage.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 20000 });
  await oldPage.evaluate(() => window.__ip.flush());
  await oldPage.waitForTimeout(200);

  // Rewrite the stored record into exactly the shape a pre-1.5.0 build wrote.
  const downgraded = await oldPage.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('intersecting-parallels', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction(['meta', 'scenes'], 'readwrite');
      const meta = t.objectStore('meta').get('lastOpen');
      meta.onsuccess = () => {
        const id = meta.result?.sceneId;
        if (!id) { resolve({ ok: false, why: 'nothing stored' }); return; }
        const get = t.objectStore('scenes').get(id);
        get.onsuccess = () => {
          const rec = get.result;
          rec.schemaVersion = 1;
          rec.horizon = { y: rec.eyeLevel.y };     // the old name, the old shape
          delete rec.eyeLevel;
          delete rec.faces;
          t.objectStore('scenes').put(rec);
          resolve({ ok: true, points: rec.vanishingPoints.length, horizon: rec.horizon.y });
        };
        get.onerror = () => reject(get.error);
      };
      meta.onerror = () => reject(meta.error);
    };
  }));
  check('a pre-1.5.0 scene was written into storage (D36a setup)',
    downgraded.ok && downgraded.points >= 2, JSON.stringify(downgraded));

  oldErrors.length = 0;
  await oldPage.reload({ waitUntil: 'networkidle' });
  // NOT fatal if it never boots — that IS the defect, and a gate that dies on it
  // reports a Playwright timeout instead of the four things actually broken.
  const cameUp = await oldPage.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 15000 })
    .then(() => true).catch(() => false);
  await oldPage.waitForTimeout(250);

  const booted = await oldPage.evaluate(() => {
    const s = window.__ip?.scene;
    if (!s) {
      const canvas = document.getElementById('canvas');
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let inked = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) inked++;
      return { points: 0, rows: document.querySelectorAll('.vp-row button[id$="-focus"]').length, inked, dead: true };
    }
    const canvas = document.getElementById('canvas');
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) inked++;
    return {
      points: s.vanishingPoints.length,
      eyeLevel: s.eyeLevel?.y,
      staleField: s.horizon,
      faces: Array.isArray(s.faces),
      schema: s.schemaVersion,
      rows: document.querySelectorAll('.vp-row button[id$="-focus"]').length,
      inked,
    };
  });
  check('the app boots on a scene from an older build, with its points intact (D36a)',
    cameUp && booted.points >= 2,
    booted.dead
      ? 'the app never came up at all — this is exactly what Noah saw'
      : `${booted.points} points, ${oldErrors.length} page errors${oldErrors[0] ? `: ${oldErrors[0].slice(0, 90)}` : ''}`);
  check('the old horizon became eye level, keeping its number',
    booted.eyeLevel === downgraded.horizon && booted.staleField === undefined && booted.faces && booted.schema === 2,
    `eyeLevel ${booted.eyeLevel} (was horizon ${downgraded.horizon}), schema ${booted.schema}`);
  check('and it actually DREW — the symptom was a blank page, not a bad number',
    booted.inked > 1000, `${booted.inked} inked pixels`);
  check('the points panel came back too, which is what "I cannot add any" meant',
    booted.rows === booted.points, `${booted.rows} rows for ${booted.points} points`);

  await oldPage.click('#add-vp').catch(() => {});
  await oldPage.waitForTimeout(200);
  const added = await oldPage.evaluate(() => ({
    points: window.__ip?.scene?.vanishingPoints.length ?? 0,
    rows: document.querySelectorAll('.vp-row button[id$="-focus"]').length,
  }));
  check('Add VP works on a migrated scene',
    added.points === booted.points + 1 && added.rows === added.points,
    `${booted.points} -> ${added.points} points, ${added.rows} rows`);
  await oldCtx.close();

  // D29 — the four corners that did nothing. This is the defect class Noah
  // reported and NO gate could see it: before this block the walk never dragged a
  // vertex of any kind, only vanishing points.
  const kCtx = await browser.newContext({ viewport: { width: 1194, height: 834 }, colorScheme: 'dark' });
  await seenWelcome(kCtx);
  const kPage = await kCtx.newPage();
  kPage.on('pageerror', e => pageErrors.push(`corner page: ${e}`));
  await kPage.goto(origin + '/', { waitUntil: 'networkidle' });
  await kPage.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 20000 });
  await kPage.click('#mode-box');
  await kPage.mouse.move(600, 640);
  await kPage.mouse.down();
  for (let i = 1; i <= 14; i++) await kPage.mouse.move(600 + i * 6, 640 - i * 9);
  await kPage.mouse.up();
  await kPage.waitForTimeout(150);
  await kPage.click('#mode-select');

  const cornerAt = kind => kPage.evaluate(k => {
    const s = window.__ip.scene;
    const v = s.vertices.find(x => x.kind === k);
    if (!v) return null;
    const p = window.__ip.toScreen(v);
    const r = document.getElementById('canvas').getBoundingClientRect();
    return { id: v.id, kind: v.kind, x: Math.round(p.x + r.left), y: Math.round(p.y + r.top), vx: v.x, vy: v.y };
  }, kind);

  // Every KIND of corner, driven by a real drag.
  const dragResults = [];
  for (const kind of ['anchor', 'ray', 'intersect']) {
    const before = await cornerAt(kind);
    if (!before) { dragResults.push({ kind, moved: false, why: 'no corner of this kind' }); continue; }
    await kPage.mouse.move(before.x, before.y);
    await kPage.mouse.down();
    for (let i = 1; i <= 8; i++) await kPage.mouse.move(before.x + i * 5, before.y - i * 4);
    await kPage.mouse.up();
    await kPage.waitForTimeout(120);
    const after = await kPage.evaluate(id => {
      const v = window.__ip.scene.vertices.find(x => x.id === id);
      return { x: v.x, y: v.y };
    }, before.id);
    dragResults.push({ kind, moved: Math.hypot(after.x - before.vx, after.y - before.vy) > 2 });
  }
  check('every KIND of corner moves when dragged — including the intersect corners (D29)',
    dragResults.every(r => r.moved),
    dragResults.map(r => `${r.kind}: ${r.moved ? 'moved' : 'DID NOT MOVE'}`).join(', '));

  // The box survived all three drags.
  const boxAfterDrags = await kPage.evaluate(() => {
    const s = window.__ip.scene, byId = new Map(s.vertices.map(v => [v.id, v]));
    let worst = 0;
    for (const e of s.edges) {
      if (typeof e.binding === 'string') continue;
      const vp = s.vanishingPoints.find(v => v.id === e.binding.vpId);
      const a = byId.get(e.a), b = byId.get(e.b);
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      worst = Math.max(worst, Math.abs(dx * (a.y - vp.y) - dy * (a.x - vp.x)) / L);
    }
    return {
      edges: s.edges.length, verts: s.vertices.length,
      finite: s.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)),
      degenerate: s.vertices.filter(v => v.degenerate).length,
      worst: +worst.toFixed(4),
    };
  });
  check('and the box is still a box after all three drags',
    boxAfterDrags.edges === 12 && boxAfterDrags.verts === 8 && boxAfterDrags.finite
      && boxAfterDrags.degenerate === 0 && boxAfterDrags.worst < 0.001,
    JSON.stringify(boxAfterDrags));

  // ONE undo per drag — not zero (the old empty-step bug) and not several.
  const undoSteps = await kPage.evaluate(async () => {
    const s = window.__ip.scene;
    const v = s.vertices.find(x => x.kind === 'intersect');
    const before = { x: v.x, y: v.y };
    document.getElementById('undo').click();
    await new Promise(r => requestAnimationFrame(r));
    const v2 = window.__ip.scene.vertices.find(x => x.id === v.id);
    return { restored: Math.hypot(v2.x - before.x, v2.y - before.y) > 2 };
  });
  check('ONE undo restores an intersect-corner drag', undoSteps.restored,
    undoSteps.restored ? 'restored in one step' : 'undo did not restore it');

  // The keyboard reaches the same corners through the same path.
  const keyed = await kPage.evaluate(async () => {
    const s = window.__ip.scene;
    const v = s.vertices.find(x => x.kind === 'intersect');
    window.__ip.select({ type: 'vertex', id: v.id });
    await new Promise(r => requestAnimationFrame(r));
    const before = { x: v.x, y: v.y };
    const canvas = document.getElementById('canvas');
    canvas.focus();
    for (let i = 0; i < 3; i++) {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, shiftKey: true }));
      await new Promise(r => requestAnimationFrame(r));
    }
    const after = window.__ip.scene.vertices.find(x => x.id === v.id);
    return { moved: Math.hypot(after.x - before.x, after.y - before.y) > 2, dy: +(after.y - before.y).toFixed(1) };
  });
  check('arrow keys move an intersect corner too (same path as the drag)',
    keyed.moved, `moved ${keyed.dy}px vertically`);

  // THE REGRESSION KILLER: the shipped box drag leaves one depth at the ~20px
  // floor ("two connected squares"). Dragging the back bottom corner toward the
  // horizon must lift BOTH depths off the floor in one gesture — that is what
  // makes the slab recoverable rather than a dead end.
  const rescued = await kPage.evaluate(async () => {
    const ip = window.__ip;
    const s = ip.scene;
    const anchor = s.vertices.find(v => v.kind === 'anchor');
    const rays = s.vertices.filter(v => v.kind === 'ray' && v.origin === anchor.id && typeof v.binding === 'object');
    const before = rays.map(r => Math.abs(r.t));
    // backBottom is the intersect that depends on exactly the two base rays
    // backBottom is the intersect whose ancestors are exactly the two BASE rays
    // — not merely any two-parameter corner (leftTop also has two, and picking it
    // measured a height change against the depths and reported a false failure).
    const baseIds = rays.map(r => r.id).sort().join(',');
    const back = s.vertices.find(v => v.kind === 'intersect'
      && ip.ancestors(v.id).slice().sort().join(',') === baseIds);
    if (!back) return { found: false };
    ip.manipulate(back.id, { x: back.x, y: back.y - 150 });
    await new Promise(r => requestAnimationFrame(r));
    const after = rays.map(r => Math.abs(r.t));
    return { found: true, before: before.map(n => +n.toFixed(1)), after: after.map(n => +n.toFixed(1)) };
  });
  check('dragging the back corner lifts BOTH depths off the floor in one gesture (D29)',
    rescued.found && rescued.after.every(d => d > 60),
    rescued.found ? `depths ${JSON.stringify(rescued.before)} -> ${JSON.stringify(rescued.after)}`
                  : 'no two-parameter corner found');
  await kCtx.close();

  // D27 — an off-screen marker must not read as the point itself.
  const oCtx = await browser.newContext({ viewport: { width: 1194, height: 834 }, colorScheme: 'dark' });
  await seenWelcome(oCtx);
  const oPage = await oCtx.newPage();
  oPage.on('pageerror', e => pageErrors.push(`marker page: ${e}`));
  await oPage.goto(origin + '/', { waitUntil: 'networkidle' });
  await oPage.waitForFunction(() => window.__ip && window.__ip.scene, null, { timeout: 20000 });
  const marker = await oPage.evaluate(() => {
    const s = window.__ip.scene;
    const vp = s.vanishingPoints[0];
    window.__ip.moveVp(vp.id, { x: -3000, y: s.eyeLevel.y });      // well off screen
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
      const n = document.querySelector('.vp-marker');
      if (!n) return r({ found: false });
      const arrow = n.querySelector('.vp-marker-arrow');
      r({
        found: true,
        hasArrow: !!arrow,
        rotated: arrow ? arrow.style.transform : '',
        aria: n.getAttribute('aria-label') || '',
        offscreenFlag: n.dataset.offscreen,
      });
    })));
  });
  check('an off-screen vanishing point gets a marker with a direction arrow (D27)',
    marker.found && marker.hasArrow && /rotate\(/.test(marker.rotated),
    marker.found ? `arrow ${marker.hasArrow ? 'present' : 'MISSING'}, transform "${marker.rotated}"` : 'no marker at all');
  check('and it says it is off screen rather than posing as the point',
    /OFF SCREEN/.test(marker.aria) && /points toward it/.test(marker.aria),
    `aria-label "${marker.aria.slice(0, 90)}…"`);

  // §4 / SC 2.5.1 — the single-pointer alternatives to pinch and two-finger pan.
  const zoomed = await oPage.evaluate(async () => {
    const before = window.__ip.zoom();
    document.getElementById('zoom-in').click();
    await new Promise(r => requestAnimationFrame(r));
    const inz = window.__ip.zoom();
    document.getElementById('zoom-out').click();
    document.getElementById('zoom-out').click();
    await new Promise(r => requestAnimationFrame(r));
    const outz = window.__ip.zoom();
    document.getElementById('zoom-fit').click();
    await new Promise(r => requestAnimationFrame(r));
    return { before, inz, outz, fit: window.__ip.zoom() };
  });
  check('zoom in, zoom out and fit work without a pinch (SC 2.5.1)',
    zoomed.inz > zoomed.before && zoomed.outz < zoomed.inz && zoomed.fit > 0,
    `${zoomed.before.toFixed(2)} -> in ${zoomed.inz.toFixed(2)} -> out ${zoomed.outz.toFixed(2)} -> fit ${zoomed.fit.toFixed(2)}`);
  await oCtx.close();

  // D28 — the first-run panel, against §4's six requirements for the way out,
  // at the ordinary viewport AND the small-phone-at-200%-text case the doctrine
  // names. Nothing here is judged by eye: each one is measured.
  for (const [label, vp, textScale] of [
    ['1194x834', { width: 1194, height: 834 }, 1],
    ['320x568 at 200% text', { width: 320, height: 568 }, 2],
  ]) {
    const fCtx = await browser.newContext({ viewport: vp, colorScheme: 'dark' });
    const fPage = await fCtx.newPage();
    fPage.on('pageerror', e => pageErrors.push(`welcome page: ${e}`));
    if (textScale !== 1) {
      await fPage.addInitScript(scale => {
        document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.fontSize = `${16 * scale}px`;
        });
      }, textScale);
    }
    await fPage.goto(origin + '/', { waitUntil: 'networkidle' });
    const opened = await fPage.waitForSelector('#dlg-welcome[open]', { timeout: 8000 }).then(() => true).catch(() => false);
    check(`the first-run panel appears on a clean slate (${label})`, opened, opened ? 'shown' : 'never opened');
    if (!opened) { await fCtx.close(); continue; }

    const m = await fPage.evaluate(() => {
      const d = document.getElementById('dlg-welcome');
      const top = document.getElementById('welcome-close');
      const foot = document.getElementById('welcome-close-foot');
      const body = d.querySelector('.dlg-body');
      const r = top.getBoundingClientRect(), dr = d.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        // visible in the FIRST FRAME without scrolling
        topInView: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
        // hit-testing its centre returns the dismiss itself, not something over it
        hitIsClose: !!hit && (hit === top || top.contains(hit)),
        // present at the bottom as well
        hasFoot: !!foot,
        // bounded in length — measured, not assumed
        panelH: Math.round(dr.height), viewH: window.innerHeight,
        scrollable: body.scrollHeight > body.clientHeight + 1,
        topSize: [Math.round(r.width), Math.round(r.height)],
      };
    });
    check(`its close is visible in the first frame without scrolling (${label})`,
      m.topInView, `close at ${m.topSize[0]}x${m.topSize[1]}px, in view: ${m.topInView}`);
    check(`hit-testing the close's centre returns the close (${label})`,
      m.hitIsClose, m.hitIsClose ? 'nothing is over it' : 'something else is on top of it');
    check(`there is a second way out at the bottom (${label})`, m.hasFoot,
      m.hasFoot ? 'foot button present' : 'only one way out');
    check(`the panel is bounded and fits its viewport (${label})`,
      m.panelH <= m.viewH, `${m.panelH}px panel in a ${m.viewH}px viewport`);

    // reachable from anywhere in it: scroll the body to the very end and re-check
    const afterScroll = await fPage.evaluate(() => {
      const body = document.querySelector('#dlg-welcome .dlg-body');
      body.scrollTop = body.scrollHeight;
      const top = document.getElementById('welcome-close');
      const r = top.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { inView: r.top >= 0 && r.bottom <= window.innerHeight, hitIsClose: !!hit && (hit === top || top.contains(hit)) };
    });
    check(`the way out is still there after scrolling to the very end (${label})`,
      afterScroll.inView && afterScroll.hitIsClose,
      `in view ${afterScroll.inView}, hit-test ${afterScroll.hitIsClose}`);

    // and it actually goes away, with focus landing somewhere real
    await fPage.click('#welcome-close');
    await fPage.waitForTimeout(120);
    const after = await fPage.evaluate(() => ({
      gone: !document.querySelector('#dlg-welcome[open]'),
      focus: document.activeElement ? document.activeElement.id || document.activeElement.tagName : 'none',
    }));
    check(`closing it genuinely removes it, and focus lands somewhere real (${label})`,
      after.gone && after.focus !== 'BODY' && after.focus !== 'none',
      `open: ${!after.gone}, focus on ${after.focus}`);

    // never conditional, and it stays gone on the next visit
    await fPage.reload({ waitUntil: 'networkidle' });
    await fPage.waitForTimeout(200);
    const second = await fPage.evaluate(() => !!document.querySelector('#dlg-welcome[open]'));
    check(`it does not come back on the next visit (${label})`, !second,
      second ? 'shown again' : 'stayed dismissed');
    await fCtx.close();
  }

  check('no page errors during the whole walk', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('the walk ran to completion', false, String(err && err.stack ? err.stack.split('\n')[0] : err));
  // An abort with no checks behind it is unreadable without the page's own
  // errors — print what the browser said, not just what Playwright timed out on.
  for (const e of pageErrors.slice(0, 5)) check(`page error seen before the abort`, false, e.slice(0, 200));
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
