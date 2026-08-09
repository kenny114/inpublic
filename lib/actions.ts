/**
 * The action schema the Artist speaks.
 *
 * It replaces Mermaid. Mermaid could only ever describe a whole new picture;
 * these actions describe *changes to the board that already exists*, which is
 * what lets the model connect two things it drew a minute ago instead of
 * drawing them again.
 *
 * Parsing is deliberately forgiving in one direction only: a malformed action
 * is dropped, never thrown. One bad action must cost one action, never the
 * whole response — the same rule `parseLine` follows for the Scribe.
 */

import { CONCEPT_KINDS, type ConceptKind } from "./semantic";

export type CanvasAction =
  | {
      type: "create_concept";
      conceptId: string;
      label: string;
      kind: ConceptKind;
      confidence?: number;
    }
  | {
      type: "update_concept";
      conceptId: string;
      label?: string;
      kind?: ConceptKind;
      confidence?: number;
    }
  | { type: "delete_concept"; conceptId: string }
  | {
      type: "create_relationship";
      fromConceptId: string;
      toConceptId: string;
      relationshipType: string;
      label?: string;
      confidence?: number;
    }
  | { type: "create_section"; title: string }
  | { type: "clear_section" }
  | { type: "group_concepts"; conceptIds: string[]; label?: string }
  | { type: "move_concept"; conceptId: string; direction: MoveDirection }
  | { type: "resize_concept"; conceptId: string; scale: number }
  | { type: "zoom_to_concept"; conceptId: string }
  | { type: "highlight_concept"; conceptId: string }
  | { type: "undo_last" };

export type MoveDirection = "left" | "right" | "up" | "down";

const DIRECTIONS: MoveDirection[] = ["left", "right", "up", "down"];

const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : "";

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const kindOf = (v: unknown): ConceptKind =>
  CONCEPT_KINDS.includes(str(v) as ConceptKind) ? (str(v) as ConceptKind) : "note";

/** One raw object -> one validated action, or null. */
export function parseAction(raw: unknown): CanvasAction | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = str(o.type);

  switch (type) {
    case "create_concept": {
      const label = str(o.label);
      if (!label) return null;
      return {
        type,
        conceptId: str(o.conceptId) || label,
        label,
        kind: kindOf(o.kind),
        confidence: num(o.confidence, 0.8),
      };
    }
    case "update_concept": {
      const conceptId = str(o.conceptId);
      if (!conceptId) return null;
      const out: CanvasAction = { type, conceptId };
      if (str(o.label)) out.label = str(o.label);
      if (str(o.kind)) out.kind = kindOf(o.kind);
      out.confidence = num(o.confidence, 0.8);
      return out;
    }
    case "delete_concept": {
      const conceptId = str(o.conceptId);
      return conceptId ? { type, conceptId } : null;
    }
    case "create_relationship": {
      const from = str(o.fromConceptId);
      const to = str(o.toConceptId);
      if (!from || !to || from === to) return null;
      return {
        type,
        fromConceptId: from,
        toConceptId: to,
        relationshipType: str(o.relationshipType) || "relates",
        label: str(o.label),
        confidence: num(o.confidence, 0.8),
      };
    }
    case "create_section": {
      const title = str(o.title);
      return title ? { type, title } : null;
    }
    case "clear_section":
      return { type };
    case "group_concepts": {
      const ids = Array.isArray(o.conceptIds)
        ? o.conceptIds.map(str).filter(Boolean)
        : [];
      // One is legitimate: "put a box around ClickLabs" is a group of one.
      // Requiring two made that instruction unexpressible.
      return ids.length >= 1 ? { type, conceptIds: ids, label: str(o.label) } : null;
    }
    case "move_concept": {
      const conceptId = str(o.conceptId);
      const direction = str(o.direction) as MoveDirection;
      if (!conceptId || !DIRECTIONS.includes(direction)) return null;
      return { type, conceptId, direction };
    }
    case "resize_concept": {
      const conceptId = str(o.conceptId);
      if (!conceptId) return null;
      // Clamp: a model asking for 10x would push everything off the sheet.
      const scale = Math.min(2.5, Math.max(0.5, num(o.scale, 1.3)));
      return { type, conceptId, scale };
    }
    case "zoom_to_concept": {
      const conceptId = str(o.conceptId);
      return conceptId ? { type, conceptId } : null;
    }
    case "highlight_concept": {
      const conceptId = str(o.conceptId);
      return conceptId ? { type, conceptId } : null;
    }
    case "undo_last":
      return { type };
    default:
      return null;
  }
}

/**
 * Pull an action list out of whatever the model returned. Tolerates code
 * fences and leading prose, because both show up occasionally regardless of
 * what the prompt says.
 */
export function parseActions(rawText: string): CanvasAction[] {
  const cleaned = rawText
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let payload: unknown = null;
  try {
    payload = JSON.parse(cleaned);
  } catch {
    // Salvage the first {...} or [...] block.
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (!match) return [];
    try {
      payload = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { actions?: unknown })?.actions)
      ? (payload as { actions: unknown[] }).actions
      : [];

  const out: CanvasAction[] = [];
  for (const item of list) {
    const action = parseAction(item);
    if (action) out.push(action);
    // Cap: a runaway response should not repaint the whole board.
    if (out.length >= 12) break;
  }
  return out;
}
