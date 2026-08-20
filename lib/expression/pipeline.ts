/**
 * The pipeline: one input segment in, one visual expression out, with every
 * intermediate stage preserved.
 *
 * INPUT -> MEANING -> WORLD -> INTENT -> EXPRESSION -> SCENE -> RENDER ->
 * EVALUATE -> REPAIR, and the world persists across calls so the tenth
 * sentence modifies what the first one built instead of starting over.
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

import { compose } from "./compose/compose";
import { evaluateScene } from "./evaluate/evaluate";
import { applyRepair, planRepair } from "./evaluate/repair";
import { classifyIntent } from "./intent/classify";
import { requestMeaningDelta } from "./meaning/client";
import type { MeaningExtractor } from "./meaning/extract";
import { planExpression } from "./planner/plan";
import { diffScenes } from "./render/core";
import { applyDelta, describeWorldOp } from "./world/apply";
import {
  EMPTY_REPAIR_PLAN,
  EMPTY_SCENE_PLAN,
  EMPTY_WORLD_STATE,
  type EvaluationResult,
  type ExpressionIntent,
  type ExpressionPlan,
  type InputSegment,
  type MeaningDelta,
  type RenderPatch,
  type RepairPlan,
  type ScenePlan,
  type WorldOp,
  type WorldState,
} from "./schemas";

/** Everything the pipeline decided, in the order it decided it. */
export interface ExpressionTrace {
  input: InputSegment;
  delta: MeaningDelta;
  /** The world as it stood BEFORE this segment — the other half of every "what changed" question. */
  worldBefore: WorldState;
  world: WorldState;
  ops: WorldOp[];
  opsDescribed: string[];
  intent: ExpressionIntent;
  plan: ExpressionPlan;
  scene: ScenePlan;
  patch: RenderPatch;
  evaluation: EvaluationResult;
  repair: RepairPlan;
  /** Set when a repair was attempted; says whether it was kept and what it changed the score from. */
  repairOutcome?: { kept: boolean; before: number; after: number };
  /** False when the round produced no semantic change at all — filler, noise, a duplicate. */
  changed: boolean;
}

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
  private world: WorldState = EMPTY_WORLD_STATE;
  private lastScene: ScenePlan | null = null;
  private context: string[] = [];
  private readonly extract: MeaningExtractor;
  private readonly contextWindow: number;

  constructor(options: SessionOptions = {}) {
    this.extract = options.extract ?? ((text, recent) => requestMeaningDelta(text, recent));
    this.contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  }

  getWorld(): WorldState {
    return this.world;
  }

  getScene(): ScenePlan {
    return this.lastScene ?? EMPTY_SCENE_PLAN;
  }

  reset(): void {
    this.world = EMPTY_WORLD_STATE;
    this.lastScene = null;
    this.context = [];
  }

  async ingest(segment: InputSegment): Promise<ExpressionTrace> {
    const delta = await this.extract(segment.text, [...this.context]);
    return this.ingestDelta(segment, delta);
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
  async ingestDelta(segment: InputSegment, delta: MeaningDelta): Promise<ExpressionTrace> {
    this.context = [...this.context, segment.text].slice(-this.contextWindow);

    const worldBefore = this.world;
    const { world, ops } = applyDelta(this.world, delta, segment.seq);
    this.world = world;

    const newEntityIds = ops.filter((op) => op.kind === "ADD_ENTITY").map((op) => op.entity.id);
    const intent = classifyIntent(world, delta);
    let plan = planExpression(world, intent, { newEntityIds });
    let scene = compose(world, plan);
    let evaluation = evaluateScene(world, scene);
    let repair: RepairPlan = EMPTY_REPAIR_PLAN;
    let repairOutcome: ExpressionTrace["repairOutcome"];

    if (evaluation.repairRequired) {
      repair = planRepair(evaluation, plan, world);
      if (repair.steps.length) {
        const { plan: adjusted, grammarOverride } = applyRepair(plan, repair, world);
        const repairedPlan = grammarOverride
          ? planExpression(world, intent, { newEntityIds, grammarOverride })
          : adjusted;
        const repairedScene = compose(world, repairedPlan);
        const repairedEvaluation = evaluateScene(world, repairedScene);

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
        }
      }
    }

    const patch = diffScenes(this.lastScene, scene);
    this.lastScene = scene;

    return {
      input: segment,
      delta,
      worldBefore,
      world,
      ops,
      opsDescribed: ops.map(describeWorldOp),
      intent,
      plan,
      scene,
      patch,
      evaluation,
      repair,
      repairOutcome,
      changed: ops.length > 0,
    };
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
