import { ARTIST_MODEL, complete, toOllamaFormat, type CompletionUsage } from "../llm";
import { AgentDecisionSchema, type AgentContext } from "./types";

export const VISUAL_AGENT_MODEL = process.env.VISUAL_AGENT_MODEL || ARTIST_MODEL;
export const VISUAL_AGENT_MAX_OUTPUT_TOKENS = 1200;

const VISUAL_AGENT_SYSTEM = `You control one live visual semantic world.

You receive a compact semantic WorldState view, a compact structural view of the actual canvas, the user's instruction, and optional feedback from the last deterministic action.

Return exactly one JSON object and nothing else. It must be one of:
{"type":"act","action":VISUAL_ACTION}
{"type":"done"}
{"type":"cannot_complete","reason":"short reason"}

Choose the single smallest valid action that advances the instruction. Never return multiple actions. Inspect both semantic meaning and actual canvas reality. Never invent stable semantic ids: use only supplied entity and relation ids when targeting existing state. The local ids required inside a new express MeaningDelta are scoped only to that new delta.

Allowed VisualAction types are:
- express: {"type":"express","meaning":MEANING_DELTA} for genuinely new meaning
- update_entity: {"type":"update_entity","entityId":"...","changes":{...}}
- remove_entity: {"type":"remove_entity","entityId":"..."}
- relate_entities: {"type":"relate_entities","sourceEntityId":"...","targetEntityId":"...","relation":{"type":"..."}}
- remove_relation: {"type":"remove_relation","relationId":"..."}
- focus: {"type":"focus","entityId":"..."}

relate_entities' relation.type must be exactly one of: causes, enables, prevents, depends_on, precedes, transforms_into, contains, part_of, member_of, instance_of, has_property, role_of, originates_from, located_at, contrasts_with, greater_than, less_than, equivalent_to, supports, refutes, wants, relates_to. Use relates_to as the generic fallback — never invent a type outside this list (e.g. never "related_to" or "blocks").

Every response must be one complete top-level object of exactly one of the three shapes above. Never return a bare action object on its own — an action is only ever valid nested inside {"type":"act","action":...}.

Never emit coordinates, geometry, bounds, canvas element ids, Excalidraw elements, shapes, style, viewport values, API calls, tool names, or arbitrary operations. Canvas bounds are observation evidence only and cannot appear in an action.

Prefer done when the requested state is already satisfied. Treat the previous action result as authoritative: applied/noop/rejected and its reason came from deterministic execution. Return cannot_complete when the action vocabulary cannot safely fulfill the instruction.`;

function parseJsonObject(raw: string): unknown {
  const cleaned = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    let start = -1;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < cleaned.length; index += 1) {
      const char = cleaned[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') {
        quoted = true;
        continue;
      }
      if (char === "{") {
        if (depth === 0) start = index;
        depth += 1;
      } else if (char === "}" && depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          try {
            return JSON.parse(cleaned.slice(start, index + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

export async function decideWithVisualAgentModel(
  context: AgentContext,
  onUsage?: (usage: CompletionUsage) => void,
): Promise<unknown> {
  const raw = await complete({
    model: VISUAL_AGENT_MODEL,
    system: VISUAL_AGENT_SYSTEM,
    user: JSON.stringify(context),
    maxTokens: VISUAL_AGENT_MAX_OUTPUT_TOKENS,
    temperature: 0,
    allowThinking: false,
    onUsage,
    jsonSchema: toOllamaFormat(AgentDecisionSchema),
  });
  return parseJsonObject(raw);
}
