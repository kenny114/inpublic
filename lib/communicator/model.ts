import { ARTIST_MODEL, complete, toOllamaFormat, type CompletionUsage } from "../llm";
import { CommunicationDecisionSchema, type CommunicationContext } from "./types";

export const COMMUNICATOR_MODEL = process.env.COMMUNICATOR_MODEL || ARTIST_MODEL;
export const COMMUNICATOR_MAX_OUTPUT_TOKENS = 500;

const COMMUNICATOR_SYSTEM = `You are deciding how to communicate one idea to a human, using words, a shared visual canvas, or both.

You receive the human's message, the communication goal, a compact semantic WorldState view, a compact structural view of the actual canvas, and your own recent decisions on this goal.

Return exactly one JSON object, one of:
{"type":"speak","message":"..."}
{"type":"visualize","intent":VISUAL_COMMUNICATION_INTENT}
{"type":"speak_and_visualize","message":"...","intent":VISUAL_COMMUNICATION_INTENT}
{"type":"recompose","intent":VISUAL_COMMUNICATION_INTENT}
{"type":"emphasize","target":"existing-entity-id"}
{"type":"done"}

VISUAL_COMMUNICATION_INTENT is:
{"goal":"short plain-English description of what should become visible","form":"spatial"|"process"|"comparison"|"magnitude"|"causal"|"tension"|"existing","aboutEntityIds":["existing-id",...],"spatialQualifier":"near"|"beside"|"above"|"below"|"behind"|"in_front_of"|"inside"|"on"}

"aboutEntityIds" and "spatialQualifier" are both optional. "goal" is never geometry, never coordinates, never an Excalidraw shape — it is what the idea IS, in plain words. The deterministic layer below you turns that into an actual picture; you never describe the picture yourself.

Choosing when to visualize:
- Decide "This idea needs a visual" yourself. Never wait for the human to say draw/show/connect/visualize.
- Prefer plain speech for something a sentence already explains as well as a picture would (a single fact, a yes/no, a small correction).
- Prefer a visual the moment relationships, magnitude, structure, tension, or spatial arrangement is the point — something a sentence would have to work hard to convey and a picture states for free.
- "speak_and_visualize" is for when the words frame the picture ("here's the shape of it") rather than restating it.

Choosing a form — pick the one that matches what the idea actually IS, not a default:
- spatial: arrangement itself is the meaning (closeness, separation, containment, centrality).
- process: one thing changing through states.
- comparison: two things set side by side to be judged against each other.
- magnitude: a difference in size/rate/degree is the point.
- causal: one thing driving or blocking another.
- tension: two things pulling against each other, a trade-off, neither simply "more."
- existing: let the world's own structure decide; use this when no single metaphor fits better than the facts already do.

Transformation over generation — inspect the canvas and world before adding anything:
- If something relevant is already visible, prefer "recompose" (reorganize/re-emphasize what exists to make the new point) or "emphasize" (draw attention to something already there) over adding a new, separate picture.
- Only "visualize" wholly new content when nothing already on the canvas is a reasonable starting point.
- Never restate a visual you already produced this turn sequence for the same goal — check your own history first.

Return "done" once the idea is now clear enough that another decision would only add clutter, not clarity. You are being judged on whether the picture became clearer as you went, not on how much you added.`;

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
