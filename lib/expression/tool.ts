/**
 * The agent-facing TOOL over the agent entry point.
 *
 * `entry.express` is already the way in for anything that produces meaning
 * (lib/expression/entry.ts). What it is not is a *tool*: an external caller —
 * Claude Code, Codex, an MCP client — cannot see a TypeScript function. It
 * needs a name, an advertised input schema, and a handler that takes plain
 * JSON from an untrusted process and hands back a plain JSON answer.
 *
 * That is all this file adds. There is no second pipeline here, no second
 * validation story, and deliberately no way to reach the canvas that
 * `express` does not already have:
 *
 *   tool.call(json) → entry.express(request) → controller.express(...)
 *
 * so an agent's tool call is the same run a spoken sentence gets, in the same
 * session, against the same world, competing for the same debounce.
 *
 * THE ONE RULE, and the reason the schema looks like this: an agent submits
 * MEANING, never shapes. There is no field here for a coordinate, an element,
 * a colour or a diagram type, and a delta carrying one is rejected rather
 * than stripped — `MeaningDeltaSchema` is `.strict()` at every level, so an
 * unknown key fails the parse. `findGeometryKey` below runs first only to
 * turn that into a sentence an agent can act on, not to do the rejecting.
 *
 * Transport-agnostic on purpose. This module knows nothing about MCP, HTTP,
 * or stdio; `definition` is a description a registry can publish and `call`
 * is a function a registry can invoke. See scripts/express-mcp-server.mjs for
 * one transport, and AGENT.md for what to say to the agent.
 */

import { z } from "zod";
import type { ExpressionEntry, ExpressResult } from "./entry";
import { EntityTypeSchema, RelationTypeSchema, type MeaningDelta } from "./schemas";

export const EXPRESS_TOOL_NAME = "express_meaning";

/**
 * What the calling model reads before it decides what to send. The framing is
 * the load-bearing part: an agent that thinks this is a drawing API will send
 * boxes and arrows and be rejected, so the description says what the engine
 * actually wants and what it does with it.
 */
export const EXPRESS_TOOL_DESCRIPTION = [
  "Express meaning visually on the InPublic board.",
  "",
  "Submit MEANING, not shapes. You say what is true and how things relate; the engine chooses the form,",
  "the layout and the drawing. There is no way to specify coordinates, colours, elements or a diagram type,",
  "and a submission carrying any of them is rejected.",
  "",
  "Two ways to call it:",
  '  { text }   plain words, extracted for you — e.g. "Rising costs push teams to consolidate tools,',
  '             which slows their releases." → expect a cause_effect chain of three nodes.',
  "  { delta }  structured meaning you already have (entities / relations / claims / interpretation),",
  "             which skips extraction entirely.",
  "",
  "The board is one shared, continuing world. A second call extends what the first one drew",
  '(result.mode = "patch") rather than starting a new picture, exactly as a person adding a sentence would.',
].join("\n");

/**
 * The advertised input schema, as JSON Schema so any tool registry can
 * publish it unchanged.
 *
 * `delta` describes the fields worth an agent's attention rather than every
 * field MeaningDelta accepts, and does NOT set `additionalProperties: false`
 * on the delta objects — the richer optional fields (attributes, metric,
 * referenceMentions, discourseActs) are legal and a client-side schema that
 * forbade them would block valid meaning. Enforcement is MeaningDeltaSchema's
 * job at call time; this is documentation with a shape.
 */
export const EXPRESS_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    text: {
      type: "string",
      maxLength: 4000,
      description: "What to express, in plain words. Required unless `delta` is given.",
    },
    speakerId: {
      type: "string",
      maxLength: 48,
      description: 'Who this is from — a slug like "codex" or "research-agent". Recorded as provenance, never interpreted.',
    },
    delta: {
      type: "object",
      description:
        "Structured meaning, when you already have it. Skips extraction. Ids are local to this one submission; the world mints its own.",
      properties: {
        entities: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Local id, referenced by relations and claims in this same submission." },
              type: { type: "string", enum: [...EntityTypeSchema.options] },
              label: { type: "string", maxLength: 60, description: "A NAME, 1-4 words. Never a clause." },
              description: { type: "string", maxLength: 160 },
            },
            required: ["id", "type", "label"],
          },
        },
        relations: {
          type: "array",
          maxItems: 16,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              source: { type: "string", description: "An entity id from this submission." },
              type: { type: "string", enum: [...RelationTypeSchema.options] },
              target: { type: "string", description: "An entity id from this submission." },
            },
            required: ["id", "source", "type", "target"],
          },
        },
        claims: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              text: { type: "string", maxLength: 160 },
              about: { type: "array", items: { type: "string" }, maxItems: 5 },
            },
            required: ["id", "text"],
          },
        },
        interpretation: {
          type: "string",
          maxLength: 240,
          description: "One sentence saying what this submission means. Stands in for `text` when `text` is absent.",
        },
      },
      required: ["entities", "relations", "claims", "interpretation"],
    },
  },
  additionalProperties: false,
} as const;

/**
 * The envelope, kept separate from MeaningDelta's own validation: this checks
 * that the CALL is well-formed (the right keys, of the right kinds, at least
 * one of text/delta), and hands the delta itself to the entry point, which
 * validates it with the same schema the model's output goes through.
 */
export const ExpressToolInputSchema = z
  .object({
    text: z.string().max(4000).optional(),
    speakerId: z.string().max(48).optional(),
    delta: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine((input) => Boolean(input.text?.trim()) || input.delta !== undefined, {
    message: "give either `text` or `delta`",
  });

export type ExpressToolInput = z.infer<typeof ExpressToolInputSchema>;

/**
 * The answer, flattened for a caller reading JSON over a wire. The
 * ExpressionTrace is deliberately NOT included: it is a debugging structure
 * for the board's own console, not something to spend an agent's context on.
 *
 * `status` keeps Track C's three outcomes distinct, because an agent that
 * cannot tell "the board changed" from "the board understood you and had
 * nothing to draw" from "that was rejected" will retry the wrong one:
 *
 *   updated  the board changed. `mode` says whether it extended (patch) or redrew (full).
 *   noop     the run happened and produced no change. `reason` says why. Do not retry verbatim.
 *   failed   the submission was rejected or the run threw. `error` says which.
 */
export interface ExpressToolResult {
  ok: boolean;
  id: string;
  status: ExpressResult["status"];
  mode?: ExpressResult["mode"];
  intent?: ExpressResult["intent"];
  grammar?: ExpressResult["grammar"];
  reason?: string;
  objects?: number;
  connectors?: number;
  error?: string;
}

export interface ExpressTool {
  /** The published description — name, description, input schema. */
  definition: {
    name: typeof EXPRESS_TOOL_NAME;
    description: string;
    inputSchema: typeof EXPRESS_TOOL_INPUT_SCHEMA;
  };
  /** Takes whatever arrived over the wire. Never throws; a rejection is a `failed` result. */
  call(input: unknown): Promise<ExpressToolResult>;
}

/**
 * Keys that mean "I am telling you what to draw". Present so the refusal is
 * a sentence rather than "Unrecognized key(s) in object: 'x'" — the schema
 * would reject all of these anyway (every level is `.strict()`), and this
 * runs first only to say WHY in terms the agent can act on.
 */
const GEOMETRY_KEYS = new Set([
  "x",
  "y",
  "width",
  "height",
  "angle",
  "points",
  "position",
  "coordinates",
  "bounds",
  "elements",
  "shape",
  "shapes",
  "layout",
  "grammar",
  "diagram",
  "diagramType",
  "style",
  "strokeColor",
  "backgroundColor",
  "fontSize",
]);

/** The first geometry key anywhere in the submitted delta, or undefined. */
function findGeometryKey(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findGeometryKey(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (GEOMETRY_KEYS.has(key)) return key;
    const found = findGeometryKey(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function rejected(error: string): ExpressToolResult {
  return { ok: false, id: "", status: "failed", error };
}

export function createExpressTool(entry: ExpressionEntry): ExpressTool {
  return {
    definition: {
      name: EXPRESS_TOOL_NAME,
      description: EXPRESS_TOOL_DESCRIPTION,
      inputSchema: EXPRESS_TOOL_INPUT_SCHEMA,
    },

    async call(input: unknown): Promise<ExpressToolResult> {
      const parsed = ExpressToolInputSchema.safeParse(input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return rejected(`invalid call: ${[issue?.path.join("."), issue?.message].filter(Boolean).join(": ")}`);
      }

      const geometry = parsed.data.delta ? findGeometryKey(parsed.data.delta) : undefined;
      if (geometry) {
        return rejected(
          `geometry rejected: "${geometry}" describes what to draw, not what you mean. ` +
            "Submit entities, relations and claims; the engine chooses the form.",
        );
      }

      try {
        const result = await entry.express({
          text: parsed.data.text,
          // Untyped on purpose — MeaningDeltaSchema in entry.express is what
          // decides whether this is a MeaningDelta, and it is the only thing
          // that should.
          delta: parsed.data.delta as MeaningDelta | undefined,
          speakerId: parsed.data.speakerId,
        });
        return {
          ok: result.status !== "failed",
          id: result.id,
          status: result.status,
          mode: result.mode,
          intent: result.intent,
          grammar: result.grammar,
          reason: result.reason,
          objects: result.objects,
          connectors: result.connectors,
          error: result.error,
        };
      } catch (err) {
        // entry.express resolves rather than rejects, but this is the edge of
        // the process: a caller over a wire gets an answer, never a hang.
        return rejected(err instanceof Error ? err.message : String(err));
      }
    },
  };
}
