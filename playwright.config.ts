import { defineConfig } from "@playwright/test";

/**
 * The minimal browser safety net this repo had zero of before Phase 2 of the
 * strip-down (audit/TEST_COVERAGE_MAP.md: "no Playwright config, no *.spec.ts
 * anywhere"). Deliberately narrow: boot, undo, session restore, page/camera —
 * not a general E2E framework. See tests/smoke/README.md.
 *
 * No live Deepgram, no paid LLM call: every test drives the board through
 * `window.inpublic.express({ delta })` (lib/expression/entry.ts), which skips
 * meaning extraction entirely and goes straight into the deterministic world
 * fold — the same guarantee AGENT.md documents for any agent caller.
 */
export default defineConfig({
  testDir: "./tests/smoke",
  // Next.js dev compiles each route on first hit — Board.tsx's chunk alone
  // took ~20s cold in practice. Generous timeouts here are absorbing that,
  // not masking flakiness.
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    video: "off",
    navigationTimeout: 45_000,
  },
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
