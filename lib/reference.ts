/**
 * "Going back to Airline…"
 *
 * People do not talk in a straight line. They finish a point, start another,
 * and then circle back to add one more thing to the first — and when they do,
 * the new thing belongs on the page where the first point lives, not at the
 * bottom of whatever sheet happens to be current.
 *
 * Two halves, both pure:
 *
 *   1. Spot the cue. This is a small closed class of phrases in English and a
 *      regex handles it better than a model round trip would, at zero latency.
 *   2. Work out what it points at, and how sure we are. Low confidence means
 *      stay where we are and carry on — a camera that flies to the wrong page
 *      mid-sentence is far worse on camera than one that doesn't move.
 */

import { similarity } from "./semantic";
import { soundsLike } from "./vocab";

export interface BackReference {
  /** The cue as spoken, e.g. "going back to". */
  cue: string;
  /** What it named, e.g. "Airline". */
  phrase: string;
  /** What follows the cue, which is the content to add there. */
  rest: string;
}

/**
 * The cue phrases. Each captures the target phrase in group 1 and the
 * remainder in group 2.
 *
 * "Remember when I mentioned X" is included because it reads as a reference
 * even though it is grammatically a question — in a monologue it never is.
 */
const CUES: RegExp[] = [
  /\b(?:going|go|getting|coming|back)\s+back\s+to\s+([^.,;!?]{2,48})([.,;!?]?[\s\S]*)$/i,
  /\bback\s+to\s+the\s+([^.,;!?]{2,48}?)\s+(?:point|thing|part|bit|topic|section)\b([\s\S]*)$/i,
  /\breturning\s+to\s+([^.,;!?]{2,48})([.,;!?]?[\s\S]*)$/i,
  /\bas\s+for\s+([^.,;!?]{2,48})([.,;!?][\s\S]*)$/i,
  /\bremember\s+when\s+i\s+(?:mentioned|said|talked\s+about)\s+([^.,;!?]{2,48})([.,;!?]?[\s\S]*)$/i,
  /\b(?:also|and)\s*,\s*about\s+(?:the\s+)?([^.,;!?]{2,48})([.,;!?]?[\s\S]*)$/i,
  /\bearlier\s+i\s+(?:mentioned|said)\s+([^.,;!?]{2,48})([.,;!?]?[\s\S]*)$/i,
];

/** Words that get swept up by the capture and are not part of the name. */
const TRIM = /^(?:the|a|an|my|our|that|this|those|these)\s+/i;

export function detectBackReference(text: string): BackReference | null {
  const clean = text.trim();
  if (!clean) return null;
  for (const re of CUES) {
    const m = clean.match(re);
    if (!m) continue;
    const phrase = m[1].trim().replace(TRIM, "").replace(/\s+/g, " ");
    if (phrase.length < 2) continue;
    // "back to it" / "back to that" names nothing resolvable.
    if (/^(?:it|that|this|them|those|there|here)$/i.test(phrase)) continue;
    return {
      cue: clean.slice(m.index ?? 0, (m.index ?? 0) + m[0].length - (m[2] ?? "").length).trim(),
      phrase,
      rest: (m[2] ?? "").replace(/^[.,;!?]\s*/, "").trim(),
    };
  }
  return null;
}

export interface ReferenceTarget {
  /** The page the camera should visit. */
  pageIndex: number;
  sectionId?: string;
  conceptId?: string;
  /** What matched, for the log. */
  matched: string;
  confidence: number;
}

export interface ReferenceWorld {
  sections: { sectionId: string; title: string; pageIndex: number }[];
  /** Concepts, with the page their drawn node sits on. */
  concepts: { conceptId: string; label: string; pageIndex: number }[];
  currentPage: number;
}

/**
 * Below this, do nothing. The instruction is explicit that low confidence
 * means stay on the current page and continue normally, and that is also just
 * correct: a wrong jump costs the viewer the thread of the talk.
 */
export const REFERENCE_THRESHOLD = 0.7;

export function resolveReference(
  ref: BackReference,
  world: ReferenceWorld,
): ReferenceTarget | null {
  let best: ReferenceTarget | null = null;

  const consider = (
    candidate: Omit<ReferenceTarget, "confidence">,
    score: number,
  ) => {
    if (!best || score > best.confidence) {
      best = { ...candidate, confidence: score };
    }
  };

  for (const section of world.sections) {
    if (section.title === "Untitled") continue;
    const score = Math.max(
      similarity(ref.phrase, section.title),
      soundsLike(ref.phrase, section.title) >= 0.92 ? 0.88 : 0,
    );
    consider(
      {
        pageIndex: section.pageIndex,
        sectionId: section.sectionId,
        matched: section.title,
      },
      // A section title is what the speaker named the topic, so it is the
      // better answer when both a section and a concept match.
      score * 1.05,
    );
  }

  for (const concept of world.concepts) {
    const score = Math.max(
      similarity(ref.phrase, concept.label),
      soundsLike(ref.phrase, concept.label) >= 0.92 ? 0.88 : 0,
    );
    consider(
      {
        pageIndex: concept.pageIndex,
        conceptId: concept.conceptId,
        matched: concept.label,
      },
      score,
    );
  }

  if (!best) return null;
  const winner: ReferenceTarget = best;
  if (winner.confidence < REFERENCE_THRESHOLD) return null;
  // Already there. Nothing to do, and saying so keeps the log honest.
  if (winner.pageIndex === world.currentPage) {
    return { ...winner, confidence: Math.min(1, winner.confidence) };
  }
  return { ...winner, confidence: Math.min(1, winner.confidence) };
}
