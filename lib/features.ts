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
} as const;

export type FeatureFlags = typeof features;
