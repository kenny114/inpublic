/**
 * The Story Mode / Audio Replay product-surface shutdown, tested directly.
 *
 *   node --import ./scripts/ts-register.mjs scripts/features-test.mjs
 *
 * Confirms the flags themselves, AND the one piece of pure clamping logic
 * that isn't just "don't render a button" — lib/preferences.ts's
 * readPreferences(), which must not let a stale localStorage value (set
 * before Story Mode was parked) silently route "New session" back into it.
 * Everything else (the UI gating) is React-rendered and not covered by
 * this node-script test style, same limitation as the rest of this suite.
 */

import assert from "node:assert/strict";
import { features, isLivePresentationV2Enabled, isVisualReentryV1Enabled, isMeaningEngineV1Enabled } from "../lib/features.ts";

let pass = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

function section(title) {
  console.log(`\n── ${title}`);
}

section("feature flags");

check("standardMode is enabled", features.standardMode === true);
check("storyMode is parked", features.storyMode === false);
check("audioReplay is parked", features.audioReplay === false);
check("choreographerComparison is enabled", features.choreographerComparison === true);
check("directorV1 is enabled", features.directorV1 === true);

section("validated stack is the committed production default (docs/VALIDATED-STACK-PRODUCTION-ACTIVATION-V1.md)");

// This is the product contract this section exists to protect: a normal
// visitor with zero query params, in production, gets V2 with no legacy
// fallback. If this flag is ever flipped back to `false` without
// deliberately reverting the whole activation, this must fail loudly rather
// than silently ship the legacy pipeline again.
check("livePresentationV2 is the committed default", features.livePresentationV2 === true);
// visualReentryV1 was turned back OFF 2026-08-19: superseded by the Meaning
// Engine (features.meaningEngineV1, lib/meaning/*) — see that flag's doc
// comment in lib/features.ts for why. meaningEngineV1 itself stays off by
// default while it's under active development/testing (query-param-gated
// in non-production via `?me=1`), so NEITHER visual-intelligence pipeline
// is on for a normal production visitor right now — V2's live handwriting
// (Tier 1) is unaffected either way.
check("visualReentryV1 is off (superseded by the Meaning Engine)", features.visualReentryV1 === false);
check("meaningEngineV1 is off by default while under active development", features.meaningEngineV1 === false);

const originalEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
delete globalThis.window;
check(
  "STANDARD MODE DEFAULT: production, no window, no query params -> V2 active",
  isLivePresentationV2Enabled() === true,
);
check(
  "STANDARD MODE DEFAULT: production, no window, no query params -> Visual Re-entry inactive (superseded)",
  isVisualReentryV1Enabled() === false,
);
check(
  "STANDARD MODE DEFAULT: production, no window, no query params -> Meaning Engine inactive (still off by default)",
  isMeaningEngineV1Enabled() === false,
);
process.env.NODE_ENV = originalEnv;

section("isVisualReentryV1Enabled() requires V2 to also be on (override mechanics, simulated pre-activation state)");

// Both isLivePresentationV2Enabled() and isVisualReentryV1Enabled() read
// `window.location.search` directly (not React state), so a minimal window
// shim with only `location.search` is enough to exercise the resolvers
// outside a browser — same idiom as the localStorage shim above. The
// override only has anything to prove when the committed flags are off, so
// this section temporarily simulates the pre-activation committed state
// (both `false`) to exercise the override logic in isolation, then restores
// the real committed defaults asserted above.
features.livePresentationV2 = false;
features.visualReentryV1 = false;

const withSearch = (search) => {
  globalThis.window = { location: { search } };
};

check("with both flags off, no query params: disabled", !isVisualReentryV1Enabled());

withSearch("?vr=1");
check("?vr=1 alone (no v2): still disabled — V1 is meaningless without V2", !isVisualReentryV1Enabled());

withSearch("?v2=1");
check("?v2=1 alone (no vr): disabled", !isVisualReentryV1Enabled());

withSearch("?v2=1&vr=1");
check("?v2=1&vr=1 together: enabled (dev override)", isVisualReentryV1Enabled());

delete globalThis.window;

section("isVisualReentryV1Enabled() — dev override works, production ignores it (Part 15)");

process.env.NODE_ENV = "development";
withSearch("?v2=1&vr=1");
check("dev override works: ?v2=1&vr=1 enables V1 in development", isVisualReentryV1Enabled());

process.env.NODE_ENV = "production";
withSearch("?v2=1&vr=1");
check(
  "production ignores query override — ?v2=1&vr=1 must NOT enable V1 in production while the committed flags are off",
  isVisualReentryV1Enabled() === false,
);

// The flag itself (not the query override) is what production honors.
features.livePresentationV2 = true;
features.visualReentryV1 = true;
withSearch("");
check("in production, the committed flags alone (no query needed) enable V1", isVisualReentryV1Enabled() === true);

// Already back to the real committed defaults (both `true`) here, so no
// restore is needed — just clean up the shims this section installed.
delete globalThis.window;
process.env.NODE_ENV = originalEnv;

section("preferences.readPreferences() clamps a stale story preference to standard");

// lib/preferences.ts reads `window.localStorage` at call time, not import
// time — a minimal global shim installed before the call is enough.
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  },
};

const { readPreferences, DEFAULT_PREFERENCES } = await import("../lib/preferences.ts");

check("with nothing stored, defaults to standard", readPreferences().defaultMode === "standard");

store.set("inpublic-preferences", JSON.stringify({ defaultMode: "story", displayName: "Kenny" }));
const clamped = readPreferences();
check(
  "a stale 'story' preference from before the shutdown is clamped to standard",
  clamped.defaultMode === "standard",
  clamped.defaultMode,
);
check("other preference fields survive the clamp untouched", clamped.displayName === "Kenny");

store.set("inpublic-preferences", JSON.stringify({ defaultMode: "standard", displayName: "" }));
check("an explicit standard preference round-trips as standard", readPreferences().defaultMode === "standard");

check("DEFAULT_PREFERENCES itself defaults to standard", DEFAULT_PREFERENCES.defaultMode === "standard");

// ------------------------------------- engine mutual exclusion

/**
 * The Expression Engine and the Meaning Engine both consume the same settled
 * thoughts and draw onto the same sheet. Running both double-draws the same
 * content in two visual languages, so the flag resolver — not a comment, and
 * not whoever flips the flags — has to enforce that only one can win.
 */
{
  const { isMeaningEngineV1Enabled, isExpressionEngineV1Enabled } = await import("../lib/features.ts");
  const withSearch = (search) => {
    globalThis.window = { ...globalThis.window, location: { search } };
  };

  withSearch("?v2=1&me=1");
  check("the meaning engine turns on by itself", isMeaningEngineV1Enabled() === true);
  check("and the expression engine stays off", isExpressionEngineV1Enabled() === false);

  withSearch("?v2=1&xe=1");
  check("the expression engine turns on by itself", isExpressionEngineV1Enabled() === true);

  withSearch("?v2=1&me=1&xe=1");
  check("with both requested, the expression engine wins", isExpressionEngineV1Enabled() === true);
  check("and the meaning engine is forced off, so the sheet is never double-drawn", isMeaningEngineV1Enabled() === false);

  // Note: `livePresentationV2` is committed on, so both resolvers' V2 gate is
  // always satisfied in this build — the gate itself is covered by the
  // visualReentry override tests above, which simulate the pre-activation state.
  withSearch("?v2=1");
  check("with neither requested, both engines stay off", isExpressionEngineV1Enabled() === false && isMeaningEngineV1Enabled() === false);
}

delete globalThis.window;

// ------------------------------------------------------------------- results

console.log(`\n${"─".repeat(60)}`);
if (failures.length === 0) {
  console.log(`✓ ${pass} checks passed`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
