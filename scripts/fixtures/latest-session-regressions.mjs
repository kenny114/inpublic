/** Minimal, immutable excerpts from session-2026-08-08T19-08-17-977Z.json. */
export const validLiveTiming = [
  { type: "live", text: "I wanna talk about your line.", lagP50: 388, lagMax: 1393, t: 7404 },
  { type: "live", text: "Airline is a", lagP50: 260, lagMax: 267, t: 11717 },
  { type: "live", text: "airline is an m v chapter four agents.", lagP50: 252, lagMax: 264, t: 19402 },
];

export const resetTimelineTiming = [
  { type: "live", text: "My name is Kenneth. I am from", lagP50: 202607, lagMax: 202621, t: 207547 },
  { type: "live", text: "my name is Kenny Fama.", lagP50: 202708, lagMax: 202708, t: 210558 },
];

export const destructiveCorrections = [
  { from: "ran", to: "rain", confidence: 1, why: "canvas-term" },
  { from: "run", to: "rain", confidence: 1, why: "canvas-term" },
];

export const fragmentedMovement = ["The cat rain towards", "the car."];

export const firstTwoMinutePages = [
  { index: 1, t: 27201 }, { index: 2, t: 43035 }, { index: 3, t: 53875 },
  { index: 4, t: 63806 }, { index: 5, t: 81680 }, { index: 6, t: 100585 },
  { index: 7, t: 114195 },
];

/** Historical failure shape: the command's live line sat above the real action. */
export const scratchSelfUndoHistory = ["create_concept", "live_line"];

