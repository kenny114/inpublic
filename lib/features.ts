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
  /**
   * Live Speech Presentation V2 — a PROTECTED BASELINE, not an experiment
   * anymore. Manually compared against legacy Standard Mode and confirmed
   * materially cleaner; future visual intelligence is meant to build on top
   * of this layer, not bypass or casually rewrite it. Full rationale,
   * pipeline diagram, and the protected invariant list live in
   * docs/LIVE-SPEECH-PRESENTATION-V2.md — read that before changing anything
   * this flag gates. See also docs/decisions/ADR-LIVE-PRESENTATION-V2.md.
   *
   * Off means every call site this flag touches takes the exact branch that
   * existed before it — zero behavior change, same pattern as `reflex` /
   * `directorV1`. Governs HOW the live transcript looks and moves; it does
   * not change recognition speed or the Tier 1 speech->ink path
   * (components/Board.tsx's `writeLive`, hooks/useDeepgram.ts).
   *
   * On, for the duration of a session:
   *  - Reflex (Tier 2), the Scribe (Tier 3a), and Beat/Artist/Director/Math
   *    (Tier 3b/3c) are suppressed — nothing is scheduled, no extra call is
   *    made. Tier 1 (Deepgram -> writeLive -> canvas) is untouched.
   *  - A settled live line is no longer deleted the instant the next
   *    utterance starts (writeLive's `dropSettledLiveLine`) — it stays on
   *    the page, since nothing else in this mode redraws it.
   *  - Consecutive Deepgram finals belonging to one unfinished thought
   *    (lib/liveSpeech.ts's `pushStructuralSegment`, already used by Story
   *    Mode, deterministic and model-free) patch the same anchored text
   *    element instead of starting a new row per final.
   *  - The camera does not reframe on every interim; it only follows the
   *    live line when it is genuinely about to leave the safe viewport.
   *  - The finalisation opacity pulse ("settle flash") is skipped.
   *
   * Dev-only override: with `NODE_ENV !== "production"`, `?v2=1` in the URL
   * enables this mode for that page load regardless of the flag below, so
   * on/off can be compared without editing and redeploying. See
   * `isLivePresentationV2Enabled`.
   *
   * ACTIVATED 2026-08-17 (docs/VALIDATED-STACK-PRODUCTION-ACTIVATION-V1.md):
   * validated against the deterministic camera/replay corpus and a fresh
   * natural session; this is now the default Standard Mode experience for
   * every user, not a flag under test. `?v2=1` is now a no-op — the
   * resolver returns `true` from the committed flag before it ever reads
   * the query string, in every environment. There is no forced-off debug
   * override; reverting requires flipping this literal back to `false`.
   */
  livePresentationV2: true,
  /**
   * Visual Re-entry V1 — controlled reintroduction of visual intelligence
   * DOWNSTREAM of Live Speech Presentation V2's settled-thought output. Only
   * two visual families exist in V1: `enumeration` and `quantitative_change`
   * (see lib/visualReentry/). `none` is a first-class, expected result — the
   * hypothesis being tested is that most settled thoughts should produce no
   * additional visual at all. See docs/VISUAL-REENTRY-V1.md.
   *
   * Meaningless without V2: `isVisualReentryV1Enabled()` returns false
   * whenever `isLivePresentationV2Enabled()` is false, regardless of this
   * flag or the dev override below. Off means the pipeline never runs — no
   * extra LLM call, no extra canvas write, zero behavior change, same
   * pattern as `reflex` / `livePresentationV2`.
   *
   * Dev-only override: with `NODE_ENV !== "production"`, `?vr=1` in the URL
   * enables this mode for that page load (still requires V2 to also be on,
   * via the `livePresentationV2` flag or `?v2=1`), so on/off can be compared
   * without editing and redeploying — e.g. `/try?v2=1&vr=1`. Production
   * always ignores the query param and reads only the committed flag value,
   * same reasoning as every other flag in this file.
   *
   * ACTIVATED 2026-08-17 (docs/VALIDATED-STACK-PRODUCTION-ACTIVATION-V1.md):
   * same activation as `livePresentationV2` above, for the same reason —
   * `?vr=1` is now a no-op in every environment. Reverting requires flipping
   * this literal back to `false` (and/or `livePresentationV2`, since this
   * flag is inert without it regardless).
   */
  visualReentryV1: true,
} as const;

export type FeatureFlags = typeof features;

/**
 * Resolves `features.livePresentationV2` plus its dev-only `?v2=1` override.
 * Production always ignores the query param and reads the flag only — see
 * the flag's doc comment above for why env/query overrides aren't trusted
 * for anything user-facing in this codebase.
 */
export function isLivePresentationV2Enabled(): boolean {
  if (features.livePresentationV2) return true;
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("v2") === "1";
}

/**
 * Resolves `features.visualReentryV1` plus its dev-only `?vr=1` override.
 * Always false when `isLivePresentationV2Enabled()` is false — Visual
 * Re-entry has no meaning without V2's settled-thought output to consume.
 * See the flag's doc comment above for why env/query overrides aren't
 * trusted for anything user-facing in this codebase.
 */
export function isVisualReentryV1Enabled(): boolean {
  if (!isLivePresentationV2Enabled()) return false;
  if (features.visualReentryV1) return true;
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("vr") === "1";
}
