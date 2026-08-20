/**
 * Cadence controller for the Meaning Engine: turns a stream of settled
 * thoughts into a paced sequence of `decideMeaning` calls.
 *
 * This is the piece Part 7 of the original rebuild brief ("avoid LLM
 * thrashing") asks for. It does three things a naive "call the model per
 * thought" loop doesn't:
 *  - Debounces: a burst of settled thoughts arriving close together (someone
 *    talking normally) is coalesced into one call instead of one per thought.
 *  - Coalesces while in flight: a thought that settles while a call is
 *    already running is buffered, not dropped and not fired as a second
 *    concurrent request — at most one meaning call is ever in flight.
 *  - Carries context forward: every call is seeded with the last resolved
 *    SemanticState AND a rolling window of recent raw settled-thought text
 *    (`recentContext`) — the Meaning Canvas rebuild's core fix. A settled
 *    thought is rarely self-contained ("that really opened my eyes" means
 *    nothing without knowing what "that" was); the model needs the last few
 *    things actually said, not just the accumulated state, to resolve
 *    pronouns and vague references. See lib/meaning/decide.ts's prompt.
 *
 * Also owns the transcript-lifecycle signal: a MeaningUpdate reports
 * `consumedIds` — the ids of every buffered input that contributed to a
 * call whose result actually changed the semantic state (ops.length > 0).
 * Only those inputs are safe for a caller to fade from the live transcript;
 * an input whose round produced no change (the model genuinely decided
 * there was nothing new — filler, noise, a duplicate) is never reported as
 * consumed, so its transcript ink stays put.
 *
 * Deliberately not coupled to Deepgram or components/Board.tsx's refs — it
 * only knows about ExpressionInput text in and SemanticState/ops out, so a
 * later `source: "ai_agent"` caller can drive it exactly the same way a
 * settled human thought does (see lib/meaning/types.ts's ExpressionInput).
 */

import { requestMeaning } from "./client";
import { planMeaning } from "./plan";
import { diffSemanticState, type CanvasOperation } from "./reconcile";
import { EMPTY_SEMANTIC_STATE, type ExpressionInput, type SemanticState, type VisualFamily, type VisualPlan } from "./types";

export interface MeaningUpdate {
  state: SemanticState;
  ops: CanvasOperation[];
  /** Deterministic visual plan for this state — apply.ts draws from this, not from the full graph. */
  plan: VisualPlan;
  /** ids of every buffered ExpressionInput that contributed to this update — see the module doc comment's transcript-lifecycle note. */
  consumedIds: string[];
}

/**
 * The Part-10 debug view: everything needed to inspect why the engine made
 * a decision without looking at the canvas. Fired for every round — a
 * no-op round (`changed: false`) is just as important to see as a change,
 * since "the model correctly said nothing new here" and "the model is
 * broken and silently discarding everything" look identical from the
 * canvas alone.
 */
export interface MeaningDebugSnapshot {
  event: "decide-completed" | "decide-no-change" | "decide-failed";
  newThought: string;
  recentContext: string[];
  previousInterpretation?: string;
  topic?: string;
  concepts: SemanticState["concepts"];
  claims: SemanticState["claims"];
  relationships: SemanticState["relationships"];
  semanticOps: string[];
  currentInterpretation?: string;
  changed: boolean;
  family?: VisualFamily;
  focusConceptIds?: string[];
  planReason?: string;
}

export interface MeaningEngineOptions {
  /** How long to wait after the last buffered input before calling the model. */
  debounceMs?: number;
  /** How many prior settled-thought texts to keep in the rolling context window. */
  contextWindowSize?: number;
  onUpdate: (update: MeaningUpdate) => void;
  /** Development/debug visibility (Part 10/15) — never required for correctness. Fires once per round, success or not. */
  onDebug?: (snapshot: MeaningDebugSnapshot) => void;
}

const DEFAULT_DEBOUNCE_MS = 900;
const DEFAULT_CONTEXT_WINDOW = 8;

interface BufferedInput {
  id?: string;
  text: string;
}

export class MeaningEngineController {
  private state: SemanticState = EMPTY_SEMANTIC_STATE;
  /** Oldest-first window of already-processed settled-thought text — see the module doc comment. */
  private recentContext: string[] = [];
  private buffer: BufferedInput[] = [];
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly contextWindowSize: number;
  private readonly opts: MeaningEngineOptions;

  constructor(opts: MeaningEngineOptions) {
    this.opts = opts;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.contextWindowSize = opts.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW;
  }

  /** Buffers this input's text and (re)schedules a debounced flush. Safe to call from any ExpressionInput source. */
  submit(input: ExpressionInput): void {
    if (!input.content.trim()) return;
    this.buffer.push({ id: input.id, text: input.content });
    if (this.inFlight) return; // flush() re-schedules itself once the in-flight call resolves and finds more buffered text
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    if (this.inFlight || !this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    const text = batch.map((b) => b.text).join(" ");
    const consumedIds = batch.map((b) => b.id).filter((id): id is string => Boolean(id));
    const contextSnapshot = [...this.recentContext];
    const previousState = this.state;
    this.inFlight = true;
    try {
      const nextState = await requestMeaning(previousState, contextSnapshot, text);
      const ops = diffSemanticState(previousState, nextState);
      const changed = ops.length > 0;
      const plan = planMeaning(nextState);

      this.opts.onDebug?.({
        event: changed ? "decide-completed" : "decide-no-change",
        newThought: text,
        recentContext: contextSnapshot,
        previousInterpretation: previousState.currentInterpretation,
        topic: nextState.topic,
        concepts: nextState.concepts,
        claims: nextState.claims,
        relationships: nextState.relationships,
        semanticOps: ops.map(describeOp),
        currentInterpretation: nextState.currentInterpretation,
        changed,
        family: plan.family,
        focusConceptIds: plan.focusConceptIds,
        planReason: plan.reason,
      });

      if (changed) {
        this.state = nextState;
        this.opts.onUpdate({ state: nextState, ops, plan, consumedIds });
      }

      // The context window advances on every round that reached the model
      // (whether or not it changed the state) — the raw text was still
      // really said, and later thoughts may need it to resolve a pronoun
      // even if this round itself produced nothing new.
      this.recentContext = [...this.recentContext, ...batch.map((b) => b.text)].slice(-this.contextWindowSize);
    } finally {
      this.inFlight = false;
      if (this.buffer.length) {
        // More speech settled while this call was in flight — flush it on
        // the same debounce cadence rather than immediately, so a fast
        // talker still gets coalesced batches instead of a call per thought.
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, this.debounceMs);
      }
    }
  }

  getState(): SemanticState {
    return this.state;
  }

  /** New session/page: forget everything and stop any pending call. */
  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.buffer = [];
    this.state = EMPTY_SEMANTIC_STATE;
    this.recentContext = [];
  }
}

/** Human-readable one-liner per op, for the debug view's "SEMANTIC OPERATIONS" section. */
function describeOp(op: CanvasOperation): string {
  switch (op.kind) {
    case "ADD_NODE":
      return `add concept "${op.concept.label}" (${op.concept.importance})`;
    case "UPDATE_NODE":
      return `update concept ${op.concept.id}: "${op.prev.label}" -> "${op.concept.label}"`;
    case "REMOVE_NODE":
      return `remove concept ${op.conceptId}`;
    case "ADD_EDGE":
      return `add relationship ${op.relationship.from} -${op.relationship.type}-> ${op.relationship.to}`;
    case "UPDATE_EDGE":
      return `update relationship ${op.relationship.id}: ${op.prev.type} -> ${op.relationship.type}`;
    case "REMOVE_EDGE":
      return `remove relationship ${op.relationshipId}`;
    case "ADD_CLAIM":
      return `add claim: "${op.claim.text}"`;
    case "UPDATE_CLAIM":
      return `update claim ${op.claim.id}: "${op.prev.text}" -> "${op.claim.text}"`;
    case "REMOVE_CLAIM":
      return `remove claim ${op.claimId}`;
  }
}
