/**
 * A headless stand-in for the canvas.
 *
 * This is a TEST DOUBLE and says so up front: it cannot render, and it is not
 * the code that runs in the browser. What it does do is call the REAL decision
 * functions for every decision that matters — `planActions` for what happens
 * to an existing board, `decidePageTurn` for when the sheet turns,
 * `routeArrow` for where an arrow goes, `SemanticBoard` for identity, and the
 * real pen from ops.ts for layout. Only the glue between them is re-written
 * here, and the glue is the part a test cannot exercise anyway without a DOM.
 *
 * So a green run proves the logic is right. It does not prove the pixels are.
 */

import { emptyUndo, newId } from "../lib/semantic.ts";
import { measureOp, newPagePen, pageOrigin, place, markKey, PAGE_W } from "../lib/ops.ts";
import { decidePageTurn, isThoughtComplete } from "../lib/pagination.ts";
import { planActions } from "../lib/organizer.ts";
import { routeArrow } from "../lib/routing.ts";
import { SemanticBoard } from "../lib/semantic.ts";
import { correctTranscript, keyterms } from "../lib/vocab.ts";
import { extractConcepts } from "../lib/sketch.ts";

const MAX_MARKS_PER_PAGE = 22;

export class FakeBoard {
  constructor() {
    this.board = new SemanticBoard();
    this.page = 0;
    this.pens = new Map([[0, newPagePen(0)]]);
    this.pageMarks = new Map([[0, new Map()]]);
    /** conceptId -> { elementId, page, kind } */
    this.conceptNodes = new Map();
    /** Every element ever placed: { id, type, x, y, width, height, page, text } */
    this.elements = [];
    this.pageTurns = [];
    this.corrections = [];
    this.seenMarkKeys = new Set();
    this.liveText = "";
    this.pageTurnRequestedAt = 0;
    this.log = [];
    this.arrows = [];
    this.nextId = 0;
  }

  id(prefix) {
    this.nextId += 1;
    return `${prefix}_${this.nextId}`;
  }

  /**
   * Record one reversible change, the same way Board.tsx does.
   *
   * The reason this is in the test double at all: "scratch that" used to call
   * clearSketch(), which removed every id on the sheet — one retraction wiped
   * the page. Conversation E exists to keep that from coming back, and it can
   * only check it if undo is a real pop off a real history.
   */
  recordOp(type, undo, sourceText = "") {
    const op = {
      operationId: newId("op"),
      type,
      timestamp: Date.now(),
      sourceText,
      confidence: 1,
      conceptIds: undo.addedConceptIds ?? [],
      elementIds: undo.addedElementIds ?? [],
      undo,
    };
    this.board.push(op);
    return op;
  }

  /** Reverse exactly the last meaningful operation, and nothing else. */
  undoLast() {
    const op = this.board.lastMeaningful();
    if (!op) return null;
    const index = this.board.history.indexOf(op);
    const trailing = this.board.history.slice(index);
    for (let i = trailing.length - 1; i >= 0; i -= 1) {
      const u = trailing[i].undo;
      const drop = new Set(u.addedElementIds ?? []);
      if (drop.size) {
        this.elements = this.elements.filter((e) => !drop.has(e.id));
        this.arrows = this.arrows.filter((e) => !drop.has(e.id));
      }
      for (const id of u.addedConceptIds ?? []) {
        this.board.concepts.delete(id);
        this.conceptNodes.delete(id);
      }
      for (const id of u.addedRelationshipIds ?? []) {
        this.board.relationships.delete(id);
      }
      for (const id of u.addedSectionIds ?? []) this.board.sections.delete(id);
    }
    this.board.history = this.board.history.slice(0, index);
    return op;
  }

  /**
   * A spoken sentence is a reversible thought like anything else.
   *
   * It reserves a FULL-WIDTH row, exactly as `writeLive` does. That detail is
   * load-bearing for the test: without it every mark and every transcript line
   * pile up at the same coordinates, and the arrow assertions then fail on a
   * layout the product never produces.
   */
  speak(text) {
    const width = Math.min(760, Math.max(200, text.length * 14));
    const spot = place(this.pen, width, 34, true);
    const el = {
      id: this.id("live"),
      type: "text",
      x: spot.x,
      y: spot.y,
      width,
      height: 34,
      page: this.page,
      text,
      counts: false,
    };
    this.elements.push(el);
    const undo = emptyUndo();
    undo.addedElementIds = [el.id];
    this.recordOp("live_line", undo, text);
    return el;
  }

  get pen() {
    return this.pens.get(this.page);
  }

  get marks() {
    return this.pageMarks.get(this.page);
  }

  terms() {
    return keyterms({
      sections: [...this.board.sections.values()].map((s) => s.title),
      concepts: [...this.board.concepts.values()].map((c) => c.label),
      marks: [...this.marks.values()].map((m) => m.text ?? m.key),
    });
  }

  // --- pages ---

  gotoPage(index) {
    if (index === this.page) return;
    if (!this.pens.has(index)) {
      this.pens.set(index, newPagePen(index));
      this.pageMarks.set(index, new Map());
    }
    this.page = index;
  }

  requestPageTurn(trigger) {
    const decision = decidePageTurn({
      trigger,
      marks: this.marksOnPage(),
      maxMarks: MAX_MARKS_PER_PAGE,
      liveText: this.liveText,
      deferredForMs: this.pageTurnRequestedAt
        ? Date.now() - this.pageTurnRequestedAt
        : 0,
    });
    if (!decision.turn) {
      if (!this.pageTurnRequestedAt) this.pageTurnRequestedAt = Date.now();
      this.log.push(`page held: ${decision.why}`);
      return false;
    }
    const midThought = this.liveText !== "" && !isThoughtComplete(this.liveText);
    this.page += 1;
    this.pens.set(this.page, newPagePen(this.page));
    this.pageMarks.set(this.page, new Map());
    this.pageTurnRequestedAt = 0;
    this.pageTurns.push({
      index: this.page,
      reason: decision.reason,
      why: decision.why,
      midThought,
      carriedLiveLine: this.liveText !== "",
    });
    return true;
  }

  marksOnPage() {
    return this.elements.filter((e) => e.page === this.page && e.counts).length;
  }

  // --- the Scribe's local fallback, as marks ---

  letter(text) {
    const concepts = extractConcepts(text, new Set(this.seenMarkKeys), false);
    const drawn = [];
    for (const label of concepts) {
      const key = markKey(label);
      if (this.seenMarkKeys.has(key)) continue;
      const op = { op: "word", text: label };
      const size = measureOp(op, this.marks);
      if (!size) continue;
      if (this.marksOnPage() >= MAX_MARKS_PER_PAGE) this.requestPageTurn("capacity");
      const spot = place(this.pen, size.w, size.h);
      const el = {
        id: this.id("el"),
        type: "text",
        x: spot.x,
        y: spot.y,
        width: size.w,
        height: size.h,
        page: this.page,
        text: label,
        counts: true,
      };
      this.elements.push(el);
      this.marks.set(key, {
        key,
        x: spot.x,
        y: spot.y,
        w: size.w,
        h: size.h,
        text: label,
        elementId: el.id,
      });
      this.seenMarkKeys.add(key);
      drawn.push(label);
    }
    return drawn;
  }

  // --- speech ---

  hear(text) {
    const { text: fixed, corrections } = correctTranscript(text, this.terms());
    this.corrections.push(...corrections);
    this.liveText = fixed;
    const lettered = this.letter(fixed);
    return { text: fixed, corrections, lettered };
  }

  // --- the Organizer ---

  unclaimedMarks() {
    const claimed = new Set(
      [...this.conceptNodes.values()].map((n) => n.elementId),
    );
    return [...this.marks.values()]
      .filter((m) => m.elementId && !claimed.has(m.elementId))
      .map((m) => ({ key: m.key, text: m.text ?? m.key, elementId: m.elementId }));
  }

  organize(actions, sourceText = "") {
    const plan = planActions(actions, this.board, this.unclaimedMarks());
    const applied = [];
    for (const step of plan.steps) {
      switch (step.kind) {
        case "reuse":
          applied.push(`reused ${step.conceptId}`);
          break;

        case "adopt": {
          const mark = this.marks.get(step.markKey);
          if (!mark) {
            applied.push(`adopt failed ${step.conceptId}`);
            break;
          }
          const concept = this.board.addConcept({
            conceptId: step.conceptId,
            label: step.label,
            sourceText,
            confidence: 0.9,
          });
          const ring = {
            id: this.id("ref"),
            type: "rectangle",
            x: mark.x - 12,
            y: mark.y - 8,
            width: mark.w + 24,
            height: mark.h + 16,
            page: this.page,
            text: step.label,
            counts: false, // annotation, not new content
          };
          this.elements.push(ring);
          concept.elementIds = [ring.id];
          this.conceptNodes.set(concept.conceptId, {
            elementId: ring.id,
            page: this.page,
          });
          {
            const undo = emptyUndo();
            undo.addedElementIds = [ring.id];
            undo.addedConceptIds = [concept.conceptId];
            this.recordOp("create_concept", undo, sourceText);
          }
          applied.push(`adopted ${concept.conceptId} <- "${step.label}"`);
          break;
        }

        case "create": {
          const concept = this.board.addConcept({
            conceptId: step.conceptId,
            label: step.label,
            kind: step.conceptKind,
            sourceText,
            confidence: step.confidence,
          });
          const w = Math.max(170, step.label.length * 21 * 0.55 + 48);
          const h = 70;
          if (this.marksOnPage() >= MAX_MARKS_PER_PAGE) {
            this.requestPageTurn("capacity");
          }
          const spot = place(this.pen, w, h);
          const box = {
            id: this.id("box"),
            type: "rectangle",
            x: spot.x,
            y: spot.y,
            width: w,
            height: h,
            page: this.page,
            text: step.label,
            counts: true,
          };
          this.elements.push(box);
          concept.elementIds = [box.id];
          this.conceptNodes.set(concept.conceptId, {
            elementId: box.id,
            page: this.page,
          });
          {
            const undo = emptyUndo();
            undo.addedElementIds = [box.id];
            undo.addedConceptIds = [concept.conceptId];
            this.recordOp("create_concept", undo, sourceText);
          }
          applied.push(`created ${concept.conceptId}`);
          break;
        }

        case "link": {
          const fromNode = this.conceptNodes.get(step.fromConceptId);
          const toNode = this.conceptNodes.get(step.toConceptId);
          if (!fromNode || !toNode) {
            applied.push(
              `no node for ${step.fromConceptId}->${step.toConceptId}`,
            );
            break;
          }
          const rel = this.board.addRelationship({
            fromConceptId: step.fromConceptId,
            toConceptId: step.toConceptId,
            relationshipType: step.relationshipType,
            label: step.label,
            confidence: step.confidence,
          });
          if (!rel) {
            applied.push(`duplicate ${step.fromConceptId}->${step.toConceptId}`);
            break;
          }
          const from = this.elements.find((e) => e.id === fromNode.elementId);
          const to = this.elements.find((e) => e.id === toNode.elementId);
          const obstacles = this.elements
            .filter(
              (e) =>
                e.page === this.page &&
                e.id !== from.id &&
                e.id !== to.id &&
                // An arrow's bounding box is not a thing an arrow can hit —
                // buildBoundArrow excludes them for the same reason.
                e.type !== "arrow",
            )
            // Transcript rows span the sheet: soft, so the router can cross
            // one when that is the only way past the lettered words.
            .map((e) => (e.id.startsWith("live") ? { ...e, soft: true } : e));
          const route = routeArrow(from, to, obstacles);
          const arrow = {
            id: this.id("arrow"),
            type: "arrow",
            x: route.start.x,
            y: route.start.y,
            width: Math.abs(route.end.x - route.start.x),
            height: Math.abs(route.end.y - route.start.y),
            page: this.page,
            counts: false,
            startBinding: { elementId: from.id, focus: 0, gap: 4 },
            endBinding: { elementId: to.id, focus: 0, gap: 4 },
            routed: route.routed,
            points: route.points,
          };
          this.elements.push(arrow);
          this.arrows.push(arrow);
          rel.elementIds = [arrow.id];
          {
            const undo = emptyUndo();
            undo.addedElementIds = [arrow.id];
            undo.addedRelationshipIds = [rel.relationshipId];
            this.recordOp("create_relationship", undo, sourceText);
          }
          applied.push(
            `linked ${step.fromConceptId} -> ${step.toConceptId} (${step.relationshipType})`,
          );
          break;
        }

        case "passthrough":
          if (step.action.type === "create_section") {
            this.requestPageTurn("section");
            this.board.startSection(step.action.title, this.page);
            applied.push(`section "${step.action.title}"`);
          } else {
            applied.push(`${step.action.type}`);
          }
          break;

        case "drop":
          applied.push(`dropped ${step.action.type}: ${step.why}`);
          break;
      }
    }
    return { plan, applied };
  }

  /** Everything visible on a page, for assertions. */
  onPage(index = this.page) {
    return this.elements.filter((e) => e.page === index);
  }

  duplicateLabels() {
    const seen = new Map();
    const dupes = [];
    for (const c of this.board.concepts.values()) {
      const key = c.label.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) dupes.push([seen.get(key), c.conceptId]);
      else seen.set(key, c.conceptId);
    }
    return dupes;
  }
}

export { MAX_MARKS_PER_PAGE, PAGE_W };
