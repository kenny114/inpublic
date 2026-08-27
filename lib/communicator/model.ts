import { ARTIST_MODEL, complete, toOllamaFormat, type CompletionUsage } from "../llm";
import { CommunicationDecisionSchema, type CommunicationContext } from "./types";

export const COMMUNICATOR_MODEL = process.env.COMMUNICATOR_MODEL || ARTIST_MODEL;
export const COMMUNICATOR_MAX_OUTPUT_TOKENS = 500;

const COMMUNICATOR_SYSTEM = `Choose the next communication act for one evolving visual explanation. You receive the full compact semantic world and canvas plus deterministic communication state, semantic/visual deltas, and an optional compatible transformation candidate.

Return exactly one JSON object, one of:
{"type":"speak","message":"..."}
{"type":"visualize","intent":VISUAL_COMMUNICATION_INTENT}
{"type":"speak_and_visualize","message":"...","intent":VISUAL_COMMUNICATION_INTENT}
{"type":"recompose","intent":VISUAL_COMMUNICATION_INTENT}
{"type":"emphasize","target":"existing-entity-id"}
{"type":"done"}

VISUAL_COMMUNICATION_INTENT is:
{"goal":"short plain-English description of what meaning needs to exist","form":"spatial"|"process"|"comparison"|"magnitude"|"causal"|"tension"|"existing","scope":{"entityIds":["existing-id",...]},"emphasis":{"primaryEntityIds":["existing-id",...]},"spatial":{"arrangement":"separated"|"clustered"|"centralized"|"surrounding"}}

scope, emphasis, and spatial are optional. "goal" is semantic meaning only. form/scope/emphasis/spatial are PresentationIntent and travel directly to Expression, separately from meaning. They contain no coordinates or canvas element ids.
Every id in scope/emphasis must come from the semantic world.entities list. Never copy ids from canvas.objects; those are renderer ids, not semantic identities.

Treat semantic truth and presentation separately. Never invent relations, quantities, or locations to unlock a form; a form may honestly fall back. Decide yourself when relationships, magnitude, structure, tension, or arrangement deserve a visual. Use speech for framing or facts that a sentence communicates better.

Choosing a form — pick the one that matches what the idea actually IS, not a default:
- spatial: arrangement itself is the meaning (closeness, separation, containment, centrality).
- process: one thing changing through states.
- comparison: two things set side by side to be judged against each other.
- magnitude: a difference in size/rate/degree is the point.
- causal: one thing driving or blocking another.
- tension: two things pulling against each other, a trade-off, neither simply "more."
- existing: let the world's own structure decide.

Follow state.stage as progress guidance, not a script:
- establish: state.visualEstablished is false. For a visual explanation, speech alone is not progress; create meaning with visualize or speak_and_visualize before any recompose.
- develop: extend or focus the same world; preserve active semantic ids.
- transform: new semantics make another compatible form useful. Use transformationCandidate to judge whether a real recompose clarifies the existing world.
- conclude: reduce noise, emphasize the central existing entity if useful, or return done. Never repeat the same recompose.

Only visualize when new semantic content must enter WorldState. On the first decision of a new turn over an established visual, compare userMessage with world: if it names any new actor, relation, quantity, correction, or conclusion, choose visualize first and retain current form (or use existing). Then inspect the next semantic delta and transformationCandidate before deciding whether to recompose. Recompose changes presentation only and never adds the user's fact. When all relevant meaning is already visible, prefer recompose or emphasize over a disconnected replacement. Treat feedback as explicit failed-progress evidence and choose a different action. Never repeat a delivered message or decision. Return done as soon as another act would add clutter rather than clarity.`;

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

export async function decideWithCommunicatorModel(
  context: CommunicationContext,
  onUsage?: (usage: CompletionUsage) => void,
): Promise<unknown> {
  const raw = await complete({
    model: COMMUNICATOR_MODEL,
    system: COMMUNICATOR_SYSTEM,
    user: JSON.stringify(context),
    maxTokens: COMMUNICATOR_MAX_OUTPUT_TOKENS,
    temperature: 0,
    allowThinking: false,
    onUsage,
    jsonSchema: toOllamaFormat(CommunicationDecisionSchema),
  });
  return parseJsonObject(raw);
}
