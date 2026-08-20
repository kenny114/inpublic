/**
 * The expression planner: WorldState + ExpressionIntent -> ExpressionPlan.
 *
 * Decides what should EXIST visually, what should be connected, what should
 * dominate and what should be grouped — and still not where anything goes.
 * Deterministic; the model is three layers upstream by now and has no say
 * here.
 *
 * The planner is thin on purpose. Choosing regions and connections is the
 * grammar's job (lib/expression/grammars/index.ts); this module chooses the
 * grammar, walks the fallback chain when a grammar finds nothing to build,
 * and then adds the two things no single grammar can decide because they
 * depend on the round rather than the structure:
 *
 *  - EMPHASIS, which is about what just changed. A grammar sees a world; it
 *    cannot know that Mariam is the thing that arrived this second and so
 *    deserves to be the thing your eye lands on.
 *  - ANNOTATIONS, the claims that never became structure. They attach to a
 *    region as a note; they never become boxes, because a claim rendered as
 *    a box is a caption pretending to be a concept.
 */

import {
  ANNOTATION_BUDGET,
  GRAMMARS,
  GRAMMAR_FOR_INTENT,
  REGION_BUDGET,
  type GrammarResult,
} from "../grammars";
import {
  relationFamily,
  EMPTY_EXPRESSION_PLAN,
  ExpressionPlanSchema,
  type Emphasis,
  type ExpressionIntent,
  type ExpressionPlan,
  type GrammarId,
  type Region,
  type WorldState,
} from "../schemas";

export interface PlanOptions {
  /** Entities added by the round that produced this world — the basis for "look here now". */
  newEntityIds?: string[];
  /** Forces a grammar; used by repair (lib/expression/evaluate/repair.ts) and by the debug UI. */
  grammarOverride?: GrammarId;
}

/**
 * A grammar "found something" when it produced at least one region. A
 * grammar that returns nothing is not a failure — it is correctly reporting
 * that this world has no such structure, which is exactly when the fallback
 * chain should move on rather than force the shape.
 */
function firstUsable(
  world: WorldState,
  focusEntityId: string | undefined,
  chain: GrammarId[],
): { grammar: GrammarId; result: GrammarResult; skipped: GrammarId[] } | null {
  const skipped: GrammarId[] = [];
  for (const id of chain) {
    const result = GRAMMARS[id].build({ world, focusEntityId });
    if (result.regions.length) return { grammar: id, result, skipped };
    skipped.push(id);
  }
  return null;
}

/**
 * Emphasis is ranked, not boolean: weight 3 is "this is the point", 2 is
 * "this just arrived", 1 is "this is the subject". Capped at three entries
 * because a picture where everything is emphasised has no hierarchy at all
 * — which is precisely the failure the evaluator flags as `no_focus`.
 */
function buildEmphasis(regions: Region[], focusEntityId: string | undefined, newEntityIds: string[]): Emphasis[] {
  const emphasis: Emphasis[] = [];
  const seen = new Set<string>();
  const add = (region: Region | undefined, weight: number, reason: string) => {
    if (!region || seen.has(region.id) || emphasis.length >= 3) return;
    seen.add(region.id);
    emphasis.push({ regionId: region.id, weight, reason });
  };

  for (const id of newEntityIds) {
    add(regions.find((r) => r.entityId === id), 3, "newly introduced this round");
  }
  add(
    regions.find((r) => r.entityId === focusEntityId),
    2,
    "intent focus",
  );
  add(
    regions.find((r) => r.role === "primary_subject" || r.role === "hierarchy_root"),
    1,
    "structural subject",
  );
  return emphasis;
}

/**
 * Claims become annotation regions hanging off whatever they are about.
 * A claim about nothing shown is dropped rather than floated: an unattached
 * note is a sentence on a canvas, and the whole point is not to write
 * sentences on the canvas.
 */
function buildAnnotations(world: WorldState, regions: Region[]): Region[] {
  const shownEntityIds = new Set(regions.map((r) => r.entityId).filter(Boolean) as string[]);
  const out: Region[] = [];
  for (const claim of world.claims) {
    if (out.length >= ANNOTATION_BUDGET) break;
    const anchor = (claim.about ?? []).find((id) => shownEntityIds.has(id));
    if (!anchor) continue;
    out.push({ id: `a-${claim.id}`.slice(0, 48), role: "annotation", claimId: claim.id, entityId: anchor });
  }
  return out;
}

/**
 * Fill the display budget with what the speaker actually connected.
 *
 * The thing the utterance is ABOUT must be on the canvas, and so should
 * anything else related to what is already shown while there is room.
 *
 * Every grammar selects for its own structure, and a grammar that finds its
 * structure is entitled to ignore whatever does not participate in it — but
 * not when the thing it ignored is the subject. "Cheap software is not always
 * cheaper, because maintenance exceeds the purchase price" is a comparison
 * between maintenance and purchase price, so the comparison grammar drew
 * exactly those two and dropped the software the argument was about. The
 * picture compared two numbers and never said what for.
 *
 * Fixed here rather than in the comparison grammar because it is not a fact
 * about comparisons: any grammar can select a structure that excludes the
 * subject, and each one would need the same patch. The focus is re-attached
 * as context, with whatever real relations connect it to what is already
 * shown — never with an invented one, so a focus with no relation to the
 * structure appears beside it rather than being wired in falsely.
 */
function attachRelatedEntities(world: WorldState, intent: ExpressionIntent, result: GrammarResult): GrammarResult {
  const live = world.entities.filter((e) => e.status !== "superseded");
  const regions = [...result.regions];
  const connections = [...result.connections];
  const shown = new Set(regions.map((r) => r.entityId).filter(Boolean) as string[]);
  const attached: string[] = [];

  /** Every real relation between `id` and something already shown. Never an invented one. */
  const linksTo = (id: string) =>
    world.relations.filter((r) => (r.source === id && shown.has(r.target)) || (r.target === id && shown.has(r.source)));

  /** Starts a new component: the same attach, but without requiring a link to what is already shown. */
  const seedComponent = (id: string) => {
    if (shown.has(id) || regions.length >= REGION_BUDGET) return;
    shown.add(id);
    attached.push(id);
    regions.push({ id: `r-${id}`.slice(0, 48), role: "context", entityId: id });
  };

  const attach = (id: string, role: Region["role"]) => {
    if (shown.has(id) || regions.length >= REGION_BUDGET) return;
    const links = linksTo(id);
    // The focus earns its place even unlinked — it is what the utterance is
    // about. Anything else has to be connected to something on the canvas,
    // or it would land as a floating box asserting nothing.
    if (!links.length && id !== intent.focusEntityId) return;
    shown.add(id);
    attached.push(id);
    regions.push({ id: `r-${id}`.slice(0, 48), role, entityId: id });
    for (const relation of links.slice(0, 4)) {
      if (connections.some((c) => c.relationId === relation.id)) continue;
      connections.push({
        id: `c-${relation.id}`.slice(0, 48),
        fromRegionId: `r-${relation.source}`.slice(0, 48),
        toRegionId: `r-${relation.target}`.slice(0, 48),
        relationId: relation.id,
        kind: relationFamily(relation.type) === "causal" ? "flow" : "link",
        label: CONNECTION_LABEL[relation.type] ?? (relation.type === "role_of" ? relation.role : undefined),
      });
    }
  };

  // The focus first, then whatever else the speaker connected, most
  // important first, until the display budget is used up.
  if (intent.focusEntityId) attach(intent.focusEntityId, "primary_subject");

  const ranked = () =>
    live
      .filter((e) => e.importance !== "detail" && !shown.has(e.id))
      .sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance]);

  /**
   * Attaching has to run to a fixed point, and it has to be able to start a
   * new component.
   *
   * A single pass only reaches things already touching the canvas, so an
   * entire disconnected part of the world stays invisible however much room
   * is left. That is how "platform contains infra and tooling; product
   * contains web and mobile" drew the first tree and silently deleted the
   * second, and how the bird under the tree vanished from the story about
   * finding a bird under a tree — the sequence grammar showed the two steps
   * and nothing they happened to.
   *
   * So: keep attaching while anything still connects, and when nothing does
   * but budget remains, seed the most important thing still missing and let
   * its own neighbours follow on the next pass. A second root is content,
   * not clutter — the budget is what bounds it.
   */
  for (let pass = 0; pass < REGION_BUDGET && regions.length < REGION_BUDGET; pass += 1) {
    const before = attached.length;
    for (const entity of ranked()) attach(entity.id, "context");
    if (attached.length > before) continue;
    const seed = ranked()[0];
    if (!seed) break;
    seedComponent(seed.id);
  }

  if (!attached.length) return result;
  return {
    regions,
    connections,
    reason: `${result.reason}; attached ${attached.join(", ")}`,
  };
}

const IMPORTANCE_RANK: Record<string, number> = { primary: 0, supporting: 1, detail: 2 };

/** Relations whose sign cannot be seen in an arrangement — see the grammar library's connectionLabel. */
const CONNECTION_LABEL: Partial<Record<string, string>> = {
  prevents: "prevents",
  refutes: "refutes",
  greater_than: "more",
  less_than: "less",
};

export function planExpression(world: WorldState, intent: ExpressionIntent, opts: PlanOptions = {}): ExpressionPlan {
  const chain = opts.grammarOverride
    ? [opts.grammarOverride, ...GRAMMAR_FOR_INTENT[intent.primary].filter((g) => g !== opts.grammarOverride)]
    : GRAMMAR_FOR_INTENT[intent.primary];

  const chosen = firstUsable(world, intent.focusEntityId, chain);
  if (!chosen) {
    return { ...EMPTY_EXPRESSION_PLAN, intent: intent.primary, reason: `no grammar could express this world (tried ${chain.join(", ")})` };
  }

  const withFocus = attachRelatedEntities(world, intent, chosen.result);
  const annotations = buildAnnotations(world, withFocus.regions);
  const regions = [...withFocus.regions, ...annotations];
  const emphasis = buildEmphasis(regions, intent.focusEntityId, opts.newEntityIds ?? []);

  const plan: ExpressionPlan = {
    grammar: chosen.grammar,
    intent: intent.primary,
    focusEntityId: intent.focusEntityId,
    regions,
    // withFocus, not chosen.result: the attachment step adds the relations
    // that connect what it attached, and reading the grammar's original list
    // here put entities on the canvas with every one of their relations
    // silently dropped — visible as boxes that sit near each other saying
    // nothing, which is precisely the failure mode the brief calls out.
    connections: withFocus.connections,
    emphasis,
    reason:
      `${chosen.grammar}: ${withFocus.reason}` +
      (chosen.skipped.length ? ` (skipped ${chosen.skipped.join(", ")} — no such structure)` : ""),
  };

  // The schema is the contract, not a suggestion: a grammar that produced a
  // connection to a region it never created is a bug in that grammar, and
  // failing loudly here is far cheaper than debugging it from the canvas.
  const parsed = ExpressionPlanSchema.safeParse(plan);
  if (!parsed.success) {
    return {
      ...EMPTY_EXPRESSION_PLAN,
      intent: intent.primary,
      reason: `grammar ${chosen.grammar} produced an invalid plan: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    };
  }
  return parsed.data;
}
