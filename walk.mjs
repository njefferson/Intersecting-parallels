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
  const midPt = await dPage.evaluate(() => {
    const sc = window.__ip.scene, e = sc.edges[1];
    const a = sc.vertices.find(v => v.id === e.a), b = sc.vertices.find(v => v.id === e.b);
    return window.__ip.toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
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
  check('the drag sets each depth separately, not a square plan (D23)',
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
    return { edges: s.edges.length, points: s.vanishingPoints.length, horizon: Math.round(s.horizon.y) };
  });
  check('two strokes are on the sheet before clearing', drawn.edges === 2,
    `${drawn.edges} lines, ${drawn.points} points`);

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
      points: s.vanishingPoints.length, horizon: Math.round(s.horizon.y),
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
    return { edges: s.edges.length, points: s.vanishingPoints.length, horizon: Math.round(s.horizon.y) };
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
  await cCtx.close();

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
