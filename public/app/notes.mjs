// GENERATED from CHANGELOG.md by notes-build.mjs — do not edit by hand.
// §7d: one source, so the notes on screen cannot drift from the release.
export const RELEASES = [
  {
    "version": "1.19.0",
    "kind": "CAPABILITY",
    "date": "2026-08-03",
    "head": "The app tells you what changed, and what is still broken.",
    "points": [
      "Tap the version number in the corner. You get the last six releases in",
      "The notes come from the same file the release itself is written in, so what you"
    ]
  },
  {
    "version": "1.18.3",
    "kind": "ITERATION",
    "date": "2026-08-02",
    "head": "The accessibility gate now checks every control, not most of them.",
    "points": [
      "It had never measured a single drop-down or number field — ten controls it had",
      "Those are fixed the honest way: the label beside a checkbox toggles it, so the"
    ]
  },
  {
    "version": "1.18.2",
    "kind": "ITERATION",
    "date": "2026-08-02",
    "head": "Choose image is where you'd look for it, and it works from the keyboard.",
    "points": [
      "Reference image is now the first thing in Setup instead of the sixth. It is",
      "Choose image is a real button. It looked like one and behaved like one under"
    ]
  },
  {
    "version": "1.18.1",
    "kind": "ITERATION",
    "date": "2026-08-02",
    "head": "Line the reference image up with the paper.",
    "points": [
      "Bigger, Smaller and four arrows place the image; Refit puts it back",
      "Growing it holds its middle, so whatever you were looking at stays under your",
      "Every step is a button rather than a pinch, and the buttons are the only route,"
    ]
  },
  {
    "version": "1.18.0",
    "kind": "CAPABILITY",
    "date": "2026-08-02",
    "head": "Draw over a photograph.",
    "points": [
      "Setup, under Reference image: Choose image, pick a photo, and it sits",
      "It pans and zooms with the drawing, not with the screen — an image you",
      "Together with Point from two lines, this is the whole technique for reading a",
      "The photo never leaves your device. It is kept in this browser's own"
    ]
  },
  {
    "version": "1.17.1",
    "kind": "ITERATION",
    "date": "2026-08-02",
    "head": "Nearly-parallel lines get an answer instead of a refusal.",
    "points": [
      "Two lines within a degree of parallel cross about 36,000px away — a real point,",
      "Tilt a line past parallel and the point simply comes back from the other side.",
      "Exactly parallel gets a point too, stood off far enough that lines drawn to"
    ]
  }
];
export const STILL_OPEN = [
  "The snap radius is a fixed number rather than something you can tune to your",
  "Target *spacing* is not checked by the accessibility gate — only target size is.",
  "The reference image has never been tested against a real photograph, only a",
  "There is no (i) surface yet, and no diagnostic report to send instead of a"
];
