// interactions.mjs — the machine-readable half of INTERACTIONS.md.
//
// Doctrine §4: "Each app declares its drag and gesture interactions alongside the
// non-drag control satisfying each one. A declared interaction with no declared
// alternative FAILS the build, and a declaration that matches nothing FAILS
// rather than being skipped."
//
// `selector` is what must EXIST in the page for the alternative to be real. A
// declaration whose selector matches nothing fails loudly — the same rule the
// contrast registry follows, and for the same reason: a renamed class must not
// quietly drop an accessibility path.

export const INTERACTIONS = [
  {
    id: "drag-vanishing-point",
    kind: "drag",
    what: "Drag a vanishing point on the canvas, or its off-screen marker",
    alternatives: [
      { how: "Arrow keys on the point's panel button (Shift for 20px)", selector: ".vp-row button[id$='-focus']", keyboard: true },
      { how: "Exact x and y number fields", selector: ".vp-row input[type='number']", keyboard: true },
    ],
  },
  {
    id: "drag-corner",
    kind: "drag",
    what: "Drag ANY corner — anchored corners freely, guide-riding corners along their guide, and corners where two guides cross by inverse-solving the distances behind them (D29)",
    alternatives: [
      { how: "Arrow keys once selected — the same manipulate() the drag uses, for every kind of corner", selector: "canvas[tabindex]", keyboard: true },
      { how: "Inspector number fields: x/y for an anchor, distance along the guide for a ray, and for a crossing corner the distances it is built from", selector: "#inspector", keyboard: true },
    ],
  },
  {
    id: "pinch-zoom",
    kind: "gesture",
    what: "Two-finger pinch to zoom the view",
    alternatives: [
      { how: "Zoom out button", selector: "#zoom-out", keyboard: true },
      { how: "Zoom in button", selector: "#zoom-in", keyboard: true },
      { how: "Fit the whole drawing", selector: "#zoom-fit", keyboard: true },
    ],
  },
  {
    id: "two-finger-pan",
    kind: "gesture",
    what: "Two-finger drag to pan the view",
    alternatives: [
      { how: "Fit brings the whole drawing back into view", selector: "#zoom-fit", keyboard: true },
      { how: "Zoom out widens what is visible without panning", selector: "#zoom-out", keyboard: true },
    ],
  },
  {
    id: "draw-stroke",
    kind: "drag",
    what: "Drag on the canvas to draw a line",
    // Was declared `gap: "F-04"` from the day this file existed until 1.4.0.
    // The gate reported it on every run rather than letting it pass quietly,
    // which is why it was still on the list to fix instead of forgotten.
    alternatives: [
      { how: "Add line puts one at the middle of the view, along the guide the toolbar is showing (D34)", selector: "#add-line", keyboard: true },
      { how: "Its far end is selected on arrival, so the arrow keys set the length with no drag", selector: "canvas[tabindex]", keyboard: true },
      { how: "Or type that distance as a number", selector: "#inspector", keyboard: true },
    ],
  },
  {
    id: "draw-box",
    kind: "drag",
    what: "First drag builds the box: height, and depth toward the point you drag toward",
    alternatives: [
      { how: "Add box builds one at the middle of the view with one depth set and the other at its floor — the same state the first drag leaves (D34)", selector: "#add-box", keyboard: true },
      { how: "It goes straight into the second step, so the arrow keys finish it", selector: "canvas[tabindex]", keyboard: true },
      { how: "Or type the remaining depth as a number", selector: "#inspector", keyboard: true },
    ],
  },
  {
    id: "extrude-box",
    kind: "drag",
    what: "The second step (D31): the remaining depth is live under the finger the moment the first drag releases — drag anywhere, no handle to find. A double-headed arrow on the pre-selected corner shows which way it travels (D33)",
    alternatives: [
      { how: "The corner is pre-selected, so the arrow keys set that depth with no drag at all", selector: "canvas[tabindex]", keyboard: true },
      { how: "Its distance is a number field in the Points panel", selector: "#inspector", keyboard: true },
      { how: "Done ends the step and keeps the box; so does Escape or switching tools", selector: "#extrude-done", keyboard: true },
    ],
  },
];
