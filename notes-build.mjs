// §7d — patch notes IN THE APP, generated from ONE SOURCE.
//
// The doctrine's trap is notes maintained separately from the release: they drift
// and the drift is invisible. So nothing is typed twice. CHANGELOG.md is the
// source and this derives `public/app/notes.mjs` from it; `npm run notes:check`
// fails if the committed file has fallen behind, which is what makes "one source"
// enforceable rather than a promise.
//
// Two things it reads:
//   · the last N releases, BOUNDED — a list that grows by accumulation becomes
//     the app, and an archive belongs in the repo.
//   · "Still open", which is §7d's requirement to say what is STILL BROKEN. An
//     app that lists only its fixes is an advertisement.
import { readFileSync, writeFileSync } from 'node:fs';

const KEEP = 6;
const src = readFileSync('CHANGELOG.md', 'utf8');

const open = (() => {
  const m = src.match(/^## Still open\n([\s\S]*?)(?=\n## |\n---)/m);
  if (!m) return [];
  return m[1].split('\n').filter(l => l.trim().startsWith('- ')).map(l => l.trim().slice(2).trim());
})();

// SPLIT on headings rather than matching a body with a lookahead. The first
// version used `(?=\n## |\n*$)` with the m flag, and `\n*$` matches at the end of
// EVERY line under /m — so every body captured empty and the app showed six
// releases with no bullets under any of them. A generator that silently produces
// nothing is worse than one that throws.
const releases = [];
for (const block of src.split(/\n## /).slice(1)) {
  const m = block.match(/^(\S+) — (CAPABILITY|ITERATION) · (\S+)\n([\s\S]*)$/);
  if (!m) continue;
  if (releases.length >= KEEP) break;
  const [, version, kind, date, body] = m;
  const head = (body.match(/^\*\*(.+?)\*\*/m) || [, ''])[1];
  const points = body.split('\n')
    .filter(l => l.trim().startsWith('- '))
    .map(l => l.trim().slice(2).replace(/\*\*/g, '').replace(/\*/g, '').trim());
  if (!points.length) {
    console.error(`Release ${version} parsed with no bullets — refusing to write empty notes.`);
    process.exit(1);
  }
  releases.push({ version, kind, date, head, points });
}

const out = `// GENERATED from CHANGELOG.md by notes-build.mjs — do not edit by hand.
// §7d: one source, so the notes on screen cannot drift from the release.
export const RELEASES = ${JSON.stringify(releases, null, 2)};
export const STILL_OPEN = ${JSON.stringify(open, null, 2)};
`;

if (process.argv.includes('--check')) {
  const have = readFileSync('public/app/notes.mjs', 'utf8');
  if (have !== out) {
    console.error('=== patch notes are STALE ===');
    console.error('public/app/notes.mjs does not match CHANGELOG.md. Run: npm run notes');
    console.error('§7d: notes maintained separately from the release drift from it, invisibly.');
    process.exit(1);
  }
  console.log(`PASS — patch notes match CHANGELOG.md (${releases.length} releases, ${open.length} open items).`);
} else {
  writeFileSync('public/app/notes.mjs', out);
  console.log(`Wrote public/app/notes.mjs — ${releases.length} releases, ${open.length} still-open items.`);
}
