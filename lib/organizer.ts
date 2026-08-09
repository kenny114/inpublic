/**
 * Turning what the Artist asked for into what should actually happen to a
 * board that already has things on it.
 *
 * The failure this exists to fix: the Artist asks for `create_concept
 * "AI agents"` when the words *AI agents* are already lettered on the sheet,
 * because the Scribe put them there and the Scribe's marks were never part of
 * the semantic board. The old code created a second, boxed "AI agents" a few
 * inches from the first. Measured over a real session: 27 concepts created,
 * 0 reused, while the Scribe had lettered 40 marks covering most of the same
 * nouns.
 *
 * So there are now three outcomes for a requested concept, not two:
 *
 *   reuse  — it is already a concept. Use its id.
 *   adopt  — it is already INK on the page, lettered by the Scribe. Bind a
 *            concept to that mark and draw a reference box around it, so the
 *            arrow attaches to the words the speaker already saw appear.
 *   create — genuinely new. Draw it.
 *
 * `adopt` is the whole point of this file. It is what makes the Organizer
 * annotate the page instead of drawing a parallel copy of it.
 *
 * This module is pure: it decides, it does not draw. Board.tsx executes the
 * plan. That split is also what makes the behaviour testable without a canvas.
 */

import type { CanvasAction } from "./actions";
import { similarity, slugify, type SemanticBoard } from "./semantic";
import { soundsLike } from "./vocab";

/** A mark already lettered on the page, as the planner needs to see it. */
export interface PageMark {
  key: string;
  /** The text as drawn. */
  text: string;
  /** The element that carries it, so a reference box can be drawn around it. */
  elementId?: string;
}

export type PlanStep =
  | { kind: "reuse"; conceptId: string; label: string; why: string }
  | {
      kind: "adopt";
      conceptId: string;
      label: string;
      markKey: string;
      elementId?: string;
      why: string;
    }
  | {
      kind: "create";
      conceptId: string;
      label: string;
      conceptKind: string;
      confidence: number;
    }
  | {
      kind: "link";
      fromConceptId: string;
      toConceptId: string;
      relationshipType: string;
      label: string;
      confidence: number;
    }
  | { kind: "passthrough"; action: CanvasAction }
  | { kind: "drop"; action: CanvasAction; why: string };

export interface Plan {
  steps: PlanStep[];
  /** Every concept id the plan will have available, for the log. */
  resolved: Map<string, string>;
}

/** How alike a requested label and an existing mark must be to adopt it. */
export const ADOPT_THRESHOLD = 0.72;
/** Phonetic fallback, for names the recogniser mangled. */
export const ADOPT_SOUND_THRESHOLD = 0.92;

/**
 * Find the mark on the page that a requested concept is really referring to.
 *
 * Deliberately stricter than `SemanticBoard.match`: adopting the wrong mark
 * puts a box around an unrelated word, which is visible and confusing, whereas
 * failing to adopt merely costs a duplicate — bad, but quieter. Strictness in
 * the direction of the louder mistake.
 */
export function matchMark(
  label: string,
  marks: PageMark[],
): PageMark | null {
  let best: PageMark | null = null;
  let bestScore = 0;
  for (const mark of marks) {
    const score = Math.max(
      similarity(label, mark.text),
      soundsLike(label, mark.text) >= ADOPT_SOUND_THRESHOLD ? 0.9 : 0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = mark;
    }
  }
  return bestScore >= ADOPT_THRESHOLD ? best : null;
}

/**
 * Resolve the Artist's actions against the board and the page.
 *
 * Order is preserved exactly as the Artist emitted it, which is the order the
 * speaker said things in — the prompt asks for that and the board reads wrong
 * without it. Relationships are resolved *after* the concepts in the same
 * plan, so `create A; create B; link A->B` works even when neither existed.
 */
export function planActions(
  actions: CanvasAction[],
  board: SemanticBoard,
  marks: PageMark[],
): Plan {
  const steps: PlanStep[] = [];
  /** Whatever id the Artist used -> the id that actually exists. */
  const resolved = new Map<string, string>();
  /** Ids this plan will have created or adopted by the time links run. */
  const willExist = new Set<string>(board.concepts.keys());
  const claimedMarks = new Set<string>();

  const remember = (requested: string, actual: string) => {
    resolved.set(requested, actual);
    resolved.set(slugify(requested), actual);
    willExist.add(actual);
  };

  /** Requested id or label -> a concept id that will exist. */
  const lookup = (ref: string): string | null => {
    if (!ref) return null;
    const direct = resolved.get(ref) ?? resolved.get(slugify(ref));
    if (direct) return direct;
    if (willExist.has(ref)) return ref;
    const slug = slugify(ref);
    if (willExist.has(slug)) return slug;
    const existing = board.match(ref);
    return existing ? existing.conceptId : null;
  };

  for (const action of actions) {
    switch (action.type) {
      case "create_concept": {
        // 1. Already a concept?
        const existing =
          board.match(action.conceptId) ?? board.match(action.label);
        if (existing) {
          remember(action.conceptId, existing.conceptId);
          remember(action.label, existing.conceptId);
          steps.push({
            kind: "reuse",
            conceptId: existing.conceptId,
            label: existing.label,
            why: `"${action.label}" is already the concept ${existing.conceptId}`,
          });
          break;
        }

        // 2. Already ink on the page?
        const available = marks.filter((m) => !claimedMarks.has(m.key));
        const mark = matchMark(action.label, available);
        if (mark) {
          claimedMarks.add(mark.key);
          const conceptId = slugify(action.conceptId || action.label);
          remember(action.conceptId, conceptId);
          remember(action.label, conceptId);
          steps.push({
            kind: "adopt",
            conceptId,
            // The page's spelling wins. The speaker watched it appear.
            label: mark.text,
            markKey: mark.key,
            elementId: mark.elementId,
            why: `"${action.label}" is already lettered on the page as "${mark.text}"`,
          });
          break;
        }

        // 3. Genuinely new.
        const conceptId = slugify(action.conceptId || action.label);
        remember(action.conceptId, conceptId);
        remember(action.label, conceptId);
        steps.push({
          kind: "create",
          conceptId,
          label: action.label,
          conceptKind: action.kind,
          confidence: action.confidence ?? 0.8,
        });
        break;
      }

      case "create_relationship": {
        const from = lookup(action.fromConceptId);
        const to = lookup(action.toConceptId);
        if (!from || !to) {
          steps.push({
            kind: "drop",
            action,
            why: `endpoint not on the board: ${!from ? action.fromConceptId : action.toConceptId}`,
          });
          break;
        }
        if (from === to) {
          steps.push({ kind: "drop", action, why: "both ends resolve to the same concept" });
          break;
        }
        const already = [...board.relationships.values()].some(
          (r) => r.fromConceptId === from && r.toConceptId === to,
        );
        if (already) {
          steps.push({ kind: "drop", action, why: `${from} -> ${to} is already drawn` });
          break;
        }
        steps.push({
          kind: "link",
          fromConceptId: from,
          toConceptId: to,
          relationshipType: action.relationshipType,
          label: action.label ?? "",
          confidence: action.confidence ?? 0.8,
        });
        break;
      }

      // Everything else references an existing concept; rewrite its id to the
      // one that actually exists and let Board.tsx handle it.
      case "update_concept":
      case "delete_concept":
      case "move_concept":
      case "resize_concept":
      case "zoom_to_concept":
      case "highlight_concept": {
        const id = lookup(action.conceptId);
        if (!id) {
          steps.push({ kind: "drop", action, why: `no concept for ${action.conceptId}` });
          break;
        }
        steps.push({
          kind: "passthrough",
          action: { ...action, conceptId: id } as CanvasAction,
        });
        break;
      }

      case "group_concepts": {
        const ids = action.conceptIds
          .map(lookup)
          .filter((id): id is string => id !== null);
        if (ids.length === 0) {
          steps.push({ kind: "drop", action, why: "no known concepts to group" });
          break;
        }
        steps.push({
          kind: "passthrough",
          action: { ...action, conceptIds: ids },
        });
        break;
      }

      default:
        steps.push({ kind: "passthrough", action });
    }
  }

  return { steps, resolved };
}

/** One line per step, for the session log. */
export function describePlan(plan: Plan): string[] {
  return plan.steps.map((s) => {
    switch (s.kind) {
      case "reuse":
        return `reuse ${s.conceptId}`;
      case "adopt":
        return `adopt ${s.conceptId} <- mark "${s.label}"`;
      case "create":
        return `create ${s.conceptId}`;
      case "link":
        return `link ${s.fromConceptId} -> ${s.toConceptId} (${s.relationshipType})`;
      case "passthrough":
        return `${s.action.type}`;
      case "drop":
        return `drop ${s.action.type}: ${s.why}`;
    }
  });
}
