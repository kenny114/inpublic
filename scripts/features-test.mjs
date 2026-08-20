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
import { features, isLivePresentationV2Enabled, isExpressionEngineV1Enabled } from "../lib/features.ts";

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
// ONE visual engine, and it is on. Visual Re-entry V1 (lib/visualReentry/)
// and Meaning Engine V1 (lib/meaning/) were both deleted on 2026-08-20 —
// see features.expressionEngineV1's doc comment. Three engines behind three
// flags, none of them on, meant a normal production visitor got no semantic
// visual at all. If this flag is ever flipped back to `false`, that is the
// state it returns to, so this must fail loudly.
check("expressionEngineV1 is the committed default", features.expressionEngineV1 === true);

const originalEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
delete globalThis.window;
check(
  "STANDARD MODE DEFAULT: production, no window, no query params -> V2 active",
  isLivePresentationV2Enabled() === true,
);
check(
  "STANDARD MODE DEFAULT: production, no window, no query params -> Expression Engine active",
  isExpressionEngineV1Enabled() === true,
);
process.env.NODE_ENV = originalEnv;

section("isExpressionEngineV1Enabled() requires V2 to also be on (override mechanics, simulated pre-activation state)");

// Both resolvers read `window.location.search` directly (not React state), so
// a minimal window shim with only `location.search` is enough to exercise
// them outside a browser — same idiom as the localStorage shim above. The
// override only has anything to prove when the committed flags are off, so
// this section temporarily simulates the pre-activation committed state
// (both `false`), then restores the real committed defaults asserted above.
features.livePresentationV2 = false;
features.expressionEngineV1 = false;

const withSearch = (search) => {
  globalThis.window = { location: { search } };
};

check("with both flags off, no query params: disabled", !isExpressionEngineV1Enabled());

withSearch("?xe=1");
check("?xe=1 alone (no v2): still disabled — the engine is meaningless without V2's settled thoughts", !isExpressionEngineV1Enabled());

withSearch("?v2=1");
check("?v2=1 alone (no xe): disabled", !isExpressionEngineV1Enabled());

withSearch("?v2=1&xe=1");
check("?v2=1&xe=1 together: enabled (dev override)", isExpressionEngineV1Enabled());

delete globalThis.window;

section("isExpressionEngineV1Enabled() — dev override works, production ignores it");

process.env.NODE_ENV = "development";
withSearch("?v2=1&xe=1");
check("dev override works: ?v2=1&xe=1 enables the engine in development", isExpressionEngineV1Enabled());

process.env.NODE_ENV = "production";
withSearch("?v2=1&xe=1");
check(
  "production ignores query override — ?v2=1&xe=1 must NOT enable the engine in production while the committed flags are off",
  isExpressionEngineV1Enabled() === false,
);

// The flag itself (not the query override) is what production honors.
features.livePresentationV2 = true;
features.expressionEngineV1 = true;
withSearch("");
check("in production, the committed flags alone (no query needed) enable the engine", isExpressionEngineV1Enabled() === true);

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
