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
import {
  EMPTY_PRESENTATION_THOUGHT,
  EMPTY_THOUGHT,
  MAX_PRESENTATION_WORDS,
  pushPresentationSegment,
  pushStructuralSegment,
} from "../lib/liveSpeech.ts";
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

// ------------------------------------------------------- V3 boundary safety

section("Thought-Boundary Safety V3: exact natural-corpus continuations");

function replayPresentation(segments) {
  let state = EMPTY_PRESENTATION_THOUGHT;
  const thoughts = [];
  for (let index = 0; index < segments.length; index += 1) {
    const result = pushPresentationSegment(state, segments[index], 1000 + index * 500);
    state = result.state;
    thoughts.push(...result.thoughts);
  }
  return { state, thoughts };
}

const exactContinuations = [
  {
    fragment: "The idea is just",
    segments: [
      "Marketing InPublic is really simple. The idea is just",
      "post, create content, create content that really showcase it, but",
      "really, like, really capitalize on the visual aspect",
      "because InPublic is our visual tool, our visual expressive tool.",
    ],
    joined: "The idea is just post, create content",
  },
  {
    fragment: "I quite like",
    segments: ["I quite like", "talking and really seeing how my my words are really", "I quite like it."],
    joined: "I quite like talking",
  },
  {
    fragment: "InPublic was built",
    segments: ["InPublic was built", "by me to help solve this insecurity of mine."],
    joined: "InPublic was built by me",
  },
  {
    fragment: "I'm also thinking",
    segments: ["I'm also thinking", "like, are we gonna for the affiliate aspect, are we gonna, like,"],
    joined: "I'm also thinking like, are we gonna",
  },
  {
    fragment: "there was no real way I could make progress without",
    segments: [
      "I can't code it. So there was no real way I could make progress without",
      "realistically using AI agents beside my knowledge wise.",
    ],
    joined: "there was no real way I could make progress without realistically using AI agents",
  },
  {
    fragment: "interestingly, I was like, let me just",
    segments: ["interestingly, I was like, let me just", "go and research", "see what types of expressions they were out there to see what"],
    joined: "interestingly, I was like, let me just go and research",
  },
  {
    fragment: "How much minutes are we gonna have, like, users",
    segments: [
      "How much minutes are we gonna have, like, users",
      "Like, how much like, really going into that? Like, how much minutes we're gonna have working on that because minutes considering pricing is something that's really important.",
    ],
    joined: "How much minutes are we gonna have, like, users Like, how much",
  },
];

for (const sample of exactContinuations) {
  const first = pushPresentationSegment(EMPTY_PRESENTATION_THOUGHT, sample.segments[0], 1000);
  check(`${sample.fragment}: does not settle from its corpus final`, !first.thoughts.some((thought) => thought.text === sample.fragment));
  const replayed = replayPresentation(sample.segments);
  const completeText = [...replayed.thoughts.map((thought) => thought.text), replayed.state.text].join(" ");
  check(`${sample.fragment}: joins its exact following corpus context`, completeText.includes(sample.joined), completeText);
}

section("Thought-Boundary Safety V3: prefix/tail, short clauses, questions, and safety bound");

{
  const result = pushPresentationSegment(
    EMPTY_PRESENTATION_THOUGHT,
    "Marketing InPublic is really simple. The idea is just",
    1000,
  );
  check("completed prefix settles independently", result.thoughts[0]?.text === "Marketing InPublic is really simple.");
  check("unfinished suffix remains live", result.state.text === "The idea is just", result.state.text);
  check(
    "prefix plus tail preserves every word exactly",
    [...result.thoughts.map((thought) => thought.text), result.state.text].join(" ") ===
      "Marketing InPublic is really simple. The idea is just",
  );
}

for (const sentence of ["It worked.", "That's why.", "I agree.", "This matters.", "What should we build next?", "Why did this happen?"]) {
  const result = pushPresentationSegment(EMPTY_PRESENTATION_THOUGHT, sentence, 1000);
  check(`${sentence}: legitimate short/complete unit settles`, result.thoughts[0]?.text === sentence);
}

for (const question of ["What exactly how exactly are we gonna really", "How much minutes are we gonna"]) {
  const result = pushPresentationSegment(EMPTY_PRESENTATION_THOUGHT, question, 1000);
  check(`${question}: unfinished question remains live`, result.thoughts.length === 0 && result.state.text === question);
}

{
  const long = Array.from({ length: 70 }, (_, index) => `word${index + 1}`).join(" ");
  const result = pushPresentationSegment(EMPTY_PRESENTATION_THOUGHT, long, 1000);
  const units = [...result.thoughts.map((thought) => thought.text), result.state.text].filter(Boolean);
  check("punctuation-free speech is bounded", units.every((unit) => unit.split(/\s+/).length <= MAX_PRESENTATION_WORDS));
  check("forced splits preserve order and every token", units.join(" ") === long);
  check("safety telemetry identifies the forced split", result.decisions.some((item) => item.reason === "safe_forced_split"));
}

// ---------------------------------------------------------------- flag/off

section("feature flag: livePresentationV2 is the committed production default (docs/VALIDATED-STACK-PRODUCTION-ACTIVATION-V1.md)");

// Product contract: a normal visitor, zero query params, in production, is
// on V2 — not the legacy pipeline. This must fail loudly if the flag is
// ever flipped back without a deliberate revert.
check("livePresentationV2 is the committed default", features.livePresentationV2 === true);
const originalEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
delete globalThis.window;
check(
  "STANDARD MODE DEFAULT: production, no window, no query params -> V2 active",
  isLivePresentationV2Enabled() === true,
);
process.env.NODE_ENV = originalEnv;

section("dev-only ?v2=1 override (mechanics, simulated pre-activation state)");

// The override only has anything to prove when the committed flag is off —
// this section temporarily simulates the pre-activation committed state
// (`false`) to exercise the override in isolation, then restores the real
// committed default asserted above.
features.livePresentationV2 = false;

process.env.NODE_ENV = "development";
globalThis.window = { location: { search: "?v2=1" } };
check("?v2=1 enables V2 in development", isLivePresentationV2Enabled() === true);

globalThis.window = { location: { search: "" } };
check("no query param leaves V2 off in development", isLivePresentationV2Enabled() === false);

process.env.NODE_ENV = "production";
globalThis.window = { location: { search: "?v2=1" } };
check(
  "?v2=1 is IGNORED in production — the override must never leak into prod, while the committed flag is off",
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
// Leave it on: `true` is the real committed default this whole suite runs
// against below (V3, camera, thought-merging all assume V2 is active).

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
