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
   *
   * SUPERSEDED 2026-08-19: turned back off now that the Meaning Engine
   * (features.meaningEngineV1, lib/meaning/*) is the system actually being
   * developed against. Left running, this fired an LLM call on every
   * settled thought and logged its own `decision-none`/`fast-path-rejected`
   * events under `type: "visual-reentry"` — easy to misread as a Meaning
   * Engine failure during a session-log audit, since the two pipelines ran
   * in parallel with no visual distinction in a casual read of the log.
   * Everything under lib/visualReentry/ remains fully implemented and
   * untouched; flip this back to `true` to bring it back as a comparison
   * baseline if ever needed.
   */
  visualReentryV1: false,
  /**
   * Meaning Engine V1 — a persistent SemanticState (lib/meaning/types.ts)
   * built downstream of Live Speech Presentation V2's settled-thought
   * output, reconciled against the canvas via lib/meaning/reconcile.ts +
   * lib/meaning/apply.ts instead of Visual Re-entry's single-clause
   * cause_effect grammar. Off by default while it's validated against real
   * sessions — Visual Re-entry (and everything else V2 already does) stays
   * exactly as-is either way.
   *
   * Off means components/Board.tsx's meaning-engine branch never runs — no
   * MeaningEngineController is created, no extra call, no extra canvas
   * write, same pattern as `reflex` / `visualReentryV1`.
   *
   * When turning this on for local testing, also flip `visualReentryV1` off
   * — both currently draw from the same settled-thought stream onto the
   * same canvas, and running both at once double-draws related content.
   *
   * Dev-only override: with `NODE_ENV !== "production"`, `?me=1` in the URL
   * enables this mode for that page load (still requires V2, via the
   * `livePresentationV2` flag or `?v2=1`), mirroring visualReentryV1's
   * `?vr=1`.
   */
  meaningEngineV1: false,

  /**
   * Wordless Visuals V1 — the meaning region draws signs (lib/meaning/
   * lexicon.ts -> lib/meaning/sign.ts) instead of labelled boxes, so a
   * concept reaches the canvas as a glyph and never as its English label.
   *
   * Scoped deliberately to the meaning region and nothing else. The live
   * transcript line (lib/ops.ts buildLiveLine) and the Scribe's lettering
   * are separate surfaces on the same sheet, and switching them off is a
   * different decision with a different failure mode — a viewer left with
   * no signal at all if the sign vocabulary misses. Turning this on first
   * lets the wordless region be judged next to the words it is meant to
   * replace, which is the only way to find out whether it actually reads.
   *
   * Meaningless without the Meaning Engine: `isWordlessVisualsEnabled()`
   * returns false when `isMeaningEngineV1Enabled()` is false.
   *
   * Dev-only override: `?wordless=1`, mirroring `?me=1`.
   */
  wordlessVisualsV1: false,

  /**
   * Expression Engine V1 — the rebuild in `lib/expression/*`, driven by the
   * same Live Speech Presentation V2 settled-thought stream the Meaning
   * Engine consumes, but through the full meaning → world → intent →
   * grammar → scene → render → evaluate → repair pipeline instead of
   * SemanticState -> planMeaning -> syncMeaningCanvas.
   *
   * Off means components/Board.tsx's expression branch never runs — no
   * controller is created, no extra model call, no extra canvas write —
   * exactly the pattern `visualReentryV1` and `meaningEngineV1` follow.
   *
   * MUTUALLY EXCLUSIVE with the Meaning Engine, and enforced rather than
   * documented: `isExpressionEngineV1Enabled()` wins and
   * `isMeaningEngineV1Enabled()` returns false whenever it is on. Both draw
   * from the same settled-thought stream onto the same sheet, and running
   * the pair at once double-draws the same content in two different visual
   * languages — the exact confusion that made `visualReentryV1` worth
   * turning off when the Meaning Engine arrived.
   *
   * Dev-only override: `?xe=1` (still requires V2, via `livePresentationV2`
   * or `?v2=1`), mirroring `?me=1` and `?vr=1`.
   */
  expressionEngineV1: true,
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

/**
 * Resolves `features.meaningEngineV1` plus its dev-only `?me=1` override.
 * Always false when `isLivePresentationV2Enabled()` is false, same
 * reasoning as `isVisualReentryV1Enabled()`.
 */
export function isMeaningEngineV1Enabled(): boolean {
  if (!isLivePresentationV2Enabled()) return false;
  // The Expression Engine replaces this one. Both consume the same settled
  // thoughts and draw onto the same sheet, so they cannot both run — see
  // `expressionEngineV1`'s doc comment. Enforced here rather than left to
  // whoever flips the flags.
  if (isExpressionEngineV1Enabled()) return false;
  if (features.meaningEngineV1) return true;
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("me") === "1";
}

/**
 * Resolves `features.expressionEngineV1` plus its dev-only `?xe=1` override.
 * Always false without Live Presentation V2, same reasoning as
 * `isVisualReentryV1Enabled()`: there is no settled-thought stream to
 * consume without it.
 */
export function isExpressionEngineV1Enabled(): boolean {
  if (!isLivePresentationV2Enabled()) return false;
  if (features.expressionEngineV1) return true;
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("xe") === "1";
}

/**
 * Dev-only, `?debug=1`-gated counterpart of `isMeaningDebugOnlyEnabled()`:
 * runs the whole Expression pipeline and logs every stage, but stops before
 * any Excalidraw write or camera move. The way to tell a misunderstanding
 * apart from a bad drawing without a canvas in the way.
 */
export function isExpressionDebugOnlyEnabled(): boolean {
  if (!isExpressionEngineV1Enabled()) return false;
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

/**
 * Resolves `features.wordlessVisualsV1` plus its dev-only `?wordless=1`
 * override. Always false without the Meaning Engine, which is what produces
 * the SemanticState the lexicon maps.
 */
export function isWordlessVisualsEnabled(): boolean {
  if (!isMeaningEngineV1Enabled()) return false;
  if (features.wordlessVisualsV1) return true;
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("wordless") === "1";
}

/**
 * Dev-only, `?debug=1`-gated: proves the semantic brain in isolation before
 * reconnecting it to the canvas. Requires the Meaning Engine itself to be
 * on (`isMeaningEngineV1Enabled()`) — it has no meaning otherwise. When
 * true, components/Board.tsx's applyMeaningUpdate stops after logging the
 * Part-10 debug snapshot: no layout, no arrows, no camera movement, no
 * Excalidraw write. Never available in production (this is a testing tool,
 * not a product surface, so it has no committed-flag path at all — only
 * the query-string override).
 */
export function isMeaningDebugOnlyEnabled(): boolean {
  if (!isMeaningEngineV1Enabled()) return false;
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1";
}
