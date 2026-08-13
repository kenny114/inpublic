/**
 * The semantic board — what the talk is ABOUT.
 *
 * Excalidraw elements are pixels. This is meaning. The two are linked only by
 * `elementIds`, and the direction of authority runs one way: a concept knows
 * which elements draw it, and an element knows nothing.
 *
 * Everything the models are told about the board is derived from here, and
 * every structural change goes through an Operation so it can be reversed one
 * step at a time.
 *
 * Concepts are identified by `conceptId`, never by label. Two marks reading
 * "ClickLabs" are the same concept only if they resolve to the same id.
 */

import type { SceneElement } from "./scene";
import type { CompositionState } from "./composition";
import type { MathReasoningStep } from "./math/types";

export type ConceptKind =
  | "input"
  | "process"
  | "output"
  | "person"
  | "product"
  | "problem"
  | "solution"
  | "goal"
  | "note"
  // Math domain — additive. A generic concept never becomes one of these
  // implicitly; only the math pipeline (feature-flagged) creates them.
  | "equation"
  | "graph"
  | "math_step";

export const CONCEPT_KINDS: ConceptKind[] = [
  "input", "process", "output", "person", "product",
  "problem", "solution", "goal", "note",
  "equation", "graph", "math_step",
];

export interface Concept {
  conceptId: string;
  label: string;
  kind: ConceptKind;
  elementIds: string[];
  sectionId: string;
  sourceText: string;
  confidence: number;
  createdAt: number;
  lastUpdatedAt: number;
  /** Present only for kind "equation" | "graph" | "math_step". */
  mathMeaning?: MathReasoningStep;
}

export interface Relationship {
  relationshipId: string;
  fromConceptId: string;
  toConceptId: string;
  relationshipType: string;
  label: string;
  elementIds: string[];
  confidence: number;
  createdAt: number;
}

export interface Section {
  sectionId: string;
  title: string;
  pageIndex: number;
  createdAt: number;
}

export type OperationType =
  | "create_concept"
  | "update_concept"
  | "delete_concept"
  | "create_relationship"
  | "delete_relationship"
  | "create_section"
  | "clear_section"
  | "group_concepts"
  | "move_concept"
  | "resize_concept"
  | "zoom_to_concept"
  | "highlight_concept"
  | "scribe_mark"
  /** A spoken sentence written by the live line. Undoable like anything else. */
  | "live_line"
  /** Two existing concepts reorganized into a side-by-side comparison. See lib/director.ts. */
  | "form_comparison"
  /** 3-6 existing concepts reorganized into an ordered chain. See lib/directorState.ts. */
  | "form_process";

/**
 * Everything needed to reverse one operation. Elements are captured whole
 * rather than diffed — a board is small and correctness matters more here than
 * bytes.
 */
export interface UndoRecord {
  addedElementIds: string[];
  removedElements: SceneElement[];
  elementPatches: { id: string; before: Record<string, unknown> }[];
  addedConceptIds: string[];
  addedRelationshipIds: string[];
  addedSectionIds: string[];
  /** Temporary Scribe registry entries created by this operation. */
  addedMarkKeys: string[];
  addedDecorationKeys: string[];
  removedConcepts: Concept[];
  removedRelationships: Relationship[];
  /** Section that was active before this operation, if it changed. */
  previousActiveSectionId?: string;
}

export interface Operation {
  operationId: string;
  type: OperationType;
  timestamp: number;
  sourceText: string;
  confidence: number;
  conceptIds: string[];
  elementIds: string[];
  undo: UndoRecord;
  compositionBefore?: CompositionState;
}

export function emptyUndo(): UndoRecord {
  return {
    addedElementIds: [],
    removedElements: [],
    elementPatches: [],
    addedConceptIds: [],
    addedRelationshipIds: [],
    addedSectionIds: [],
    addedMarkKeys: [],
    addedDecorationKeys: [],
    removedConcepts: [],
    removedRelationships: [],
  };
}

// --- identity -------------------------------------------------------------

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/** Stable, readable id from a label. The AI proposes these; we reconcile them. */
export function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "concept"
  );
}

// --- matching -------------------------------------------------------------

const MATCH_STOP = new Set(
  "a an the of to for and or in on at is are was were this that these those my our your their it its".split(
    " ",
  ),
);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !MATCH_STOP.has(w))
    // crude singularisation, so "thumbnails" matches "thumbnail"
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

export function normalizeLabel(s: string): string {
  return tokens(s).join(" ");
}

/**
 * How alike are two labels, 0..1. Token Jaccard with a containment boost, so
 * "uploaded video" matches "the user uploads a video" strongly enough to be
 * treated as the same thing.
 */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const jaccard = shared / (ta.size + tb.size - shared);
  const containment = shared / Math.min(ta.size, tb.size);
  return Math.max(jaccard, containment * 0.95);
}

export const MATCH_THRESHOLD = 0.6;

// --- the board ------------------------------------------------------------

export interface SemanticSnapshot {
  concepts: Concept[];
  relationships: Relationship[];
  sections: Section[];
  activeSectionId: string;
  history: Operation[];
  checkpoints?: SessionCheckpoint[];
}

/**
 * A compressed record of content that has aged out of the live windows
 * (the 24-concept cap in `scene()`, the 90s transcript window in Board.tsx).
 * Truncation elsewhere is a hard cliff — the content simply becomes invisible
 * to future model calls. A checkpoint is the one place that content survives,
 * in compact form, so a long session doesn't lose all memory of its early
 * minutes. Bounded like everything else here; see `addCheckpoint`.
 */
export interface SessionCheckpoint {
  checkpointId: string;
  topicSummary: string;
  keyFacts: string[];
  spanStart: number;
  spanEnd: number;
  createdAt: number;
}

/**
 * A compact view for prompts. Positions are rounded hard — the models must
 * never emit coordinates, but knowing roughly where things sit lets them avoid
 * asking for an arrow across the whole sheet.
 */
export interface SemanticScene {
  activeTopic: string;
  currentPage: number;
  sections: { sectionId: string; title: string }[];
  concepts: {
    conceptId: string;
    label: string;
    kind: ConceptKind;
    sectionId: string;
    at?: { x: number; y: number };
  }[];
  relationships: {
    fromConceptId: string;
    toConceptId: string;
    relationshipType: string;
  }[];
  recentCommands: string[];
  recentTranscript: string;
  /** Compressed summaries of content that aged out of the concept window — see SessionCheckpoint. */
  checkpointSummaries?: string[];
}

export class SemanticBoard {
  concepts = new Map<string, Concept>();
  relationships = new Map<string, Relationship>();
  sections = new Map<string, Section>();
  activeSectionId = "";
  history: Operation[] = [];
  recentCommands: string[] = [];
  checkpoints: SessionCheckpoint[] = [];
  /** conceptIds already folded into a checkpoint, so they're never summarized twice. */
  private checkpointedConceptIds = new Set<string>();

  constructor() {
    this.startSection("Untitled", 0);
  }

  // --- sections ---
  startSection(title: string, pageIndex: number): Section {
    const section: Section = {
      sectionId: newId("sec"),
      title,
      pageIndex,
      createdAt: Date.now(),
    };
    this.sections.set(section.sectionId, section);
    this.activeSectionId = section.sectionId;
    return section;
  }

  activeSection(): Section | undefined {
    return this.sections.get(this.activeSectionId);
  }

  // --- concepts ---

  /**
   * Find an existing concept for this label. This is the gate that stops the
   * board filling with duplicates of the same idea — the previous
   * architecture's central failure.
   *
   * Prefers an exact id hit, then the best label match above threshold.
   */
  match(labelOrId: string): Concept | null {
    const direct = this.concepts.get(labelOrId);
    if (direct) return direct;

    const slug = slugify(labelOrId);
    const bySlug = this.concepts.get(slug);
    if (bySlug) return bySlug;

    let best: Concept | null = null;
    let bestScore = 0;
    for (const c of this.concepts.values()) {
      const score = Math.max(
        similarity(labelOrId, c.label),
        similarity(slug.replace(/-/g, " "), c.label),
      );
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return bestScore >= MATCH_THRESHOLD ? best : null;
  }

  addConcept(input: {
    conceptId?: string;
    label: string;
    kind?: ConceptKind;
    sourceText?: string;
    confidence?: number;
    mathMeaning?: MathReasoningStep;
  }): Concept {
    const id = input.conceptId ? slugify(input.conceptId) : slugify(input.label);
    const unique = this.concepts.has(id) ? `${id}-${newId("x").slice(-4)}` : id;
    const now = Date.now();
    const concept: Concept = {
      conceptId: unique,
      label: input.label,
      kind: input.kind ?? "note",
      elementIds: [],
      sectionId: this.activeSectionId,
      sourceText: input.sourceText ?? input.label,
      confidence: input.confidence ?? 0.8,
      createdAt: now,
      lastUpdatedAt: now,
      ...(input.mathMeaning ? { mathMeaning: input.mathMeaning } : {}),
    };
    this.concepts.set(unique, concept);
    return concept;
  }

  addRelationship(input: {
    fromConceptId: string;
    toConceptId: string;
    relationshipType?: string;
    label?: string;
    confidence?: number;
  }): Relationship | null {
    if (!this.concepts.has(input.fromConceptId)) return null;
    if (!this.concepts.has(input.toConceptId)) return null;
    if (input.fromConceptId === input.toConceptId) return null;
    // Never draw the same edge twice.
    for (const r of this.relationships.values()) {
      if (
        r.fromConceptId === input.fromConceptId &&
        r.toConceptId === input.toConceptId
      ) {
        return null;
      }
    }
    const rel: Relationship = {
      relationshipId: newId("rel"),
      fromConceptId: input.fromConceptId,
      toConceptId: input.toConceptId,
      relationshipType: input.relationshipType ?? "relates",
      label: input.label ?? "",
      elementIds: [],
      confidence: input.confidence ?? 0.8,
      createdAt: Date.now(),
    };
    this.relationships.set(rel.relationshipId, rel);
    return rel;
  }

  /** Every relationship touching a concept — needed when it is deleted. */
  relationshipsFor(conceptId: string): Relationship[] {
    return [...this.relationships.values()].filter(
      (r) => r.fromConceptId === conceptId || r.toConceptId === conceptId,
    );
  }

  conceptForElement(elementId: string): Concept | null {
    for (const c of this.concepts.values()) {
      if (c.elementIds.includes(elementId)) return c;
    }
    return null;
  }

  // --- history ---
  push(op: Operation) {
    this.history.push(op);
    if (this.history.length > 500) this.history.shift();
  }

  /** The most recent operation that a person would consider "the last thing". */
  lastMeaningful(): Operation | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const op = this.history[i];
      // Camera-only operations aren't what "scratch that" means.
      if (
        op.type !== "zoom_to_concept" &&
        op.type !== "highlight_concept" &&
        op.type !== "live_line"
      ) {
        return op;
      }
    }
    return undefined;
  }

  noteCommand(text: string) {
    this.recentCommands.push(text);
    if (this.recentCommands.length > 6) this.recentCommands.shift();
  }

  // --- checkpoints ---

  addCheckpoint(topicSummary: string, keyFacts: string[], spanStart: number, spanEnd: number): SessionCheckpoint {
    const cp: SessionCheckpoint = {
      checkpointId: newId("cp"),
      topicSummary,
      keyFacts: keyFacts.slice(0, 8),
      spanStart,
      spanEnd,
      createdAt: Date.now(),
    };
    this.checkpoints.push(cp);
    // Bounded like every other list here (history, recentCommands) — a
    // checkpoint of checkpoints would defeat the point.
    if (this.checkpoints.length > 40) this.checkpoints.shift();
    return cp;
  }

  /**
   * Folds concepts that have fallen out of the live `scene()` window (beyond
   * `maxConcepts` most-recently-updated) into one checkpoint per section, so
   * they leave a compressed trace instead of silently vanishing from every
   * future prompt. Concepts themselves are untouched — this only adds a
   * summary alongside them. Idempotent: a concept is folded at most once.
   */
  compactAgedConcepts(maxConcepts = 24): SessionCheckpoint[] {
    const sorted = [...this.concepts.values()].sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
    const aged = sorted.slice(maxConcepts).filter((c) => !this.checkpointedConceptIds.has(c.conceptId));
    if (aged.length === 0) return [];

    const bySection = new Map<string, Concept[]>();
    for (const c of aged) {
      const list = bySection.get(c.sectionId) ?? [];
      list.push(c);
      bySection.set(c.sectionId, list);
    }

    const created: SessionCheckpoint[] = [];
    for (const [sectionId, list] of bySection) {
      const title = this.sections.get(sectionId)?.title ?? "Untitled";
      const spanStart = Math.min(...list.map((c) => c.createdAt));
      const spanEnd = Math.max(...list.map((c) => c.lastUpdatedAt));
      created.push(this.addCheckpoint(title, list.map((c) => c.label), spanStart, spanEnd));
      for (const c of list) this.checkpointedConceptIds.add(c.conceptId);
    }
    return created;
  }

  // --- prompt view ---
  scene(opts: {
    currentPage: number;
    recentTranscript: string;
    positions?: Map<string, { x: number; y: number }>;
    maxConcepts?: number;
  }): SemanticScene {
    const max = opts.maxConcepts ?? 24;
    const concepts = [...this.concepts.values()]
      .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
      .slice(0, max)
      .map((c) => {
        const pos = opts.positions?.get(c.conceptId);
        return {
          conceptId: c.conceptId,
          label: c.label,
          kind: c.kind,
          sectionId: c.sectionId,
          ...(pos ? { at: { x: Math.round(pos.x), y: Math.round(pos.y) } } : {}),
        };
      });
    const keep = new Set(concepts.map((c) => c.conceptId));
    return {
      activeTopic: this.activeSection()?.title ?? "Untitled",
      currentPage: opts.currentPage,
      sections: [...this.sections.values()].map((s) => ({
        sectionId: s.sectionId,
        title: s.title,
      })),
      concepts,
      relationships: [...this.relationships.values()]
        .filter((r) => keep.has(r.fromConceptId) && keep.has(r.toConceptId))
        .map((r) => ({
          fromConceptId: r.fromConceptId,
          toConceptId: r.toConceptId,
          relationshipType: r.relationshipType,
        })),
      recentCommands: [...this.recentCommands],
      recentTranscript: opts.recentTranscript,
      // Last 3 only: this is meant as a brief "what came before" nudge, not a
      // second transcript to re-read every call.
      checkpointSummaries: this.checkpoints
        .slice(-3)
        .map((cp) => `${cp.topicSummary}: ${cp.keyFacts.join(", ")}`),
    };
  }

  // --- persistence ---
  snapshot(): SemanticSnapshot {
    return {
      concepts: [...this.concepts.values()],
      relationships: [...this.relationships.values()],
      sections: [...this.sections.values()],
      activeSectionId: this.activeSectionId,
      history: this.history,
      checkpoints: this.checkpoints,
    };
  }

  static restore(snap: SemanticSnapshot): SemanticBoard {
    const board = new SemanticBoard();
    board.concepts = new Map(snap.concepts.map((c) => [c.conceptId, c]));
    board.relationships = new Map(
      snap.relationships.map((r) => [r.relationshipId, r]),
    );
    board.sections = new Map(snap.sections.map((s) => [s.sectionId, s]));
    board.activeSectionId = snap.activeSectionId;
    board.history = snap.history ?? [];
    board.checkpoints = snap.checkpoints ?? [];
    return board;
  }
}
