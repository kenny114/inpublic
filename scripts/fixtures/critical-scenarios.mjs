/**
 * The three "critical test conversation" fixtures from the InPublic V1
 * spec: a five-turn decision that gets reversed and briefly reconsidered
 * under a hypothetical, a causal chain that must not become five floating
 * boxes, and a correction that must change WHICH problem is primary rather
 * than caption the correction itself.
 *
 * Unlike scripts/fixtures/expression-scenarios.mjs, these are not
 * paragraph-vs-incremental convergence tests — the whole point is the
 * turn-by-turn revision, so each scenario is one ordered sequence of turns
 * and each turn carries its OWN expectation, checked against the trace
 * produced right after that turn. Later turns are allowed to change what an
 * earlier turn asserted (that's the test), so expectations are per-turn, not
 * merged into one final assertion.
 *
 * Deltas are hand-authored as a real extractor would plausibly produce them
 * against the extraction contract in lib/expression/meaning/extract.ts.
 */

let n = 0;
const rid = () => `r${(n += 1)}`;

const E = (id, type, label, extra = {}) => ({ id, type, label, ...extra });
const R = (source, type, target, extra = {}) => ({ id: rid(), source, type, target, ...extra });

const D = (
  text,
  { entities = [], relations = [], claims = [], topicEntityId, emphasisEntityIds, supersededMentions, interpretation = "" } = {},
) => ({
  text,
  delta: {
    entities,
    relations,
    claims,
    ...(topicEntityId ? { topicEntityId } : {}),
    ...(emphasisEntityIds ? { emphasisEntityIds } : {}),
    ...(supersededMentions ? { supersededMentions } : {}),
    interpretation,
  },
});

export const CRITICAL_SCENARIOS = [
  // ─────────────────────────────────── decision → reversal → hypothetical
  {
    name: "critical: raise vs bootstrap, reversal, hypothetical, forget-it",
    turns: [
      D("I have two options. I can raise money or stay bootstrapped.", {
        entities: [
          E("decision", "concept", "the decision"),
          E("raise", "concept", "raise money"),
          E("bootstrap", "concept", "stay bootstrapped"),
        ],
        relations: [
          R("decision", "relates_to", "raise"),
          R("decision", "relates_to", "bootstrap"),
          R("raise", "contrasts_with", "bootstrap"),
        ],
        topicEntityId: "decision",
        interpretation: "Choosing between raising money and staying bootstrapped.",
      }),
      D("Bootstrapping is safer but slower.", {
        entities: [
          E("bootstrap", "concept", "stay bootstrapped", {
            attributes: [
              { key: "safety", value: "safer" },
              { key: "speed", value: "slower" },
            ],
          }),
        ],
        topicEntityId: "bootstrap",
        interpretation: "Bootstrapping trades speed for safety.",
      }),
      D("Actually, I don't want to raise anymore.", {
        entities: [E("raise", "concept", "raise money")],
        emphasisEntityIds: ["bootstrap"],
        supersededMentions: ["raise money"],
        interpretation: "Rejecting the raise option; bootstrapping is now the direction.",
      }),
      D("But hypothetically, if someone offered us five hundred thousand dollars, I'd reconsider.", {
        entities: [
          E("offer", "quantity", "$500K offer", { quantity: { value: 500000, unit: "USD" }, confidence: "low" }),
          E("reconsider", "action", "reconsider", { confidence: "low" }),
          E("raise", "concept", "raise money", { confidence: "low" }),
        ],
        relations: [
          R("offer", "causes", "reconsider", { confidence: "low" }),
          R("reconsider", "causes", "raise", { confidence: "low" }),
        ],
        topicEntityId: "offer",
        interpretation: "A hypothetical $500K offer would make the speaker reconsider raising.",
      }),
      D("Forget that. We're bootstrapping.", {
        entities: [E("bootstrap", "concept", "stay bootstrapped")],
        emphasisEntityIds: ["bootstrap"],
        supersededMentions: ["$500K offer", "reconsider"],
        interpretation: "Withdrawing the hypothetical; bootstrapping is the committed direction.",
      }),
    ],
    /** One expectation per turn index (0-based), checked right after that turn's trace. */
    expectByTurn: {
      0: { entities: ["raise money", "stay bootstrapped"], singular: ["raise money", "stay bootstrapped"] },
      1: { entities: ["stay bootstrapped"] },
      2: { absent: ["raise money"] },
      3: { entities: ["$500K offer", "reconsider"] },
      4: { absent: ["$500K offer", "reconsider"], entities: ["stay bootstrapped"] },
    },
  },

  // ───────────────────────────────────────────────── causal chain, no captions
  {
    name: "critical: awareness -> users -> revenue (causal chain)",
    turns: [
      D(
        "We're not making enough money because hardly anyone knows about the product, so we don't have enough users.",
        {
          entities: [
            E("awareness", "state", "low awareness"),
            E("users", "state", "few users"),
            E("revenue", "state", "low revenue"),
          ],
          relations: [R("awareness", "causes", "users"), R("users", "causes", "revenue")],
          topicEntityId: "revenue",
          interpretation: "Low awareness causes few users, which causes low revenue.",
        },
      ),
    ],
    expectByTurn: {
      0: {
        entities: ["low awareness", "few users", "low revenue"],
        entityCount: 3,
        relations: [
          ["low awareness", "causes", "few users"],
          ["few users", "causes", "low revenue"],
        ],
        readable: [
          ["low awareness", "causes", "few users"],
          ["few users", "causes", "low revenue"],
        ],
        intent: "explain_causality",
        grammar: "cause_effect",
        minDimension: { causal: 1, ordering: 1 },
      },
    },
  },

  // ─────────────────────────────────────────────────────────── correction
  {
    name: "critical: traffic doubled, activation is the real problem",
    turns: [
      D("I thought traffic was the problem.", {
        entities: [E("traffic", "state", "traffic", { attributes: [{ key: "role", value: "primary problem" }] })],
        topicEntityId: "traffic",
        interpretation: "Traffic was believed to be the primary problem.",
      }),
      D("Actually traffic doubled.", {
        entities: [E("traffic", "state", "traffic", { attributes: [{ key: "trend", value: "doubled" }] })],
        topicEntityId: "traffic",
        interpretation: "Traffic in fact doubled, so it is not the problem.",
      }),
      D("Activation is the thing that's broken.", {
        entities: [E("activation", "state", "activation", { attributes: [{ key: "role", value: "primary problem" }] })],
        emphasisEntityIds: ["activation"],
        topicEntityId: "activation",
        interpretation: "Activation is the primary problem now, not traffic.",
      }),
    ],
    expectByTurn: {
      0: { entities: ["traffic"] },
      1: { entities: ["traffic"], singular: ["traffic"] },
      2: { entities: ["traffic", "activation"], singular: ["traffic", "activation"] },
    },
    /** Checked on the FINAL trace only: the corrected primary must win. */
    attributes: [["activation", "role", "primary problem"]],
  },
];
