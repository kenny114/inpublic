/**
 * Regression coverage for the native-camera-hold coordination fix.
 *
 * `zoom_to_concept` drives Excalidraw's own `scrollToContent` animation — a
 * second, independent camera writer alongside `animateCamera`'s spring (see
 * components/Board.tsx). Nothing in this repo's existing test suite mounts
 * Board.tsx (no jsdom/testing-library dependency, and Excalidraw itself would
 * need mocking), so this test mirrors the exact control flow added to
 * Board.tsx — the framePage guard clause and the zoom_to_concept hold
 * engage/resync/replay sequence — against a mocked `apiRef` and a manually
 * driven clock, while importing and exercising the one piece of that flow
 * that IS a real, shared, unit-testable function: `nativeCameraHoldIsStale`
 * from lib/composition.ts. Board.tsx uses that same function for its
 * staleness ceiling, so this test is checking real production logic, not a
 * reimplementation of it.
 */
import {
  initialCompositionState,
  initialNativeCameraHoldState,
  nativeCameraHoldIsStale,
  proposeCamera,
  recordingViewport,
  stepCameraSpring,
} from "../lib/composition.ts";

let pass = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`   ${condition ? "✓" : "✗"} ${name}${condition || !detail ? "" : ` — ${detail}`}`);
};

console.log("CAMERA COORDINATION — native scrollToContent vs. spring regressions\n");

// --- nativeCameraHoldIsStale (the real, shared staleness rule) -----------

check(
  "an inactive hold is never stale",
  !nativeCameraHoldIsStale(initialNativeCameraHoldState(), 100_000, 2000),
);
check(
  "an active hold within the ceiling is not stale",
  !nativeCameraHoldIsStale({ active: true, setAt: 1000 }, 1000 + 419, 2000),
);
check(
  "an active hold past the ceiling is stale",
  nativeCameraHoldIsStale({ active: true, setAt: 1000 }, 1000 + 2001, 2000),
);

// --- Mocked Excalidraw + framePage/zoom_to_concept coordination harness --

/**
 * Mirrors the refs and control flow Board.tsx uses:
 *  - apiRef.{getAppState,updateScene,scrollToContent} stand in for Excalidraw.
 *  - cameraMotionActive stands in for `cameraMotionRef.current !== null`.
 *  - nativeHold/resyncTimer stand in for nativeCameraHoldRef/…TimerRef.
 *  - pendingReframe stands in for `pendingReframeRef.current`.
 *  - springStarts records every time the guard would call `animateCamera`.
 */
function makeHarness() {
  const appState = { scrollX: 0, scrollY: 0, zoom: 1 };
  const scrollToContentCalls = [];
  const springStarts = [];
  let cameraMotionActive = false;
  let nativeHold = initialNativeCameraHoldState();
  let resyncTimer = null; // { fireAt, run }
  let pendingReframe = null;
  const CEILING_MS = 2000;

  /** Mirrors framePage's new guard clause, added right before its existing body. */
  function requestFramePage(reason, now) {
    if (nativeCameraHoldIsStale(nativeHold, now, CEILING_MS)) {
      nativeHold = { active: false, setAt: 0 };
      resyncTimer = null;
    }
    if (nativeHold.active) {
      pendingReframe = { reason };
      return "deferred";
    }
    // The guard passed — this is where framePage would go on to call
    // proposeCamera/animateCamera and start (or continue) the spring.
    cameraMotionActive = true;
    springStarts.push({ reason, at: now });
    return "started-spring";
  }

  /** Mirrors zoom_to_concept's action handler. */
  function requestZoomToConcept(el, now) {
    if (cameraMotionActive) cameraMotionActive = false; // cancelAnimationFrame + null out
    pendingReframe = null; // this explicit zoom supersedes any earlier deferred request
    resyncTimer = null;
    nativeHold = { active: true, setAt: now };
    scrollToContentCalls.push({ el, at: now });
  }

  /** Simulates Excalidraw's own animation moving appState mid-flight (not our writer). */
  function simulateNativeAnimationProgress(next) {
    Object.assign(appState, next);
  }

  /** Fires the resync timeout scheduled 420ms after requestZoomToConcept. */
  function completeNativeHold() {
    resyncTimer = null;
    nativeHold = { active: false, setAt: 0 };
    const camera = { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom };
    if (pendingReframe) {
      const pending = pendingReframe;
      pendingReframe = null;
      requestFramePage(pending.reason, 0);
    }
    return camera;
  }

  function reset() {
    cameraMotionActive = false;
    resyncTimer = null;
    nativeHold = { active: false, setAt: 0 };
  }

  return {
    apiRef: { getAppState: () => ({ ...appState }) },
    requestFramePage,
    requestZoomToConcept,
    simulateNativeAnimationProgress,
    completeNativeHold,
    reset,
    get scrollToContentCalls() { return scrollToContentCalls; },
    get springStarts() { return springStarts; },
    get cameraMotionActive() { return cameraMotionActive; },
    get nativeHoldActive() { return nativeHold.active; },
    get pendingReframe() { return pendingReframe; },
  };
}

// 1. A running spring is cancelled before scrollToContent starts.
{
  const h = makeHarness();
  h.requestFramePage("page turn: next", 0); // spring running
  check("spring running before zoom_to_concept", h.cameraMotionActive);
  h.requestZoomToConcept({ id: "concept-a" }, 100);
  check("running spring cancelled when scrollToContent starts", !h.cameraMotionActive);
}

// 2. framePage during the native animation does not start a spring.
{
  const h = makeHarness();
  h.requestZoomToConcept({ id: "concept-a" }, 0);
  const outcome = h.requestFramePage("live narration follow", 50);
  check("framePage during native hold is deferred, not started", outcome === "deferred" && h.springStarts.length === 0);
}

// 3. A meaningful reframe requested during the hold is recorded as pending.
{
  const h = makeHarness();
  h.requestZoomToConcept({ id: "concept-a" }, 0);
  h.requestFramePage("structured diagram joined the active visual cluster", 50);
  check(
    "deferred request is recorded in pendingReframe, not discarded",
    h.pendingReframe?.reason === "structured diagram joined the active visual cluster",
  );
}

// 4. Multiple requests during the hold do not create competing camera animations.
{
  const h = makeHarness();
  h.requestZoomToConcept({ id: "concept-a" }, 0);
  h.requestFramePage("following live narration", 20);
  h.requestFramePage("following live narration", 120);
  h.requestFramePage("page turn: next", 250);
  check(
    "repeated requests during the hold never start a spring",
    h.springStarts.length === 0 && !h.cameraMotionActive,
  );
  check(
    "the newest request coalesces over older deferred ones",
    h.pendingReframe?.reason === "page turn: next",
  );
}

// 5 & 6. Final camera matches the completed scrollToContent state; hold clears.
{
  const h = makeHarness();
  h.requestZoomToConcept({ id: "concept-a" }, 0);
  h.simulateNativeAnimationProgress({ scrollX: 342, scrollY: -118, zoom: 0.74 });
  const camera = h.completeNativeHold();
  check(
    "resynced camera matches Excalidraw's actual settled scrollToContent state",
    camera.scrollX === 342 && camera.scrollY === -118 && camera.zoom === 0.74,
  );
  check("hold is cleared once the native animation completes", !h.nativeHoldActive);
}

// 7. A pending reframe is replayed after the hold clears, through the normal spring path.
{
  const h = makeHarness();
  h.requestZoomToConcept({ id: "concept-a" }, 0);
  h.requestFramePage("structured diagram joined the active visual cluster", 50);
  check("reframe deferred while hold is active", h.springStarts.length === 0);
  h.completeNativeHold();
  check(
    "deferred reframe replays through the spring path once the hold clears",
    h.springStarts.length === 1 && h.springStarts[0].reason === "structured diagram joined the active visual cluster",
  );
  check("no reframe left pending after replay", h.pendingReframe === null);
}

// 8. No spring and native scrollToContent writer run concurrently.
{
  const h = makeHarness();
  h.requestZoomToConcept({ id: "concept-a" }, 0);
  h.requestFramePage("page turn: next", 10);
  h.requestFramePage("following live narration", 200);
  const springStartsDuringHold = h.springStarts.length;
  h.completeNativeHold();
  check(
    "zero spring starts while scrollToContent owns the camera",
    springStartsDuringHold === 0 && h.scrollToContentCalls.length === 1,
  );
  check("spring only resumes after the native writer's animation is done", h.springStarts.length === 1);
}

// 9. Reset/unmount clears the hold and any associated timer safely.
{
  const h = makeHarness();
  h.requestZoomToConcept({ id: "concept-a" }, 0);
  h.requestFramePage("following live narration", 50); // queues a pending reframe
  h.reset();
  check("reset clears the native hold", !h.nativeHoldActive);
  const outcome = h.requestFramePage("page turn: next", 999);
  check("camera is not stuck deferring forever after a reset mid-hold", outcome === "started-spring");
}

// 10. Existing camera/composition behavior outside this path is unchanged.
{
  const viewport = recordingViewport(1528, 698);
  const proposal = proposeCamera({
    state: initialCompositionState(),
    viewport,
    currentCamera: { scrollX: 0, scrollY: 0, zoom: 1 },
    focalBounds: { x: 100, y: 80, width: 420, height: 260 },
    focalSubject: "primary",
    activeCluster: "page:0",
    reason: "content entered safe frame",
    now: 10_000,
  });
  check("proposeCamera still resolves a fitting frame unaffected by this fix", proposal.contentFits);

  let camera = { scrollX: 0, scrollY: 0, zoom: 1 };
  let velocity = { scrollX: 0, scrollY: 0, zoom: 0 };
  const target = { scrollX: 200, scrollY: 40, zoom: 0.9 };
  for (let frame = 0; frame < 90; frame += 1) {
    const next = stepCameraSpring(camera, target, velocity, 1000 / 60);
    camera = next.camera;
    velocity = next.velocity;
  }
  check(
    "the spring itself still converges normally outside a native hold",
    Math.abs(camera.scrollX - target.scrollX) < 0.1 && Math.abs(camera.zoom - target.zoom) < 0.001,
  );
}

console.log(`\n${pass} checks passed${failures.length ? `, ${failures.length} FAILED` : ""}.`);
if (failures.length) {
  console.error("\nFailures:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
