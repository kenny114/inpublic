import {
  CAMERA_RULES,
  READABILITY_CONTRACT,
  effectiveTextSize,
  initialCompositionState,
  proposeCamera,
  recordingViewport,
  rectsOverlap,
  stepCameraSpring,
  worldToScreen,
} from "../lib/composition.ts";
import { PAGE_PAD, PAGE_W } from "../lib/ops.ts";

let pass = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`   ${condition ? "✓" : "✗"} ${name}${condition || !detail ? "" : ` — ${detail}`}`);
};

const viewport = recordingViewport(1528, 698);
const baseInput = {
  viewport,
  focalSubject: "primary",
  activeCluster: "page:0",
  reason: "important content left the safe frame",
  now: 10_000,
};

let springCamera = { scrollX: 0, scrollY: 0, zoom: 1 };
let springVelocity = { scrollX: 0, scrollY: 0, zoom: 0 };
const springTarget = { scrollX: 300, scrollY: -180, zoom: 0.82 };
for (let frame = 0; frame < 90; frame += 1) {
  const next = stepCameraSpring(springCamera, springTarget, springVelocity, 1000 / 60);
  springCamera = next.camera;
  springVelocity = next.velocity;
}
check("damped camera converges without an easing timer",
  Math.abs(springCamera.scrollX - springTarget.scrollX) < 0.1
    && Math.abs(springCamera.scrollY - springTarget.scrollY) < 0.1
    && Math.abs(springCamera.zoom - springTarget.zoom) < 0.001);

const beforeRetarget = springCamera;
const retargeted = stepCameraSpring(beforeRetarget, { scrollX: -120, scrollY: 40, zoom: 1.04 }, springVelocity, 1000 / 60);
check("retargeting preserves position continuity",
  Math.abs(retargeted.camera.scrollX - beforeRetarget.scrollX) < 10
    && Number.isFinite(retargeted.velocity.scrollX));

console.log("VISUAL COMPOSITION — recording-space regressions\n");

const unreadable = proposeCamera({
  ...baseInput,
  state: initialCompositionState(),
  currentCamera: { scrollX: 0, scrollY: 0, zoom: 0.7 },
  focalBounds: { x: 80, y: 120, width: 520, height: 260 },
  text: [{ id: "support", fontSize: 21, role: "supporting" }],
});
check("minimum effective font size is enforced", unreadable.move && unreadable.effectiveTextSize >= READABILITY_CONTRACT.supporting,
  `${unreadable.effectiveTextSize}px`);

const collisionWorld = { x: 1210, y: 45, width: 180, height: 100 };
const collision = proposeCamera({
  ...baseInput,
  state: initialCompositionState(),
  currentCamera: { scrollX: 0, scrollY: 0, zoom: 1 },
  focalBounds: collisionWorld,
});
const collisionScreen = worldToScreen(collisionWorld, collision.target);
check("webcam-safe collision is removed", collision.webcamCollisions === 0 && !rectsOverlap(collisionScreen, viewport.webcamBounds));

const stable = proposeCamera({
  ...baseInput,
  state: initialCompositionState(),
  currentCamera: { scrollX: 80, scrollY: 40, zoom: 1 },
  focalBounds: { x: 100, y: 80, width: 420, height: 260 },
  text: [{ id: "primary", fontSize: 26, role: "primary" }],
});
check("minor addition already in frame does not move camera", !stable.move);

const hysteresis = proposeCamera({
  ...baseInput,
  state: { ...initialCompositionState(), lastMovementAt: 0 },
  currentCamera: { scrollX: -20, scrollY: -20, zoom: 0.96 },
  focalBounds: { x: 80, y: 60, width: 980, height: 563 },
  explicitNavigation: true,
});
check("small zoom difference is held by hysteresis", hysteresis.target.zoom === 0.96,
  `${hysteresis.target.zoom}`);
check("zoom change is bounded", Math.abs(hysteresis.target.zoom - 0.96) <= CAMERA_RULES.maximumZoomChange);

const liveFollow = proposeCamera({
  ...baseInput,
  state: initialCompositionState(),
  currentCamera: { scrollX: 0, scrollY: 0, zoom: 1 },
  focalBounds: { x: 760, y: 420, width: 420, height: 58 },
  followMovingSubject: true,
  reason: "following live narration",
});
check("live narration recenters even while it already fits", liveFollow.move && liveFollow.reason === "following live narration");

const overviewReveal = proposeCamera({
  ...baseInput,
  state: liveFollow.state,
  currentCamera: { ...liveFollow.target, zoom: 1.08 },
  focalBounds: { x: 40, y: 40, width: 1800, height: 900 },
  explicitNavigation: true,
  maximumZoomChange: 1,
  reason: "overview after live narration",
});
check("overview may widen enough to reveal the full composition", overviewReveal.move && overviewReveal.contentFits &&
  1.08 - overviewReveal.target.zoom > CAMERA_RULES.maximumZoomChange, `${overviewReveal.target.zoom}`);

// Regression: a live session logged contentFits:false held at zoom≈0.92,
// scrollX≈-1116 across many frames, with every proposal reporting "below
// the meaningful-displacement threshold" — the fix that needed a small zoom
// correction was itself smaller than zoomHysteresis, so it got discarded
// every single frame and the camera never converged.
let stuckState = initialCompositionState();
let stuckCamera = { scrollX: -1116, zoom: 0.92 };
let convergedWithinBudget = false;
for (let frame = 0; frame < 10; frame += 1) {
  const proposal = proposeCamera({
    ...baseInput,
    state: stuckState,
    currentCamera: stuckCamera,
    // Slightly too tall for the current zoom to fit — needs a correction
    // smaller than zoomHysteresis (0.07) to resolve, the exact shape of the
    // logged failure.
    focalBounds: { x: 40, y: 40, width: 1000, height: 600 },
    now: baseInput.now + frame * 1000,
  });
  stuckState = proposal.state;
  stuckCamera = proposal.target;
  if (proposal.contentFits) {
    convergedWithinBudget = true;
    break;
  }
}
check("camera converges out of a stuck small-zoom-correction state instead of repeating forever", convergedWithinBudget);

// Regression: real proposeCamera calls against the ACTUAL box geometry
// measured from a real 12-step math replay (audio-replay audit, "Math -
// Long Multiplication.mp4") — 39×8, 56×9, 76×52, 369×43. Feeding the
// whole-page union as focalBounds on every commit (Board.tsx's old
// behaviour) reported contentFits:false on 9 consecutive commits with the
// target FROZEN at exactly zoom=1.0/scrollX=-15, because 22px primary text
// forces readableZoom=1.0 while the accumulated union needs zoom≈0.93 to
// fit — a real, unresolvable conflict once framed as "make everything
// fit". Framing the ACTIVE step as focalBounds and the page union as
// optional contextBounds (dropped when it would break readability) is the
// fix: the active step must stay visible even though old history doesn't.
const realStepGeometry = [
  { id: "eq1-1", rect: { x: 44, y: 44, width: 160, height: 64 } },
  { id: "eq1-2", rect: { x: 246, y: 44, width: 302, height: 64 } },
  { id: "eq1-3", rect: { x: 590, y: 44, width: 193, height: 64 } },
  { id: "eq2-1", rect: { x: 825, y: 44, width: 169, height: 64 } },
  { id: "eq2-2", rect: { x: 44, y: 154, width: 193, height: 64 } },
  { id: "eq3-1", rect: { x: 279, y: 154, width: 160, height: 64 } },
  { id: "eq3-2", rect: { x: 481, y: 154, width: 290, height: 64 } },
  { id: "eq3-3", rect: { x: 44, y: 264, width: 447, height: 85 } },
  { id: "eq3-4", rect: { x: 533, y: 264, width: 230, height: 64 } },
  { id: "eq4-1", rect: { x: 44, y: 395, width: 193, height: 64 } },
  { id: "eq4-2", rect: { x: 279, y: 395, width: 326, height: 64 } },
  { id: "eq4-3", rect: { x: 44, y: 505, width: 411, height: 85 } },
];

function unionOf(rects) {
  return rects.reduce((acc, r) => acc
    ? {
        x: Math.min(acc.x, r.x),
        y: Math.min(acc.y, r.y),
        width: Math.max(acc.x + acc.width, r.x + r.width) - Math.min(acc.x, r.x),
        height: Math.max(acc.y + acc.height, r.y + r.height) - Math.min(acc.y, r.y),
      }
    : r, null);
}

const mathViewport = recordingViewport(1280, 720);
let mathState = initialCompositionState();
let frozenTargetCount = 0;
let previousTarget = null;
let finalActiveVisible = false;
const seenSoFar = [];
for (let i = 0; i < realStepGeometry.length; i += 1) {
  seenSoFar.push(realStepGeometry[i].rect);
  const proposal = proposeCamera({
    viewport: mathViewport,
    focalSubject: realStepGeometry[i].id,
    activeCluster: "page:0",
    reason: "content entered safe frame",
    state: mathState,
    currentCamera: mathState.camera,
    focalBounds: realStepGeometry[i].rect, // the active MathStep group only
    contextBounds: unionOf(seenSoFar), // the rest of the page, optional
    now: i * 3000,
    text: [{ id: realStepGeometry[i].id, fontSize: 22, role: "primary" }],
  });
  mathState = proposal.state;
  if (previousTarget && proposal.target.zoom === previousTarget.zoom && proposal.target.scrollX === previousTarget.scrollX) {
    frozenTargetCount += 1;
  } else {
    frozenTargetCount = 0;
  }
  previousTarget = proposal.target;
  if (i === realStepGeometry.length - 1) {
    const activeScreen = worldToScreen(realStepGeometry[i].rect, proposal.target);
    const safe = mathViewport.safeBounds;
    finalActiveVisible =
      activeScreen.x >= safe.x - 1 &&
      activeScreen.y >= safe.y - 1 &&
      activeScreen.x + activeScreen.width <= safe.x + safe.width + 1 &&
      activeScreen.y + activeScreen.height <= safe.y + safe.height + 1;
  }
}
check(
  "the final (most recent) math step is fully visible at readable zoom after 12 accumulating commits",
  finalActiveVisible,
);
check(
  "the camera target does not stay bit-for-bit frozen across many consecutive commits the way the reproduced bug did",
  frozenTargetCount < 6,
  `frozen for ${frozenTargetCount} consecutive commits`,
);

console.log(`\n   safe frame: ${JSON.stringify(viewport.safeBounds)}`);
console.log(`   webcam region: ${JSON.stringify(viewport.webcamBounds)}`);
console.log(`\n${"─".repeat(64)}`);
if (failures.length === 0) console.log(`✓ ${pass} visual composition checks passed`);
else {
  console.log(`${pass} passed, ${failures.length} FAILED:`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exitCode = 1;
}
