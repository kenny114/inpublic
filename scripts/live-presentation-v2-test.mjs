/**
 * Live Speech Presentation V2 — protected-invariant tests.
 *
 *   node --import ./scripts/ts-register.mjs scripts/live-presentation-v2-test.mjs
 *
 * V2 is a protected baseline (docs/LIVE-SPEECH-PRESENTATION-V2.md). This file
 * covers the pieces of its contract that are pure/deterministic and testable
 * without mounting components/Board.tsx:
 *
 *   - the feature flag and its dev-only query-param override
 *   - thought-level merging (segment order, active-vs-settled transition)
 *   - the camera "does the active thought still fit the viewport" check
 *
 * What this file deliberately does NOT cover, and why: components/Board.tsx
 * is a single ~6,000-line component with no seam for testing in isolation
 * (see SPEECH-TO-VISUAL-AUDIT.md §27), and refactoring it to create one is
 * explicitly out of scope for protecting V2. Not tested here, by design:
 *
 *   - that Reflex/Scribe/Beat/resetSilenceTimer are actually gated by
 *     `!v2Enabled` at their call sites in handleInterim/handleFinal (this is
 *     read, not exercised, by a human/agent reviewing those functions)
 *   - that dropSettledLiveLine is actually skipped under V2 in writeLive
 *   - that liveRef.current/settledLiveRef.current anchor identity survives
 *     end-to-end across real Deepgram interims/finals
 *   - the finalisation-pulse suppression's visual effect
 *
 * These remain protected by the "V2 INVARIANT" comments at each gate in
 * Board.tsx and by docs/LIVE-SPEECH-PRESENTATION-V2.md's invariant list —
 * not by an automated test. A future refactor that extracts Board.tsx's
 * speech-handling into a testable module should add coverage for these.
 */

import assert from "node:assert/strict";
import { features, isLivePresentationV2Enabled } from "../lib/features.ts";
import { EMPTY_THOUGHT, pushStructuralSegment } from "../lib/liveSpeech.ts";
import { liveLineFitsViewport } from "../lib/composition.ts";

let pass = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

function section(title) {
  console.log(`\n── ${title}`);
}

// ---------------------------------------------------------------- flag/off

section("feature flag: livePresentationV2 defaults off (legacy path stays available)");

check("livePresentationV2 defaults to false", features.livePresentationV2 === false);
check("isLivePresentationV2Enabled() is false with the flag off, no window", isLivePresentationV2Enabled() === false);

section("dev-only ?v2=1 override");

const originalEnv = process.env.NODE_ENV;

process.env.NODE_ENV = "development";
globalThis.window = { location: { search: "?v2=1" } };
check("?v2=1 enables V2 in development", isLivePresentationV2Enabled() === true);

globalThis.window = { location: { search: "" } };
check("no query param leaves V2 off in development", isLivePresentationV2Enabled() === false);

process.env.NODE_ENV = "production";
globalThis.window = { location: { search: "?v2=1" } };
check(
  "?v2=1 is IGNORED in production — the override must never leak into prod",
  isLivePresentationV2Enabled() === false,
);

delete globalThis.window;
process.env.NODE_ENV = originalEnv;

section("flag on always wins, regardless of environment");

// `as const` in lib/features.ts is a type-level guarantee, not Object.freeze —
// flipping this at runtime is deliberate here, to prove the flag itself (not
// just the dev override) is what the function ultimately reads.
features.livePresentationV2 = true;
check("isLivePresentationV2Enabled() is true once the flag itself is on", isLivePresentationV2Enabled() === true);
features.livePresentationV2 = false;
check("flipping it back off restores legacy behavior", isLivePresentationV2Enabled() === false);

// ---------------------------------------------------------- thought merging

section("thought-level merging (lib/liveSpeech.ts pushStructuralSegment) — reused unchanged from Story Mode");

{
  const t0 = 1000;
  const seg1 = pushStructuralSegment(EMPTY_THOUGHT, "Revenue increased but", t0);
  check("an incomplete segment stays active (thought is null)", seg1.thought === null);
  check("an incomplete segment is reported as held", seg1.held === true);
  check(
    "the held text accumulates the segment",
    seg1.state.text === "Revenue increased but",
    seg1.state.text,
  );
  check("segment order is preserved in rawSegments after one push", (
    seg1.state.rawSegments.length === 1 && seg1.state.rawSegments[0] === "Revenue increased but"
  ));

  const seg2 = pushStructuralSegment(seg1.state, "customers actually decreased.", t0 + 400);
  check("thought completes once a terminal segment lands", seg2.thought === "Revenue increased but customers actually decreased.");
  check("a completed thought is reported as not held", seg2.held === false);
  check(
    "segment order is preserved across the whole held thought",
    seg2.state.rawSegments.length === 0, // state resets to EMPTY_THOUGHT on completion
  );
  check(
    "the merged text preserves segment order (first segment's words precede second's)",
    seg2.thought.indexOf("Revenue increased but") === 0 &&
      seg2.thought.indexOf("customers actually decreased") > seg2.thought.indexOf("increased but"),
  );

  const seg3 = pushStructuralSegment(EMPTY_THOUGHT, "This is InPublic.", t0 + 800);
  check(
    "a single self-contained final settles immediately (no held state needed)",
    seg3.thought === "This is InPublic." && seg3.held === false,
  );
}

// --------------------------------------------------------------- camera fit

section("camera: liveLineFitsViewport (lib/composition.ts) — V2's 'ask only when necessary' gate");

const viewport = { scrollX: -100, scrollY: -100, zoom: 1, width: 1200, height: 800 };
// Visible canvas region at this viewport (before margin): x in [100, 1300], y in [100, 900].

check(
  "a line well inside the visible viewport does not need the camera to move",
  liveLineFitsViewport({ x: 200, y: 200, width: 300, height: 40 }, viewport) === true,
);

check(
  "a line that has grown past the right/bottom edge DOES need the camera to move",
  liveLineFitsViewport({ x: 1100, y: 850, width: 300, height: 40 }, viewport) === false,
);

check(
  "a line right at the margin boundary is treated as fitting (tolerance is exact, not lenient outward)",
  liveLineFitsViewport({ x: 148, y: 148, width: 100, height: 20 }, viewport) === true,
);

check(
  "a degenerate zero-size viewport never reports a fit (fails closed, not open)",
  liveLineFitsViewport({ x: 0, y: 0, width: 10, height: 10 }, { ...viewport, width: 0, height: 0 }) === false,
);

// ------------------------------------------------------------------- results

console.log(`\n${"─".repeat(60)}`);
if (failures.length === 0) {
  console.log(`✓ ${pass} checks passed`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
