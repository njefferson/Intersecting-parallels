// canvas-contrast.test.mjs — SC 1.4.11 for the marks drawn INSIDE the canvas.
//
// The a11y gate walks the DOM; a canvas is one opaque element to it, so every
// mark drawn on the drawing surface is invisible to that gate. This does the
// arithmetic instead, so a palette change that dims a control mark fails a
// build rather than reaching an iPad.
//
// EVERY mark is covered. There was a version of this file that exempted the
// grid because it measured 1.38:1 and was "decorative". THE RULING, 2026-07-30:
// no colour in this app is protected from the gate, and that is right. A drawing app's
// grid is not decoration — it is how you read scale and position off the paper.
// Exempting the one thing that failed is how a gate becomes a formality.

import test from "node:test";
import assert from "node:assert/strict";
import { themeColors } from "../public/app/render.mjs";

function channel(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("the contrast arithmetic itself is right", () => {
  assert.equal(Math.round(contrast("#FFFFFF", "#000000")), 21);
  assert.equal(contrast("#123456", "#123456"), 1);
});

// The palette splits in two, and the split is about DRAW ORDER, not importance.
//
// MARKS are lines and dots. They must clear 3:1 against whatever is behind them.
// SURFACES are fills that other things get drawn ON TOP OF; holding a surface to
// 3:1 against paper would be meaningless — what matters is that everything drawn
// over it stays legible.
//
// Both lists are spelled out rather than derived from Object.keys, so adding a
// colour without deciding which kind it is fails the build instead of passing
// quietly. The completeness test below is what enforces that.
const MARKS = ["ink", "guide", "grid", "vp", "vpLocked", "bad", "sel", "ghost"];
const SURFACES = ["faceTop", "faceRight", "faceLeft", "faceBottom", "faceBack"];

// The grid is drawn UNDER the face fills (draw order: paper, grid, fills, then
// every line), so it is the one mark that never lands on a surface and is not
// held to 3:1 against one. Everything else can.
const MARKS_OVER_SURFACES = MARKS.filter(m => m !== "grid");

for (const theme of ["dark", "light"]) {
  test(`${theme}: the palette has exactly the entries this file checks`, () => {
    const c = themeColors(theme);
    const found = Object.keys(c).filter(k => k !== "paper").sort();
    assert.deepEqual(found, [...MARKS, ...SURFACES].sort(),
      "a palette entry was added or renamed without a contrast decision");
  });

  for (const surface of SURFACES) {
    test(`${theme}: every mark drawn on ${surface} clears 3:1 (SC 1.4.11)`, () => {
      const c = themeColors(theme);
      for (const mark of MARKS_OVER_SURFACES) {
        const ratio = contrast(c[mark], c[surface]);
        assert.ok(ratio >= 3, `${mark} ${c[mark]} on ${surface} ${c[surface]} is ${ratio.toFixed(2)}:1`);
      }
    });
  }

  test(`${theme}: the face shading is actually distinguishable`, () => {
    // Shading that all reads the same is decoration pretending to be
    // information. Each step in the ramp has to be visible, and each face has to
    // be visible against bare paper, or "solid" has not been delivered.
    const c = themeColors(theme);
    // The back wall is its own surface, not a step in the lit ramp — it is the
    // one you look AT rather than along, so it is checked against paper only.
    const ramp = ["faceTop", "faceRight", "faceLeft", "faceBottom"].map(k => c[k]);
    for (let i = 0; i < ramp.length - 1; i++) {
      const step = contrast(ramp[i], ramp[i + 1]);
      assert.ok(step >= 1.1, `ramp step ${i} is only ${step.toFixed(2)}:1`);
    }
    for (const k of SURFACES) {
      assert.ok(contrast(c[k], c.paper) >= 1.05, `${k} is indistinguishable from paper`);
    }
  });

  for (const mark of MARKS) {
    test(`${theme}: ${mark} clears 3:1 on paper (SC 1.4.11)`, () => {
      const c = themeColors(theme);
      const ratio = contrast(c[mark], c.paper);
      assert.ok(ratio >= 3, `${mark} ${c[mark]} on paper ${c.paper} is ${ratio.toFixed(2)}:1`);
    });
  }

  test(`${theme}: the drawing still reads as a hierarchy`, () => {
    // Not WCAG — a design floor, and the reason raising the grid needed checking
    // rather than just doing. Grid is the quietest thing on the paper, guides sit
    // above it, committed ink is loudest. Weight and dash carry this too (grid
    // 1px solid, guides 1px finely dashed, ink 2px solid), but if the ordering
    // inverted, colour would be actively fighting the shape language.
    const c = themeColors(theme);
    const grid = contrast(c.grid, c.paper);
    const guide = contrast(c.guide, c.paper);
    const ink = contrast(c.ink, c.paper);
    assert.ok(grid < guide, `grid ${grid.toFixed(2)}:1 must stay quieter than guides ${guide.toFixed(2)}:1`);
    assert.ok(guide < ink, `guides ${guide.toFixed(2)}:1 must stay quieter than ink ${ink.toFixed(2)}:1`);
  });

  test(`${theme}: the selection mark is distinguishable from plain ink`, () => {
    // Selection must not read as ink, or "which corner is selected" stops being
    // answerable. Weight and shape carry it too (the arrow has heads, the
    // selected corner an outer square), so this is a floor on the colour's
    // contribution, not the whole signal.
    const c = themeColors(theme);
    assert.ok(contrast(c.sel, c.ink) >= 1.5, `selection ${c.sel} vs ink ${c.ink}`);
  });
}
