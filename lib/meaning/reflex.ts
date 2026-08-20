/**
 * The reflex layer: visuals that react *during* speech.
 *
 * ## What this inverts
 *
 * Until now the split ran the wrong way for a wordless product. Deepgram
 * interims reached only `writeLive` — the caption line — while every visual
 * system waited for a settled thought. So words were live and pictures
 * lagged, which is precisely backwards from "the canvas must not wait for a
 * fully completed thought."
 *
 * This module is the other half of that inversion. It consumes the same
 * settled-interim words `components/Board.tsx` already computes (the prefix
 * two consecutive interims agree on — see `handleInterim`), and turns them
 * into provisional *signs* rather than text.
 *
 * ## Why tentative, and why they change
 *
 * A guess made mid-sentence is drawn thin and dashed (`tentative`), and it is
 * expected to be revised. That revision is the feature, not a defect to
 * suppress: as the speaker gets further into a clause, the same clause index
 * re-scans to a sharper sign, and the diff reports it as `updated` rather
 * than as a remove-and-add. "Onboarding" draws a funnel; two words later
 * "onboarding is too complicated" redraws that same funnel tangled. The sign
 * never blinks out and back — it sharpens in place, which is what makes the
 * screen read as a mind following along rather than a slideshow.
 *
 * Identity is the clause's position in the utterance, not its text. Keying on
 * text would make every added word a brand-new sign, and the sheet would fill
 * with the history of a sentence instead of showing its meaning.
 *
 * ## The lifecycle, and who ends it
 *
 * Provisional signs are scaffolding with a deliberately short life:
 *
 *   interim words  → scanProvisional → tentative signs drawn
 *   thought settles → clearProvisional → scaffolding removed, and the Meaning
 *                     Engine's real (model-decided, confident) signs take the
 *                     region
 *
 * Retraction is the same mechanism as revision: if Deepgram walks a clause
 * back, it stops appearing in the scan and the diff reports it `removed`. No
 * separate retraction path is needed, and no guess can outlive the words that
 * produced it.
 *
 * ## Cost
 *
 * Pure and synchronous — regex and table lookups, no model, no network, no
 * allocation beyond the diff. That is what makes it affordable on every
 * interim tick, and it is what keeps V2's protected invariant 1 ("no model in
 * the Tier 1 live path") intact while inverting invariants 6 and 7. See
 * docs/WORDLESS-VISUAL-OVERHAUL-V1.md.
 */

import { scanUtterance, type VisualSign } from "./lexicon";

export interface ProvisionalSign {
  /** `${utteranceId}:${clauseIndex}` — stable while the clause is being spoken. */
  key: string;
  /** Clause position within the utterance. Drives left-to-right placement. */
  index: number;
  /** The clause this came from. Internal only — logged, never drawn. */
  phrase: string;
  sign: VisualSign;
  /** Change detection, so a re-scan that decided nothing new redraws nothing. */
  signature: string;
}

export interface ProvisionalState {
  /** Which utterance the current signs belong to; a new one clears the old. */
  utteranceId: string;
  byKey: Map<string, ProvisionalSign>;
}

export interface ProvisionalDiff {
  added: ProvisionalSign[];
  /** Same clause, sharper reading — redrawn in place, never removed and re-added. */
  updated: ProvisionalSign[];
  removed: string[];
  state: ProvisionalState;
}

export function emptyProvisionalState(): ProvisionalState {
  return { utteranceId: "", byKey: new Map() };
}

function signatureOf(sign: VisualSign): string {
  return [sign.glyph, sign.charge, sign.texture, sign.motion, sign.scale, sign.negated].join("|");
}

const NO_CHANGE = (state: ProvisionalState): ProvisionalDiff => ({
  added: [],
  updated: [],
  removed: [],
  state,
});

/**
 * Scan the utterance so far and diff it against what is currently drawn.
 *
 * `utteranceText` is everything settled in this utterance, not just the newly
 * settled delta: a clause's meaning routinely depends on words that settled
 * several ticks ago ("onboarding" … "is too complicated"), and re-scanning the
 * whole utterance is what lets an existing sign sharpen instead of a second
 * one appearing beside it. It is cheap enough to do every tick — a spoken
 * utterance is a few dozen words, and the scan is regex over clauses.
 *
 * A new `utteranceId` retires everything from the previous one, so provisional
 * ink can never accumulate across utterances.
 */
export function scanProvisional(
  state: ProvisionalState,
  utteranceText: string,
  utteranceId: string,
): ProvisionalDiff {
  const carriedOver = state.utteranceId === utteranceId;
  const previous = carriedOver ? state.byKey : new Map<string, ProvisionalSign>();

  const scanned = scanUtterance(utteranceText);
  const next = new Map<string, ProvisionalSign>();
  const added: ProvisionalSign[] = [];
  const updated: ProvisionalSign[] = [];

  for (const { index, phrase, sign } of scanned) {
    const key = `${utteranceId}:${index}`;
    const entry: ProvisionalSign = { key, index, phrase, sign, signature: signatureOf(sign) };
    next.set(key, entry);
    const before = previous.get(key);
    if (!before) added.push(entry);
    else if (before.signature !== entry.signature) updated.push(entry);
  }

  // Anything previously drawn and no longer scanned: Deepgram revised those
  // words away, or the clause resolved into something the vocabulary does not
  // picture. Either way the ink must go.
  const removed = [...previous.keys()].filter((key) => !next.has(key));
  if (!carriedOver) removed.push(...state.byKey.keys());

  if (!added.length && !updated.length && !removed.length) {
    // Still update the id, or a new utterance that happened to scan
    // identically would keep reporting the old one as current.
    return NO_CHANGE({ utteranceId, byKey: next });
  }
  return { added, updated, removed, state: { utteranceId, byKey: next } };
}

/**
 * Retire every provisional sign — the thought has settled and the Meaning
 * Engine's real signs are about to be drawn, or the board was cleared.
 *
 * Called at the moment of settlement rather than after the real sync lands, so
 * a viewer never sees a guess and its confident replacement on screen at once.
 */
export function clearProvisional(state: ProvisionalState): ProvisionalDiff {
  if (!state.byKey.size) return NO_CHANGE(emptyProvisionalState());
  return {
    added: [],
    updated: [],
    removed: [...state.byKey.keys()],
    state: emptyProvisionalState(),
  };
}
