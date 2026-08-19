import { localVoiceCommand } from "../liveSpeech";
import { parseExplicitCauseEffect } from "./cause";

export type VisualCandidateFamily = "cause_effect";

export interface VisualCandidateDecision {
  /**
   * Whether this thought is worth attempting at all — either the
   * deterministic grammar already found a complete edge (see `family`), or
   * it's plausible prose worth asking the model about. False means "never
   * worth asking anyone" (empty, a recognized voice command, a bare
   * question, or too short/fragmentary to be a real clause).
   */
  candidate: boolean;
  /**
   * Set only when cause.ts's deterministic grammar already parsed a
   * complete causal edge out of this exact text — lets
   * lib/visualReentry/evidence.ts and lib/visualReentry/fastPath.ts keep
   * treating a deterministic match as the fast path it always was. Absent
   * (even when `candidate` is true) means "no known trigger word fired;
   * this is model territory."
   */
  family?: VisualCandidateFamily;
  reason: string;
}

/**
 * A handful of exact greeting/filler utterances a live talk produces
 * constantly and that are never a drawable relationship, however loosely
 * defined — cheap enough to reject before ever troubling the model.
 */
const PURE_FILLER = /^(?:so|it|it's|its|like|you know|i mean|basically|really|kind of|sort of|well|yeah|yep|nope|okay|ok|um|uh|hmm|mm|right|cool|nice|great|thanks|thank you|hi|hey|hello|bye|goodbye)[.!?]*$/i;

/**
 * A real clause needs a finite verb — the same "not a grammar parser, just
 * enough to reject bare noun/prepositional fragments" spirit as
 * lib/liveSpeech.ts's hasClauseShape, extended with cause.ts's own relation
 * verbs since those are exactly the verbs a directed relationship is stated
 * with. This is deliberately NOT a relationship detector — it only asks "is
 * this a complete enough sentence to possibly contain one," and leaves the
 * actual relationship judgment to the model.
 */
const HAS_FINITE_VERB = /\b(?:am|is|are|was|were|be|been|being|have|has|had|do|does|did|can|could|will|would|should|might|may|must|got|gets?|makes?|made|works?|worked|matters?|happened|started|means?|meant|lets?|allows?|allowed|enables?|enabled|helps?|helped|handles?|handled|uses?|used|includes?|included|contains?|contained|shows?|showed|represents?|represented|decides?|decided|builds?|built|becomes?|became|connects?|connected|causes?|caused|leads?|led|results?|resulted|creates?|created|produces?|produced|brings?|brought|talks?|talked|thinks?|thought|knows?|knew|wants?|wanted|needs?|needed|likes?|liked|turns?|turned|consists?)\b/i;

/**
 * Cheap, deliberately conservative prefilter — the "is this even worth
 * anyone's time" gate that runs before either decision tier
 * (lib/visualReentry/fastPath.ts's deterministic grammar, then the model
 * fallback in lib/visualReentry/decide.ts). It does NOT try to detect a
 * relationship itself: that judgment now belongs entirely to
 * cause.ts's deterministic grammar (cheap, tried first) and the model
 * (tried only if that grammar finds nothing). This prefilter only screens
 * out text that could never be worth either one — empty input, a
 * recognized voice command, an unresolved question, or a fragment too short
 * or too verb-less to be a complete clause.
 */
export function evaluateVisualCandidate(text: string): VisualCandidateDecision {
  const spoken = text.trim();
  if (!spoken) return { candidate: false, reason: "empty thought" };
  if (localVoiceCommand(spoken)) return { candidate: false, reason: "recognized voice command, not prose" };
  if (/\?\s*$/.test(spoken)) return { candidate: false, reason: "a question has no settled relationship to draw" };

  const wordCount = spoken.split(/\s+/).filter(Boolean).length;
  if (PURE_FILLER.test(spoken)) return { candidate: false, reason: "pure filler/greeting" };

  // The deterministic grammar gets first look regardless of length/shape —
  // it's cheap, closed, and any match it produces is strictly more reliable
  // than sending the same text to the model.
  const causal = parseExplicitCauseEffect(spoken);
  if (causal.intent) {
    return { candidate: true, family: "cause_effect", reason: causal.reason };
  }

  if (wordCount < 4 || !HAS_FINITE_VERB.test(spoken)) {
    return { candidate: false, reason: "too short or verb-less to be a complete clause" };
  }

  return { candidate: true, reason: "plausible prose clause worth asking the model about" };
}
