/**
 * What the speaker actually says, versus what the recogniser heard.
 *
 * Two jobs, in order of how much they can hurt:
 *
 *  1. **Keyterms.** Deepgram's nova-3 accepts a list of terms to bias toward.
 *     Feeding it the words already on the canvas is nearly free and it is the
 *     only fix that works *before* the mistake is made. Everything below is
 *     repair work.
 *
 *  2. **Correction.** When a term is already on the board and the transcript
 *     contains something that sounds like it, that is almost always the term.
 *     "air agents" after "AI agents" is on the page is not a coincidence.
 *
 * The second job is dangerous and is deliberately hard to trigger. A correction
 * layer that rewrites ordinary English is worse than no correction layer at
 * all — the speaker sees their own words replaced with something they didn't
 * say, on camera. So: a span is only rewritten when the target is ACTIVE (on
 * the canvas, or in a section title, or an explicit known-error mapping) and
 * the phonetic evidence is strong. Everything else is left exactly as heard.
 */

// --- the speaker's vocabulary --------------------------------------------

/**
 * Seed terms. These are the proper nouns this speaker uses that a general
 * recogniser has no reason to know, collected from real sessions. They are
 * keyterms from the first second of a take, before anything is on the canvas
 * to learn from.
 *
 * Extend at runtime with NEXT_PUBLIC_KEYTERMS="Foo,Bar Baz".
 */
export const SEED_TERMS: string[] = [
  "Airline",
  "AI agents",
  "Affiliate Capital",
  "InPublic",
  "ClickLabs",
  "Excalidraw",
  "Deepgram",
  "Anthropic",
  "Claude",
  "Trinidad and Tobago",
  "Kenny Farmer",
  "sketchnote",
  "keyterm",
  "agentic",
  "LLM",
];

function envTerms(): string[] {
  const raw = process.env.NEXT_PUBLIC_KEYTERMS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface TermSource {
  /** Labels of concepts on the semantic board, most recent first. */
  concepts?: string[];
  /** Text of marks lettered on the canvas. */
  marks?: string[];
  /** Section titles. */
  sections?: string[];
}

/**
 * The keyterm list for the recogniser, most valuable first.
 *
 * Priority is the whole point: Deepgram weights early terms more, and terms
 * that are *already on the canvas* are the ones the speaker is actively
 * talking about, so they come before the seeds. Capped because a huge list
 * dilutes the bias and costs connection time.
 */
export function keyterms(source: TermSource, limit = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (term: string) => {
    const clean = term.trim().replace(/\s+/g, " ");
    // Single short words are noise as keyterms and risk biasing common speech.
    if (clean.length < 3) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };

  for (const t of source.sections ?? []) if (t !== "Untitled") push(t);
  for (const t of source.concepts ?? []) push(t);
  for (const t of source.marks ?? []) push(t);
  for (const t of envTerms()) push(t);
  for (const t of SEED_TERMS) push(t);

  return out.slice(0, limit);
}

// --- known mishearings ----------------------------------------------------

/**
 * Errors seen in real transcripts, where the heard form is not a phrase anyone
 * would say and the intended form is unambiguous. These apply without needing
 * the target to be on the canvas — but they are exact-phrase only, and the
 * list stays short on purpose. Anything speculative belongs in the phonetic
 * path, where it has to earn the rewrite.
 */
export const KNOWN_ERRORS: { heard: RegExp; write: string }[] = [
  { heard: /\bair agents?\b/gi, write: "AI agents" },
  { heard: /\ba\.?\s?i\.?\s+agents?\b/gi, write: "AI agents" },
  { heard: /\bay eye agents?\b/gi, write: "AI agents" },
  { heard: /\bap[ip] agents?\b/gi, write: "API agents" },
  { heard: /\bdeep gram\b/gi, write: "Deepgram" },
  { heard: /\bexcali draw\b/gi, write: "Excalidraw" },
  { heard: /\bin public\b(?=\s+(?:app|board|canvas))/gi, write: "InPublic" },
];

// --- phonetics ------------------------------------------------------------

/**
 * A deliberately crude phonetic key. Not Metaphone — Metaphone's whole design
 * is to collapse aggressively, and aggressive collapsing is exactly what turns
 * a correction layer into a vandal. This keeps vowel *presence* and collapses
 * only the consonant confusions that actually cause recogniser errors.
 */
export function phoneticKey(word: string): string {
  let s = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return "";
  s = s
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/qu?/g, "k")
    .replace(/x/g, "ks")
    .replace(/[cz]/g, "s")
    .replace(/[wy]/g, "")
    .replace(/gh/g, "")
    .replace(/([bdfgjklmnprstv])\1+/g, "$1")
    // Vowels collapse to a single class but are not dropped: "airline" and
    // "Orlean" must not become the same key.
    .replace(/[aeiou]+/g, "a");
  return s;
}

/**
 * The phonetic key for a whole phrase, with the spaces removed.
 *
 * Removing them is the point. Speech has no word boundaries — the recogniser
 * invents them, and inventing them wrongly is exactly the error being repaired
 * here: "Airline" comes back as "your line", "Deepgram" as "deep gram". Keep
 * the spaces and those never match, because the comparison is then between a
 * one-word key and a two-word one.
 */
export function phoneticPhrase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map(phoneticKey)
    .filter(Boolean)
    .join("");
}

/** Levenshtein, capped — we only ever care about "close". */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

/** 0..1 — how alike two phrases sound. 1 is an exact phonetic match. */
export function soundsLike(a: string, b: string): number {
  const ka = phoneticPhrase(a);
  const kb = phoneticPhrase(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const cap = Math.ceil(Math.max(ka.length, kb.length) * 0.4);
  const d = editDistance(ka, kb, cap);
  if (d > cap) return 0;
  return 1 - d / Math.max(ka.length, kb.length);
}

// --- the guard rail -------------------------------------------------------

/**
 * Words a correction may never invent over. If the speaker said an ordinary
 * English word, they said it — no term on the board is worth overwriting
 * "people" with. A term that IS one of these words (a product called "Lock",
 * say) simply doesn't get phonetic correction, which is the right trade.
 */
const PROTECTED = new Set(
  `people person business businesses company companies thing things time
   good bad better best work working made make making use used using
   about after again all also always another any because been before being
   between both call called came come could does done down each even every
   first from give given going great have having here into just know known
   like little long look made many more most much must never next only other
   over own place point right same should since some still such take taken
   than that their them then there these they thing think this those through
   under very want water well were what when where which while will with
   would year years your air line lines airline agent agents data control
   trust problem problems sales service services customer customers family
   goal goals life school home money world`
    .split(/\s+/)
    .filter(Boolean),
);

export interface Correction {
  from: string;
  to: string;
  /** 0..1 — how sure we are. Below `MIN_CONFIDENCE` nothing is rewritten. */
  confidence: number;
  why: "known-error" | "canvas-term";
}

const explicitNamedTerms = (): Set<string> =>
  new Set([...SEED_TERMS, ...envTerms()].map((term) => term.toLowerCase()));

export const MIN_CONFIDENCE = 0.86;

/**
 * Rewrite what the recogniser heard, conservatively.
 *
 * Returns the corrected text plus every change made, so the log can show what
 * was rewritten and the speaker can tell the system is doing it.
 *
 * `active` is the terms currently on the canvas — a term not on the canvas
 * gets no phonetic authority at all. That is the load-bearing restriction:
 * it means correction can only ever pull speech *toward what is already
 * visible*, which is the one direction that cannot surprise the speaker.
 */
export function correctTranscript(
  text: string,
  active: string[],
): { text: string; corrections: Correction[] } {
  const corrections: Correction[] = [];
  let out = text;

  for (const { heard, write } of KNOWN_ERRORS) {
    out = out.replace(heard, (match) => {
      if (match.toLowerCase() === write.toLowerCase()) return match;
      corrections.push({
        from: match,
        to: write,
        confidence: 1,
        why: "known-error",
      });
      return write;
    });
  }

  // Multi-word terms first: "affiliate capital" must win over "capital".
  // Canvas ink is contextual recognition evidence, not authority over ordinary
  // English. Only explicit named vocabulary may rewrite the provider result.
  // This general boundary is what keeps ran/run/rain distinct without a list
  // of one-off forbidden replacements.
  const named = explicitNamedTerms();
  const terms = [...new Set(active.map((t) => t.trim()).filter((t) =>
    t.length >= 4 && named.has(t.toLowerCase()),
  ))]
    .sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length);
  if (terms.length === 0) return { text: out, corrections };

  /**
   * How many heard words a term might have been split into.
   *
   * The recogniser both splits a name into pieces ("Airline" -> "your line")
   * and runs one into its neighbour, so a term has to be tried against spans
   * either side of its own word count.
   *
   * Every candidate span is SCORED and the best one wins — an earlier version
   * took the longest span that cleared the bar, and that quietly deleted words
   * the speaker had said: "move on to Affiliate Capital" matched the
   * three-word span "to Affiliate Capital" at 0.88 and swallowed the "to".
   * The two-word span scores 1.0, and the tighter span wins ties, so the
   * function word survives.
   */
  const spansFor = (term: string): number[] => {
    const n = term.split(/\s+/).length;
    return n === 1 ? [1, 2] : [n, n - 1, n + 1];
  };

  const words = out.split(/(\s+)/); // keep separators, so spacing survives
  const wordIndexes: number[] = [];
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].trim()) wordIndexes.push(i);
  }

  const consumed = new Set<number>();
  for (const term of terms) {
    const termWords = term.split(/\s+/).length;
    const spans = spansFor(term).filter((s) => s >= 1);
    for (let w = 0; w < wordIndexes.length; w += 1) {
      if (consumed.has(w)) continue;

      // Score every span starting here, then take the best. Ties go to the
      // shorter span, which is what keeps neighbouring words out of the match.
      let bestSpan = 0;
      let bestScore = 0;
      let bestBare = "";
      for (const span of spans) {
        if (w + span > wordIndexes.length) continue;
        const idxs = wordIndexes.slice(w, w + span);
        if (idxs.some((_, k) => consumed.has(w + k))) continue;

        const heard = idxs.map((i) => words[i]).join(" ");
        const bare = heard.replace(/[^A-Za-z0-9\s'-]/g, "").trim();
        if (!bare) continue;
        if (bare.toLowerCase() === term.toLowerCase()) {
          bestSpan = 0; // already correct; nothing to do at this position
          break;
        }

        const score = soundsLike(bare, term);
        if (score < MIN_CONFIDENCE) continue;

        // A span WIDER than the term has to be near-perfect, because the extra
        // word is a word the speaker said and the rewrite would delete it. A
        // genuine split scores 1.0 ("your line" -> "Airline", "deep gram" ->
        // "Deepgram"); an accidental overlap does not ("to Affiliate Capital"
        // scores 0.88 against "Affiliate Capital", and the "to" is real).
        if (span > termWords && score < 0.95) continue;

        // The guard rail. An ordinary English word is never overwritten unless
        // the phonetic match is exact — an exact-key collision on a single
        // common word is a coincidence, not evidence.
        const anyProtected = bare
          .toLowerCase()
          .split(/\s+/)
          .some((x) => PROTECTED.has(x));
        if (anyProtected && (span === 1 || score < 1)) continue;

        if (score > bestScore + 1e-9) {
          bestScore = score;
          bestSpan = span;
          bestBare = bare;
        }
      }

      if (!bestSpan) continue;

      const idxs = wordIndexes.slice(w, w + bestSpan);
      const heard = idxs.map((i) => words[i]).join(" ");
      // Trailing punctuation the recogniser attached belongs to the sentence,
      // not to the term.
      const tail = heard.match(/[^A-Za-z0-9\s'-]+$/)?.[0] ?? "";
      words[idxs[0]] = term + tail;
      for (let k = 1; k < idxs.length; k += 1) {
        words[idxs[k]] = "";
        // and swallow the separator before it
        words[idxs[k] - 1] = "";
      }
      for (let k = 0; k < bestSpan; k += 1) consumed.add(w + k);
      corrections.push({
        from: bestBare,
        to: term,
        confidence: bestScore,
        why: "canvas-term",
      });
    }
  }

  return { text: words.join("").replace(/\s+/g, " ").trim(), corrections };
}

/**
 * Is this text grounded in what was actually said?
 *
 * The Scribe is told to letter the speaker's words and mostly does, but it
 * occasionally emits a mark assembled out of nothing — "puts AI" — which reads
 * on camera as the board hallucinating. A mark has to be traceable to the
 * source speech, allowing for the corrections above (so "AI agents" is still
 * grounded in "air agents").
 */
export function groundedInSource(mark: string, source: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const m = norm(mark);
  const s = norm(source);
  if (m.length === 0) return false;
  if (s.length === 0) return true; // nothing to check against; don't block

  const src = new Set(s);
  let hit = 0;
  for (const w of m) {
    if (src.has(w)) {
      hit += 1;
      continue;
    }
    // A word the Scribe cleaned up still counts if it sounds like one that
    // was said.
    if (s.some((x) => soundsLike(w, x) >= 0.9)) hit += 1;
  }
  return hit / m.length >= 0.5;
}
