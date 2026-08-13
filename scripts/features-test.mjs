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
import { features } from "../lib/features.ts";

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
check("directorV1 defaults off", features.directorV1 === false);

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
