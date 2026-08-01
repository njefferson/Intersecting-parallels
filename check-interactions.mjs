// check-interactions.mjs — the gate Doctrine §4 asks for and this app did not have.
//
// `npm run interactions`
//
// It fails when:
//   · a declared drag or gesture has no alternative and no registered finding;
//   · an alternative's selector matches nothing in the real page (a renamed class
//     must not silently drop an accessibility path — same rule as the contrast
//     registry);
//   · an alternative claims to be keyboard-reachable and is not focusable;
//   · a declared gap cites a finding that is not in ACCESSIBILITY.md.
//
// Why it exists: without it, "every drag has a non-drag path" is prose, and prose
// loses to whoever is in a hurry. Noah found V1 shipping with a corner that could
// not be dragged AND could not be nudged — two halves of one rule, both missing,
// both invisible to every gate the app had.

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { INTERACTIONS } from "./interactions.mjs";

const TYPES = {
  ".html": "text/html", ".css": "text/css", ".mjs": "text/javascript", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);

const register = readFileSync("ACCESSIBILITY.md", "utf8");

const server = createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const file = join("public", p === "/" ? "index.html" : p);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const origin = `http://127.0.0.1:${server.address().port}`;

const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const launchOpts = { args: ["--no-sandbox"] };
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

const browser = await chromium.launch(launchOpts);
try {
  const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("ip-welcome-seen", "1"); } catch { /* ignore */ } });
  const page = await ctx.newPage();
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".vp-row").length > 0, null, { timeout: 20000 });
  // A corner has to exist for the inspector's controls to be real, so the check
  // builds one rather than trusting that the selector would match if it did.
  await page.evaluate(() => {
    const ip = window.__ip;
    if (!ip) return;
    const s = ip.scene;
    if (!s.vertices.length && ip.select) return;
  });
  await page.click("#mode-box");
  await page.mouse.move(600, 640);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(600 + i * 6, 640 - i * 9);
  await page.mouse.up();
  await page.waitForTimeout(150);
  // Deliberately NOT switching modes here: releasing that box leaves the app in
  // D31's second step, which pre-selects the corner it is about. So the inspector,
  // the focusable canvas and the step's own Done button are all live at once, and
  // the gate measures the alternatives in the state a person is actually in
  // rather than in a state assembled for the gate.
  await page.waitForTimeout(80);

  console.log("=== interaction declarations (Doctrine §4) ===\n");
  for (const it of INTERACTIONS) {
    if (!it.alternatives.length) {
      if (!it.gap) {
        fail(`${it.id}: a declared ${it.kind} with no non-drag alternative and no registered finding`);
        continue;
      }
      if (!register.includes(it.gap)) {
        fail(`${it.id}: declares gap ${it.gap}, which is not in ACCESSIBILITY.md — a gap has to be a finding with a number`);
      } else {
        notes.push(`  GAP  ${it.id} — ${it.what}\n       no alternative yet; registered as ${it.gap}`);
      }
      continue;
    }
    const results = [];
    for (const alt of it.alternatives) {
      // An alternative may live behind a disclosure. That is allowed — SC 2.5.1
      // asks for a single-pointer route to EXIST — but the disclosure is then part
      // of the route, so it has to be reachable by the same means before anything
      // inside it counts. Checked first, and failed loudly if it is not.
      if (alt.behind) {
        const opener = await page.evaluate(sel => {
          const n = document.querySelector(sel);
          if (!n) return { missing: true };
          const ok = n.getClientRects().length > 0
            && n.matches("a[href],button,input,select,textarea,[tabindex]");
          if (ok) n.click();
          return { missing: false, ok };
        }, alt.behind);
        if (opener.missing) {
          fail(`${it.id}: alternative "${alt.how}" says it is behind ${alt.behind}, which matches nothing`);
          continue;
        }
        if (!opener.ok) {
          fail(`${it.id}: alternative "${alt.how}" is behind ${alt.behind}, which is not itself keyboard reachable`);
          continue;
        }
      }
      const found = await page.evaluate(sel => {
        const nodes = [...document.querySelectorAll(sel)];
        const visible = nodes.filter(n => n.getClientRects().length > 0);
        const focusable = visible.filter(n =>
          n.matches("a[href],button,input,select,textarea,[tabindex]") ||
          n.querySelector("a[href],button,input,select,textarea,[tabindex]"));
        return { count: nodes.length, visible: visible.length, focusable: focusable.length };
      }, alt.selector);
      if (found.count === 0) {
        fail(`${it.id}: alternative "${alt.how}" names ${alt.selector}, which matches nothing`);
      } else if (alt.keyboard && found.focusable === 0) {
        fail(`${it.id}: alternative "${alt.how}" (${alt.selector}) is not keyboard reachable`);
      }
      results.push(`${alt.selector} ×${found.count}${alt.behind ? ` behind ${alt.behind}` : ""}`);
    }
    notes.push(`  OK   ${it.id} — ${it.what}\n       ${it.alternatives.length} alternative(s): ${results.join(", ")}`);
  }
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

for (const n of notes) console.log(n);
if (failures.length) {
  console.error(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error("\nDoctrine §4: a declared interaction with no declared alternative FAILS the build.");
  process.exit(1);
}
console.log(`\nPASS — ${INTERACTIONS.length} declared interactions, every alternative present and reachable.`);
