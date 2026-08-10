/**
 * Turns a chronological transcript-chunk list into an AudioTimeline: each
 * chunk gets a topic, an optional mathematical claim, and any references to
 * earlier topics resolved — all deterministic, cue-phrase-based detection,
 * the same style as lib/reference.ts's back-reference detector, rather than
 * an LLM call per chunk. That keeps a 40-minute upload's processing cost
 * bounded and the detection reproducible/testable offline.
 *
 * The actual DRAWING for each segment happens later, during replay
 * (components/AudioReplayPanel.tsx), by feeding the segment's transcript
 * into the same /api/artist and /api/math routes live mode uses — this
 * module only builds the timeline data, it never calls the drawing models.
 */

import { newId } from "../semantic";
import type { TranscriptChunk } from "./chunk";
import type { AudioSegment, AudioTimeline } from "./types";

const MATH_CUE = /\b(equals?|plus|minus|times|multiplied by|divided by|solve for|equation|slope|intercept|fraction|numerator|denominator)\b/i;
const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\b/i;
/** A variable (bare single letter) or a number, spoken or numeral — spoken math says "two", not "2". */
const VARIABLE_OR_NUMBER = new RegExp(`\\b[a-z]\\b|${NUMBER_WORDS.source}`, "i");

/** A conservative, false-negative-biased detector: better to miss a claim than to route ordinary speech into the math pipeline. */
export function detectMathematicalClaim(text: string): string | undefined {
  if (MATH_CUE.test(text) && VARIABLE_OR_NUMBER.test(text)) return text.trim();
  return undefined;
}

const TOPIC_CHANGE_CUE =
  /\b(now let'?s|moving on to|let'?s move on|next,? (?:we'?ll|let'?s)|turning to|the next thing (?:is|we'?ll cover)|let'?s try another|another example|next example|one more example|let'?s look at (?:another|a different)|here'?s another|let'?s do (?:another|one more))\b/i;

/**
 * Lecture/tutorial openers that carry no topical content of their own —
 * "In this video, we're gonna focus on long multiplication" should label
 * itself "long multiplication", not "In this video we re gonna". Applied
 * repeatedly since these sometimes stack ("So, today we're gonna...").
 * Caught live: a real lecture's every segment inherited this filler as its
 * topic because it was the FIRST segment's rough label and nothing ever
 * replaced it — the label was bad from the start, not just stuck.
 */
const LEAD_IN_FILLER =
  /^(?:so\s+|okay\s+|alright\s+|well\s+|now\s+)*\b(?:in this (?:video|lesson|tutorial|episode)|in today'?s (?:video|lesson)|today (?:we'?re|i'?m) (?:going to|gonna)|we'?re (?:going to|gonna)|let'?s (?:start|begin) (?:with|by)|so today)\b[,]?\s*/i;

/** Verb framing that names the ACT of introducing a subject, not the subject itself. */
const TOPIC_VERB_LEAD_IN =
  /^(?:focus(?:ing)?\s+on|learn(?:ing)?\s+about|talk(?:ing)?\s+about|discuss(?:ing)?|cover(?:ing)?|look(?:ing)?\s+at|explor(?:e|ing))\s+/i;

/** The transition cue itself, when a segment's topic changed because of it — the cue is why the topic changed, not what the new topic is. */
const TRANSITION_CUE_LEAD_IN =
  /^(?:now let'?s|moving on to|let'?s move on(?:\s+to)?|next,?\s*(?:we'?ll|let'?s)?|turning to|the next thing (?:is|we'?ll cover)(?:\s+is)?|let'?s try another(?:\s+example)?|another example|next example|one more example|let'?s look at (?:another|a different)|here'?s another|let'?s do (?:another|one more))[,:]?\s*/i;

const QUESTION_LEAD_IN = /^what(?:'s|\s+is)\s+/i;
const ARTICLE_LEAD_IN = /^(?:a|an|the)\s+/i;

function stripRepeatedly(text: string, patterns: RegExp[]): string {
  let out = text;
  for (let i = 0; i < 4; i++) {
    // A sentence boundary left behind by a stripped-out lead phrase
    // ("Let's try another example. What is...") would otherwise block the
    // next pattern from matching at the new start of the string.
    out = out.replace(/^[^a-zA-Z0-9]+/, "");
    let changed = false;
    for (const pattern of patterns) {
      const next = out.replace(pattern, "").trim();
      // Allowed to reduce all the way to "" — a sentence that was ENTIRELY
      // a transition cue ("Let's try another example.") should end up
      // empty here so the caller knows to look past it, not settle for the
      // cue phrase itself as the label.
      if (next !== out) {
        out = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

/** Up to the end of the first sentence — a topic label shouldn't bleed into the next thought. */
function firstSentence(text: string): string {
  const m = text.match(/^[^.!?]*/);
  return (m ? m[0] : text).trim() || text;
}

/**
 * First few CONTENT words of a chunk, as a rough topic label — same
 * "cheap but good enough" spirit as BEAT_SYSTEM's section detection.
 * Stripped, in order: lecture-opener framing ("in this video, we're
 * gonna"), the verb naming the introduction itself ("focus on"), the
 * transition cue that triggered a topic change ("let's try another
 * example"), a leading question stem ("what is"), and a leading article —
 * each pass exists to remove a specific real label the app produced, not
 * speculatively.
 */
const LEADS = [LEAD_IN_FILLER, TOPIC_VERB_LEAD_IN, TRANSITION_CUE_LEAD_IN, QUESTION_LEAD_IN, ARTICLE_LEAD_IN];

function roughTopic(text: string): string {
  const sentence = firstSentence(text);
  let stripped = stripRepeatedly(sentence, LEADS);
  // A sentence that was ENTIRELY framing ("Let's try another example.")
  // leaves too little to label — the real content is the next sentence
  // ("What is 236 times four?"), which firstSentence() otherwise never
  // sees. Fall back to the full chunk in that case.
  if (stripped.split(/\s+/).filter(Boolean).length < 2) {
    stripped = stripRepeatedly(text, LEADS);
  }
  const words = stripped
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  return words.join(" ") || "untitled";
}

export function detectTopic(text: string, previousTopic: string | undefined): string {
  if (TOPIC_CHANGE_CUE.test(text) || !previousTopic) return roughTopic(text);
  return previousTopic;
}

const REFERENCE_CUE = /\b(this|that|the (?:previous|earlier|last)\s+\w+|as (?:i|we) (?:said|mentioned)|going back to|earlier (?:i|we) (?:said|mentioned))\b/i;

/**
 * Very small overlap check against prior topics — deliberately simpler than
 * lib/reference.ts's phonetic+similarity scoring, since here we're only
 * flagging "this segment likely points at an earlier one" for provenance,
 * not driving a camera jump.
 */
export function detectObjectReferences(text: string, priorTopics: string[]): string[] {
  if (!REFERENCE_CUE.test(text)) return [];
  const words = new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  return priorTopics.filter((topic) => {
    const topicWords = topic.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    return topicWords.some((w) => words.has(w));
  });
}

export function buildAudioTimeline(sessionId: string, chunks: TranscriptChunk[], durationSeconds: number): AudioTimeline {
  const segments: AudioSegment[] = [];
  const topicsSoFar: string[] = [];
  let previousTopic: string | undefined;

  for (const chunk of chunks) {
    const topic = detectTopic(chunk.transcript, previousTopic);
    if (topic !== previousTopic) topicsSoFar.push(topic);
    previousTopic = topic;

    segments.push({
      segmentId: newId("seg"),
      startTime: chunk.startTime,
      endTime: chunk.endTime,
      transcript: chunk.transcript,
      topic,
      mathematicalClaim: detectMathematicalClaim(chunk.transcript),
      objectsReferenced: detectObjectReferences(chunk.transcript, topicsSoFar.slice(0, -1)),
      visualEvents: [],
      confidence: chunk.avgConfidence,
    });
  }

  // One checkpoint per ~10 segments, so a very long upload still has
  // compressed continuity beyond the live 24-concept/90s windows once
  // replay is driving Board.tsx — the same mechanism as SemanticBoard's.
  const checkpoints: AudioTimeline["checkpoints"] = [];
  const GROUP = 10;
  for (let i = 0; i < segments.length; i += GROUP) {
    const group = segments.slice(i, i + GROUP);
    const topics = [...new Set(group.map((s) => s.topic).filter((t): t is string => Boolean(t)))];
    checkpoints.push({
      checkpointId: newId("acp"),
      throughSegmentIndex: Math.min(i + GROUP, segments.length) - 1,
      topicSummary: topics.join(", ") || "untitled",
      keyFacts: group.filter((s) => s.mathematicalClaim).map((s) => s.mathematicalClaim as string).slice(0, 8),
      createdAt: Date.now(),
    });
  }

  return { sessionId, durationSeconds, segments, checkpoints, createdAt: Date.now() };
}
