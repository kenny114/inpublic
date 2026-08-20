import { isThoughtComplete } from "./pagination";

export type LocalVoiceCommand = "undo" | "new-page";

/** Closed, deterministic command lane. Narration never reaches this matcher. */
export function localVoiceCommand(text: string): LocalVoiceCommand | null {
  const clean = text.trim().toLowerCase().replace(/[.!?]+$/g, "").trim();
  if (clean === "scratch that" || clean === "remove that" || clean === "undo") {
    return "undo";
  }
  if (clean === "new page" || clean === "new scene") return "new-page";
  return null;
}

/**
 * The same command lane, fired from settled interim words instead of a final.
 *
 * Waiting for the final costs 150–600ms of endpointing on every command, which
 * is the difference between the board reacting with you and reacting after
 * you. Because the matcher is a closed set of exact phrases, running it early
 * is safe in a way that no open-ended interpretation would be.
 *
 * Two guards make it safe, and both are load-bearing:
 *
 * 1. **The whole settled utterance must be the command, exactly.** Not a
 *    prefix, not a substring. "scratch" is not "scratch that"; "scratch that
 *    idea" is a sentence about an idea and must not erase anything. This is
 *    why the check delegates to `localVoiceCommand` on the full string rather
 *    than testing for a leading match.
 * 2. **The words must be settled** — agreed by two consecutive interims —
 *    which is the caller's job and is what stops a half-heard "under…" from
 *    ever reaching this function as "undo".
 *
 * The asymmetry of the risk is the whole argument. Firing a command 300ms
 * early is a small win; firing one that was never spoken destroys work the
 * speaker cannot see was destroyed. So the bar is exact equality, and anything
 * ambiguous simply waits for the final, which is the behaviour we had anyway.
 */
export function earlyVoiceCommand(settledText: string): LocalVoiceCommand | null {
  const clean = settledText.trim();
  if (!clean) return null;
  // A trailing comma means the speaker is still going — "undo, and then…".
  if (/[,;:]$/.test(clean)) return null;
  return localVoiceCommand(clean);
}

const INCOMPLETE_ENDINGS = new Set([
  "toward", "towards", "from", "to", "because", "with", "and", "but",
  "if", "when", "that", "need", "needs",
]);

export interface StructuralThoughtState {
  text: string;
  rawSegments: string[];
  heldSince: number;
}

export interface StructuralThoughtResult {
  state: StructuralThoughtState;
  thought: string | null;
  held: boolean;
}

export const EMPTY_THOUGHT: StructuralThoughtState = {
  text: "",
  rawSegments: [],
  heldSince: 0,
};

export const STRUCTURAL_HOLD_MS = 1600;

export function isObviouslyIncomplete(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  if (/[,;:]$/.test(clean)) return true;
  const words = clean.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter(Boolean);
  return words.length > 0 && INCOMPLETE_ENDINGS.has(words[words.length - 1]);
}

/**
 * Adds one exact provider segment and emits only a coherent structural thought.
 * Rendering remains immediate; this helper is for the semantic lane only.
 */
export function pushStructuralSegment(
  prior: StructuralThoughtState,
  rawSegment: string,
  at: number,
): StructuralThoughtResult {
  const segment = rawSegment.trim();
  if (!segment) return { state: prior, thought: null, held: Boolean(prior.text) };
  const text = `${prior.text} ${segment}`.trim();
  const state = {
    text,
    rawSegments: [...prior.rawSegments, rawSegment],
    heldSince: prior.heldSince || at,
  };
  if (isObviouslyIncomplete(text) || !isThoughtComplete(text)) {
    return { state, thought: null, held: true };
  }
  return { state: EMPTY_THOUGHT, thought: text, held: false };
}

/**
 * What is left of the pending buffer once a beat has consumed part of it.
 *
 * The beat is asked about a snapshot of the buffer, then the model call and
 * the Artist call together take the best part of eight seconds. People do not
 * stop talking for eight seconds, so by the time the drawing lands the buffer
 * usually holds a NEWER sentence than the one that was just drawn. Retiring
 * the whole buffer therefore threw away the next thought — reliably the last
 * one in an explanation, because nothing came after it to trigger another
 * beat. Only the consumed prefix is retired.
 *
 * If the buffer no longer starts with what was sent (the word cap dropped the
 * front of it, or a command reset it mid-flight), there is no safe way to say
 * what is left over, so it retires entirely — the old behaviour.
 */
export function retirePending(buffer: string, consumed: string): string {
  const remaining = buffer.trim();
  const used = consumed.trim();
  if (!used) return remaining;
  return remaining.startsWith(used) ? remaining.slice(used.length).trim() : "";
}

export function flushStructuralThought(state: StructuralThoughtState): StructuralThoughtResult {
  return {
    state: EMPTY_THOUGHT,
    thought: state.text.trim() || null,
    held: false,
  };
}

// --- Live Presentation V3 -------------------------------------------------

export type PresentationBoundaryReason =
  | "terminal_complete"
  | "stable_clause"
  | "completed_prefix"
  | "continuation_hold"
  | "safety_bound"
  | "safe_forced_split";

export interface PresentationThoughtState {
  text: string;
  /** Exact provider finals that contributed to the pending presentation unit. */
  rawSegments: string[];
  heldSince: number;
  providerFinalCount: number;
}

export interface PresentationThoughtEmission {
  text: string;
  reason: Exclude<PresentationBoundaryReason, "continuation_hold">;
  rawSegments: string[];
  providerFinalCount: number;
  heldSince: number;
  settledAt: number;
}

export interface PresentationBoundaryDecision {
  reason: PresentationBoundaryReason;
  text: string;
  wordCount: number;
  charCount: number;
  providerFinalCount: number;
  heldMs: number;
}

export interface PresentationThoughtResult {
  state: PresentationThoughtState;
  thoughts: PresentationThoughtEmission[];
  decisions: PresentationBoundaryDecision[];
}

export const EMPTY_PRESENTATION_THOUGHT: PresentationThoughtState = {
  text: "",
  rawSegments: [],
  heldSince: 0,
  providerFinalCount: 0,
};

/**
 * One readability bound is enough. The natural audit's runaway units began at
 * 35 words; 32 leaves ordinary spoken sentences alone while guaranteeing that
 * a punctuation-poor monologue cannot grow without limit.
 */
export const MAX_PRESENTATION_WORDS = 32;
const FORCED_SPLIT_TARGET_WORDS = 28;
const MIN_SAFE_PREFIX_WORDS = 10;

const OPEN_FUNCTION_WORDS = new Set(
  `and but because so with without for to from when where which that who whose
   if unless until while than as of at by into onto toward towards through
   about against between during before after or nor yet the a an my our your
   their his her its this these those there what how why in on up down out off
   over under i we you they he she it them us am is are was were be been being
   have has had do does did can could will would should might may must gonna
   going that's what's who's i'm we're they're he's she's it's`.split(/\s+/).filter(Boolean),
);

const OPEN_MODIFIERS = new Set(
  "just really very quite rather more most less main also still even almost especially particularly instead".split(" "),
);

const LEGITIMATE_SINGLE_WORDS = new Set(
  "yes no exactly absolutely agreed correct right done worked solved finished entertained".split(" "),
);

function presentationWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function wordCount(text: string): number {
  return presentationWords(text).length;
}

/**
 * Structural open-tail detection, deliberately broader than a dangling-word
 * list. It combines function-word endings with a few clause shapes that are
 * visibly promises of more speech. It never rewrites the transcript.
 */
export function hasOpenPresentationTail(text: string): boolean {
  const clean = text.trim().replace(/[.!?]+["')\]]?$/g, "").trim();
  if (!clean) return false;
  if (/[,;:]$/.test(clean)) return true;
  const words = presentationWords(clean);
  const last = words.at(-1) ?? "";
  if (OPEN_FUNCTION_WORDS.has(last) || OPEN_MODIFIERS.has(last)) return true;

  return hasObviouslyOpenClauseShape(clean);
}

function hasObviouslyOpenClauseShape(text: string): boolean {
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  return (
    /\b(?:would|could|should|might|may|can|will|must|gonna)\s*$/i.test(lower) ||
    /\b(?:would|could|should|might|may|can|will|need|needs|want|wants|wanted|like|likes|liked|try|tries|tried|trying|going|have|has|had)\s+to\s*$/i.test(lower) ||
    /\b(?:i(?:'m| am)|we(?:'re| are)|they(?:'re| are)|he(?:'s| is)|she(?:'s| is)|it(?:'s| is))\s+(?:also\s+)?(?:thinking|considering|trying|looking|hoping|planning|wondering)\s*$/i.test(lower) ||
    /\b(?:the idea|the point|the thing|what i mean|what i(?:'m| am) saying)\s+(?:is|was)(?:\s+just)?\s*$/i.test(lower) ||
    /\b(?:is|are|was|were|be|been|being)\s+(?:built|designed|made|created|intended|supposed|meant)\s*$/i.test(lower) ||
    /\b(?:what|how|why|where|when|which|who)\s+[^.!?]{0,80}\b(?:gonna|going|really|exactly|actually)\s*$/i.test(lower) ||
    /\b(?:no|any)\s+(?:real\s+)?way\b[^.!?]{0,100}\b(?:without|to)\s*$/i.test(lower) ||
    /\b(?:let me|let us)\s+just\s*$/i.test(lower) ||
    /\b(?:let me|let us)\s+just\b[^.!?]{0,80}\b(?:research|look|see|check|try|find|figure|understand)\s*$/i.test(lower) ||
    /\b(?:that|which|who|when|where)\s+(?:the\s+)?(?:[a-z0-9'-]+\s*){1,3}$/i.test(lower)
  );
}

function hasClauseShape(text: string): boolean {
  const clean = text.trim();
  // A finite auxiliary or an ordinary inflected verb is enough for a
  // presentation clause. This is not a grammar parser; it only stops bare noun
  // and prepositional fragments from earning permanence by length alone.
  return /\b(?:am|is|are|was|were|be|been|being|have|has|had|do|does|did|can|could|will|would|should|might|may|must|got|gets?|made|makes?|worked|works|matters|happened|started|avoided|understand|supports?|survive[ds]?|agree[ds]?|think|thought|know|knew|find|found|want|wanted|like|liked|need|needed|use[ds]?|built|created|gave|give[sn]?|took|take[sn]?|said|says?|talk(?:ed|ing)?|play(?:ed|ing)?|help(?:ed|ing)?|allow(?:ed|s)?|express(?:ed|es)?|showcase[ds]?)\b/i.test(clean);
}

export function isStablePresentationClause(text: string, strongPunctuation = false): boolean {
  const clean = text.trim();
  if (!clean) return false;
  const words = presentationWords(clean);
  if (words.length === 0) return false;
  if (strongPunctuation) {
    // Provider punctuation is strong evidence, but explicit promise-of-more
    // clause shapes still win. This lets malformed-but-closed natural
    // questions such as "what type ... would we do?" settle without treating
    // an unpunctuated "what ... are we gonna really" as complete.
    const unpunctuated = clean.replace(/[.!?]+["')\]]?$/g, "").trim();
    if (hasObviouslyOpenClauseShape(unpunctuated)) return false;
    if (words.length === 1) return LEGITIMATE_SINGLE_WORDS.has(words[0]);
    if (/^(?:that's why|that's it|it worked|i agree|this matters)[.!?]["')\]]?$/i.test(clean)) return true;
    if (/\?["')\]]?$/.test(clean) && /^(?:what|why|how|when|where|which|who|is|are|was|were|do|does|did|can|could|will|would|should|have|has|had)\b/i.test(clean)) {
      return true;
    }
    return hasClauseShape(clean);
  }
  if (hasOpenPresentationTail(clean)) return false;
  return words.length >= 6 && hasClauseShape(clean);
}

function startsAsContinuation(text: string): boolean {
  const first = presentationWords(text)[0] ?? "";
  return new Set([
    "and", "but", "because", "so", "with", "without", "for", "to", "from",
    "when", "where", "which", "that", "who", "if", "while", "than", "as",
  ]).has(first);
}

function strongBoundaryEnds(text: string): number[] {
  const ends: number[] = [];
  const re = /[.!?]+["')\]]?(?=\s|$)/g;
  for (const match of text.matchAll(re)) ends.push((match.index ?? 0) + match[0].length);
  return ends;
}

function charIndexAfterWords(text: string, count: number): number {
  const re = /\S+/g;
  let seen = 0;
  for (const match of text.matchAll(re)) {
    seen += 1;
    if (seen === count) return (match.index ?? 0) + match[0].length;
  }
  return text.length;
}

function chooseSafetySplit(text: string): { index: number; reason: "safety_bound" | "safe_forced_split" } {
  const hard = charIndexAfterWords(text, MAX_PRESENTATION_WORDS);
  const target = charIndexAfterWords(text, FORCED_SPLIT_TARGET_WORDS);
  let best = -1;
  for (const match of text.matchAll(/[,;:]\s+/g)) {
    const end = (match.index ?? 0) + match[0].trimEnd().length;
    const leftWords = wordCount(text.slice(0, end));
    if (leftWords >= MIN_SAFE_PREFIX_WORDS && end <= hard) best = end;
  }
  if (best > 0) return { index: best, reason: "safety_bound" };

  for (const match of text.matchAll(/\s+(?:and|but|so|because)\s+/gi)) {
    const start = match.index ?? 0;
    const leftWords = wordCount(text.slice(0, start));
    if (leftWords >= MIN_SAFE_PREFIX_WORDS && start <= target) best = start;
  }
  if (best > 0) return { index: best, reason: "safety_bound" };
  return { index: target, reason: "safe_forced_split" };
}

function decision(
  reason: PresentationBoundaryReason,
  text: string,
  providerFinalCount: number,
  heldSince: number,
  at: number,
): PresentationBoundaryDecision {
  return {
    reason,
    text,
    wordCount: wordCount(text),
    charCount: text.length,
    providerFinalCount,
    heldMs: heldSince ? Math.max(0, at - heldSince) : 0,
  };
}

/**
 * Live Presentation V3 boundary policy. It changes only permanence: callers
 * continue rendering every interim immediately. The returned emissions and
 * pending tail concatenate to the exact input text (normalising only the same
 * inter-segment whitespace V2 already normalised).
 */
export function pushPresentationSegment(
  prior: PresentationThoughtState,
  rawSegment: string,
  at: number,
): PresentationThoughtResult {
  const segment = rawSegment.trim();
  if (!segment) return { state: prior, thoughts: [], decisions: [] };

  const thoughts: PresentationThoughtEmission[] = [];
  const decisions: PresentationBoundaryDecision[] = [];
  let pendingText = prior.text.trim();
  let rawSegments = [...prior.rawSegments];
  let heldSince = prior.heldSince || at;
  let providerFinalCount = prior.providerFinalCount;

  const emit = (text: string, reason: PresentationThoughtEmission["reason"]) => {
    const clean = text.trim();
    if (!clean) return;
    thoughts.push({
      text: clean,
      reason,
      rawSegments: [...rawSegments],
      providerFinalCount: Math.max(1, providerFinalCount),
      heldSince,
      settledAt: at,
    });
    decisions.push(decision(reason, clean, Math.max(1, providerFinalCount), heldSince, at));
  };
  const emitBounded = (text: string, reason: PresentationThoughtEmission["reason"]) => {
    let rest = text.trim();
    while (wordCount(rest) > MAX_PRESENTATION_WORDS) {
      const split = chooseSafetySplit(rest);
      emit(rest.slice(0, split.index), split.reason);
      rest = rest.slice(split.index).trim();
    }
    emit(rest, reason);
  };

  // A later provider final can prove that an unpunctuated prior final was a
  // closed beat. Continuation-led segments deliberately do not provide that
  // evidence.
  if (pendingText && isStablePresentationClause(pendingText) && !startsAsContinuation(segment)) {
    emitBounded(pendingText, "stable_clause");
    pendingText = "";
    rawSegments = [];
    heldSince = at;
    providerFinalCount = 0;
  }

  pendingText = `${pendingText} ${segment}`.trim();
  rawSegments.push(rawSegment);
  providerFinalCount += 1;

  // Strong internal punctuation closes completed prefixes immediately while
  // leaving an unresolved tail live. Each sentence is a readable presentation
  // unit; malformed/open punctuation is left in the tail.
  let cursor = 0;
  for (const end of strongBoundaryEnds(pendingText)) {
    const candidate = pendingText.slice(cursor, end).trim();
    if (!candidate || !isStablePresentationClause(candidate, true)) continue;
    emitBounded(candidate, end < pendingText.length ? "completed_prefix" : "terminal_complete");
    cursor = end;
    // A single provider final can contain several sentences and a tail. Keep
    // that final as provenance for every derived presentation unit without
    // duplicating any visible words.
    rawSegments = [rawSegment];
    heldSince = at;
    providerFinalCount = 1;
  }
  if (cursor > 0) pendingText = pendingText.slice(cursor).trim();

  // One hard readability bound prevents punctuation-poor accumulation. Prefer
  // a recent comma/conjunction boundary; otherwise split at an exact word
  // boundary. No token is removed or rearranged.
  while (wordCount(pendingText) > MAX_PRESENTATION_WORDS) {
    const split = chooseSafetySplit(pendingText);
    const prefix = pendingText.slice(0, split.index).trim();
    const tail = pendingText.slice(split.index).trim();
    emit(prefix, split.reason);
    pendingText = tail;
    rawSegments = [rawSegment];
    heldSince = at;
    providerFinalCount = 1;
  }

  const state = pendingText
    ? { text: pendingText, rawSegments, heldSince, providerFinalCount }
    : EMPTY_PRESENTATION_THOUGHT;
  if (pendingText) decisions.push(decision("continuation_hold", pendingText, providerFinalCount, heldSince, at));
  return { state, thoughts, decisions };
}

export function flushPresentationThought(
  state: PresentationThoughtState,
  at: number,
): PresentationThoughtResult {
  const text = state.text.trim();
  if (!text) return { state: EMPTY_PRESENTATION_THOUGHT, thoughts: [], decisions: [] };
  const reason = isStablePresentationClause(text) ? "stable_clause" : "safe_forced_split";
  const emission: PresentationThoughtEmission = {
    text,
    reason,
    rawSegments: [...state.rawSegments],
    providerFinalCount: state.providerFinalCount,
    heldSince: state.heldSince,
    settledAt: at,
  };
  return {
    state: EMPTY_PRESENTATION_THOUGHT,
    thoughts: [emission],
    decisions: [decision(reason, text, state.providerFinalCount, state.heldSince, at)],
  };
}


/**
 * One settled thought: the unit Live Speech Presentation V2 emits once a run
 * of Deepgram finals has stopped moving, and the only input the visual engine
 * consumes. Lived under `lib/visualReentry/types.ts` while Visual Re-entry was
 * the engine; it was never a Visual Re-entry concept, so it stayed when that
 * engine was deleted and the Expression Engine became the only consumer.
 */
export interface SettledThought {
  id: string;
  text: string;
  sourceSegments: string[];
  page: number;
  /** Session-clock time at which the first contributing final was received. */
  startedAt?: number;
  settledAt: number;
  sessionGeneration?: number;
  sourceRegion?: {
    audioStartMs: number;
    audioEndMs: number;
  };
  /** Present on combined evidence sources; single thoughts implicitly contain their own id. */
  participantThoughtIds?: string[];
}
