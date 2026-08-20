/**
 * Wordless glyphs — the drawn vocabulary the Visual Semantics layer maps
 * meaning onto.
 *
 * lib/icons.ts already holds *object* pictograms (person, server, money): the
 * things a speaker names. This file holds the other half, the part that
 * carries no noun at all — cause, friction, drop-off, growth, entanglement,
 * blockage, opening. Those are what let a sentence like "onboarding is too
 * complicated so users leave" be drawn without lettering a single word of it.
 *
 * Same authoring contract as lib/icons.ts on purpose (`IconArt`: polylines and
 * [cx, cy, rx, ry] ellipses in a 0-100 box), so lib/meaning/sign.ts can render
 * an object pictogram and an abstract glyph through one code path, and both
 * come out of Excalidraw looking hand-drawn rather than placed.
 *
 * Keep them simple. They render at ~46-90px; five confident strokes read, and
 * twenty accurate ones turn to mud at the size a viewer actually sees.
 */

import type { IconArt } from "../icons";

/**
 * Abstract glyphs, keyed by the *meaning* they carry — never by the English
 * word that happened to trigger them. `friction` is the sign for a thing
 * grinding, whether the speaker said "friction", "painful", or "fighting us".
 */
export const GLYPHS: Record<string, IconArt> = {
  /** Cause / reason / source: energy radiating out of an origin point. */
  source: {
    ellipses: [[50, 50, 12, 12]],
    strokes: [
      [[50, 30], [50, 14]],
      [[50, 70], [50, 86]],
      [[30, 50], [14, 50]],
      [[70, 50], [86, 50]],
      [[36, 36], [24, 24]],
      [[64, 64], [76, 76]],
    ],
  },

  /** Friction: two surfaces with a grinding seam between them. */
  friction: {
    ellipses: [],
    strokes: [
      [[10, 22], [90, 22]],
      [[10, 78], [90, 78]],
      [[12, 50], [26, 36], [40, 62], [54, 36], [68, 62], [82, 40], [90, 50]],
    ],
  },

  /** Blockage: a channel stopped by a bar, flow piling up behind it. */
  blockage: {
    ellipses: [],
    strokes: [
      [[6, 26], [46, 26]],
      [[6, 74], [46, 74]],
      [[54, 10], [54, 90]],
      [[20, 50], [44, 50]],
      [[36, 42], [44, 50], [36, 58]],
    ],
  },

  /** Breakage: a solid form fractured through. */
  crack: {
    ellipses: [],
    strokes: [
      [[16, 16], [84, 16], [84, 84], [16, 84], [16, 16]],
      [[44, 16], [56, 38], [40, 54], [58, 84]],
    ],
  },

  /** Confusion / complication: paths that cross and knot instead of resolving. */
  tangle: {
    ellipses: [],
    strokes: [
      [[10, 70], [28, 30], [50, 74], [72, 28], [90, 66]],
      [[10, 34], [34, 72], [56, 26], [78, 70], [90, 36]],
    ],
  },

  /** Uncertainty / haze: form that cannot be resolved into an edge. */
  fog: {
    ellipses: [],
    strokes: [
      [[14, 30], [40, 30]],
      [[52, 30], [84, 30]],
      [[20, 50], [56, 50]],
      [[68, 50], [88, 50]],
      [[12, 70], [36, 70]],
      [[48, 70], [80, 70]],
    ],
  },

  /** Growth / increase: a stepped climb. */
  rise: {
    ellipses: [],
    strokes: [
      [[12, 84], [12, 62], [38, 62], [38, 44], [64, 44], [64, 22], [90, 22]],
      [[78, 30], [90, 20], [88, 34]],
    ],
  },

  /** Decline / decrease: the same climb, inverted. */
  fall: {
    ellipses: [],
    strokes: [
      [[10, 18], [36, 18], [36, 42], [62, 42], [62, 64], [88, 64], [88, 86]],
      [[78, 76], [88, 88], [96, 74]],
    ],
  },

  /** Process / journey / onboarding: a channel that narrows as you pass through. */
  funnel: {
    ellipses: [],
    strokes: [
      [[8, 14], [92, 14]],
      [[8, 14], [40, 56], [40, 88]],
      [[92, 14], [60, 56], [60, 88]],
      [[40, 88], [60, 88]],
    ],
  },

  /** Leaving / churn / drop-off: a threshold with something departing through it. */
  exit: {
    ellipses: [],
    strokes: [
      [[18, 10], [18, 90], [58, 90], [58, 10], [18, 10]],
      [[62, 50], [92, 50]],
      [[82, 40], [92, 50], [82, 60]],
    ],
  },

  /** Opportunity / clarity / opening: a barrier parting to let something through. */
  opening: {
    ellipses: [],
    strokes: [
      [[26, 8], [26, 38]],
      [[26, 62], [26, 92]],
      [[74, 8], [74, 38]],
      [[74, 62], [74, 92]],
      [[36, 50], [88, 50]],
      [[78, 42], [88, 50], [78, 58]],
    ],
  },

  /** Overload / too much: a stack piled past its balance point. */
  overload: {
    ellipses: [],
    strokes: [
      [[18, 88], [78, 88]],
      [[24, 88], [24, 70], [72, 70], [72, 88]],
      [[30, 70], [30, 54], [78, 54], [78, 70]],
      [[38, 54], [40, 36], [86, 40], [84, 56]],
      [[48, 36], [52, 20], [92, 26], [88, 42]],
    ],
  },

  /** Simplicity: one closed, quiet form. Deliberately the least ink here. */
  simple: {
    ellipses: [[50, 50, 28, 28]],
    strokes: [],
  },

  /** Decision / branch: one path becoming two. */
  fork: {
    ellipses: [],
    strokes: [
      [[10, 50], [46, 50]],
      [[46, 50], [86, 22]],
      [[46, 50], [86, 78]],
      [[76, 18], [88, 20], [82, 32]],
      [[82, 66], [88, 80], [76, 82]],
    ],
  },

  /** Fix / repair: the fracture, stitched back across. */
  repair: {
    ellipses: [],
    strokes: [
      [[16, 16], [84, 16], [84, 84], [16, 84], [16, 16]],
      [[46, 16], [54, 44], [46, 84]],
      [[34, 34], [64, 30]],
      [[34, 54], [64, 50]],
      [[36, 72], [62, 68]],
    ],
  },

  /** Repetition / cycle: a closed loop with direction. */
  loop: {
    ellipses: [[50, 50, 30, 30]],
    strokes: [[[62, 18], [80, 24], [74, 42]]],
  },

  /** Goal / opportunity to aim at: concentric focus. */
  target: {
    ellipses: [
      [50, 50, 32, 32],
      [50, 50, 18, 18],
      [50, 50, 5, 5],
    ],
    strokes: [],
  },

  /** Sudden change / realization: a burst. */
  spark: {
    ellipses: [],
    strokes: [
      [[50, 6], [50, 30]],
      [[50, 70], [50, 94]],
      [[6, 50], [30, 50]],
      [[70, 50], [94, 50]],
      [[20, 20], [36, 36]],
      [[80, 20], [64, 36]],
      [[20, 80], [36, 64]],
      [[80, 80], [64, 64]],
    ],
  },

  /** Burden / cost / weight pressing down on something. */
  weight: {
    ellipses: [],
    strokes: [
      [[24, 16], [76, 16], [86, 58], [14, 58], [24, 16]],
      [[20, 74], [80, 74]],
      [[30, 62], [30, 74]],
      [[70, 62], [70, 74]],
    ],
  },

  /** Working flow: a smooth, unobstructed channel. */
  flow: {
    ellipses: [],
    strokes: [
      [[8, 34], [30, 22], [56, 44], [80, 30], [94, 36]],
      [[8, 62], [30, 50], [56, 72], [80, 58], [94, 64]],
    ],
  },

  /** Value / worth reached at the end of something. */
  value: {
    ellipses: [],
    strokes: [
      [[50, 10], [62, 38], [92, 40], [69, 60], [77, 90], [50, 72], [23, 90], [31, 60], [8, 40], [38, 38], [50, 10]],
    ],
  },

  /**
   * The fallback. Not a box and not a label — an unresolved mass, which is an
   * honest picture of "something is here and its shape is not settled yet".
   * Anything the lexicon cannot place lands on this rather than on lettering.
   */
  mass: {
    ellipses: [[50, 50, 30, 22]],
    strokes: [],
  },
};

export const GLYPH_NAMES = Object.keys(GLYPHS);

export function resolveGlyph(name: string): IconArt | null {
  return GLYPHS[name.trim().toLowerCase()] ?? null;
}
