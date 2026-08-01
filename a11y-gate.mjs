// a11y-gate.mjs — the accessibility gate Doctrine §4 requires.
//
// This EXITS NON-ZERO on any failure. That is the whole point: a checker that
// prints "FAIL" and exits 0 is a reporter, and §4 claimed a gate for months
// while only a reporter existed.
//
// It runs every deployed page in BOTH themes, computes contrast rather than
// eyeballing it, and FAILS LOUDLY when a registered selector goes missing —
// because silently skipping a renamed class removes coverage with no signal.
//
//   node a11y-gate.mjs            check everything, exit non-zero on failure
//   node a11y-gate.mjs --verbose  also print every passing measurement
//
// Adding a new foreground/background pair? Add it to REGISTRY below in the SAME
// commit that introduces it (§4).

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

// The session sandbox ships a Chromium at a fixed path (Doctrine §11) and
// playwright-core is pinned to the matching revision — see package.json.
// A CI runner has no such path, so fall back to playwright's own download
// there. Explicit rather than clever: if the sandbox binary is absent we say so
// and let playwright resolve it, instead of failing with a confusing ENOENT.
const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOpts = { args: ['--no-sandbox'] };
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

const VERBOSE = process.argv.includes('--verbose');
const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

// The app is ES modules, which a file:// origin cannot import at all, so the
// gate SERVES public/ over http and scans what a browser would really load.
// Same bytes as the deploy: this reads the directory wrangler uploads.
const ROOT = 'public';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};
function serveRoot() {
  const server = createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const path = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    try {
      if (!statSync(path).isFile()) throw new Error('not a file');
    } catch {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Every deployed page, and every STATE of it a reader can reach. A dialog that
// is closed at load is invisible to axe and to any page-load scan — scanning
// only the default state would report the app clean while three of its four
// surfaces went unchecked. Each state names the control that opens it.
const PAGES = [
  {
    url: '/',
    registry: ['h1.title', '.build', '.btn', '.hint', '.vp-name', '.coord label', '.panel-head h2'],
    states: [
      // D28 — the first-run panel is a surface like any other, and it is the FIRST
      // thing anyone sees, so it is audited in the commit that introduces it. It
      // opens by itself, which is why it has no `open` selector and instead asks
      // for a clean slate.
      { name: 'welcome', open: null, firstRun: true,
        registry: ['.dlg-head h2', '.dlg-body', '.dlg-body li', '.dlg-body .hint'] },
      { name: 'canvas', open: null },
      // D47 — the Setup panel is a surface in its own right: nine controls that
      // used to be on the toolbar and were measured there. Opened here so they
      // keep their 44px and their contrast rather than quietly leaving coverage
      // when they moved.
      { name: 'setup', open: '#show-setup', opened: '#setup[data-on="true"]', registry: ['.panel-head h2', '.panel-sec', '.btn'] },
      { name: 'export', open: '#open-export', registry: ['.dlg-head h2', '.dlg-body', '.dlg-body label', '.hint'] },
      // Not '.empty' here: whether the saved-projects list is empty depends on
      // whether autosave has fired yet, and a registry entry that matches only
      // sometimes is a flaky gate. Its pair (--muted on --surface) is the same
      // one '.hint' registers, so the colours are covered without the flake.
      { name: 'project', open: '#open-project', registry: ['.dlg-head h2', '.dlg-body label', '.dlg-body h3'] },
      { name: 'about', open: '#open-about', registry: ['.dlg-head h2', '.dlg-body', '.dlg-body a', '.dlg-body li'] },
    ],
  },
];

const THEMES = ['light', 'dark'];

// Small-phone-at-200%-text is the case that broke a sibling app's place card
// (§4). 320px wide is the narrowest phone worth supporting.
const VIEWPORTS = [
  { name: 'phone',      width: 390, height: 844 },
  { name: 'phone-320',  width: 320, height: 568 },
];

const MIN_TARGET = 44; // §4: targets >= 44px

const failures = [];
const notes = [];
const exemptions = new Set();
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

const server = await serveRoot();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(launchOpts);

try {
  for (const pageDef of PAGES) {
    for (const state of pageDef.states) {
    for (const theme of THEMES) {
      const page = await browser.newPage({
        viewport: VIEWPORTS[0],
        deviceScaleFactor: 2,
        colorScheme: theme,
      });
      const registry = [...pageDef.registry, ...(state.registry ?? [])];
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      const where = `${pageDef.url} (${state.name}) [${theme}]`;

      // Every state except the first-run one starts from a slate where the
      // welcome has already been dismissed — otherwise it sits over the surface
      // being measured and every click retries into it. Seeded BEFORE the first
      // navigation, because the panel opens during boot.
      if (!state.firstRun) {
        await page.addInitScript(() => {
          try { localStorage.setItem('ip-welcome-seen', '1'); } catch { /* ignore */ }
        });
      }
      await page.goto(origin + pageDef.url, { waitUntil: 'networkidle' });
      // The app boots asynchronously (it reads IndexedDB first), so wait for
      // the surface to actually exist before measuring anything about it.
      // 30s, not 10. The gate still REQUIRES the app to boot — nothing is
      // skipped and nothing is measured against a dead page. The budget was
      // simply too tight for a loaded machine, and reported flakes that a rerun
      // cleared, which teaches everyone to rerun a red gate. A gate that cries
      // wolf is worse than a slow one.
      await page.waitForFunction(() => document.querySelectorAll('.vp-row').length > 0, null, { timeout: 30000 })
        .catch(() => fail(where, 'the app did not finish booting within 30s — nothing below was measured against a working page'));
      if (state.firstRun) {
        await page.waitForFunction(() => !!document.querySelector('#dlg-welcome[open]'), null, { timeout: 5000 })
          .catch(() => fail(where, 'the first-run panel did not open on a clean slate'));
      }
      if (state.open) {
        await page.click(state.open);
        // D47 — a surface is not always a dialog. The Setup panel is a docked
        // panel, so what is waited for is "something opened", named by the
        // surface itself, rather than assuming every one of them is modal.
        const openedSelector = state.opened ?? 'dialog[open]';
        await page.waitForFunction(sel => !!document.querySelector(sel), openedSelector, { timeout: 5000 })
          .catch(() => fail(where, `clicking ${state.open} opened no ${openedSelector}`));
      }
      await page.addScriptTag({ content: axeSrc });

      // ---- axe ------------------------------------------------------------
      const axeResult = await page.evaluate(async () =>
        await axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] },
        })
      );
      for (const v of axeResult.violations) {
        fail(where, `axe [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node${v.nodes.length===1?'':'s'})`);
        for (const n of v.nodes.slice(0, 4)) notes.push(`      ${n.target.join(' ')}`);
      }
      // axe drops colour-contrast to `incomplete` for transformed elements
      // rather than failing it — a known instrument limitation (LESSONS §5).
      // That is exactly why the REGISTRY below is computed by hand.
      if (VERBOSE) console.log(`  ${where} axe: ${axeResult.violations.length} violations, ${axeResult.passes.length} passes, incomplete: ${axeResult.incomplete.map(i=>i.id).join(', ')||'none'}`);

      // ---- computed contrast over the registry ----------------------------
      const contrast = await page.evaluate((sels) => {
        const lum = c => {
          const [r,g,b] = c.map(v => { v /= 255; return v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055) ** 2.4; });
          return 0.2126*r + 0.7152*g + 0.0722*b;
        };
        const ratio = (fg, bg) => {
          const L1 = lum(fg), L2 = lum(bg);
          return (Math.max(L1,L2) + 0.05) / (Math.min(L1,L2) + 0.05);
        };
        // Treat anything with alpha < 1 as NOT opaque and keep walking up —
        // measuring against a translucent layer gives a number that is wrong in
        // a direction nobody notices.
        const parse = s => {
          const m = s.match(/[\d.]+/g);
          if (!m) return null;
          const n = m.map(Number);
          return { rgb: n.slice(0,3), a: n.length > 3 ? n[3] : 1 };
        };
        // The page background is a GRADIENT, so there is no single colour to
        // measure against. Rather than guess, collect every candidate colour the
        // text could sit on — opaque background-colors plus every colour stop of
        // any background-image gradient — and let the caller take the WORST
        // case. Conservative by construction: if the worst stop passes, every
        // point of the gradient passes.
        const bgCandidates = el => {
          const out = [];
          let e = el;
          while (e) {
            const cs = getComputedStyle(e);
            const img = cs.backgroundImage;
            if (img && img !== 'none') {
              for (const m of img.matchAll(/rgba?\(([\d.,\s]+)\)/g)) {
                const p = parse(m[0]);
                if (p && p.a > 0.95) out.push(p.rgb);
              }
            }
            const p = parse(cs.backgroundColor);
            if (p && p.a === 1) { out.push(p.rgb); break; } // opaque layer blocks anything behind
            e = e.parentElement;
          }
          return out;
        };
        const out = {};
        for (const s of sels) {
          const el = document.querySelector(s);
          if (!el) { out[s] = { missing: true }; continue; }
          const cs = getComputedStyle(el);
          const cands = bgCandidates(el);
          const fg = parse(cs.color);
          if (!cands.length || !fg) { out[s] = { undetermined: true }; continue; }
          const px = parseFloat(cs.fontSize);
          const weight = parseInt(cs.fontWeight, 10) || 400;
          // WCAG AA: 3:1 for large text (>=24px, or >=18.66px bold), else 4.5:1
          const isLarge = px >= 24 || (px >= 18.66 && weight >= 700);
          const ratios = cands.map(bg => ratio(fg.rgb, bg));
          out[s] = {
            ratio: +Math.min(...ratios).toFixed(2), // worst point of the gradient
            against: cands.length,
            required: isLarge ? 3 : 4.5,
            size: cs.fontSize, weight, isLarge,
          };
        }
        return out;
      }, registry);

      for (const [sel, r] of Object.entries(contrast)) {
        if (r.missing) {
          // §4: a registered pair that stops matching must FAIL, not be skipped.
          fail(where, `registry selector "${sel}" matched nothing — either restore it or remove it from REGISTRY in a11y-gate.mjs`);
        } else if (r.undetermined) {
          fail(where, `could not determine an opaque background for "${sel}" — refusing to guess`);
        } else if (r.ratio < r.required) {
          fail(where, `contrast ${sel} ${r.ratio}:1 (needs ${r.required}:1 at ${r.size}/${r.weight})`);
        } else if (VERBOSE) {
          console.log(`  ${where} ${sel.padEnd(16)} ${String(r.ratio).padStart(6)}:1  needs ${r.required}  PASS`);
        }
      }

      // ---- structural checks ---------------------------------------------
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const custom = await page.evaluate((minTarget) => {
          const inter = [...document.querySelectorAll('a[href],button,[role="button"]')];
          const visible = el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          // WCAG 2.2 SC 2.5.8 "Inline" exception: a target inside a sentence,
          // whose size is constrained by the line-height of the surrounding
          // text, is exempt. Forcing 44px on a link mid-paragraph breaks the
          // text flow and makes the page WORSE. Exemptions are REPORTED, never
          // silent — see the summary at the end of a run.
          // Must be text IMMEDIATELY adjacent — on the same line. A link that
          // merely shares a parent with text elsewhere (e.g. sitting alone
          // before a <br>) is standalone and gets no exemption: nothing
          // constrains its height, so it can and should be 44px.
          const isInlineInText = el => {
            if (getComputedStyle(el).display !== 'inline') return false;
            // Walk one direction past whitespace-only text nodes. Stop at the
            // first thing that matters: real text means same sentence; a <br>
            // or any element means a new line, so no exemption.
            const hasAdjacentText = (node, dir) => {
              while (node) {
                if (node.nodeType === 3) {
                  if (node.textContent.trim()) return true;        // real text beside it
                } else {
                  return false;                                     // <br> or any element
                }
                node = dir === 'prev' ? node.previousSibling : node.nextSibling;
              }
              return false;
            };
            return hasAdjacentText(el.previousSibling, 'prev')
                || hasAdjacentText(el.nextSibling, 'next');
          };
          const measured = inter.filter(visible).map(el => {
            const r = el.getBoundingClientRect();
            return {
              el,
              t: el.textContent.trim().slice(0,32),
              w: +r.width.toFixed(1), h: +r.height.toFixed(1),
              tooSmall: r.width < minTarget || r.height < minTarget,
              inline: isInlineInText(el),
            };
          });
          const small   = measured.filter(m => m.tooSmall && !m.inline).map(({el,...m}) => m);
          const exempt  = measured.filter(m => m.tooSmall &&  m.inline).map(({el,...m}) => m);
          // An <img> is a fault only when it has NO alt attribute at all.
          // alt="" with aria-hidden="true" is the CORRECT pattern for a
          // decorative image — counting it as a failure trains people to
          // ignore the checker.
          const imgsNoAlt = [...document.querySelectorAll('img')]
            .filter(i => !i.hasAttribute('alt'))
            .map(i => i.getAttribute('src') || '(no src)');
          const linksNoName = inter
            .filter(el => !el.textContent.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title'))
            .map(el => el.outerHTML.slice(0, 60));

          // D56 — two controls on one surface must not answer to the SAME NAME.
          //
          // Noah, 2026-08-01: "Person, 'place,' or thing…. Label is confusing."
          // The Human-scale button read "Place" and so did the toolbar mode for
          // putting vanishing points down. Two controls, one word, two meanings —
          // and for anyone driving this by voice or by a list of controls,
          // "Place" was simply ambiguous. Nothing in the app noticed.
          //
          // The rule is the accessible NAME, not the visible text, which is why
          // the two Hide buttons and the per-point Lock/Delete rows are fine:
          // they show the same word and answer to different names.
          const nameOf = el =>
            (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
          const byName = new Map();
          for (const el of inter.filter(visible)) {
            const n = nameOf(el).toLowerCase();
            if (!n) continue;
            byName.set(n, (byName.get(n) || []).concat(el.id || el.tagName.toLowerCase()));
          }
          const dupeNames = [...byName.entries()]
            .filter(([, who]) => who.length > 1)
            .map(([n, who]) => `"${n}" on ${who.join(' and ')}`);

          // WCAG 2.2 SC 2.5.3 Label in Name: when a control shows words AND
          // carries an aria-label, the visible words must appear in that label —
          // otherwise saying what is written on the button does not activate it.
          // Added in the same commit as the aria-label that made it relevant.
          // What a READER sees is not el.textContent: anything marked
          // aria-hidden is decoration and is not part of the label, and a
          // control labelled only by a symbol has no text for the criterion to
          // be about. Both exclusions are in the criterion itself, and without
          // them this check reports the arrow on an off-screen marker and the
          // minus sign on Zoom out, neither of which anyone would ever say.
          const shownText = el => {
            const c = el.cloneNode(true);
            for (const h of c.querySelectorAll('[aria-hidden="true"]')) h.remove();
            return (c.textContent || '').replace(/\s+/g, ' ').trim();
          };
          const labelInName = inter.filter(visible).filter(el => {
            const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const seen = shownText(el).toLowerCase();
            if (!aria || !seen) return false;
            if (!/[a-z0-9]/.test(seen)) return false;      // a symbol is not text
            return !aria.includes(seen);
          }).map(el => `${el.id || el.tagName.toLowerCase()}: shows "${shownText(el)}", named "${el.getAttribute('aria-label')}"`);

          return {
            smallTargets: small,
            inlineExempt: exempt,
            imgsNoAlt,
            linksNoName,
            dupeNames,
            labelInName,
            lang: document.documentElement.lang,
            h1: document.querySelectorAll('h1').length,
          };
        }, MIN_TARGET);

        const at = `${where} @${vp.name}`;
        for (const t of custom.smallTargets) {
          fail(at, `touch target "${t.t}" is ${t.w}x${t.h}px — §4 requires >= ${MIN_TARGET}px`);
        }
        for (const t of custom.inlineExempt) {
          exemptions.add(`${t.t} (${t.w}x${t.h}px, inline in a sentence — WCAG 2.2 SC 2.5.8)`);
        }
        for (const s of custom.imgsNoAlt) fail(at, `<img> has no alt attribute: ${s}`);
        for (const l of custom.linksNoName) fail(at, `interactive element has no accessible name: ${l}`);
        for (const d of custom.dupeNames) fail(at, `two controls answer to the same name — ${d} (D56)`);
        for (const l of custom.labelInName) fail(at, `SC 2.5.3 Label in Name — ${l}`);
        if (!custom.lang) fail(at, 'document has no lang attribute');
        if (custom.h1 !== 1) fail(at, `expected exactly one <h1>, found ${custom.h1}`);
        if (VERBOSE) console.log(`  ${at} targets ok, lang="${custom.lang}", h1=${custom.h1}`);
      }

      if (pageErrors.length) fail(where, `page errors: ${pageErrors.join(' | ')}`);
      await page.close();
    }
    }
  }
} finally {
  await browser.close();
  server.close();
}

const STATE_COUNT = PAGES.reduce((n, p) => n + p.states.length, 0);
console.log('=== a11y gate ===');
console.log(`surfaces: ${STATE_COUNT} x themes: ${THEMES.length} x viewports: ${VIEWPORTS.length}`);
if (exemptions.size) {
  console.log(`\nEXEMPTED (${exemptions.size}) — reported, never silent:`);
  for (const e of exemptions) console.log('  · ' + e);
  console.log('  §4 states ">= 44px" flatly; WCAG 2.2 SC 2.5.8 exempts inline targets.');
  console.log('  Noah rules on whether §4 should carry that exception explicitly.');
}
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log('  ✗ ' + f);
  if (notes.length) { console.log('\n  detail:'); for (const n of notes) console.log(n); }
  console.log('\nDoctrine §4: accessibility is a hard gate. This exits non-zero.');
  process.exit(1);
}
console.log('PASS — no violations, all registered contrast pairs meet AA, all non-inline targets >= 44px.');
