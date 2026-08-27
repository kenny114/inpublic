/**
 * The pipeline: one input segment in, one visual expression out, with every
 * intermediate stage preserved.
 *
 * INPUT -> MEANING -> WORLD -> INTENT -> COMPOSITION -> CLEAN -> PRESENTATION ->
 * EXPRESSION -> SCENE -> RENDER -> EVALUATE -> REPAIR, and the world persists
 * across calls so the tenth sentence modifies what the first one built instead
 * of starting over.
 *
 * Two design decisions worth stating outright:
 *
 * 1. Every stage's output is returned, not just the final scene. When a
 *    picture is wrong the only question that matters is WHICH LAYER failed,
 *    and answering it from the canvas alone is impossible. `ExpressionTrace`
 *    is what the debug panel renders and what the corpus test asserts on.
 *
 * 2. A repair is kept only if it actually scored better. The repair layer
 *    is a heuristic acting on a heuristic; letting it apply unconditionally
 *    would mean an "improvement" could quietly make a picture worse, and
 *    nobody would find out. Scoring both and keeping the winner makes the
 *    whole repair stage safe to be wrong.
 *
 * The extractor is injected. The default calls a model; scripts and tests
 * pass a fixture, which is what lets the deterministic 90% of this engine
 * be asserted over a hundred cases with no network and no API key.
 */

import { applyCleanToPlan, constrainPatch, constrainScene } from "./clean/apply";
import { planClean, shouldPoliceVisual } from "./clean/plan";
import { snapshotBoard, type BoardSnapshot } from "./clean/snapshot";
import { applyCompositionToPlan, constrainCompositionScene } from "./composition/apply";
import { planComposition, shouldCompose } from "./composition/plan";
import { compose, isContinuation, type ComposeOptions } from "./compose/compose";
import { applyPresentationToClean, applyPresentationToPlan, constrainPresentationScene } from "./presentation/apply";
import { planPresentation } from "./presentation/plan";
import { worldForPresentation, type PresentationIntent } from "./presentation/intent";
import { evaluateScene } from "./evaluate/evaluate";
import { applyRepair, planRepair } from "./evaluate/repair";
import { classifyIntent } from "./intent/classify";
import { requestMeaningDelta } from "./meaning/client";
import type { MeaningExtractor } from "./meaning/extract";
import { planExpression } from "./planner/plan";
import { assignVisibility, type VisibilityTier } from "./planner/visibility";
import { diffScenes } from "./render/core";
import { applyDelta, applyResolvedDiscourseAct, describeWorldOp } from "./world/apply";
import {
  abstainIdentityJudge,
  recentlyTouchedEntityIds,
  resolveEntityIdentity,
  type IdentityContext,
  type IdentityDecision,
  type IdentityJudge,
  type IdentityResolution,
} from "./world/identity";
import { resolveTopicRecallWithJudge } from "./world/references";
import {
  abstainTargetJudge,
  applyTargetJudge,
  decideTarget,
  judgeInputFor,
  retrieveTargetCandidates,
  toReferenceCandidates,
  type TargetJudge,
} from "./world/resolveTarget";
import {
  EMPTY_REPAIR_PLAN,
  EMPTY_MEANING_DELTA,
  EMPTY_SCENE_PLAN,
  EMPTY_WORLD_STATE,
  type CleanPlan,
  type CompositionPlan,
  type PresentationLayout,
  type PresentationPlan,
  type EvaluationResult,
  type ExpressionIntent,
  type ExpressionPlan,
  type DiscourseActResolution,
  type GrammarId,
  type InputSegment,
  type MeaningDelta,
  type Provenance,
  type ReferenceResolution,
  type RenderPatch,
  type RepairPlan,
  type ScenePlan,
  type WorldOp,
  type WorldState,
} from "./schemas";
import type { MetricResolution, StanceResolution } from "./world/apply";
import {
  actionExpressionDelta,
  applyExactSemanticVisualAction,
  type SemanticVisualAction,
} from "./actions";
import {
  restoreWorldState,
  serializeWorldState,
  type PersistedExpressionState,
  type WorldStateRestoreResult,
} from "./persistence";

/**
 * A JSON-serializable snapshot of lib/expression/planner/visibility.ts's
 * VisibilityAssignment — its Map/Set collapsed to a plain object/array so it
 * survives a capture/replay round-trip. Recomputed here, independently, from
 * the same inputs planExpression already used (see below); this module never
 * reaches into the planner's internals and never changes what the planner
 * returns. Read-only observability, not a second opinion.
 */
export interface VisibilitySnapshot {
  tiers: Record<string, VisibilityTier>;
  focusId: string | undefined;
  persistIds: string[];
}

/** Everything the pipeline decided, in the order it decided it. */
export interface ExpressionTrace {
  input: InputSegment;
  delta: MeaningDelta;
  /** The world as it stood BEFORE this segment — the other half of every "what changed" question. */
  worldBefore: WorldState;
  world: WorldState;
  ops: WorldOp[];
  opsDescribed: string[];
  /** Ordinal/topic-recall mentions this segment made, whether or not they resolved — see lib/expression/world/references.ts. */
  referenceResolutions: ReferenceResolution[];
  /** "I agree" / "that's not right" claims this segment made, whether or not the target resolved. */
  stanceResolutions: StanceResolution[];
  /** Lifecycle transitions this segment performed ("let's set that aside", "actually, forget it"), whether or not the target resolved. */
  discourseActResolutions: DiscourseActResolution[];
  /** One entry per entity this segment attached quantitative meaning to — see lib/expression/world/apply.ts's mergeMetric. */
  metricResolutions: MetricResolution[];
  /** One entry per entity this segment mentioned — the full identity-resolution trail, empty when `enableIdentityLayer` is off. See lib/expression/world/identity.ts. */
  identityResolutions: IdentityResolution[];
  /** speakerId/timestamp/sourceSegmentIds attached to whatever this segment touched — see lib/expression/schemas.ts's ProvenanceSchema. Empty when the segment carried none. */
  provenance: Provenance | null;
  intent: ExpressionIntent;
  /** Caller-supplied visual preference; never part of semantic truth. */
  presentationIntent?: PresentationIntent;
  /** See VisibilitySnapshot — the visual horizon this round's plan was built against. */
  visibility: VisibilitySnapshot;
  /**
   * The board as the Clean Agent saw it BEFORE this thought was drawn —
   * compact, entity-keyed, no strokes. Empty on the first thought.
   */
  board: BoardSnapshot;
  /**
   * The single story of this thought: one primary, one spine. Null on the
   * fast path (reflex, and a weak anticipation) so a one-entity preview is
   * not delayed by a story pass it does not need. When present, Clean and
   * the renderer may only realise this set.
   */
  composition: CompositionPlan | null;
  /**
   * Occupancy and hierarchy decision. Null on the fast path (reflex, and
   * anticipation while the board is already within budget) so a preview
   * is not delayed by a police pass it does not need. When present, the
   * renderer is only allowed to execute a patch that obeys it.
   */
  clean: CleanPlan | null;
  /**
   * How the story should be shown: layout, emphasis, clarity drops. Null on
   * the fast path with Clean. When present, the composer realises `layout`
   * and the renderer realises the three-tier emphasis; neither may add
   * what `simplifications` dropped.
   */
  presentation: PresentationPlan | null;
  plan: ExpressionPlan;
  scene: ScenePlan;
  patch: RenderPatch;
  evaluation: EvaluationResult;
  repair: RepairPlan;
  /** Set when a repair was attempted; says whether it was kept and what it changed the score from. */
  repairOutcome?: { kept: boolean; before: number; after: number };
  /** False when the round produced no semantic change at all — filler, noise, a duplicate. */
  changed: boolean;
  /**
   * How this round's scene relates to the one before it.
   *
   * `patch` — the same grammar was in play, so the composer anchored this
   * scene onto the previous one and everything unchanged is at the same
   * coordinates it was (lib/expression/compose/compose.ts's
   * anchorToPrevious). The canvas extends rather than redraws.
   *
   * `full` — the first scene of a session, or the grammar changed. A grammar
   * change is a legitimate rebuild: the spatial logic itself is different, so
   * there is no slot an existing object could be said to keep. Nothing is
   * suppressed either way; this reports what happened, it does not decide it.
   */
  mode: "patch" | "full";
  /**
   * How long this round's two halves took, in wall-clock ms.
   *
   * The audit could not answer "extract time vs everything else" from a
   * session log, because only the aggregate settled→updated figure existed
   * and it starts at submit (docs/EXPRESSION-ENGINE-FULL-AUDIT.md §8,
   * unknown #1). Measured here rather than in the caller because the caller
   * cannot see inside `ingest` — the model call is the first thing it does.
   *
   * `extractMs` is absent on the agent path (`ingestDelta`), where meaning
   * arrived already structured and no model ran. Diagnostic only: nothing
   * downstream reads these.
   */
  timings: { extractMs?: number; deterministicMs: number };
  /**
   * Anthropic prompt-cache accounting for this round's extraction call.
   *
   * The extraction system prompt is ~4k fixed tokens re-sent every
   * utterance, so it is marked with one ephemeral cache breakpoint
   * (lib/expression/meaning/extract.ts). A healthy session reads
   * `cacheCreationInputTokens > 0` on the first turn and
   * `cacheReadInputTokens > 0` on every turn within the cache TTL.
   *
   * Absent on the agent path, where no model runs, and on any injected
   * extractor that does not report usage. Diagnostic only — as with
   * `timings`, nothing downstream reads it.
   */
  extractUsage?: { inputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number };
}

export type SemanticActionExecution =
  | { status: "applied"; trace: ExpressionTrace; reason: string }
  | { status: "noop"; reason: string; trace?: ExpressionTrace }
  | { status: "rejected"; code: string; reason: string };

export interface SessionOptions {
  /**
   * How text becomes meaning. Defaults to the client wrapper (a fetch to
   * app/api/express/route.ts) rather than to the extractor itself, so that
   * importing this module from a "use client" component cannot drag the
   * provider SDK into the browser bundle. Server-side callers inject
   * `extractMeaning` directly; tests and replays inject a fixture.
   */
  extract?: MeaningExtractor;
  /** How many prior segments the extractor sees for pronoun resolution. */
  contextWindow?: number;
  /**
   * Off by default. When on, every mentioned entity is resolved through
   * lib/expression/world/identity.ts's two-stage identity layer BEFORE
   * apply.ts ever creates or merges it, instead of apply.ts's own plain
   * resolveMention. Off preserves byte-identical behaviour for every
   * existing fixture and test — see identity.ts's own docstring for why
   * this defaults to opt-in rather than replacing resolveMention outright.
   */
  enableIdentityLayer?: boolean;
  /**
   * Stage 2 of the identity layer — only consulted when deterministic
   * retrieval cannot decide on its own, and only when `enableIdentityLayer`
   * is on. Defaults to abstaining (never merges, never calls a model) so
   * turning the layer on without also injecting a real judge still costs
   * nothing and never guesses wrong; pass identityJudge.ts's
   * `defaultIdentityJudge` for the real model-backed judgment.
   */
  identityJudge?: IdentityJudge;
  /**
   * Optional constrained judge for remaining reference / discourse-act ties
   * the deterministic target-resolution substrate cannot break. Defaults to
   * abstaining (never attaches, never calls a model). Same isolation rule as
   * identityJudge: the real model lives in targetJudge.ts so this module
   * stays browser-safe.
   */
  targetJudge?: TargetJudge;
}

interface FoldOptions {
  extractMs?: number;
  extractUsage?: ExpressionTrace["extractUsage"];
  contextless?: boolean;
  skipContext?: boolean;
  presentationIntent?: PresentationIntent;
  /** Re-render current truth without applying a MeaningDelta or advancing WorldState. */
  presentationOnly?: boolean;
}

const DEFAULT_CONTEXT_WINDOW = 6;

/**
 * One conversation. Holds the world, the last scene (so every render is a
 * patch rather than a redraw), and the rolling raw-text window.
 *
 * Source-agnostic by construction: `ingest` takes an InputSegment, and a
 * typed sentence, a settled speech thought and an AI agent's submission
 * differ only in that segment's `source` field. Nothing below this method
 * ever asks where the meaning came from.
 */
export class ExpressionSession {
  private folding = false;
  private world: WorldState = EMPTY_WORLD_STATE;
  private lastScene: ScenePlan | null = null;
  private lastFocusId: string | undefined;
  /** The grammar lastScene was composed under — see compose.ts's isContinuation. */
  private lastGrammar: GrammarId | null = null;
  /** The story last settled thought chose — continuity for the Composition Agent. */
  private lastComposition: CompositionPlan | null = null;
  private lastPresentationLayout: PresentationLayout | null = null;
  private context: string[] = [];
  private readonly extract: MeaningExtractor;
  private readonly contextWindow: number;
  private readonly enableIdentityLayer: boolean;
  private readonly identityJudge: IdentityJudge;
  private readonly targetJudge: TargetJudge;

  constructor(options: SessionOptions = {}) {
    this.extract = options.extract ?? ((text, recent, onUsage) => requestMeaningDelta(text, recent, undefined, onUsage));
    this.contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    this.enableIdentityLayer = options.enableIdentityLayer ?? false;
    this.identityJudge = options.identityJudge ?? abstainIdentityJudge;
    this.targetJudge = options.targetJudge ?? abstainTargetJudge;
  }

  getWorld(): WorldState {
    return this.world;
  }

  getScene(): ScenePlan {
    return this.lastScene ?? EMPTY_SCENE_PLAN;
  }

  /** A validated, cloned persistence snapshot — never the mutable runtime object. */
  snapshotState(): PersistedExpressionState {
    return serializeWorldState(this.world);
  }

  /**
   * Restore durable semantic memory and deliberately discard transient render,
   * extraction-context, and in-flight caches. Safe fallback is an empty world.
   */
  restoreState(input: unknown): WorldStateRestoreResult {
    const restored = restoreWorldState(input);
    this.reset();
    this.world = restored.world;
    return restored;
  }

  reset(): void {
    this.world = EMPTY_WORLD_STATE;
    this.lastScene = null;
    this.lastFocusId = undefined;
    this.lastGrammar = null;
    this.lastComposition = null;
    this.lastPresentationLayout = null;
    this.context = [];
  }

  async ingest(segment: InputSegment): Promise<ExpressionTrace> {
    const startedAt = Date.now();
    let extractUsage: ExpressionTrace["extractUsage"];
    const delta = await this.extract(segment.text, [...this.context], (usage) => {
      extractUsage = {
        inputTokens: usage.inputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
        cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
      };
    });
    return this.ingestDelta(segment, delta, { extractMs: Date.now() - startedAt, extractUsage });
  }

  /**
   * Feeds meaning in directly, skipping extraction.
   *
   * This is the AI-agent input path: an agent already knows what it means
   * and should not have to render that back into English so a model can
   * parse it out again. It is also what the corpus test drives, which is
   * the same thing from a different direction — a fixture is just meaning
   * that arrived without a model.
   */
  async ingestDelta(
    segment: InputSegment,
    delta: MeaningDelta,
    /**
     * `extractMs`/`extractUsage` are set by `ingest` so the trace can report
     * what the model call cost; both are absent on the agent path.
     *
     * `contextless` is for the reflex path (lib/expression/fast/reflex.ts):
     * its segments are PARTIAL — "I", then "I was", then "I was a" — and
     * feeding those to the extractor's context window would hand the model
     * three broken copies of a sentence it is about to receive whole. The
     * fold still happens; only the memory of the words is skipped.
     */
    upstreamTimings?: FoldOptions,
  ): Promise<ExpressionTrace> {
    const deterministicStartedAt = Date.now();
    this.folding = true;
    try {
      return await this.foldDelta(segment, delta, upstreamTimings);
    } finally {
      this.folding = false;
    }
  }

  /**
   * Apply one already-validated semantic VisualAction. Creation/general
   * expression reuses MeaningDelta; exact-id mutations update WorldState and
   * then run the ordinary deterministic expression stages against that world.
   */
  async executeSemanticAction(
    segment: InputSegment,
    action: SemanticVisualAction,
  ): Promise<SemanticActionExecution> {
    if (action.type === "express") {
      const trace = await this.ingestDelta(segment, action.meaning, {
        skipContext: true,
        presentationIntent: action.presentation,
      });
      return trace.changed
        ? { status: "applied", trace, reason: "expressed structured meaning" }
        : { status: "noop", trace, reason: "structured meaning produced no semantic change" };
    }

    const worldBefore = this.world;
    const mutation = applyExactSemanticVisualAction(worldBefore, action, segment.seq);
    if (mutation.status !== "applied") return mutation;

    this.folding = true;
    this.world = mutation.world;
    try {
      const rendered = await this.foldDelta(
        segment,
        actionExpressionDelta(mutation.world),
        { skipContext: true },
      );
      const trace: ExpressionTrace = {
        ...rendered,
        worldBefore,
        ops: mutation.ops,
        opsDescribed: mutation.ops.map(describeWorldOp),
        changed: true,
      };
      return { status: "applied", trace, reason: mutation.reason };
    } catch (error) {
      this.world = worldBefore;
      throw error;
    } finally {
      this.folding = false;
    }
  }

  /** Pure expression operation: new ScenePlan, byte-identical WorldState. */
  async recomposeExpression(
    segment: InputSegment,
    presentation: PresentationIntent,
  ): Promise<SemanticActionExecution> {
    this.folding = true;
    try {
      const trace = await this.foldDelta(segment, EMPTY_MEANING_DELTA, {
        skipContext: true,
        presentationIntent: presentation,
        presentationOnly: true,
      });
      const visualChanged =
        trace.patch.added.length + trace.patch.moved.length + trace.patch.updated.length + trace.patch.removed.length +
          trace.patch.connectorsAdded.length + trace.patch.connectorsRemoved.length + trace.patch.connectorsRerouted.length >
        0;
      return visualChanged
        ? { status: "applied", trace, reason: `recomposed expression as ${presentation.form ?? "existing"}` }
        : { status: "noop", trace, reason: `presentation ${presentation.form ?? "existing"} produced the current scene` };
    } finally {
      this.folding = false;
    }
  }

  /**
   * True from the moment a fold reads the world to the moment it writes the
   * world back.
   *
   * The fold is a read-modify-write over `this.world` with awaits in the
   * middle (the identity and target judges, when a caller supplies them), so
   * a second fold starting inside that window would be building on a world
   * the first one is about to overwrite. The live controller serialises the
   * slow path already; this exists for the reflex path, which deliberately
   * does NOT wait for a slow run — it only has to avoid the fold itself, not
   * the extraction that precedes it. See lib/expression/live.ts's `reflex`.
   */
  isFolding(): boolean {
    return this.folding;
  }

  private async foldDelta(
    segment: InputSegment,
    delta: MeaningDelta,
    upstreamTimings?: FoldOptions,
  ): Promise<ExpressionTrace> {
    const deterministicStartedAt = Date.now();
    if (!upstreamTimings?.contextless && !upstreamTimings?.skipContext) {
      this.context = [...this.context, segment.text].slice(-this.contextWindow);
    }

    // Provenance rides alongside the text as segment metadata, never
    // something the extractor infers — a speech/agent adapter already knows
    // who is speaking and when, the same way it already knows `source`.
    // Absent entirely (not an empty object) when the segment carried neither
    // a speakerId nor a timestamp, so a caller that never supplies either
    // gets exactly the old behaviour: no provenance recorded anywhere.
    const provenance: Provenance | null =
      segment.speakerId !== undefined || segment.timestamp !== undefined
        ? { speakerId: segment.speakerId, timestamp: segment.timestamp, sourceSegmentIds: [segment.id] }
        : null;

    const worldBefore = this.world;

    const { identityDecisions, identityResolutions } = !upstreamTimings?.presentationOnly && this.enableIdentityLayer
      ? await this.resolveIdentities(delta, provenance)
      : { identityDecisions: undefined, identityResolutions: [] as IdentityResolution[] };

    const precomputedRefs = upstreamTimings?.presentationOnly ? new Map() : await this.precomputeReferences(delta);

    let { world, ops, idMap, referenceResolutions, stanceResolutions, discourseActResolutions, metricResolutions } =
      upstreamTimings?.presentationOnly
        ? {
            world: this.world,
            ops: [],
            idMap: new Map<string, string>(),
            referenceResolutions: [],
            stanceResolutions: [],
            discourseActResolutions: [],
            metricResolutions: [],
          }
        : applyDelta(
            this.world,
            delta,
            segment.seq,
            provenance ?? undefined,
            identityDecisions,
            precomputedRefs,
          );

    if (!upstreamTimings?.presentationOnly) {
      const judged = await this.judgePendingDiscourseActs(
        world,
        delta,
        discourseActResolutions,
        ops,
        segment.seq,
        provenance ?? undefined,
      );
      world = judged.world;
      ops = judged.ops;
      discourseActResolutions = judged.discourseActResolutions;
    }

    this.world = world;
    for (const resolution of identityResolutions) resolution.resultingEntityId = idMap.get(resolution.localId) ?? null;

    const newEntityIds = ops.filter((op) => op.kind === "ADD_ENTITY").map((op) => op.entity.id);
    const previousVisibleIds = (this.lastScene?.objects ?? []).map((o) => o.entityId).filter((id): id is string => Boolean(id));
    const intent = classifyIntent(world, delta);
    // Mirrors exactly the VisibilityOptions planExpression builds internally
    // (lib/expression/planner/plan.ts) — same inputs, so this is the same
    // assignment the plan below was actually produced against, not a
    // reconstruction. assignVisibility is pure and already exported; nothing
    // about tiering/ranking is touched by computing it a second time here.
    const vis = assignVisibility(world, { newEntityIds, previousVisibleIds, previousFocusId: this.lastFocusId, focusHint: intent.focusEntityId, nowMs: segment.timestamp });
    const visibility: VisibilitySnapshot = {
      tiers: Object.fromEntries(vis.tier),
      focusId: vis.focusId,
      persistIds: [...vis.persistIds],
    };

    const board = snapshotBoard(this.lastScene, this.lastFocusId);
    const composeStory = Boolean(upstreamTimings?.presentationIntent) || shouldCompose({
      contextless: upstreamTimings?.contextless,
      segmentId: segment.id,
      snapshot: board,
      delta,
    });
    const police =
      composeStory ||
      shouldPoliceVisual({
        contextless: upstreamTimings?.contextless,
        segmentId: segment.id,
        snapshot: board,
      });
    const hasExplicitScope = Boolean(upstreamTimings?.presentationIntent?.scope);
    const composition = composeStory && !hasExplicitScope
      ? planComposition({
          snapshot: board,
          delta,
          world,
          idMap,
          newEntityIds,
          previousFocusId: this.lastFocusId,
          previousComposition: this.lastComposition,
          focusHint: intent.focusEntityId,
        })
      : null;
    const cleanRaw = police && !hasExplicitScope
      ? planClean({
          snapshot: board,
          delta,
          world,
          idMap,
          newEntityIds,
          previousFocusId: composition?.primaryId ?? this.lastFocusId,
          focusHint: intent.focusEntityId,
          composition,
        })
      : null;
    const presentation = upstreamTimings?.presentationIntent
      ? planPresentation({
          snapshot: board,
          world,
          intent,
          composition,
          clean: cleanRaw,
          request: upstreamTimings.presentationIntent,
        })
      : police && cleanRaw
        ? planPresentation({
            snapshot: board,
            world,
            intent,
            composition,
            clean: cleanRaw,
          })
        : null;
    const clean = presentation && cleanRaw ? applyPresentationToClean(cleanRaw, presentation) : cleanRaw;
    const planOpts = {
      newEntityIds,
      previousVisibleIds: clean ? clean.keep : previousVisibleIds,
      previousFocusId: clean?.primaryId ?? composition?.primaryId ?? this.lastFocusId,
      nowMs: segment.timestamp,
      ...(clean ? { cleanPlan: clean } : {}),
      presentationIntent: upstreamTimings?.presentationIntent,
    };

    const requestedPrimaryId =
      upstreamTimings?.presentationIntent?.emphasis?.primaryEntityIds?.[0] ??
      upstreamTimings?.presentationIntent?.scope?.entityIds[0];
    let plan = planExpression(world, intent, planOpts);
    if (clean) plan = applyCleanToPlan(plan, clean, world);
    if (composition) plan = applyCompositionToPlan(plan, composition, world, { preserveGrammar: Boolean(upstreamTimings?.presentationIntent) });
    if (presentation) plan = applyPresentationToPlan(plan, presentation, requestedPrimaryId ?? clean?.primaryId ?? composition?.primaryId);
    // The scene on the canvas is an input to composing the next one — for
    // continuity only (see anchorToPrevious). It never changes what is drawn.
    const continuity: ComposeOptions = {
      previous: this.lastScene,
      previousGrammar: this.lastGrammar,
      previousLayout: this.lastPresentationLayout,
      presentation,
      presentationIntent: upstreamTimings?.presentationIntent,
      primaryId: requestedPrimaryId ?? clean?.primaryId ?? composition?.primaryId,
      spineIds: composition ? [...new Set(composition.spine.flatMap((e) => [e.from, e.to]))] : undefined,
      demote: clean?.demote,
    };
    let scene = compose(world, plan, continuity);
    if (clean) scene = constrainScene(scene, clean);
    if (composition) scene = constrainCompositionScene(scene, composition);
    if (presentation) {
      scene = constrainPresentationScene(scene, presentation, {
        primaryId: requestedPrimaryId ?? clean?.primaryId ?? composition?.primaryId,
        composition,
        demote: clean?.demote,
      });
    }
    let mode: ExpressionTrace["mode"] = isContinuation(plan, continuity) ? "patch" : "full";
    const evaluationWorld = worldForPresentation(world, upstreamTimings?.presentationIntent);
    let evaluation = evaluateScene(evaluationWorld, scene);
    let repair: RepairPlan = EMPTY_REPAIR_PLAN;
    let repairOutcome: ExpressionTrace["repairOutcome"];

    if (evaluation.repairRequired) {
      repair = planRepair(evaluation, plan, evaluationWorld);
      if (repair.steps.length) {
        const { plan: adjusted, grammarOverride } = applyRepair(plan, repair, evaluationWorld);
        let repairedPlan = grammarOverride
          ? planExpression(world, intent, { ...planOpts, grammarOverride })
          : adjusted;
        if (clean) repairedPlan = applyCleanToPlan(repairedPlan, clean, world);
        if (composition) repairedPlan = applyCompositionToPlan(repairedPlan, composition, world, { preserveGrammar: Boolean(upstreamTimings?.presentationIntent) });
        if (presentation) repairedPlan = applyPresentationToPlan(repairedPlan, presentation, requestedPrimaryId ?? clean?.primaryId ?? composition?.primaryId);
        let repairedScene = compose(world, repairedPlan, continuity);
        if (clean) repairedScene = constrainScene(repairedScene, clean);
        if (composition) repairedScene = constrainCompositionScene(repairedScene, composition);
        if (presentation) {
          repairedScene = constrainPresentationScene(repairedScene, presentation, {
            primaryId: requestedPrimaryId ?? clean?.primaryId ?? composition?.primaryId,
            composition,
            demote: clean?.demote,
          });
        }
        const repairedEvaluation = evaluateScene(evaluationWorld, repairedScene);

        const improved = repairedEvaluation.semanticPreservation > evaluation.semanticPreservation ||
          (repairedEvaluation.semanticPreservation === evaluation.semanticPreservation &&
            problemCost(repairedEvaluation) < problemCost(evaluation));

        repairOutcome = {
          kept: improved,
          before: evaluation.semanticPreservation,
          after: repairedEvaluation.semanticPreservation,
        };
        if (improved) {
          plan = repairedPlan;
          scene = repairedScene;
          evaluation = repairedEvaluation;
          // A repair may have changed the grammar, which is exactly the case
          // that is not a continuation.
          mode = isContinuation(plan, continuity) ? "patch" : "full";
        }
      }
    }

    let patch = diffScenes(this.lastScene, scene);
    if (clean) patch = constrainPatch(patch, clean, this.lastScene);
    this.lastScene = scene;
    this.lastFocusId = requestedPrimaryId ?? clean?.primaryId ?? composition?.primaryId ?? plan.focusEntityId;
    this.lastGrammar = plan.grammar;
    if (composition) this.lastComposition = composition;
    if (presentation) this.lastPresentationLayout = presentation.layout;

    return {
      input: segment,
      delta,
      worldBefore,
      world,
      ops,
      opsDescribed: ops.map(describeWorldOp),
      referenceResolutions,
      stanceResolutions,
      discourseActResolutions,
      metricResolutions,
      identityResolutions,
      provenance,
      intent,
      presentationIntent: upstreamTimings?.presentationIntent,
      visibility,
      board,
      composition,
      clean,
      presentation,
      plan,
      scene,
      patch,
      evaluation,
      repair,
      repairOutcome,
      mode,
      changed: ops.length > 0,
      timings: {
        ...(upstreamTimings?.extractMs !== undefined ? { extractMs: upstreamTimings.extractMs } : {}),
        deterministicMs: Date.now() - deterministicStartedAt,
      },
      ...(upstreamTimings?.extractUsage ? { extractUsage: upstreamTimings.extractUsage } : {}),
    };
  }

  /**
   * The identity layer's pre-pass: one resolveEntityIdentity call per
   * mentioned entity, run against `this.world` as it stood before this
   * segment — exactly the same world apply.ts's own entities loop will see,
   * so the decision made here is the decision apply.ts acts on, not a
   * stale guess. Entities carrying a `referenceMention` are skipped
   * entirely: "the second one" / "go back to X" already resolve through a
   * completely different mechanism (lib/expression/world/references.ts),
   * and running identity retrieval against a placeholder label like "the
   * second one" would only manufacture noise.
   *
   * `neighborhoodIds` accumulates as entities in THIS delta resolve, in
   * order, so later entities in the same utterance can use earlier ones as
   * relation-neighborhood evidence — the "discourse context" signal.
   */
  private async resolveIdentities(
    delta: MeaningDelta,
    provenance: Provenance | null,
  ): Promise<{ identityDecisions: Map<string, IdentityDecision>; identityResolutions: IdentityResolution[] }> {
    const identityDecisions = new Map<string, IdentityDecision>();
    const identityResolutions: IdentityResolution[] = [];
    const refIds = new Set((delta.referenceMentions ?? []).map((m) => m.entityId));
    const recentEntityIds = recentlyTouchedEntityIds(this.world, this.contextWindow);
    const neighborhoodIds: string[] = [];

    for (const local of delta.entities) {
      if (refIds.has(local.id)) continue;
      const ctx: IdentityContext = { neighborhoodIds: [...neighborhoodIds], recentEntityIds, speakerId: provenance?.speakerId };
      const decision = await resolveEntityIdentity(this.world, local, ctx, this.identityJudge);
      identityDecisions.set(local.id, decision);
      if (decision.action === "merge" && decision.targetId) neighborhoodIds.push(decision.targetId);

      identityResolutions.push({
        localId: local.id,
        mentionLabel: local.label,
        mentionType: local.type,
        candidateCount: decision.candidates.length,
        rejectedCount: decision.rejectedCount,
        topCandidateId: decision.candidates[0]?.id,
        topCandidateStatus: decision.candidates[0]?.status,
        topScore: decision.candidates[0]?.score,
        usedJudge: decision.usedJudge,
        judgeVerdict: decision.judgeVerdict,
        action: decision.action,
        reactivate: decision.reactivate,
        resultingEntityId: null, // filled in by the caller once applyDelta's idMap exists
        reason: decision.reason,
      });
    }
    return { identityDecisions, identityResolutions };
  }

  /**
   * Topic-recall mentions resolve against the world as it stood before this
   * segment. When a real target judge is configured, run it here (async)
   * and hand applyDelta the answer so apply itself can stay synchronous.
   * Ordinal mentions are left to applyDelta — they are a different search.
   */
  private async precomputeReferences(delta: MeaningDelta): Promise<Map<string, ReferenceResolution> | undefined> {
    if (this.targetJudge === abstainTargetJudge) return undefined;
    const mentions = (delta.referenceMentions ?? []).filter((m) => m.kind === "topic_recall");
    if (!mentions.length) return undefined;
    const out = new Map<string, ReferenceResolution>();
    for (const mention of mentions) {
      out.set(mention.entityId, await resolveTopicRecallWithJudge(this.world, mention, this.targetJudge));
    }
    return out;
  }

  /**
   * Discourse acts run AFTER this segment's entities exist, so they cannot
   * be precomputed against world-before. applyDelta abstains on a
   * deterministic tie; this post-pass asks the judge, by index, and applies
   * only a `resolved` pick. Uncertain stays UNAPPLIED.
   */
  private async judgePendingDiscourseActs(
    world: WorldState,
    delta: MeaningDelta,
    resolutions: DiscourseActResolution[],
    ops: WorldOp[],
    seq: number,
    provenance: Provenance | undefined,
  ): Promise<{ world: WorldState; ops: WorldOp[]; discourseActResolutions: DiscourseActResolution[] }> {
    if (this.targetJudge === abstainTargetJudge) return { world, ops, discourseActResolutions: resolutions };
    let nextWorld = world;
    const nextOps = [...ops];
    const nextResolutions = [...resolutions];
    for (let i = 0; i < nextResolutions.length; i += 1) {
      const current = nextResolutions[i];
      const act = delta.discourseActs?.[i];
      if (!act || act.type === "invalidate" || current.applied || !current.candidates.length) continue;
      const decision = decideTarget(
        retrieveTargetCandidates(nextWorld, act.targetSurface, { actType: act.type }),
        act.targetSurface,
        { actType: act.type },
      );
      if (!decision.needsJudge) continue;
      const judged = applyTargetJudge(
        decision,
        await this.targetJudge(judgeInputFor(act.targetSurface, act.targetSurface, "discourse_act", decision, { actType: act.type })),
      );
      if (!judged.chosenId) {
        nextResolutions[i] = {
          ...current,
          candidates: toReferenceCandidates(judged.candidates),
          reason: judged.reason,
        };
        continue;
      }
      const applied = applyResolvedDiscourseAct(
        nextWorld,
        { type: act.type, targetSurface: act.targetSurface },
        judged.chosenId,
        seq,
        provenance,
        toReferenceCandidates(judged.candidates),
        judged.reason,
      );
      if (!applied) continue;
      nextWorld = applied.world;
      nextOps.push(applied.op);
      nextResolutions[i] = applied.resolution;
    }
    return { world: nextWorld, ops: nextOps, discourseActResolutions: nextResolutions };
  }
}

function problemCost(evaluation: EvaluationResult): number {
  return evaluation.problems.reduce((sum, problem) => sum + problem.severity, 0);
}

/** Splits a paragraph into sentence-sized segments — the text-first input adapter. */
export function segmentText(text: string, source: InputSegment["source"] = "human_text", startSeq = 0): InputSegment[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `seg-${startSeq + index}`,
      source,
      text: line.slice(0, 4000),
      seq: startSeq + index,
    }));
}
