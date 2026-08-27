/**
 * Turns one declarative `VisualCommunicationIntent` into a real
 * `MeaningDelta` — the ONE place in this experimental layer that decides
 * what entities/relations to add. This is deliberately a separate model call
 * from Expression's own `extractMeaning`
 * (`lib/expression/meaning/extract.ts`): that prompt turns spoken text into
 * meaning with no notion of visual form, and touching it would put this
 * experiment on the production live-speech path. This prompt turns a
 * communication goal into meaning. Presentation form is intentionally not
 * included in this model call: it reaches Expression separately.
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

const SHAPING_SYSTEM_PREFIX = `You turn one communication goal into the meaning behind it, for a system that draws pictures from meaning and never from instructions about drawing.

You will be given a "goal" (what meaning needs to exist) and "existingEntities" (existing identities relevant to that goal — reuse their id and label exactly when the goal refers to them).

Extract:
"entities" — every distinct thing the goal needs, each with a short kebab-case "id" unique to this extraction, a "type" (person, group, place, object, concept, action, event, state, time, quantity), a "label" of 1-4 words, and "quantity":{"value":N,"unit":"..."} whenever the goal states or implies a number.
"relations" — every relation between two of this extraction's own entities, each with "type" (the vocabulary below), and "source"/"target" as this extraction's own local ids.
"interpretation" — one sentence, what this picture is showing.

Never think about position, coordinates, boxes, arrows-as-pixels, or Excalidraw. You are producing meaning, not a layout.
Use relation types only when they are semantically true. Never use prevents, contrasts_with, transforms_into, or located_at as layout-control tokens.
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
  const existing = existingEntityLabels(options.world, intent.scope?.entityIds);
  const user = JSON.stringify({
    goal: intent.goal,
    existingEntities: existing,
  });
  let raw = "";
  try {
    raw = await complete({
      model: SHAPING_MODEL,
      system: SHAPING_SYSTEM_PREFIX,
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
