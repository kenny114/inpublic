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
 * Story Mode, Audio Replay, and the old Reflex(Tier 2)/Scribe(Tier 3a)/
 * Beat-Artist-Director-Choreographer-Math(Tier 3b/3c) pipeline were removed
 * entirely in the Strip-Down (2026-08). There is one visual architecture now:
 * speech → Expression Engine → Excalidraw. The flags that gated those
 * removed systems are gone from this file, not just turned off — recover
 * them from git history if a comparison baseline is ever wanted.
 */
export const features = {
  standardMode: true,
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
   * Expression Engine V1 (`lib/expression/*`) — THE visual engine, and the
   * product's core capability: meaning → visual expression. Driven by Live
   * Speech Presentation V2's settled-thought stream through
   * meaning → world → intent → grammar → scene → render → evaluate → repair.
   * One model call, at the meaning layer only; every other layer is
   * deterministic TypeScript that runs without a network.
   *
   * ACTIVATED 2026-08-20. It replaced two predecessors that both drew from
   * this same settled-thought stream onto this same sheet, and both of which
   * were deleted rather than left flagged off:
   *
   *   - Visual Re-entry V1 (`lib/visualReentry/`), two visual families and a
   *     single-clause cause_effect grammar.
   *   - Meaning Engine V1 (`lib/meaning/`), a persistent SemanticState whose
   *     relation vocabulary was discourse-shaped (`causes`, `supports`,
   *     `contains`, `related_to`) over untyped concepts, so ordinary speech
   *     about the world collapsed into unlabelled boxes.
   *
   * Three engines behind three flags meant the product shipped no semantic
   * visual at all, because no combination of them was ever turned on in
   * production. There is now one engine and one flag. Recover the others from
   * the commit before this one if a comparison baseline is ever wanted.
   *
   * Dev-only override: `?xe=1` (still requires V2, via `livePresentationV2`
   * or `?v2=1`).
   */
  expressionEngineV1: true,
  /**
   * The Expression Engine's anticipation pass (lib/expression/live.ts's
   * `anticipate`): while a sentence is still being spoken, read what has
   * been said so far with the real extractor and fold ITS ENTITIES ONLY, so
   * the board keeps growing between the reflex mark and the settled
   * structure instead of holding still for the three-to-four seconds that
   * gap actually lasts.
   *
   * This is the one part of the engine that spends money to buy pacing: it
   * adds up to three extra extraction calls per utterance, rationed to one
   * per 1.4s and abandoned the moment the settled thought is on its way. Off
   * means `anticipate` is never called at all — no request, no fold, no cost
   * — and the engine behaves exactly as it did before it existed, same
   * pattern as `reflex`. Turn it off first if extraction spend ever needs
   * cutting.
   */
  expressionAnticipation: true,
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
 * Resolves `features.expressionEngineV1` plus its dev-only `?xe=1` override.
 * Always false without Live Presentation V2 — there is no settled-thought
 * stream to consume without it.
 */
export function isExpressionEngineV1Enabled(): boolean {
  if (!isLivePresentationV2Enabled()) return false;
  if (features.expressionEngineV1) return true;
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("xe") === "1";
}

/**
 * Dev-only, `?debug=1`-gated: runs the whole Expression pipeline and logs
 * every stage, but stops before any Excalidraw write or camera move. The way to tell a misunderstanding
 * apart from a bad drawing without a canvas in the way.
 */
export function isExpressionDebugOnlyEnabled(): boolean {
  if (!isExpressionEngineV1Enabled()) return false;
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

/**
 * Dev-only, `?capture=1`-gated: buffers every ExpressionTrace this session
 * produces (lib/expression/capture.ts) so it can be downloaded and
 * deterministically replayed offline (scripts/expression-live-replay.mjs)
 * without repeating model extraction. A developer evaluation tool, never
 * production — same shape as isExpressionDebugOnlyEnabled, no committed-flag
 * path at all, so there is no way to turn this on for a real user by
 * accident.
 */
export function isLiveCaptureModeEnabled(): boolean {
  if (!isExpressionEngineV1Enabled()) return false;
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("capture") === "1";
}

/**
 * Dev-only, `?agent=1`-gated: attaches the board's `express_meaning` tool to
 * the local agent bridge (lib/expression/agentBridge.ts +
 * scripts/express-mcp-server.mjs), so an external agent — Claude Code, Codex,
 * any MCP client — can submit meaning into THIS open session.
 *
 * A local development connector, never production: the bridge talks to a
 * loopback port a developer started themselves, and the same three guards as
 * isLiveCaptureModeEnabled mean there is no committed-flag path that could
 * turn it on for a real user. `window.inpublic.tool(...)` works regardless —
 * this flag gates only the network bridge, not the tool itself.
 */
export function isAgentBridgeEnabled(): boolean {
  if (!isExpressionEngineV1Enabled()) return false;
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("agent") === "1";
}
