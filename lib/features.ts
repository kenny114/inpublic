/**
 * Product-surface feature flags.
 *
 * NOT an entitlement/plan gate (see lib/server/entitlement.ts for that) —
 * this controls whether a mode is exposed in the UI at all, for every user,
 * regardless of plan. A plain hardcoded object rather than an env var
 * deliberately: env vars need per-environment Vercel configuration AND a
 * fresh build to take effect for anything NEXT_PUBLIC_-prefixed (bit us
 * once already — a flag set locally silently had no effect in production
 * until a redeploy). A value here takes effect the moment it's committed
 * and deployed, on every environment, with no separate config step.
 *
 * Story Mode and Audio Replay are parked (2026-08-10) so product focus can
 * go entirely to Standard Mode, payments, and cost/latency. Both remain
 * fully implemented and untouched — components/Board.tsx's story-mode
 * branches, components/AudioReplayPanel.tsx, lib/story.ts, lib/storyV2.ts,
 * app/api/story/route.ts, app/api/audio/upload/route.ts, all still work.
 * This file only controls whether the UI offers a path to reach them.
 * Flip a value back to `true` and redeploy to bring a parked feature back —
 * no reconstruction needed.
 */
export const features = {
  standardMode: true,
  storyMode: false,
  audioReplay: false,
  /**
   * Tier 2 (lib/speculative.ts / components/Board.tsx's Reflex wiring).
   * Flipping this off entirely skips recognition and rendering — no
   * setTimeout is even scheduled — while leaving Tier 1 (writeLive) and Tier
   * 3 (Scribe/Beat/Artist) untouched. Exists so Reflex-off-vs-on can be
   * measured (see scripts/latency-benchmark.mjs) and so it can be pulled
   * instantly without a code change if it ever measurably costs Tier 1
   * anything (see the invariant comment at the top of writeLive).
   */
  reflex: true,
  /**
   * Director/Choreographer v0: recognize a spoken comparison between two
   * concepts already on the board and reorganize their existing nodes into a
   * side-by-side layout instead of drawing more content next to them. See
   * lib/director.ts and lib/choreographerComparison.ts. Off means the
   * detection call after applyActions never runs — zero behavior change,
   * same pattern as `reflex`.
   */
  choreographerComparison: true,
  /**
   * Director V1: a persistent, patient structural-recognition layer that adds
   * PROCESS (an ordered chain of concepts already on the board) alongside
   * Comparison, and arbitrates between the two when a beat's evidence
   * supports both. See lib/directorState.ts and lib/choreographerProcess.ts.
   * Off means runBeat falls through to the exact `choreographerComparison`
   * branch that existed before this flag — zero behavior change. On subsumes
   * comparison's *decision* (still the same detectComparison/
   * performComparison functions) so both capabilities can be arbitrated in
   * one place instead of firing independently.
   */
  directorV1: true,
} as const;

export type FeatureFlags = typeof features;
