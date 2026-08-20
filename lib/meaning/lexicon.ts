/**
 * The Visual Semantics layer: meaning in, visual sign out.
 *
 * This is the module that makes wordless output possible. Everything upstream
 * (lib/meaning/decideCore.ts) produces a `Concept` whose `label` is English —
 * that label exists so the *engine* can reason and so "it" can resolve to the
 * same thing two sentences later. It is not, and must never become, something
 * a viewer reads. This file is where the English stops: a Concept goes in, a
 * `VisualSign` comes out, and the renderer downstream (lib/meaning/sign.ts)
 * can draw that sign without ever seeing the label.
 *
 * Deterministic on purpose — no model call, no network, no latency. A sign has
 * to be chosen every time a concept moves or is added, which happens far more
 * often than meaning is re-decided; putting a round trip here would put one on
 * every frame of the drawing. The model's job is to understand what was said;
 * choosing how that looks is a drawing decision, the same posture
 * lib/meaning/plan.ts already takes for visual family.
 *
 * The mapping has two independent axes, and keeping them independent is what
 * makes the vocabulary compose instead of explode:
 *
 *   glyph      WHAT the thing is        — onboarding is a funnel
 *   modifiers  HOW it is going          — that funnel is tangled, and heavy
 *
 * So "onboarding is too complicated" is not a 25th glyph. It is `funnel` with
 * `texture: "cluttered"` and `charge: "problem"`. Roughly 20 abstract glyphs
 * plus lib/icons.ts's object pictograms, crossed with the modifiers, is a far
 * larger expressive range than a flat symbol-per-phrase table, and it degrades
 * gracefully: an unmatched concept still gets a charge and a motion from its
 * verbs even when its noun lands on the neutral `mass` fallback.
 */

import { resolveIcon } from "../icons";
import { resolveGlyph } from "./glyphs";
import type { Concept, ConceptImportance, Relationship, RelationshipType } from "./types";

/** Is this going well, badly, or neither. Drives ink colour and stroke weight. */
export type VisualCharge = "problem" | "solution" | "neutral";

/** Order vs. disorder — drawn as added noise over the glyph, not a second glyph. */
export type VisualTexture = "clean" | "normal" | "cluttered";

/** Direction of travel, drawn as a motion cue beside the sign. */
export type VisualMotion = "rise" | "fall" | "exit" | "loop" | "still";

export interface VisualSign {
  /** A key in lib/meaning/glyphs.ts GLYPHS, or a lib/icons.ts pictogram name. */
  glyph: string;
  charge: VisualCharge;
  texture: VisualTexture;
  motion: VisualMotion;
  /** Size multiplier from importance and stated quantity. Emphasis is scale. */
  scale: number;
  /** The speaker cancelled this. Drawn struck through, not removed. */
  negated: boolean;
  /** Drawn tentatively (thin, gappy) while the engine is still unsure. */
  tentative: boolean;
  /** Which rule fired. Debug and test only — never rendered. */
  reason: string;
}

interface GlyphRule {
  /** Matched against `${label} ${description}`, lowercased. */
  test: RegExp;
  glyph: string;
  why: string;
}

interface ModifierRule {
  test: RegExp;
  charge?: VisualCharge;
  texture?: VisualTexture;
  motion?: VisualMotion;
}

/**
 * WHAT the thing is. Ordered — first match wins, so the specific sits above
 * the general.
 *
 * These carry no charge, texture or motion, and that separation is the point.
 * "Onboarding" and "onboarding is a disaster" are the same thing in different
 * condition; if the noun table also set the mood, the second phrase would need
 * its own entry, and so would every other pairing — the combinatorial blowup
 * this architecture exists to avoid. A rule here answers one question only.
 */
const GLYPH_RULES: GlyphRule[] = [
  // --- process and journey ------------------------------------------------
  { test: /\bonboard|sign[- ]?up|signup|getting started|first[- ]run|activation|setup|tutorial|walkthrough\b/, glyph: "funnel", why: "entry process" },
  { test: /\bfunnel|pipeline|workflow|checkout|journey|the flow\b/, glyph: "funnel", why: "staged process" },

  // --- leaving, loss ------------------------------------------------------
  { test: /\bchurn|drop[- ]?off|drop out|bounce|abandon|unsubscrib|cancel(l?ed|lation)?\b/, glyph: "exit", why: "departure" },
  { test: /\b(leav|left|leaving|quit|walk(ing)? away|go(ing)? elsewhere)\b/, glyph: "exit", why: "departure verb" },

  // --- cause and explanation ---------------------------------------------
  { test: /\b(the )?(reason|cause|root cause|why|driver|source|origin|because)\b/, glyph: "source", why: "explanatory origin" },

  // --- trouble ------------------------------------------------------------
  { test: /\bfriction|painful|pain point|struggl|fight(ing)?|grind|hard to use|clunky\b/, glyph: "friction", why: "grinding" },
  { test: /\bblock(ed|er|ing)?|stuck|stall|bottleneck|gate|barrier|wall|can'?t get (past|through)\b/, glyph: "blockage", why: "stoppage" },
  { test: /\bbroke|breaking|broken|bug|crash|fail(ure|ing|s)?|outage|defect\b/, glyph: "crack", why: "breakage" },
  { test: /\brisk|danger|threat|exposure|liability|warning\b/, glyph: "crack", why: "instability" },

  // --- disorder as a thing in its own right -------------------------------
  // Reached only when the speaker names the mess itself ("the complexity"),
  // with no other noun to attach it to. When there IS one — "onboarding is too
  // complicated" — the funnel rule above wins the glyph and the modifier table
  // supplies the clutter, which is the composed reading we want.
  { test: /\boverwhelm|overload|bloat|clutter|excess|too much stuff\b/, glyph: "overload", why: "excess itself" },
  { test: /\bcomplicat|complex|convoluted|tangled|messy|mess\b/, glyph: "tangle", why: "entanglement itself" },
  { test: /\bconfus|unclear|don'?t (get|understand)|lost|ambiguous|murky|fuzzy|uncertain|unknown\b/, glyph: "fog", why: "unresolved" },
  { test: /\bproblem|issue|trouble|wrong\b/, glyph: "crack", why: "generic problem" },

  // --- order and relief ---------------------------------------------------
  { test: /\bsimpl(e|er|ify|ified)|clean(er)?|streamlin|one step|just works\b/, glyph: "simple", why: "reduction" },
  { test: /\bfix(ed|ing|es)?|repair|resolv|patch|solution|solve[ds]?|address(ed)?\b/, glyph: "repair", why: "restoration" },
  { test: /\bunblock|smooth|frictionless|seamless|it flows|working well\b/, glyph: "flow", why: "unobstructed" },

  // --- direction as a thing ("growth", "the decline") ---------------------
  { test: /\bgrow(th|ing)?|increas|rising|ramp|scal(e|ing)|traction|more (users|revenue|signups)\b/, glyph: "rise", why: "increase" },
  { test: /\bdeclin|decreas|shrink|fall(ing)?|drop(ping|ped)?|slow(ing|down)|los(e|ing) (users|money|revenue)\b/, glyph: "fall", why: "decrease" },

  // --- opening and aim ----------------------------------------------------
  { test: /\bopportunit|opening|unlock|potential|upside|room to\b/, glyph: "opening", why: "aperture" },
  { test: /\bgoal|target|objective|aim|north star|where we want\b/, glyph: "target", why: "aim" },
  { test: /\bvalue|payoff|benefit|the win|worth it|aha\b/, glyph: "value", why: "reward" },

  // --- choice, repetition, burden ----------------------------------------
  { test: /\bdecision|decide|choose|choice|option|either|two paths|fork\b/, glyph: "fork", why: "branch" },
  { test: /\b(loop|cycle|repeat|again and again|every time|iterat|recurring|retention)\b/, glyph: "loop", why: "recurrence" },
  { test: /\bcost|expensive|burden|overhead|drag|heavy|weigh(s|ing)? (on|down)\b/, glyph: "weight", why: "burden" },
  { test: /\brealiz|insight|figured out|it clicked|breakthrough|suddenly\b/, glyph: "spark", why: "sudden change" },
];

/**
 * HOW it is going. Every matching rule is applied, in order, over whatever the
 * glyph table chose — so a phrase naming a thing AND its condition gets both,
 * and a phrase naming only a condition still gets a charge on the neutral
 * `mass` fallback. Later matches win a field they both set, which makes the
 * ordering here a deliberate priority: the trailing entries are the plainest
 * statements of valence and should not be overridden by an incidental verb.
 */
const MODIFIER_RULES: ModifierRule[] = [
  { test: /\bgrow(th|ing)?|increas|rising|ramp|traction|better|improv|stronger|faster|healthier|more (users|revenue|signups)\b/, charge: "solution", motion: "rise" },
  { test: /\bdeclin|decreas|shrink|fall(ing)?|drop(ping|ped)?|worse|degrad|deteriorat|weaker|slower|los(e|ing) (users|money|revenue)\b/, charge: "problem", motion: "fall" },
  { test: /\b(loop|cycle|repeat|again and again|every time|iterat|recurring)\b/, motion: "loop" },
  { test: /\bchurn|drop[- ]?off|abandon|unsubscrib|leav|left|leaving|quit|bounce|walk(ing)? away\b/, charge: "problem", motion: "exit" },

  // Disorder and order. These set texture, which is drawn as added or withheld
  // ink over whatever glyph is underneath — the composition axis.
  { test: /\bcomplicat|complex|convoluted|tangled|messy|mess|confus|unclear|chaotic\b/, charge: "problem", texture: "cluttered" },
  { test: /\btoo (complicated|complex|many|much|hard|long)|overwhelm|overload|bloat|clutter|excess|piled|so many|way too\b/, charge: "problem", texture: "cluttered" },
  { test: /\bsimpl(e|er|ify|ified)|clean(er)?|streamlin|one step|just works|clear(er)?|obvious\b/, charge: "solution", texture: "clean" },

  // Plain valence, with no shape implication of its own.
  { test: /\bproblem|issue|trouble|wrong|pain|risk|danger|threat|broke|broken|bug|crash|fail|stuck|block(ed|er|ing)?|expensive|burden\b/, charge: "problem" },
  { test: /\bfix(ed|ing|es)?|repair|resolv|solved?|unblock|smooth|frictionless|seamless|working well|opportunit|unlock|value|payoff|benefit\b/, charge: "solution" },
];

/** Negation the speaker applied to the whole concept, not a mere "no" anywhere. */
const NEGATION = /\b(not|isn'?t|aren'?t|no longer|never|without|stopped|failed to|didn'?t|doesn'?t|can'?t|won'?t)\b/;

/** Words that push intensity up. Emphasis becomes scale, not capital letters. */
const INTENSIFIER = /\b(very|really|extremely|massively|huge|hugely|way too|far too|by far|critical|biggest|worst|best|most important|main)\b/;

/**
 * Concepts that are people. Kept separate from GLYPH_RULES because a crowd is
 * an *object* pictogram from lib/icons.ts, and because "users are leaving"
 * needs the departure rule to win the glyph while people still colours the
 * reading — handled by letting the exit rules sit above this in priority and
 * accepting the loss, rather than by inventing a compound glyph.
 */
const PEOPLE = /\b(user|users|customer|customers|people|audience|team|members?|subscribers?|players?|everyone)\b/;

const IMPORTANCE_SCALE: Record<ConceptImportance, number> = {
  primary: 1.35,
  supporting: 1,
  detail: 0.78,
};

function normalized(concept: Pick<Concept, "label" | "description">): string {
  return `${concept.label} ${concept.description ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Quantity earns extra size only above a threshold, and only logarithmically.
 * A stated "3%" and a stated "40%" should not differ by a factor of thirteen
 * on the page; the point is that a number was given emphasis at all.
 */
function quantityScale(quantity: Concept["quantity"]): number {
  if (!quantity || !Number.isFinite(quantity.value)) return 1;
  const magnitude = Math.abs(quantity.value);
  if (magnitude <= 1) return 1;
  return Math.min(1.3, 1 + Math.log10(magnitude) * 0.09);
}

/**
 * The core mapping. Never returns null and never falls back to text: an
 * unmatched concept becomes a neutral `mass`, which reads as "something
 * unresolved sits here" — an honest visual, and one the composition layer can
 * later replace in place once the speaker says enough to sharpen it.
 */
export function signForConcept(concept: Concept): VisualSign {
  const text = normalized(concept);
  const negated = NEGATION.test(text);

  let glyph = "mass";
  let charge: VisualCharge = "neutral";
  let texture: VisualTexture = "normal";
  let motion: VisualMotion = "still";
  let reason = "unmatched: neutral mass";

  const rule = GLYPH_RULES.find((r) => r.test.test(text));
  if (rule) {
    glyph = rule.glyph;
    reason = rule.why;
  } else if (PEOPLE.test(text)) {
    glyph = "people";
    reason = "people";
  } else {
    // Last resort before `mass`: the head noun may name a concrete object the
    // existing pictogram set already draws (money, clock, database, rocket…).
    const words = text.split(" ").filter(Boolean);
    const hit = words.find((word) => resolveIcon(word));
    if (hit) {
      glyph = hit;
      reason = `object pictogram (${hit})`;
    }
  }

  // Condition, applied over the glyph rather than instead of it.
  const applied: string[] = [];
  for (const mod of MODIFIER_RULES) {
    if (!mod.test.test(text)) continue;
    if (mod.charge) charge = mod.charge;
    if (mod.texture) texture = mod.texture;
    if (mod.motion) motion = mod.motion;
    applied.push([mod.charge, mod.texture, mod.motion].filter(Boolean).join("/"));
  }
  if (applied.length) reason = `${reason} + ${applied.join(" ")}`;

  const intensity = INTENSIFIER.test(text) ? 1.15 : 1;
  const scale = Number(
    (IMPORTANCE_SCALE[concept.importance] * quantityScale(concept.quantity) * intensity).toFixed(3),
  );

  return {
    glyph,
    charge,
    texture,
    motion,
    scale,
    negated,
    tentative: concept.confidence === "low",
    reason,
  };
}

/**
 * How a relationship becomes structure. Deliberately not "every relation is an
 * arrow": nesting, adjacency and a plain tether all carry meaning that an
 * arrow would overstate. `none` means the layout itself already says it —
 * two columns are the contrast; drawing a "vs" between them is redundant ink.
 */
export type RelationForm = "causal_arrow" | "flow_arrow" | "nest" | "adjacent" | "tether" | "none";

const RELATION_FORM: Record<RelationshipType, RelationForm> = {
  causes: "causal_arrow",
  leads_to: "causal_arrow",
  depends_on: "flow_arrow",
  supports: "tether",
  contrasts: "adjacent",
  contains: "nest",
  part_of: "nest",
  example_of: "tether",
  related_to: "tether",
};

export function formForRelationship(rel: Pick<Relationship, "type">): RelationForm {
  return RELATION_FORM[rel.type] ?? "tether";
}

/** Ink by charge. Mirrors lib/ops.ts's KIND_STROKE palette so the two agree. */
export const CHARGE_STROKE: Record<VisualCharge, string> = {
  problem: "#c2255c",
  solution: "#2f9e44",
  neutral: "#1e1e1e",
};

// --- scanning live speech -------------------------------------------------

/**
 * Clause boundaries in spoken language.
 *
 * Speech has no punctuation, so the cue words have to do the work commas do
 * in writing. These are the joints where one idea stops and another starts.
 *
 * The causal cues ("because", "so", "which is why") are separators like the
 * rest, and deliberately do not become signs of their own. Causality has a
 * better visual form than a glyph sitting between two things: an arrow, which
 * is exactly what `formForRelationship` produces once the meaning engine has
 * decided the relation. Emitting a `source` blob here would put a second,
 * weaker rendering of the same idea on screen a moment before the right one
 * arrives. What the cue does earn is the split itself — the clauses either
 * side of a "because" are two readings, not one.
 *
 * `source` still fires wherever a speaker *names* the cause ("the reason we
 * lost them", "the root cause"), which is a concept rather than a connective.
 */
const CLAUSE_SPLIT = /(?:[,.;!?]+|\b(?:and then|and|but|so that|so|because|which is why|which|when|then|while|however|although)\b)/gi;

/** Cue words that carry no meaning on their own and should not become a sign. */
const FILLER = /^(?:u[hm]+|er+|like|you know|i mean|kind of|sort of|okay|ok|right|yeah|well|just|really|actually|basically|anyway)$/;

export interface ScannedSign {
  /** Position of this clause within the utterance — the provisional key. */
  index: number;
  /** The clause this came from. Internal only: never drawn, kept for logs. */
  phrase: string;
  sign: VisualSign;
}

/**
 * Read a live utterance for whatever the vocabulary already recognises.
 *
 * This is the reflex path — what lets the canvas react *during* speech rather
 * than after it. It runs on settled interim words, and it is pure, synchronous
 * and model-free, which is the only reason it can be afforded on every interim
 * tick. It reuses the same two rule tables `signForConcept` uses rather than
 * carrying a second, drifting copy of them; the only difference is the unit of
 * input (a clause, not a decided Concept) and that everything it returns is
 * marked `tentative`.
 *
 * Silence is a valid answer. A clause the vocabulary does not recognise
 * returns nothing at all — it does NOT become a neutral `mass`. That
 * distinction matters: `mass` is the right fallback for a concept the *meaning
 * engine* decided is real but the lexicon cannot picture, and the wrong one
 * for a half-spoken fragment that may not be a concept yet. Drawing a blob for
 * every "um, so, anyway" would fill the sheet with noise in a few seconds.
 */
export function scanUtterance(text: string): ScannedSign[] {
  const out: ScannedSign[] = [];
  const clauses = text.split(CLAUSE_SPLIT);
  let index = 0;
  for (const raw of clauses) {
    const phrase = raw.trim().toLowerCase().replace(/\s+/g, " ");
    index += 1;
    if (!phrase || FILLER.test(phrase)) continue;

    const probe: Concept = {
      id: "probe",
      label: phrase,
      importance: INTENSIFIER.test(phrase) ? "primary" : "supporting",
    };
    const sign = signForConcept(probe);

    // Nothing recognised — the glyph fell through to the neutral mass AND no
    // modifier fired. Stay silent rather than drawing a shrug.
    const recognised =
      sign.glyph !== "mass" || sign.charge !== "neutral" || sign.texture !== "normal" || sign.motion !== "still";
    if (!recognised) continue;

    // A guess made mid-sentence is always drawn tentatively, whatever the
    // concept's own confidence would have been. The speaker has not finished.
    out.push({ index, phrase, sign: { ...sign, tentative: true } });
  }
  return out;
}

/** Exposed for tests and for a future authoring UI — not used at render time. */
export function glyphExists(name: string): boolean {
  return Boolean(resolveGlyph(name) || resolveIcon(name));
}
