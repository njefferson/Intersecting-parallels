// release.test.mjs — the version has four homes, and nothing was checking that
// they agree.
//
// `VERSION` in ui.mjs is what the app puts on screen and in the diagnostic
// report. The service worker's cache name carries the same triplet, because a
// cache that keeps its name across a release can never be replaced (hub LESSONS
// §21). CHANGELOG.md's newest heading is what the patch-notes surface shows.
// package.json is what the hub's handoff-check reads to decide whether the
// staged-candidate note in NOTES.md is stale.
//
// Keeping those four in step was hand-discipline through nineteen releases —
// written down in CLAUDE.md and remembered every time, which is exactly the kind
// of luck that ends without warning. Doctrine: MAKE IT A GATE, NOT AN INTENTION.
// hub LESSONS §26 is the same lesson from the other side: the gated rules held
// all session and the prose rules all lost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const version = (/const VERSION = "([^"]+)"/.exec(read('public/app/ui.mjs')) ?? [])[1];

test('ui.mjs declares a version at all', () => {
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/, 'VERSION must be a version.capability.iteration triplet');
});

test('the service worker cache name carries the same triplet', () => {
  const cache = (/const CACHE = "intersecting-parallels-([^"]+)"/.exec(read('public/sw.js')) ?? [])[1];
  assert.equal(cache, version,
    'a release that reuses its cache name serves the previous build forever (hub LESSONS §21)');
});

test('package.json names the same version', () => {
  const pkg = JSON.parse(read('package.json')).version;
  assert.equal(pkg, version,
    'the hub handoff-check reads package.json to decide whether the staged-candidate note is stale');
});

test('the newest CHANGELOG heading is this version', () => {
  const first = (/^## (\d+\.\d+\.\d+)/m.exec(read('CHANGELOG.md')) ?? [])[1];
  assert.equal(first, version,
    'the patch-notes surface would open on a release that is not the one running');
});

// hub LESSONS §26: a staged build recorded nowhere is invisible the moment the
// session ends, and the owner is left to guess which build the preview is.
test('NOTES.md names the staged version beside the preview URL', () => {
  const notes = read('NOTES.md');
  const m = /https?:\/\/[\w.-]*intersecting-parallels\.pages\.dev/.exec(notes);
  assert.ok(m, 'NOTES.md must carry the preview URL (Doctrine §7)');
  const block = notes.slice(Math.max(0, m.index - 400), m.index + 400);
  assert.ok(block.includes(version),
    `the staged-candidate block names a different build than ${version} — it cannot be acted on`);
});
