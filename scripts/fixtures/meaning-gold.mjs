/**
 * Gold talks for the Meaning Engine — Phase 1 of meaning → visual expression.
 *
 * These are settled-thought strings, not pixels. A later planner/renderer
 * is only allowed to start once `assertGoldTalk` passes against the real
 * two-stage engine (see scripts/meaning-gold-replay.mjs). Shape, not
 * wording: ids and labels will vary; the spine and the claim/relationship
 * types must not.
 *
 * The canonical talk is the product bar:
 *   AI makes building easier → more applications → too many choices → trust gets harder
 */

import { CAUSAL_TYPES, longestCausalSpineIds } from "../../lib/meaning/plan.ts";

export { CAUSAL_TYPES };

export const GOLD_TALKS = [
  {
    id: "trust-problem",
    title: "Canonical trust-problem chain",
    thoughts: [
      "AI is making it much easier to build apps.",
      "So we're going to end up with thousands of apps.",
      "But that creates a trust problem because people don't know which apps are legitimate.",
    ],
  },
  {
    id: "comparison",
    title: "Explicit comparison",
    thoughts: [
      "Napkin is for pasting text after the fact.",
      "InPublic is for speaking live.",
      "One is async, the other is live.",
      "That's why they aren't the same product.",
    ],
  },
  {
    id: "process",
    title: "Ordered process",
    thoughts: [
      "First the words land as you speak.",
      "Then InPublic understands what you meant.",
      "Then it chooses a visual form.",
      "Then the canvas expresses it.",
    ],
  },
  {
    id: "reflective",
    title: "Reflective speech stays a claim",
    thoughts: [
      "That really opened my eyes.",
      "I didn't expect it to feel that way.",
      "It's humbling.",
    ],
  },
];

export function activeConcepts(state) {
  return (state.concepts ?? []).filter((c) => c.status !== "superseded");
}

export function blob(concept) {
  return `${concept.label ?? ""} ${concept.description ?? ""}`.toLowerCase();
}

export function matches(concept, patterns) {
  const text = blob(concept);
  return patterns.some((p) => (p instanceof RegExp ? p.test(text) : text.includes(p)));
}

/** Label only — descriptions often restate the whole chain and must not decide spine order. */
export function matchesLabel(concept, patterns) {
  const text = (concept.label ?? "").toLowerCase();
  return patterns.some((p) => (p instanceof RegExp ? p.test(text) : text.includes(p)));
}

/** Gold-facing wrapper: planner spine ids resolved to concept objects. */
export function longestCausalSpine(state) {
  const byId = new Map(activeConcepts(state).map((c) => [c.id, c]));
  return longestCausalSpineIds(state).map((id) => byId.get(id)).filter(Boolean);
}

function indexOnSpine(spine, patterns) {
  return spine.findIndex((c) => matchesLabel(c, patterns));
}

function assertTrustProblem(state, failures) {
  const concepts = activeConcepts(state);
  if (concepts.length < 3) {
    failures.push(`expected at least 3 active concepts, got ${concepts.length} — collapsed or empty`);
  }

  const collapsed = concepts.filter((c) => matches(c, [/ai/]) && matches(c, [/trust/]));
  if (collapsed.length && concepts.length <= 2) {
    failures.push(`collapsed the chain into ${concepts.length} concept(s) that mix AI and trust: ${collapsed.map((c) => c.label).join("; ")}`);
  }

  const spine = longestCausalSpine(state);
  if (spine.length < 3) {
    failures.push(`causal spine too short (${spine.length}): ${spine.map((c) => c.label).join(" → ") || "(none)"}`);
  }

  // Bare /app/ matches "building apps" and "thousands of apps" alike — those
  // are different steps. Proliferation is the more-apps step; building/easier
  // is the prior one. AI may sit on the spine (leads_to) or only support the
  // building node; either is understanding, collapse is not.
  const building = indexOnSpine(spine, [/build/, /easier/, /\bease\b/, /creat/]);
  const apps = indexOnSpine(spine, [/thousand/, /proliferat/, /more app/, /many app/, /increase in app/, /flood of app/, /massive/]);
  const trust = indexOnSpine(spine, [/trust/]);
  const aiConcept = concepts.find((c) => matches(c, [/\bai\b/]));
  const spineIds = new Set(spine.map((c) => c.id));
  const aiOnOrIntoSpine = Boolean(
    aiConcept &&
      (spineIds.has(aiConcept.id) ||
        (state.relationships ?? []).some(
          (r) =>
            (r.from === aiConcept.id && spineIds.has(r.to)) ||
            (r.to === aiConcept.id && spineIds.has(r.from)),
        )),
  );

  if (!aiConcept) failures.push("missing an AI concept");
  else if (!aiOnOrIntoSpine) failures.push(`AI exists but is disconnected from the causal spine: ${spine.map((c) => c.label).join(" → ")}`);
  if (building === -1) failures.push(`spine missing easier-building: ${spine.map((c) => c.label).join(" → ")}`);
  if (apps === -1) failures.push(`spine missing more-apps / proliferation: ${spine.map((c) => c.label).join(" → ")}`);
  if (trust === -1) failures.push(`spine missing a trust concept: ${spine.map((c) => c.label).join(" → ")}`);
  if (building !== -1 && apps !== -1 && building >= apps) {
    failures.push(`easier-building should precede more-apps on the spine, got ${spine.map((c) => c.label).join(" → ")}`);
  }
  if (apps !== -1 && trust !== -1 && apps >= trust) {
    failures.push(`more-apps should precede trust on the spine, got ${spine.map((c) => c.label).join(" → ")}`);
  }

  const choiceSomewhere = [...concepts, ...(state.claims ?? []).map((c) => ({ label: c.text, description: "" }))].some((c) =>
    matches(c, [/choice/, /too many/, /don't know/, /do not know/, /which apps/, /legitim/, /legitimate/]),
  );
  if (!choiceSomewhere) {
    failures.push("lost 'too many choices / don't know which are legitimate' — not a concept and not a claim");
  }
}

function assertComparison(state, failures) {
  const concepts = activeConcepts(state);
  const napkin = concepts.find((c) => matches(c, [/napkin/]));
  const inpublic = concepts.find((c) => matches(c, [/inpublic/, /in public/]));
  if (!napkin) failures.push("missing Napkin as a concept");
  if (!inpublic) failures.push("missing InPublic as a concept");

  const contrast = (state.relationships ?? []).some(
    (r) =>
      r.type === "contrasts" &&
      napkin &&
      inpublic &&
      ((r.from === napkin.id && r.to === inpublic.id) || (r.from === inpublic.id && r.to === napkin.id)),
  );
  const asyncLive = (state.relationships ?? []).some((r) => r.type === "contrasts");
  if (!contrast && !asyncLive) {
    failures.push("expected a contrasts relationship (Napkin vs InPublic, or async vs live)");
  }
}

function assertProcess(state, failures) {
  const spine = longestCausalSpine(state);
  if (spine.length < 3) {
    failures.push(`process spine too short (${spine.length}): ${spine.map((c) => c.label).join(" → ") || "(none)"}`);
  }

  const speech = indexOnSpine(spine, [/word/, /speech/, /speak/, /land/, /transcript/]);
  const understand = indexOnSpine(spine, [/understand/, /meaning/, /meant/]);
  const express = indexOnSpine(spine, [/visual/, /form/, /canvas/, /express/]);
  if (speech === -1) failures.push(`spine missing speech/words landing: ${spine.map((c) => c.label).join(" → ")}`);
  if (understand === -1) failures.push(`spine missing understanding: ${spine.map((c) => c.label).join(" → ")}`);
  if (express === -1) failures.push(`spine missing visual expression: ${spine.map((c) => c.label).join(" → ")}`);
  if (speech !== -1 && understand !== -1 && speech >= understand) {
    failures.push(`speech should precede understanding, got ${spine.map((c) => c.label).join(" → ")}`);
  }
  if (understand !== -1 && express !== -1 && understand >= express) {
    failures.push(`understanding should precede expression, got ${spine.map((c) => c.label).join(" → ")}`);
  }
}

function assertReflective(state, failures) {
  const claims = state.claims ?? [];
  if (!claims.length) {
    failures.push("expected at least one claim for reflective speech; got none");
  }

  const humbleOrOpened = claims.some((c) => /humbl|opened my eyes|didn't expect|did not expect|feel/i.test(c.text));
  if (claims.length && !humbleOrOpened) {
    failures.push(`claims present but none capture the reflection: ${claims.map((c) => c.text).join(" | ")}`);
  }

  // The failure mode: inventing endpoints from the metaphor ("eyes" → "that").
  const invented = activeConcepts(state).filter((c) => matches(c, [/\beyes?\b/, /\bthat\b/]) && !matches(c, [/realiz/, /feel/, /humbl/, /speaker/]));
  const fakeEdges = (state.relationships ?? []).filter((r) => {
    const from = activeConcepts(state).find((c) => c.id === r.from);
    const to = activeConcepts(state).find((c) => c.id === r.to);
    return from && to && invented.some((c) => c.id === from.id || c.id === to.id);
  });
  if (fakeEdges.length) {
    failures.push(`invented a structural edge from the metaphor: ${fakeEdges.map((r) => `${r.from} -${r.type}-> ${r.to}`).join(", ")}`);
  }
}

const ASSERTIONS = {
  "trust-problem": assertTrustProblem,
  comparison: assertComparison,
  process: assertProcess,
  reflective: assertReflective,
};

/** Returns { ok, failures, spine } for one talk's final SemanticState. */
export function assertGoldTalk(talkId, state) {
  const failures = [];
  const assert = ASSERTIONS[talkId];
  if (!assert) {
    return { ok: false, failures: [`unknown gold talk id "${talkId}"`], spine: [] };
  }
  assert(state, failures);
  return { ok: failures.length === 0, failures, spine: longestCausalSpine(state) };
}
