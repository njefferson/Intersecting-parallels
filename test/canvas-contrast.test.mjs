// canvas-contrast.test.mjs — SC 1.4.11 for the marks drawn INSIDE the canvas.
//
// The a11y gate walks the DOM; a canvas is one opaque element to it, so every
// mark drawn on the drawing surface is invisible to that gate. This does the
// arithmetic instead, so a palette change that dims a control mark fails a
// build rather than reaching an iPad.
//
// It is deliberately narrow: it covers the marks that ARE controls — the
// selection colour, which carries the selected corner, the selected edge, and
// D33's extrude arrow. The grid and other decorative rules are not controls and
// are tracked as an open finding in ACCESSIBILITY.md rather than asserted here,
// because asserting a threshold this file does not yet meet would be a test
// written to pass.

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

for (const theme of ["dark", "light"]) {
  test(`${theme}: the selection mark clears 3:1 on paper (SC 1.4.11)`, () => {
    const c = themeColors(theme);
    const ratio = contrast(c.sel, c.paper);
    assert.ok(ratio >= 3, `selection ${c.sel} on paper ${c.paper} is ${ratio.toFixed(2)}:1`);
  });

  test(`${theme}: committed ink clears 3:1 on paper`, () => {
    const c = themeColors(theme);
    const ratio = contrast(c.ink, c.paper);
    assert.ok(ratio >= 3, `ink ${c.ink} on paper ${c.paper} is ${ratio.toFixed(2)}:1`);
  });

  test(`${theme}: a vanishing point clears 3:1 on paper`, () => {
    const c = themeColors(theme);
    const ratio = contrast(c.vp, c.paper);
    assert.ok(ratio >= 3, `vp ${c.vp} on paper ${c.paper} is ${ratio.toFixed(2)}:1`);
  });

  test(`${theme}: the selection mark is distinguishable from plain ink`, () => {
    // Not a WCAG threshold — a design rule. Selection must not read as ink, or
    // "which corner is selected" stops being answerable. Weight and shape carry
    // it too (the arrow has heads, the selected corner an outer square), so this
    // is a floor on the colour's contribution, not the whole signal.
    const c = themeColors(theme);
    assert.ok(contrast(c.sel, c.ink) >= 1.5, `selection ${c.sel} vs ink ${c.ink}`);
  });
}
