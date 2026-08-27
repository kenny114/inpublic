/**
 * Cadence controller for live speech: a stream of settled thoughts becomes a
 * paced sequence of pipeline runs.
 *
 * ExpressionSession deliberately has no cadence of its own — it processes one
 * segment and returns, which is exactly right for a text box and exactly
 * wrong for a microphone. Speech arrives in bursts, and a naive "run the
 * pipeline per settled thought" loop fires a model call per clause, several
 * concurrently, each seeing a world the others are about to change.
 *
 * So this does the three things the text path never needs, matching
 * lib/meaning/engine.ts's behaviour because the problem is the same one:
 *
 *  - DEBOUNCE. A burst of thoughts arriving close together is coalesced into
 *    one run instead of one per thought.
 *  - SERIALISE. At most one run is ever in flight. A thought that settles
 *    mid-run is buffered, never dropped and never fired concurrently — the
 *    world model is a sequence of folds, and two folds racing on the same
 *    state would silently lose one of them.
 *  - REPORT CONSUMPTION. `consumedIds` names the settled thoughts that
 *    contributed to a run which actually changed something, so the caller can
 *    fade their transcript ink. A run that produced no change never reports
 *    consumption, so that ink stays put.
 *
 * And two things that deliberately escape all three: `reflex`, and the
 * anticipation pass behind `anticipate`. Debouncing,
 * coalescing and serialising are all ways of paying latency to buy the
 * extractor a whole clause to read. The reflex needs no clause and calls no
 * model (lib/expression/fast/reflex.ts), so making it wait would be paying
 * a price for nothing — it folds straight into the world from PARTIAL
 * speech, while the debounce above is still counting down on the sentence
 * it came from. The two paths meet in the world, not in a queue: the slow
 * run that follows resolves the same speaker to the same entity and grows
 * the picture around what the reflex already drew.
 *
 * The anticipation pass escapes them for a different reason. The reflex is
 * free and therefore unconditional; anticipation costs a model call, so it
 * is rationed rather than debounced — it reads the utterance SO FAR, at
 * most every `anticipateMs` and at most `anticipateMaxPerUtterance` times
 * before the thought settles. It never STARTS a call once a settled
 * thought is buffered — that run is seconds away and will say the same
 * thing better — but a call already in the air when the sentence ends
 * still lands, because on a short sentence that is nearly every call, and
 * refusing them was the same as not having the pass at all. What it folds
 * is deliberately less than what it extracted: entities only. See
 * `anticipate`.
 *
 * Knows nothing about Excalidraw, Deepgram, or React. It takes text in and
 * hands traces out, so the same controller drives a human speaking and an AI
 * agent submitting meaning.
 */

import { reflexDelta } from "./fast/reflex";
import { requestMeaningDelta } from "./meaning/client";
import type { MeaningExtractor } from "./meaning/extract";
import { ExpressionSession, type ExpressionTrace, type SessionOptions } from "./pipeline";
import type { InputSegment, MeaningDelta, ScenePlan, WorldState } from "./schemas";

/**
 * One thing to express. A settled speech thought and an agent's submission
 * are the same shape, which is the whole point: `source` is metadata that
 * rides along, not a branch in the pipeline (see ExpressionSession's own
 * "source-agnostic by construction" note).
 */
export interface ExpressionSubmission {
  id: string;
  text: string;
  /**
   * Meaning the caller already has. Present only on the agent path: an agent
   * that knows what it means should not have to render that back into
   * English so a model can parse it out again, so this goes straight to
   * ExpressionSession.ingestDelta and no extraction request is made at all.
   */
  delta?: MeaningDelta;
  /** Defaults to "human_speech" — the path this controller was written for. */
  source?: InputSegment["source"];
  speakerId?: string;
}

/**
 * What one run did, for a caller that waited for it.
 *
 * The same three outcomes the session log already distinguishes
 * (onUpdate / onNoChange / onError), returned rather than emitted, because
 * an agent is a caller and not a microphone: it asked a question and is
 * entitled to the answer. A failure RESOLVES as `failed` instead of
 * rejecting — "the engine ran and produced nothing" and "the engine threw"
 * are both answers, and a caller that has to try/catch one of them and
 * inspect the other will eventually handle only one.
 */
export interface ExpressionOutcome {
  status: "updated" | "noop" | "failed";
  trace?: ExpressionTrace;
  error?: unknown;
  /** The submission ids this run consumed — usually one, more when a burst coalesced. */
  consumedIds: string[];
}

export interface ExpressionLiveUpdate {
  trace: ExpressionTrace;
  /** Settled-thought ids that contributed to this run. Empty when nothing changed. */
  consumedIds: string[];
}

export interface ExpressionLiveOptions extends SessionOptions {
  /** How long to wait after the last buffered thought before running. */
  debounceMs?: number;
  /**
   * The anticipation pass's ration, in ms between runs. 0 turns it off
   * entirely — `anticipate` becomes a no-op that calls nothing and costs
   * nothing, which is what a caller that has not opted in gets.
   */
  anticipateMs?: number;
  /** How many newly settled words must have arrived before another anticipation is worth its call. */
  anticipateMinWords?: number;
  /** A ceiling per utterance, so one long unbroken sentence cannot run up an unbounded bill. */
  anticipateMaxPerUtterance?: number;
  onUpdate: (update: ExpressionLiveUpdate) => void;
  /**
   * Fires once per run, changed or not. A no-op run matters just as much as a
   * change: "the engine correctly found nothing new" and "the engine is
   * broken and silently discarding everything" look identical from the canvas.
   */
  onTrace?: (trace: ExpressionTrace) => void;
  /**
   * A run completed but changed nothing. Distinct from onTrace, which fires
   * either way: this is the signal that speech went in and no picture came
   * out, which is a different fact from the engine never having run at all.
   */
  onNoChange?: (trace: ExpressionTrace, consumedIds: string[]) => void;
  /** A run threw. The world did not advance, and `consumedIds` is the speech that went down with it. */
  onError?: (error: unknown, consumedIds: string[]) => void;
}

const DEFAULT_DEBOUNCE_MS = 900;
/**
 * Anticipation defaults, chosen against the gap they exist to fill.
 *
 * A settled thought reaches the canvas roughly 3-4s after the words that
 * produced it: the debounce, then the extraction, then the fold and the
 * render. Anticipation exists to turn that single late jump into two or
 * three earlier steps, which is the difference between a board that grows
 * and a board that waits.
 *
 * The interval used to be 1.4s, which on a SHORT sentence spent the whole
 * utterance's budget on its first three words: the first call fires almost
 * immediately, reads "I want to", finds one already-known entity, and the
 * ration then refuses every later call until after the sentence has
 * settled. The board moved once, at the end.
 *
 * So the interval is no longer the cost bound —
 * `anticipateMaxPerUtterance` is, and it is a hard ceiling the interval
 * cannot raise. What the interval is for is stopping two calls from
 * reading the same words, and `anticipateMinWords` already does that
 * better, by counting the words themselves rather than the clock. 700ms is
 * a floor on call overlap, not a budget.
 */
const DEFAULT_ANTICIPATE_MS = 700;
/**
 * How many newly settled words must arrive before another anticipation is
 * worth its call — and, on a short sentence, the only thing that decides
 * whether the one call it gets is worth anything at all.
 *
 * At most one anticipation is ever in flight (`anticipating`), and an
 * extraction takes about as long as a short sentence does to say. So a
 * short sentence gets ONE shot, and firing it at the earliest eligible
 * moment spends it on the least material: "I want to" reads back the
 * speaker, whom the reflex drew before the sentence started, and the board
 * gains nothing. Five words in is a noun phrase or two — "I want to build
 * something" — which is the first prefix that has anything in it the board
 * does not already show.
 *
 * Lower is not earlier growth here; it is an earlier wasted call.
 */
const DEFAULT_ANTICIPATE_MIN_WORDS = 5;
const DEFAULT_ANTICIPATE_MAX_PER_UTTERANCE = 3;

interface Buffered extends ExpressionSubmission {
  /** Set only by `express`, which waits for the run its submission lands in. */
  settle?: (outcome: ExpressionOutcome) => void;
}

export class ExpressionLiveController {
  private readonly session: ExpressionSession;
  private readonly debounceMs: number;
  private readonly opts: ExpressionLiveOptions;
  private buffer: Buffered[] = [];
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  /** A reflex that arrived while the session was mid-fold, replayed once the fold completes. */
  private deferredReflex: string | null = null;
  /** The last delta the reflex folded, as a signature. Interims repeat; the world must not. */
  private lastReflexSignature = "";
  private readonly extract: MeaningExtractor;
  private readonly anticipateMs: number;
  private readonly anticipateMinWords: number;
  private readonly anticipateMaxPerUtterance: number;
  private anticipating = false;
  private lastAnticipatedAt = 0;
  /** How much of the utterance the last anticipation had already read, in words. */
  private anticipatedWords = 0;
  private anticipationsThisUtterance = 0;

  constructor(opts: ExpressionLiveOptions) {
    this.opts = opts;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    // Mirrors ExpressionSession's own default (pipeline.ts) rather than
    // reaching into the session for it: the anticipation pass is a SECOND
    // caller of the same extractor, not a second extractor.
    this.extract = opts.extract ?? ((text, recent, onUsage) => requestMeaningDelta(text, recent, undefined, onUsage));
    this.anticipateMs = opts.anticipateMs ?? DEFAULT_ANTICIPATE_MS;
    this.anticipateMinWords = opts.anticipateMinWords ?? DEFAULT_ANTICIPATE_MIN_WORDS;
    this.anticipateMaxPerUtterance = opts.anticipateMaxPerUtterance ?? DEFAULT_ANTICIPATE_MAX_PER_UTTERANCE;
    this.session = new ExpressionSession({
      extract: opts.extract,
      contextWindow: opts.contextWindow,
      enableIdentityLayer: opts.enableIdentityLayer,
      identityJudge: opts.identityJudge,
      targetJudge: opts.targetJudge,
    });
  }

  /** Buffers a settled thought and (re)schedules a debounced run. */
  submit(input: ExpressionSubmission): void {
    this.enqueue(input);
  }

  /**
   * Submit and wait for the run that consumes it.
   *
   * Identical to `submit` in every other respect — same buffer, same
   * debounce, same serialisation, same callbacks fire on the way past — so a
   * caller that waits and a caller that does not are not two code paths
   * through the engine. This exists because a microphone never asks how it
   * went and an agent always does.
   */
  express(input: ExpressionSubmission): Promise<ExpressionOutcome> {
    return new Promise((resolve) => {
      if (!this.enqueue(input, resolve)) {
        resolve({ status: "failed", error: new Error("empty submission"), consumedIds: [input.id] });
      }
    });
  }

  /**
   * The fast path: partial speech straight onto the canvas, no model, no wait.
   *
   * Called on every interim the microphone produces, with the utterance so
   * far. Almost every call does nothing — `reflexDelta` recognises only what
   * is certain before the sentence ends — and the ones that do something
   * fold a one-entity delta into the world synchronously enough to land in
   * the same breath as the word.
   *
   * Three things keep it from fighting the slow path it runs ahead of:
   *
   *  - IT IS IDEMPOTENT. Interims repeat the same words several times a
   *    second, so an unchanged reading is dropped before it reaches the
   *    session. Without this the world would re-fold "I" thirty times per
   *    sentence and the canvas would churn on every one.
   *  - IT NEVER FOLDS INSIDE A FOLD. A slow run's read-modify-write of the
   *    world must not have a reflex land in the middle of it, so a reflex
   *    that arrives mid-fold is deferred and replayed straight after.
   *  - IT CONSUMES NOTHING. `consumedIds` is empty, so the transcript ink
   *    for a sentence still being spoken does not fade. The reflex is a
   *    preview of that sentence, not the expression of it — the settled
   *    thought is still coming, and it is what will be consumed.
   */
  reflex(text: string): void {
    const delta = reflexDelta(text);
    if (!delta) return;
    const signature = JSON.stringify([delta.entities, delta.relations]);
    if (signature === this.lastReflexSignature) return;

    if (this.session.isFolding()) {
      this.deferredReflex = text;
      return;
    }
    this.lastReflexSignature = signature;
    this.deferredReflex = null;

    const segment: InputSegment = {
      id: `reflex-${this.seq}`,
      source: "human_speech",
      text,
      seq: this.seq++,
      timestamp: Date.now(),
    };
    void this.session
      // `contextless`: these are fragments of a sentence the extractor is
      // about to be given whole, and three broken copies of it in the
      // context window would make the slow path worse, not better.
      .ingestDelta(segment, delta, { contextless: true })
      .then((trace) => {
        this.opts.onTrace?.(trace);
        // A reflex that changed nothing is the ordinary case, not a
        // symptom — the speaker said "I" again, and the world already knew.
        // So this reports an update or it reports nothing; onNoChange stays
        // reserved for a settled thought that produced no picture, which is
        // the fact actually worth seeing in the log.
        if (trace.changed) this.opts.onUpdate({ trace, consumedIds: [] });
        this.drainDeferredReflex();
      })
      .catch((error) => {
        // The reflex is an optimisation over a path that still works
        // without it. A failure must not take the sentence down with it —
        // the settled thought behind this partial is still coming.
        this.opts.onError?.(error, []);
        this.drainDeferredReflex();
      });
  }

  private drainDeferredReflex(): void {
    const pending = this.deferredReflex;
    if (pending === null) return;
    this.deferredReflex = null;
    this.reflex(pending);
  }

  /**
   * The middle path: what the speaker has said SO FAR, read by the real
   * extractor, folded as entities and nothing else.
   *
   * Between the reflex mark and the settled structure there is a gap of
   * several seconds in which the board does not move, and the reflex cannot
   * close it — a closed list recognises the speaker and their own people,
   * and stays silent on everything else a sentence is actually about. Only
   * the extractor can read arbitrary speech, so this pays for it, early,
   * from a partial transcript.
   *
   * Four things keep that from being reckless:
   *
   *  - IT FOLDS ENTITIES, NEVER STRUCTURE. Relations, claims, references,
   *    discourse acts and numbers are all dropped from the reading before it
   *    reaches the world (`provisionalDelta`). What a half-finished clause
   *    says exists is nearly always still true when the clause ends; what it
   *    says CONNECTS is exactly what the rest of the clause was going to
   *    decide. So the picture gains its nouns early and its structure at the
   *    same moment it always did — the settled run still owns every arrow.
   *  - IT IS RATIONED, NOT DEBOUNCED. At most one call per `anticipateMs`,
   *    at most `anticipateMaxPerUtterance` per utterance, and only once
   *    `anticipateMinWords` new words have settled. A model call per interim
   *    would be several per second.
   *  - IT YIELDS TO THE REAL RUN, BEFORE PAYING FOR IT. A settled thought
   *    buffered or in flight before the call means no call is made: that
   *    run has the whole sentence and is seconds away. Once the call is
   *    paid for, though, only a run actually UNDER WAY discards it — see
   *    `runAnticipation`.
   *  - IT CONSUMES NOTHING. Like the reflex: the transcript ink for a
   *    sentence still being spoken does not fade, because the sentence has
   *    not been expressed yet.
   */
  anticipate(text: string): void {
    if (!this.anticipateMs) return;
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length - this.anticipatedWords < this.anticipateMinWords) return;
    if (this.anticipationsThisUtterance >= this.anticipateMaxPerUtterance) return;
    if (this.anticipating) return;
    // The settled thought is already on its way (or already running). A
    // provisional read of the same words would be strictly worse and would
    // land at the same moment.
    if (this.inFlight || this.buffer.length || this.timer !== null) return;
    if (Date.now() - this.lastAnticipatedAt < this.anticipateMs) return;
    void this.runAnticipation(words.join(" "), words.length);
  }

  private async runAnticipation(text: string, wordCount: number): Promise<void> {
    this.anticipating = true;
    this.lastAnticipatedAt = Date.now();
    this.anticipatedWords = wordCount;
    this.anticipationsThisUtterance += 1;
    const startedAt = Date.now();
    try {
      // Contextless on purpose, and for the same reason the reflex's fold is
      // (see `ingestDelta`): this is a FRAGMENT of a sentence the extractor
      // is about to be handed whole. Letting it into the rolling context
      // window would make the settled run read a broken copy of the sentence
      // it is trying to understand.
      const provisional = provisionalDelta(await this.extract(text, []));
      // Between asking and answering, the sentence finished — which is the
      // ORDINARY case on a short sentence, not the exceptional one, and
      // dropping the read here is what made anticipation invisible on
      // exactly the utterances that most needed it. A thought merely
      // BUFFERED is still behind a debounce and an extraction, i.e. seconds
      // away, and these entities are the ones its own run is about to
      // resolve to rather than duplicate (world/apply.ts's resolveMention).
      // Landing them now is the growth; landing them twice is not a risk
      // the world model has.
      //
      // What is still refused is a run actually UNDER WAY: `inFlight` means
      // the extraction has already returned or is about to, so this adds
      // nothing but a competing fold, and `isFolding` means a read-modify-
      // write of the world is open right now and a second one would race it.
      if (!provisional || this.inFlight || this.session.isFolding()) return;

      const segment: InputSegment = {
        id: `anticipate-${this.seq}`,
        source: "human_speech",
        text,
        seq: this.seq++,
        timestamp: Date.now(),
      };
      const trace = await this.session.ingestDelta(segment, provisional, {
        contextless: true,
        extractMs: Date.now() - startedAt,
      });
      this.opts.onTrace?.(trace);
      if (trace.changed) this.opts.onUpdate({ trace, consumedIds: [] });
    } catch (error) {
      // Same rule as the reflex: this is an optimisation over a path that
      // still works without it, and a failure here must never take the
      // sentence behind it down.
      this.opts.onError?.(error, []);
    } finally {
      this.anticipating = false;
    }
  }

  /**
   * A new utterance is starting: whatever the reflex last drew is no longer
   * what is being said, so the next reading of the same words is a fresh
   * one, and the anticipation ration starts again from zero. Only the
   * DEDUPE and the ration are cleared — the world keeps everything, which
   * is the point of a world.
   */
  endReflexUtterance(): void {
    this.lastReflexSignature = "";
    this.deferredReflex = null;
    this.anticipatedWords = 0;
    this.anticipationsThisUtterance = 0;
    // The ration is per utterance, so it cannot be inherited from the last
    // one. Without this a sentence that starts within `anticipateMs` of the
    // previous sentence's anticipation is silently refused its first call —
    // which in continuous speech is most of them.
    this.lastAnticipatedAt = 0;
  }

  private enqueue(input: ExpressionSubmission, settle?: (outcome: ExpressionOutcome) => void): boolean {
    if (!input.text.trim()) return false;
    this.buffer.push({ ...input, settle });
    // While a run is in flight, flush() re-schedules itself on completion —
    // scheduling here too would stack timers for the same buffer.
    if (this.inFlight) return true;
    this.schedule();
    return true;
  }

  /**
   * The submissions the next run will consume.
   *
   * Coalescing is a fact about SPEECH: several clauses of one breath are one
   * utterance, and joining their text before extraction is what lets a
   * trailing clause be understood against the one it followed. A submission
   * that carries its own MeaningDelta has nothing to coalesce — two deltas
   * cannot be concatenated the way two sentences can, and the caller has
   * already decided where its own thought ends. So a delta submission is
   * always exactly one run, and never merges with the text on either side of
   * it; whatever is left stays buffered and flushes on the next tick.
   */
  private takeBatch(): Buffered[] {
    if (this.buffer[0]?.delta) return this.buffer.splice(0, 1);
    const nextDelta = this.buffer.findIndex((b) => b.delta);
    return this.buffer.splice(0, nextDelta === -1 ? this.buffer.length : nextDelta);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    if (this.inFlight || !this.buffer.length) return;
    const batch = this.takeBatch();
    if (!batch.length) return;
    this.inFlight = true;

    const settle = (outcome: ExpressionOutcome) => {
      for (const item of batch) item.settle?.(outcome);
    };

    // The batch is one utterance as far as meaning is concerned: several
    // clauses a speaker produced in one breath. Joining them before
    // extraction is what lets "which creates a trust problem" be understood
    // against the clause it followed instead of on its own.
    const segment: InputSegment = {
      id: batch[batch.length - 1].id,
      source: batch[0].source ?? "human_speech",
      text: batch.map((b) => b.text).join(" ").slice(0, 4000),
      seq: this.seq++,
      // Wall-clock arrival time. Never read by anything below WorldEntity
      // provenance (schemas.ts: "carried, never interpreted, this far down"),
      // so this is purely additive — it exists so a captured session
      // (lib/expression/capture.ts) can be correlated against a recorded
      // screen session after the fact.
      timestamp: Date.now(),
      ...(batch[0].speakerId ? { speakerId: batch[0].speakerId } : {}),
    };

    const consumedIds = batch.map((b) => b.id);
    try {
      // A delta submission is always alone in its batch (takeBatch), so
      // reading it off the first item is reading the only one there is.
      const supplied = batch[0].delta;
      const trace = supplied ? await this.session.ingestDelta(segment, supplied) : await this.session.ingest(segment);
      this.opts.onTrace?.(trace);
      if (trace.changed) {
        this.opts.onUpdate({ trace, consumedIds });
        settle({ status: "updated", trace, consumedIds });
      } else {
        this.opts.onNoChange?.(trace, consumedIds);
        settle({ status: "noop", trace, consumedIds });
      }
    } catch (error) {
      // A failed run must never take the session down or lose the buffer's
      // successors; the world simply does not advance this round. But it must
      // not vanish either — a swallowed failure and a correct no-op are
      // indistinguishable from the canvas, and that ambiguity is the single
      // most expensive thing to debug on a live board.
      this.opts.onError?.(error, consumedIds);
      settle({ status: "failed", error, consumedIds });
    } finally {
      this.inFlight = false;
      // More speech settled mid-run: flush it on the same debounce cadence
      // rather than immediately, so a fast talker still gets coalesced
      // batches instead of a run per thought.
      if (this.buffer.length) this.schedule();
    }
  }

  /**
   * True while a run is in flight or speech is waiting in the buffer.
   * The board uses this to keep the "expressing" affordance up across a
   * coalesced burst — submitted thoughts that have not yet produced
   * updated|noop|failed are still pending, even between flushes.
   */
  hasPending(): boolean {
    return this.inFlight || this.buffer.length > 0 || this.timer !== null;
  }

  getWorld(): WorldState {
    return this.session.getWorld();
  }

  getScene(): ScenePlan {
    return this.session.getScene();
  }

  /** New session or page: forget everything and cancel any pending run. */
  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Anything still waiting is told the run it was waiting for will never
    // happen. Dropping the buffer without settling would leave an agent's
    // promise pending forever, which is the one failure mode worse than an
    // error.
    for (const item of this.buffer) {
      item.settle?.({ status: "failed", error: new Error("session reset"), consumedIds: [item.id] });
    }
    this.buffer = [];
    this.seq = 0;
    this.lastReflexSignature = "";
    this.deferredReflex = null;
    this.anticipatedWords = 0;
    this.anticipationsThisUtterance = 0;
    this.lastAnticipatedAt = 0;
    this.session.reset();
  }
}

/**
 * What is safe to fold from an unfinished sentence: the things it says
 * exist, and nothing it says about them.
 *
 * Every field dropped here is dropped because a truncated clause is
 * PARTICULARLY bad at it, not merely because it is optional:
 *
 *  - `relations` and `claims` are the clause's conclusions, and half a
 *    clause has not reached them. An invented relation is the worst thing
 *    this engine can put on a board — it says something the speaker did
 *    not — and it is the one failure the evaluator singles out by name.
 *  - `referenceMentions` and `discourseActs` REACH BACKWARDS and rewrite
 *    what is already drawn ("the second one", "actually, forget that").
 *    Acting on half a pointer can retract the wrong thing, and unlike a
 *    spurious node that is not something the settled run can put right.
 *    Their placeholder entities go with them — a node labelled "the second
 *    one" is not a thing.
 *  - `quantity`/`metric` are numbers mid-utterance: "traffic went from two
 *    hundred" is not yet the sentence the speaker is saying, and metric
 *    points APPEND to the world rather than replacing it. The settled run
 *    states them once, correctly.
 *
 * What survives is a set of nouns — which is exactly what the picture needs
 * in order to grow while someone is still talking, and exactly what the
 * settled run will resolve to the same entities a moment later rather than
 * duplicating (lib/expression/world/apply.ts's resolveMention).
 */
function provisionalDelta(delta: MeaningDelta): MeaningDelta | null {
  const placeholders = new Set((delta.referenceMentions ?? []).map((m) => m.entityId));
  const entities = delta.entities
    .filter((e) => !placeholders.has(e.id))
    .map(({ quantity: _quantity, metric: _metric, ...rest }) => rest);
  if (!entities.length) return null;
  return {
    entities,
    relations: [],
    claims: [],
    ...(delta.topicEntityId && !placeholders.has(delta.topicEntityId) ? { topicEntityId: delta.topicEntityId } : {}),
    interpretation: delta.interpretation,
  };
}
