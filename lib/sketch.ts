/**
 * The local fallback's language processing.
 *
 * This is the floor, not the ceiling: when the Scribe is healthy it does the
 * drawing and none of this runs. When the Scribe stalls or errors, this keeps
 * marks landing so the board never goes dead mid-sentence. It has no idea what
 * you are talking about — it finds nouns.
 *
 * All geometry lives in ops.ts. This file only decides *what words matter*.
 */

const STOPWORDS = new Set(
  `a an and are as at be been being but by can cant could did do does doing done
   dont down each even every for from get gets got had has have having he her
   here hers him his how i if in into is it its itself just me might mine more
   most much must my no nor not now of off on once one only or other our ours
   out over own re said same shall she should since so some such than that thats
   the their theirs them then there these they this those though through to too
   under until up us very was way we well were what when where which while who
   whom why will with within would you your yours
   um uh er ah oh yeah yep nope okay ok right like basically actually literally
   obviously essentially anyway anyways sort kind lot bit really quite pretty
   maybe probably definitely gonna wanna gotta lets let
   thing things stuff way ways part parts point points idea ideas
   going goes go went come comes came take takes took make makes made
   give gives gave say says see sees look looks want wants need needs
   know knows think thinks mean means work works working use uses used
   call calls called put puts happen happens start starts end ends
   about above after again against all also always am among another any
   because before below between both during few first last next many never
   often per rather still sure thus together toward upon whether yet
   second seconds minute minutes moment sec
   decide decides decided seem seems feel feels become becomes remain remains
   keep keeps allow allows help helps try tries add adds worth able sure
   talk talks talking tell tells said guess suppose imagine remember
   built build builds building trying tried interact interacts view views
   stop stops stopped show shows shown cover covers covering discuss
   video today tomorrow yesterday guys folks everyone everybody
   really just even still also quite rather actually`
    .split(/\s+/)
    .filter(Boolean),
);

const MAX_PHRASE_WORDS = 3;
const MIN_WORD_LEN = 3;
/** A lone short word ("Beat", "Job") is usually noise; a phrase rarely is. */
const MIN_SOLO_WORD_LEN = 5;

/**
 * "they'll" and "there'll" are stopwords wearing a disguise — the raw token
 * misses the list and gets boxed. Strip the clitic before checking.
 */
function normalize(word: string): string {
  return word.replace(/'(?:ll|re|ve|d|s|m)$/, "");
}

function titleCase(phrase: string): string {
  return phrase
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Pull salient phrases out of a transcript: contiguous runs of words that
 * aren't filler. `seen` is mutated so the same concept is never drawn twice,
 * including near-duplicates as an utterance grows.
 *
 * `isInterim` holds back the trailing run. Mid-utterance the last run is still
 * being spoken — emitting it early turns "beat detector" into a lone "Beat"
 * and then blocks the real phrase as a duplicate.
 */
export function extractConcepts(
  text: string,
  seen: Set<string>,
  isInterim = false,
): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const found: string[] = [];
  let run: string[] = [];

  const flush = () => {
    while (run.length > 0) {
      const chunk = run.slice(0, MAX_PHRASE_WORDS);
      const phrase = chunk.join(" ");
      const soloTooShort =
        chunk.length === 1 && phrase.length < MIN_SOLO_WORD_LEN;
      run = run.slice(MAX_PHRASE_WORDS);
      if (phrase.length < MIN_WORD_LEN || soloTooShort) continue;
      let overlaps = false;
      for (const prior of seen) {
        if (prior.includes(phrase) || phrase.includes(prior)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      seen.add(phrase);
      found.push(titleCase(phrase));
    }
  };

  for (const raw of words) {
    const word = normalize(raw);
    if (STOPWORDS.has(word) || word.length < MIN_WORD_LEN || /^\d+$/.test(word)) {
      flush();
    } else {
      run.push(word);
    }
  }
  // Only a final transcript closes the last run; an interim's tail is still
  // mid-phrase.
  if (!isInterim) flush();

  return found;
}

// --- speech acts ----------------------------------------------------------

export type Gesture =
  | { kind: "greeting"; text: string }
  | { kind: "title"; text: string }
  /** Topic announced, but not yet named. The next concept becomes the title. */
  | { kind: "title-pending" };

const GREETING_RE =
  /^\s*(?:so\s+|okay\s+|alright\s+)?(hey|hi|hello|yo|welcome|what'?s up|good morning|good afternoon|good evening)\b[^.?!]*/i;

const TITLE_RE =
  /\b(?:talk|talking|talked|discuss|discussing|cover|covering|go over|going over|walk through|walking through|show you|get into|dig into)\s+(?:you\s+)?(?:about\s+)?([^.?!,]{3,60})/i;

export function detectGesture(
  text: string,
  done: Set<string>,
): Gesture | null {
  if (!done.has("greeting")) {
    const m = text.match(GREETING_RE);
    if (m) {
      const phrase = m[0].trim().replace(/\s+/g, " ");
      if (phrase.split(" ").length >= 2) {
        return { kind: "greeting", text: titleCase(phrase.toLowerCase()) };
      }
    }
  }
  if (!done.has("title") && !done.has("title-pending")) {
    const m = text.match(TITLE_RE);
    if (m?.[1]) {
      const topic = m[1]
        .trim()
        .replace(/^(?:about|through|over|you|to)\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
      const meaningful =
        topic.length >= 3 &&
        topic
          .split(/\s+/)
          .some((w) => !STOPWORDS.has(normalize(w.toLowerCase())));
      return meaningful
        ? { kind: "title", text: titleCase(topic.toLowerCase()) }
        : { kind: "title-pending" };
    }
  }
  return null;
}
