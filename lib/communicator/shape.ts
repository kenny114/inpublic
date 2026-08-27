/**
 * Turns one declarative `VisualCommunicationIntent` into a real
 * `MeaningDelta` — the ONE place in this experimental layer that decides
 * what entities/relations to add. This is deliberately a separate model call
 * from Expression's own `extractMeaning`
 * (`lib/expression/meaning/extract.ts`): that prompt turns spoken text into
 * meaning with no notion of visual form, and touching it would put this
 * experiment on the production live-speech path. This prompt turns a
 * communication goal PLUS a requested form into meaning already biased
 * toward the relation vocabulary that makes the deterministic grammar/
 * composer (`lib/expression/grammars`, `lib/expression/compose`) choose the
 * matching picture — because intent classification and grammar selection
 * are entirely driven by relation TYPES already in the delta
 * (`lib/expression/intent/classify.ts`), never by an explicit hint field.
 *
 * Still produces only a `MeaningDelta` — the same shape Expression already
 * accepts through the existing `express` VisualAction
 * (`lib/expression/actions.ts`'s `ExpressVisualActionSchema`). No new
 * mutation path, no geometry, reuses the same sanitizer/validator Expression
 * uses on its own model output.
 */

import { complete, SCRIBE_MODEL, toOllamaFormat, type CompletionUsage } from "../llm";
import { extractJsonObject, sanitizeDelta } from "../expression/meaning/extract";
import { EMPTY_MEANING_DELTA, MeaningDeltaSchema, type MeaningDelta, type WorldState } from "../expression/schemas";
import type { VisualCommunicationIntent } from "./types";

export const SHAPING_MODEL = process.env.COMMUNICATOR_SHAPING_MODEL || SCRIBE_MODEL;

const FORM_GUIDANCE: Record<VisualCommunicationIntent["form"], string> = {
  spatial:
    "Use \"located_at\" relations between the entities involved, each carrying a \"spatial\" qualifier from: near, beside, above, below, behind, in_front_of, inside, on. These are the ONLY spatial words the layout engine understands — there is no \"far apart\"/\"isolated\"/\"separated\" value, so express distance by NOT adding a located_at relation between things that should read as apart, never by inventing a word outside this list.",
  process: "Use \"transforms_into\" relations forming one chain: the same subject shown at each state it passes through, oldest state first.",
  comparison: "Use \"contrasts_with\" (or greater_than/less_than for a directional difference) between the two things being set against each other. Give each side its own has_property dimensions so the columns are actually comparable.",
  magnitude: "Give the entities being compared a \"quantity\" (value/unit) and connect them with \"greater_than\"/\"less_than\" so the difference in size/rate/degree is explicit, not just implied.",
  causal: "Use \"causes\", \"enables\", \"depends_on\", or \"prevents\" relations forming a chain from driver to outcome.",
  tension: "Use a \"contrasts_with\" relation between the two things in tension, AND at least one \"prevents\" or \"refutes\" relation showing how pursuing one works against the other — a trade-off is a comparison with an argumentative edge, not a plain contrast.",
  existing: "Extract the stated meaning plainly, in whatever relation types actually fit — do not force a particular form.",
};

const SHAPING_SYSTEM_PREFIX = `You turn one communication goal into the meaning behind it, for a system that draws pictures from meaning and never from instructions about drawing.

You will be given a "goal" (what should become visible), a "form" (the kind of picture this idea deserves), optional "aboutEntityIds" (existing entities already in the world this goal refers to — reuse their id and label exactly, verbatim, as one of your entities so a downstream matcher recognises them as the same thing rather than duplicating them), and "existingEntities" (labels already on the canvas, for the same reason).

Extract:
"entities" — every distinct thing the goal needs, each with a short kebab-case "id" unique to this extraction, a "type" (person, group, place, object, concept, action, event, state, time, quantity), a "label" of 1-4 words, and "quantity":{"value":N,"unit":"..."} whenever the goal states or implies a number.
"relations" — every relation between two of this extraction's own entities, each with "type" (the vocabulary below), and "source"/"target" as this extraction's own local ids.
"interpretation" — one sentence, what this picture is showing.

Never think about position, coordinates, boxes, arrows-as-pixels, or Excalidraw. You are producing meaning, not a layout.
`;

export interface ShapeVisualIntentOptions {
  world: WorldState;
  onUsage?: (usage: CompletionUsage) => void;
}

function existingEntityLabels(world: WorldState, ids: string[] | undefined): { id: string; label: string }[] {
  if (!ids?.length) return [];
  return world.entities.filter((entity) => ids.includes(entity.id)).map((entity) => ({ id: entity.id, label: entity.label }));
}

export async function shapeVisualIntent(
  intent: VisualCommunicationIntent,
  options: ShapeVisualIntentOptions,
): Promise<MeaningDelta> {
  const existing = existingEntityLabels(options.world, intent.aboutEntityIds);
  const user = JSON.stringify({
    goal: intent.goal,
    form: intent.form,
    aboutEntityIds: intent.aboutEntityIds ?? [],
    existingEntities: existing,
  });
  let raw = "";
  try {
    raw = await complete({
      model: SHAPING_MODEL,
      system: `${SHAPING_SYSTEM_PREFIX}\nFor this "${intent.form}" form: ${FORM_GUIDANCE[intent.form]}`,
      user,
      maxTokens: 1200,
      temperature: 0,
      onUsage: options.onUsage,
      jsonSchema: toOllamaFormat(MeaningDeltaSchema),
    });
  } catch {
    return EMPTY_MEANING_DELTA;
  }
  const json = extractJsonObject(raw);
  return json ? sanitizeDelta(json) : EMPTY_MEANING_DELTA;
}
