/**
 * Shared contextual target-resolution substrate for topic-recall references
 * and discourse-act targets. Both are the same question — "which already-
 * known world entity does this free-text pointer name?" — asked from two
 * grammars of pointer. Ranking used to be label Jaccard plus a flat 40 for
 * any shared claim word, which is why the frozen meeting's unresolved
 * references and unapplied lifecycle acts clustered as ranking ties: extra
 * words in the pointer diluted the real target, while one coincidental
 * claim word (discussion, growth, weeks) promoted an unrelated neighbor to
 * the same score.
 *
 * Eligibility is still only granted by lexical/alias or claim evidence —
 * recency, topic, speaker, neighborhood, and lifecycle never make a
 * candidate eligible on their own, only rank already-eligible ones. A
 * correct abstention is still better than a wrong semantic mutation; the
 * decision layer refuses to pick when two eligible candidates cannot be
 * told apart deterministically (including the parent/child label-subset
 * case, "free tier" vs "revisit the free tier").
 *
 * An optional constrained judge (targetJudge.ts) may break a remaining
 * tie by index; it is never given a world id and cannot invent one.
 */

import { contentWords, normalizeMention } from "./apply";
import {
  isLiveEntityStatus,
  type DiscourseActType,
  type Provenance,
  type ReferenceCandidate,
  type WorldEntity,
  type WorldState,
} from "../schemas";

export interface TargetContext {
  speakerHint?: string;
  /** When resolving a discourse act, the verb — used only as a ranking bonus, never as eligibility. */
  actType?: DiscourseActType;
}

export interface TargetCandidate extends ReferenceCandidate {
  status: WorldEntity["status"];
  kind: WorldEntity["type"];
  description?: string;
  reasons: string[];
}

export interface TargetDecision {
  candidates: TargetCandidate[];
  chosenId: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  /** True when more than one eligible candidate exists and deterministic evidence cannot separate them. */
  needsJudge: boolean;
}

export interface TargetJudgeInput {
  surface: string;
  hint: string;
  kind: "topic_recall" | "discourse_act";
  actType?: DiscourseActType;
  speakerHint?: string;
  candidates: Array<{
    index: number;
    label: string;
    description?: string;
    status: WorldEntity["status"];
    kind: WorldEntity["type"];
    reasons: string[];
  }>;
}

export type TargetJudgeVerdict = "resolved" | "uncertain";

export interface TargetJudgeResult {
  /** Index into the candidate list the judge was given. Null when uncertain. */
  index: number | null;
  verdict: TargetJudgeVerdict;
  reason: string;
}

export type TargetJudge = (input: TargetJudgeInput) => Promise<TargetJudgeResult>;

export const abstainTargetJudge: TargetJudge = async () => ({
  index: null,
  verdict: "uncertain",
  reason: "no target judge configured — abstaining rather than guessing",
});

const MARGIN = 25;
const RECENT_WINDOW = 8;
const MAX_CANDIDATES = 5;

/**
 * Same narrow inflectional stemmer identity.ts uses — copied, not imported,
 * so a later identity-layer change cannot silently retune this matcher.
 * Hyphens are split first: "step-four" and "step four" have to compare equal
 * or alias evidence ("step four" on biggest-drop-off-point) never fires for
 * a "step-four problem" pointer.
 */
function stem(word: string): string {
  if (word.length <= 3) return word;
  const undoubleFinal = (s: string) => (s.length >= 4 && /([bcdfgjklmnpqrstvwxz])\1$/.test(s) ? s.slice(0, -1) : s);
  if (word.length > 5 && word.endsWith("ing")) return undoubleFinal(word.slice(0, -3));
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("ed")) return undoubleFinal(word.slice(0, -2));
  if (word.length > 4 && /[sxz]es$|[cs]hes$/.test(word)) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function targetTokens(text: string): string[] {
  return contentWords(text)
    .flatMap((w) => w.split(/-+/).filter(Boolean))
    .map(stem)
    .filter((w) => w.length > 0);
}

function tokenSet(text: string): Set<string> {
  return new Set(targetTokens(text));
}

function subset(a: Set<string>, b: Set<string>): boolean {
  if (!a.size) return false;
  return [...a].every((w) => b.has(w));
}

function speakerMatches(entries: Provenance[] | undefined, hint: string): boolean {
  if (!entries?.length) return false;
  const wanted = normalizeMention(hint);
  return entries.some((p) => p.speakerId && normalizeMention(p.speakerId) === wanted);
}

/**
 * Lexical score of one surface (label, alias, or description) against the
 * pointer's tokens. Recall of the POINTER is weighted above precision of
 * the label so a 3-word target inside a longer pointer ("growth marketer
 * role that was paused a few weeks ago") outranks a 1-word coincidental
 * head ("pricing" inside "usage-based pricing"). A 1-word label contained
 * in a longer pointer is capped so it can corroborate but cannot dominate.
 */
function lexicalAgainst(hintTokens: Set<string>, text: string): { score: number; overlap: number; size: number } {
  const words = tokenSet(text);
  if (!words.size || !hintTokens.size) return { score: 0, overlap: 0, size: 0 };
  const overlap = [...words].filter((w) => hintTokens.has(w)).length;
  if (!overlap) return { score: 0, overlap: 0, size: words.size };
  const recall = overlap / hintTokens.size;
  let score = Math.round(recall * 80 + overlap * 15);
  if (words.size === 1 && hintTokens.size >= 2) score = Math.min(score, 45);
  // Full containment of a multi-word label: score by HOW MANY tokens were
  // contained, not a flat 85 — otherwise "paused the role" (2) ties
  // "growth marketer role" (3) inside a long pointer that happens to
  // include both.
  if (overlap === words.size && words.size >= 2) score = Math.min(90, overlap * 30);
  return { score: Math.min(90, score), overlap, size: words.size };
}

function recentIds(world: WorldState): Set<string> {
  const threshold = world.seq - RECENT_WINDOW;
  return new Set(world.entities.filter((e) => e.lastTouchedSeq >= threshold).map((e) => e.id));
}

function neighborIds(world: WorldState, id: string): Set<string> {
  const out = new Set<string>();
  for (const r of world.relations) {
    if (r.source === id) out.add(r.target);
    else if (r.target === id) out.add(r.source);
  }
  return out;
}

/**
 * Retrieve and score every entity some lexical or claim signal actually
 * supports. Ranking bonuses (topic, recency, speaker, neighborhood,
 * lifecycle) never create a candidate that had no textual evidence.
 */
export function retrieveTargetCandidates(world: WorldState, hint: string, ctx: TargetContext = {}): TargetCandidate[] {
  const hintNorm = normalizeMention(hint);
  const hintTokens = tokenSet(hint);
  if (!hintTokens.size) return [];

  const recent = recentIds(world);
  const focus = new Set((world.salience ?? []).slice(0, 6));
  const candidates: TargetCandidate[] = [];

  for (const entity of world.entities) {
    const reasons: string[] = [];
    let score = 0;
    let eligible = false;

    const labelNorm = normalizeMention(entity.label);
    const exact = labelNorm === hintNorm || entity.aliases.includes(hintNorm);
    if (exact) {
      eligible = true;
      score = 100;
      reasons.push("exact label/alias match");
    } else {
      let bestLex = lexicalAgainst(hintTokens, entity.label);
      let bestSource = `label "${entity.label}"`;
      for (const alias of entity.aliases) {
        const lex = lexicalAgainst(hintTokens, alias);
        if (lex.score > bestLex.score) {
          bestLex = lex;
          bestSource = `alias "${alias}"`;
        }
      }
      if (entity.description) {
        const lex = lexicalAgainst(hintTokens, entity.description);
        const capped = Math.min(lex.score, 35);
        if (capped > bestLex.score) {
          bestLex = { ...lex, score: capped };
          bestSource = "description";
        }
      }
      if (bestLex.score > 0) {
        eligible = true;
        score = bestLex.score;
        reasons.push(`${bestLex.overlap} token(s) via ${bestSource}`);
      }
    }

    const lexicalScore = score;
    const claimHit = world.claims.find((c) => {
      if (!(c.about ?? []).includes(entity.id)) return false;
      const claimTokens = tokenSet(c.text);
      return [...hintTokens].some((w) => claimTokens.has(w));
    });
    if (claimHit) {
      const claimTokens = tokenSet(claimHit.text);
      const shared = [...hintTokens].filter((w) => claimTokens.has(w)).length;
      // Capped at 55 so a claim that happens to mention the pointer cannot
      // tie an exact label match (100). Floor of 40 when the claim covers
      // at least half the hint preserves "the original problem" → a claim
      // about "low awareness".
      const raw = Math.round((shared / hintTokens.size) * 80);
      const claimScore = Math.min(55, raw >= 40 ? Math.max(40, raw) : raw);
      if (claimScore > 0) {
        eligible = true;
        if (claimScore > score) {
          score = claimScore;
          reasons.push(`claim coverage ${shared}/${hintTokens.size} in "${claimHit.text}"`);
        } else {
          reasons.push(`also in claim "${claimHit.text}"`);
        }
      }
    }

    if (!eligible) continue;

    // Speaker is a named constraint in the pointer ("what Priya said").
    // Applied only on lexical evidence — a claim that happens to mention
    // the same word, spoken by the same person, is not "what they said about X".
    const speakerHint = ctx.speakerHint;
    if (speakerHint && lexicalScore > 0) {
      const bySpeaker =
        speakerMatches(entity.provenance, speakerHint) ||
        world.claims.some((c) => (c.about ?? []).includes(entity.id) && speakerMatches(c.provenance, speakerHint));
      if (bySpeaker) {
        score = Math.min(100, score + 30);
        reasons.push(`said by ${speakerHint}`);
      }
    }

    // Ranking bonuses never promote a weak coincidental claim-hit into a
    // medium-confidence competitor — they only separate two already-real
    // lexical matches. Speaker evidence above is different: it is a named
    // constraint in the pointer itself ("what Priya said about X").
    if (score >= 50) {
      let bonus = 0;
      if (isLiveEntityStatus(entity.status) && entity.importance === "primary") {
        bonus += 8;
        reasons.push("current primary topic");
      }
      if (recent.has(entity.id)) {
        bonus += 5;
        reasons.push("recently discussed");
      }
      const neighbors = neighborIds(world, entity.id);
      if ([...neighbors].some((id) => recent.has(id) || focus.has(id))) {
        bonus += 5;
        reasons.push("relation neighborhood of recent/focus entities");
      }
      if (ctx.actType === "reactivate" && !isLiveEntityStatus(entity.status)) {
        bonus += 10;
        reasons.push(`lifecycle: ${entity.status} is eligible for reactivate`);
      } else if (
        (ctx.actType === "reject" || ctx.actType === "suspend" || ctx.actType === "deemphasize") &&
        isLiveEntityStatus(entity.status)
      ) {
        bonus += 4;
        reasons.push("lifecycle: live target for a parking/rejecting act");
      }
      score = Math.min(100, score + Math.min(15, bonus));
    }

    const reason = `${reasons.join("; ")}${isLiveEntityStatus(entity.status) ? "" : " (archived)"}`;
    candidates.push({
      id: entity.id,
      label: entity.label,
      score,
      reason,
      status: entity.status,
      kind: entity.type,
      description: entity.description,
      reasons,
    });
  }

  return candidates.sort((a, b) => b.score - a.score || b.id.localeCompare(a.id));
}

function labelTokens(entity: { label: string }): Set<string> {
  return tokenSet(entity.label);
}

/**
 * Parent/child label pairs ("free tier" ⊂ "revisit the free tier") with
 * comparable scores are the case where auto-picking the shorter label
 * silently mutates the wrong thing. Deterministic evidence has not
 * distinguished them; leave it for the judge or for abstention.
 */
function subsetAmbiguous(top: TargetCandidate, second: TargetCandidate | undefined): boolean {
  if (!second) return false;
  if (top.score - second.score >= 30) return false;
  const a = labelTokens(top);
  const b = labelTokens(second);
  if (a.size === b.size && subset(a, b)) return false;
  return (subset(a, b) || subset(b, a)) && Math.abs(top.score - second.score) < 30;
}

const VERBISH = new Set(["remov", "eliminat", "kill", "cut", "drop", "park", "paus", "reopen", "revisit", "forget", "set"]);
const ACTIONISH = new Set(["action", "event"]);

/**
 * Parent/child labels ("free tier" ⊂ "revisit the free tier") are the case
 * a live judge guessed wrong: it rejected the product instead of the
 * proposal. Deterministic evidence has one safe opening — when the pointer
 * carries a verb the parent does not, and the child is the action/event —
 * and otherwise MUST abstain. The judge is not asked; a wrong pick here
 * silently mutates the world.
 */
function specificChildForAct(
  top: TargetCandidate,
  second: TargetCandidate,
  hint: string,
  actType?: DiscourseActType,
): TargetCandidate | null {
  if (actType !== "reject" && actType !== "suspend" && actType !== "deemphasize") return null;
  const a = labelTokens(top);
  const b = labelTokens(second);
  const [parent, child] = a.size < b.size ? [top, second] : b.size < a.size ? [second, top] : [null, null];
  if (!parent || !child) return null;
  if (!ACTIONISH.has(child.kind) || ACTIONISH.has(parent.kind)) return null;
  const hintTokens = tokenSet(hint);
  const parentTokens = labelTokens(parent);
  const extra = [...hintTokens].filter((w) => !parentTokens.has(w));
  if (!extra.some((w) => VERBISH.has(w) || w.endsWith("ing") || w.endsWith("ed"))) return null;
  return child;
}

export function decideTarget(candidates: TargetCandidate[], hint = "", ctx: TargetContext = {}): TargetDecision {
  const kept = candidates.slice(0, MAX_CANDIDATES);
  if (!kept.length) {
    return { candidates: kept, chosenId: null, confidence: "low", reason: "no candidate matched", needsJudge: false };
  }
  const top = kept[0];
  const second = kept[1];
  if (subsetAmbiguous(top, second)) {
    const child = specificChildForAct(top, second!, hint, ctx.actType);
    if (child) {
      return {
        candidates: kept,
        chosenId: child.id,
        confidence: "medium",
        reason: `chose more specific "${child.label}" over parent "${child.id === top.id ? second!.label : top.label}" given a verb in the pointer`,
        needsJudge: false,
      };
    }
    return {
      candidates: kept,
      chosenId: null,
      confidence: "low",
      reason: `ambiguous between "${top.label}" and "${second!.label}" (label-subset, deterministic evidence cannot distinguish)`,
      needsJudge: false,
    };
  }
  const topExact = top.reasons.some((r) => r.startsWith("exact label"));
  const secondExact = Boolean(second?.reasons.some((r) => r.startsWith("exact label")));
  // An exact label/alias match is not in a ranking race with a partial
  // overlap on a sibling concept ("usage-based billing" vs "usage-based
  // pricing"). Requiring the full 25-point margin here is how an exact
  // match previously won and then started losing after claim/overlap
  // scoring got richer.
  const exactWins = topExact && !secondExact;
  const clearMargin = exactWins || !second || top.score - second.score >= MARGIN;
  const confidence: "high" | "medium" | "low" =
    top.score >= 90 && clearMargin ? "high" : top.score >= 40 && clearMargin ? "medium" : "low";
  if (confidence === "low") {
    return {
      candidates: kept,
      chosenId: null,
      confidence,
      reason: second && !clearMargin ? `ambiguous between "${top.label}" and "${second.label}"` : `weak match on "${top.label}" only`,
      needsJudge: Boolean(second && !clearMargin),
    };
  }
  return {
    candidates: kept,
    chosenId: top.id,
    confidence,
    reason: `best match "${top.label}" (${top.reason})`,
    needsJudge: false,
  };
}

export function resolveTarget(world: WorldState, hint: string, ctx: TargetContext = {}): TargetDecision {
  return decideTarget(retrieveTargetCandidates(world, hint, ctx), hint, ctx);
}

export function applyTargetJudge(decision: TargetDecision, result: TargetJudgeResult): TargetDecision {
  if (result.verdict !== "resolved" || result.index === null) {
    return {
      ...decision,
      chosenId: null,
      confidence: "low",
      reason: `judge uncertain — ${result.reason || "no candidate was a confident match"}`,
      needsJudge: false,
    };
  }
  const chosen = decision.candidates[result.index];
  if (!chosen) {
    return {
      ...decision,
      chosenId: null,
      confidence: "low",
      reason: "judge returned an index that was not in the candidate list — abstaining",
      needsJudge: false,
    };
  }
  return {
    ...decision,
    chosenId: chosen.id,
    confidence: "medium",
    reason: `judge resolved "${chosen.label}" — ${result.reason}`,
    needsJudge: false,
  };
}

export function toReferenceCandidates(candidates: TargetCandidate[]): ReferenceCandidate[] {
  return candidates.map(({ id, label, score, reason }) => ({ id, label, score, reason }));
}

export function judgeInputFor(
  surface: string,
  hint: string,
  kind: TargetJudgeInput["kind"],
  decision: TargetDecision,
  ctx: TargetContext = {},
): TargetJudgeInput {
  return {
    surface,
    hint,
    kind,
    actType: ctx.actType,
    speakerHint: ctx.speakerHint,
    candidates: decision.candidates.map((c, index) => ({
      index,
      label: c.label,
      description: c.description,
      status: c.status,
      kind: c.kind,
      reasons: c.reasons,
    })),
  };
}
