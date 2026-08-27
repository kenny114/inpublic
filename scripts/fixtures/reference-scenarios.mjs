/**
 * Ordinal and topic-recall reference resolution fixtures: "the first one",
 * "the second option", "the last idea", "the other one", "go back to the
 * original problem", "what we said earlier about funding".
 *
 * Each scenario is one ordered sequence of turns, like
 * critical-scenarios.mjs, because the point is turn-by-turn behaviour: a
 * topic switch, a return to an archived topic several turns later, two
 * candidate groups competing for the same bare ordinal, a correction. Every
 * turn that contains a reference mention carries an explicit expectation of
 * what SHOULD happen — resolved to a specific entity at a given confidence,
 * or deliberately left unresolved — checked against
 * ExpressionTrace.referenceResolutions after that turn.
 *
 * Deltas are hand-authored as a real extractor would plausibly produce them
 * against the ReferenceMentionSchema contract in lib/expression/schemas.ts:
 * the extractor's job stops at recognising the mention's GRAMMAR (ordinal
 * position, or a topic being recalled) — it never sees world history, so it
 * cannot itself know which entity is meant.
 */

let n = 0;
const rid = () => `r${(n += 1)}`;

const E = (id, type, label, extra = {}) => ({ id, type, label, ...extra });
const R = (source, type, target, extra = {}) => ({ id: rid(), source, type, target, ...extra });
const C = (text, about, extra = {}) => ({ id: `c${(n += 1)}`, text, ...(about ? { about } : {}), ...extra });

/** A reference-mention turn: one placeholder entity, one ReferenceMention pointing at it. */
const REF = (id, surface, kind, refExtra = {}) => ({
  entity: E(id, "concept", surface),
  mention: { entityId: id, surface, kind, ...refExtra },
});

const D = (
  text,
  { entities = [], relations = [], claims = [], topicEntityId, emphasisEntityIds, supersededMentions, referenceMentions, interpretation = "" } = {},
) => ({
  text,
  delta: {
    entities,
    relations,
    claims,
    ...(topicEntityId ? { topicEntityId } : {}),
    ...(emphasisEntityIds ? { emphasisEntityIds } : {}),
    ...(supersededMentions ? { supersededMentions } : {}),
    ...(referenceMentions ? { referenceMentions } : {}),
    interpretation,
  },
});

/**
 * `checks(trace)` runs in addition to the label/confidence check for that
 * turn — for assertions the simple "resolved to X at Y confidence" shape
 * cannot express, like world-level status vs. visual placement. Returns an
 * array of failure strings (empty = pass).
 */

export const REFERENCE_SCENARIOS = [
  // ───────────────────────────────────────────── ordinal: first/second/third/last
  {
    name: "ordinal: three options, referenced by position across several turns",
    turns: [
      D("We could raise money, bootstrap, or find a co-founder.", {
        entities: [
          E("decision", "concept", "the decision"),
          E("raise", "concept", "raise money"),
          E("bootstrap", "concept", "bootstrap"),
          E("cofounder", "concept", "find a co-founder"),
        ],
        relations: [
          R("decision", "relates_to", "raise"),
          R("decision", "relates_to", "bootstrap"),
          R("decision", "relates_to", "cofounder"),
        ],
        topicEntityId: "decision",
        interpretation: "Three options for the decision: raise, bootstrap, or find a co-founder.",
      }),
      (() => {
        const ref = REF("o1", "the first one", "ordinal", { ordinalIndex: 0 });
        return D("Let's go with the first one.", { entities: [ref.entity], referenceMentions: [ref.mention], interpretation: "Choosing the first option." });
      })(),
      (() => {
        const ref = REF("o2", "the second one", "ordinal", { ordinalIndex: 1 });
        return D("Actually the second one seems safer.", { entities: [ref.entity], referenceMentions: [ref.mention], interpretation: "The second option seems safer." });
      })(),
      (() => {
        const ref = REF("o3", "the third one", "ordinal", { ordinalIndex: 2 });
        return D("The third one feels too risky though.", { entities: [ref.entity], referenceMentions: [ref.mention], interpretation: "The third option feels too risky." });
      })(),
      (() => {
        const ref = REF("o4", "the last idea", "ordinal", { ordinalFromEnd: true });
        return D("On reflection, the last idea is the one I'd rule out first.", { entities: [ref.entity], referenceMentions: [ref.mention], interpretation: "Ruling out the last idea." });
      })(),
    ],
    expectByTurn: {
      1: { chosenLabel: "raise money", confidence: "high" },
      2: { chosenLabel: "bootstrap", confidence: "high" },
      3: { chosenLabel: "find a co-founder", confidence: "high" },
      4: { chosenLabel: "find a co-founder", confidence: "high" },
    },
  },

  // ─────────────────────────────────────────────────────── ordinal: "the other one"
  {
    name: "ordinal: the other one, in a two-item contrast",
    turns: [
      D("Plan A costs more than Plan B.", {
        entities: [E("a", "concept", "Plan A"), E("b", "concept", "Plan B")],
        relations: [R("a", "contrasts_with", "b")],
        topicEntityId: "a",
        interpretation: "Plan A and Plan B are being compared on cost.",
      }),
      D("Let's go with Plan A.", {
        entities: [E("a", "concept", "Plan A", { attributes: [{ key: "status", value: "chosen" }] })],
        topicEntityId: "a",
        interpretation: "Plan A is chosen.",
      }),
      (() => {
        const ref = REF("o1", "the other one", "ordinal", { ordinalOther: true });
        return D("Actually, let's do the other one instead.", { entities: [ref.entity], referenceMentions: [ref.mention], interpretation: "Switching to the other plan." });
      })(),
    ],
    expectByTurn: {
      2: { chosenLabel: "Plan B", confidence: "high" },
    },
  },

  // ────────────────────────────────────── topic recall: switch away, then return
  {
    name: "topic recall: switch topics, then go back to the original problem several turns later",
    turns: [
      D("Our main problem is low awareness.", {
        entities: [E("awareness", "state", "low awareness")],
        claims: [C("the main problem is low awareness", ["awareness"])],
        topicEntityId: "awareness",
        interpretation: "Low awareness is identified as the main problem.",
      }),
      D("Let's talk about funding instead.", {
        entities: [E("funding", "concept", "funding")],
        topicEntityId: "funding",
        interpretation: "Switching topic to funding.",
      }),
      D("Funding is tight this quarter.", {
        entities: [E("funding", "concept", "funding", { attributes: [{ key: "status", value: "tight this quarter" }] })],
        topicEntityId: "funding",
        interpretation: "Funding is tight this quarter.",
      }),
      D("We also need a marketing plan.", {
        entities: [E("marketing", "concept", "marketing plan")],
        topicEntityId: "marketing",
        interpretation: "A new, unrelated topic: the marketing plan.",
      }),
      (() => {
        const ref = REF("t1", "the original problem", "topic_recall", { topicHint: "the original problem" });
        return D("Let's go back to the original problem.", {
          entities: [ref.entity],
          referenceMentions: [ref.mention],
          interpretation: "Returning to the problem discussed earlier.",
        });
      })(),
      (() => {
        const ref = REF("t2", "funding", "topic_recall", { topicHint: "funding" });
        return D("What did we say earlier about funding?", {
          entities: [ref.entity],
          referenceMentions: [ref.mention],
          interpretation: "Recalling what was said about funding.",
        });
      })(),
    ],
    expectByTurn: {
      // "the original problem" has NO lexical overlap with "low awareness" —
      // it only resolves through the claim recorded about it ("the main
      // PROBLEM is low awareness"), which is exactly the archived-topic case
      // this fixture exists to prove: medium confidence, not high.
      4: { chosenLabel: "low awareness", confidence: "medium" },
      5: { chosenLabel: "funding", confidence: "high" },
    },
  },

  // ───────────────────────────────────── ambiguous ordinal: two groups compete
  {
    name: "ordinal: bare ordinal is ambiguous between two equally-recent groups, then disambiguated by topic",
    turns: [
      D("We can hire two engineers or one designer.", {
        entities: [E("staffing", "concept", "staffing decision"), E("engineers", "group", "engineers"), E("designer", "person", "a designer")],
        relations: [R("staffing", "relates_to", "engineers"), R("staffing", "relates_to", "designer")],
        topicEntityId: "staffing",
        interpretation: "Staffing options: engineers or a designer.",
      }),
      D("For marketing we could do ads or influencers.", {
        entities: [E("marketing", "concept", "marketing decision"), E("ads", "concept", "ads"), E("influencers", "concept", "influencers")],
        relations: [R("marketing", "relates_to", "ads"), R("marketing", "relates_to", "influencers")],
        topicEntityId: "marketing",
        interpretation: "Marketing options: ads or influencers.",
      }),
      D("I keep thinking about the engineers and the ads.", {
        entities: [E("engineers", "group", "engineers"), E("ads", "concept", "ads")],
        interpretation: "Re-touching one member of each option group, so both are equally recent.",
      }),
      (() => {
        const ref = REF("o1", "the first one", "ordinal", { ordinalIndex: 0 });
        return D("Let's go with the first one.", { entities: [ref.entity], referenceMentions: [ref.mention], interpretation: "Choosing the first option — but which list?" });
      })(),
      (() => {
        const ref = REF("o2", "the first one", "ordinal", { ordinalIndex: 0, topicHint: "staffing" });
        return D("For staffing, the first one.", { entities: [ref.entity], referenceMentions: [ref.mention], interpretation: "Choosing the first staffing option." });
      })(),
    ],
    expectByTurn: {
      // No topic hint, two groups tied on recency: must NOT guess.
      3: { unresolved: true },
      // Same bare ordinal, now with a topic hint that names one of the two groups.
      4: { chosenLabel: "engineers", confidence: "high" },
    },
  },

  // ───────────────── topic recall: archived entity reactivates in the world, not forced onto the canvas
  {
    name: "topic recall: recalling an archived topic restores it in the world but not automatically onto the canvas",
    turns: [
      D("Our main problem is low awareness.", {
        entities: [E("awareness", "state", "low awareness")],
        claims: [C("the main problem is low awareness", ["awareness"])],
        topicEntityId: "awareness",
        interpretation: "Low awareness is the main problem.",
      }),
      D("Actually, let's set that aside for now.", {
        entities: [],
        supersededMentions: ["low awareness"],
        interpretation: "Archiving the awareness problem.",
      }),
      D("Let's focus on the launch instead — it depends on marketing being ready.", {
        entities: [E("launch", "concept", "the launch"), E("marketing", "concept", "marketing")],
        relations: [R("launch", "depends_on", "marketing")],
        topicEntityId: "launch",
        interpretation: "New topic: the launch depends on marketing.",
      }),
      (() => {
        const ref = REF("t1", "the original problem", "topic_recall", { topicHint: "the original problem" });
        return D("By the way, go back to the original problem for a second.", {
          entities: [ref.entity],
          referenceMentions: [ref.mention],
          interpretation: "A passing mention of the archived topic — not asking to make it the focus.",
        });
      })(),
    ],
    expectByTurn: {
      3: {
        chosenLabel: "low awareness",
        checks: (trace) => {
          const out = [];
          const entity = trace.world.entities.find((e) => e.label === "low awareness");
          if (!entity) return ["low awareness entity not found in world after recall"];
          if (entity.status !== "active") out.push(`expected status "active" after topic_recall, got "${entity.status}"`);
          const drawn = trace.plan.regions.some((r) => r.entityId === entity.id);
          if (drawn) out.push(`expected the recalled topic to stay off-canvas (nothing in this turn asked to focus on it), but it has a region`);
          return out;
        },
      },
    },
  },

  // ──── extra words in the pointer must not dilute a multi-word label ────
  {
    name: "topic recall: extra words in the pointer still resolve to the short correct label",
    turns: [
      D("We paused the growth marketer role a few weeks ago.", {
        entities: [E("role", "concept", "growth marketer role"), E("signups", "concept", "Signups")],
        claims: [C("The growth in signups from last month to this month is solid.", ["signups"])],
        topicEntityId: "role",
        interpretation: "The growth marketer role was paused; signups are up.",
      }),
      (() => {
        const ref = REF("t1", "the growth marketer role that was paused a few weeks ago", "topic_recall", {
          topicHint: "the growth marketer role that was paused a few weeks ago",
        });
        return D("Let's go back to the growth marketer role that was paused a few weeks ago.", {
          entities: [ref.entity],
          referenceMentions: [ref.mention],
          interpretation: "Returning to the paused growth marketer role.",
        });
      })(),
    ],
    expectByTurn: {
      1: { chosenLabel: "growth marketer role" },
    },
  },

  // ──── hyphenated hint vs spaced alias ────
  {
    name: "topic recall: hyphenated step-four hint matches a spaced alias",
    turns: [
      D("Step four is the drop-off.", {
        entities: [E("drop", "concept", "step four"), E("rebuild", "action", "full rebuild")],
        claims: [C("three options are now on the table for addressing the flow problem", ["rebuild"])],
        topicEntityId: "drop",
        interpretation: "Step four is the drop-off; a rebuild is also on the table.",
      }),
      (() => {
        const ref = REF("t1", "the same step-four problem we just talked about", "topic_recall", { topicHint: "step-four problem" });
        return D("It's connected to the same step-four problem we just talked about.", {
          entities: [ref.entity],
          referenceMentions: [ref.mention],
          interpretation: "Recalling the step-four problem.",
        });
      })(),
    ],
    expectByTurn: {
      1: { chosenLabel: "step four" },
    },
  },
];
