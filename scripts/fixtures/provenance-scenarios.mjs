/**
 * Speaker/timestamp/source provenance fixtures — the eight cases from the
 * multi-speaker provenance task:
 *
 *   1. two speakers make different claims about the same topic
 *   2. one speaker agrees with another
 *   3. one speaker contradicts another
 *   4. a speaker changes their own position later
 *   5. "go back to what Sarah said earlier about onboarding"
 *   6. "what did Kenny disagree with?"
 *   7. two speakers independently mention the same semantic entity
 *   8. archived claims retain their provenance
 *
 * Each turn carries its own `speakerId`/`timestamp` (segment metadata, never
 * part of the delta the model produces) alongside the hand-authored delta.
 * `stance` (agrees/disagrees + targetSurface) and `speakerHint` on
 * referenceMentions are written the way a real extractor would produce them
 * — the model's own words for the target, never a world id — exactly like
 * every other fixture in this directory.
 */

let n = 0;
const rid = () => `r${(n += 1)}`;
const cid = () => `c${(n += 1)}`;

const E = (id, type, label, extra = {}) => ({ id, type, label, ...extra });
const R = (source, type, target, extra = {}) => ({ id: rid(), source, type, target, ...extra });
const C = (text, about, extra = {}) => ({ id: cid(), text, ...(about ? { about } : {}), ...extra });

const REF = (id, surface, kind, refExtra = {}) => ({
  entity: E(id, "concept", surface),
  mention: { entityId: id, surface, kind, ...refExtra },
});

/** `speaker` and `timestamp` are InputSegment metadata; everything else is the delta, same shape as every other fixture. */
const T = (
  text,
  { speaker, timestamp, entities = [], relations = [], claims = [], topicEntityId, emphasisEntityIds, supersededMentions, referenceMentions, interpretation = "" } = {},
) => ({
  text,
  speaker,
  timestamp,
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

export const PROVENANCE_SCENARIOS = [
  // ─────────────────────────────── 1: different claims, same topic, one entity
  {
    name: "1. two speakers make different claims about the same topic",
    turns: [
      T("Activation is the problem.", {
        speaker: "sarah",
        timestamp: 1000,
        entities: [E("activation", "concept", "activation")],
        claims: [C("activation is the problem", ["activation"])],
        topicEntityId: "activation",
        interpretation: "Sarah claims activation is the problem.",
      }),
      T("Actually I think it's onboarding, not activation.", {
        speaker: "kenny",
        timestamp: 1015,
        entities: [E("activation", "concept", "activation"), E("onboarding", "concept", "onboarding")],
        claims: [C("onboarding is the problem, not activation", ["onboarding", "activation"])],
        topicEntityId: "onboarding",
        interpretation: "Kenny claims onboarding, not activation, is the problem.",
      }),
    ],
    check(traces, world) {
      const out = [];
      const activation = world.entities.filter((e) => e.label === "activation");
      if (activation.length !== 1) out.push(`expected ONE "activation" entity, found ${activation.length}`);
      else {
        const speakers = new Set((activation[0].provenance ?? []).map((p) => p.speakerId));
        if (!speakers.has("sarah") || !speakers.has("kenny")) {
          out.push(`expected activation's provenance to include both sarah and kenny, got [${[...speakers].join(", ")}]`);
        }
      }
      const sarahClaim = world.claims.find((c) => c.text.includes("activation is the problem"));
      const kennyClaim = world.claims.find((c) => c.text.includes("onboarding is the problem"));
      if (!sarahClaim || sarahClaim.provenance?.[0]?.speakerId !== "sarah") out.push(`Sarah's claim missing or missing her provenance`);
      if (!kennyClaim || kennyClaim.provenance?.[0]?.speakerId !== "kenny") out.push(`Kenny's claim missing or missing his provenance`);
      return out;
    },
  },

  // ─────────────────────────────── 2: agreement
  {
    name: "2. one speaker agrees with another",
    turns: [
      T("Activation is the problem.", {
        speaker: "sarah",
        timestamp: 2000,
        entities: [E("activation", "concept", "activation")],
        claims: [C("activation is the problem", ["activation"])],
        topicEntityId: "activation",
        interpretation: "Sarah claims activation is the problem.",
      }),
      T("I agree.", {
        speaker: "kenny",
        timestamp: 2010,
        entities: [E("activation", "concept", "activation")],
        claims: [C("agrees", ["activation"], { stance: { type: "agrees", targetSurface: "activation is the problem" } })],
        topicEntityId: "activation",
        interpretation: "Kenny agrees that activation is the problem.",
      }),
    ],
    check(traces, world) {
      const out = [];
      const agreeClaim = world.claims.find((c) => c.stance?.type === "agrees");
      if (!agreeClaim) return ["no claim carries stance.agrees"];
      if (agreeClaim.provenance?.[0]?.speakerId !== "kenny") out.push(`agreeing claim should be attributed to kenny, got ${agreeClaim.provenance?.[0]?.speakerId}`);
      const target = world.claims.find((c) => c.id === agreeClaim.stanceTargetClaimId);
      if (!target) out.push(`agreement did not resolve to a target claim`);
      else if (target.provenance?.[0]?.speakerId !== "sarah") out.push(`agreement's target claim should be sarah's, got ${target.provenance?.[0]?.speakerId}`);
      return out;
    },
  },

  // ─────────────────────────────── 3: contradiction
  {
    name: "3. one speaker contradicts another",
    turns: [
      T("Activation is the problem.", {
        speaker: "sarah",
        timestamp: 3000,
        entities: [E("activation", "concept", "activation")],
        claims: [C("activation is the problem", ["activation"])],
        topicEntityId: "activation",
        interpretation: "Sarah claims activation is the problem.",
      }),
      T("I disagree, that's not the real issue.", {
        speaker: "kenny",
        timestamp: 3012,
        entities: [E("activation", "concept", "activation")],
        claims: [C("disagrees", ["activation"], { stance: { type: "disagrees", targetSurface: "activation is the problem" } })],
        topicEntityId: "activation",
        interpretation: "Kenny disagrees that activation is the problem.",
      }),
    ],
    check(traces, world) {
      const out = [];
      const disagreeClaim = world.claims.find((c) => c.stance?.type === "disagrees");
      if (!disagreeClaim) return ["no claim carries stance.disagrees"];
      if (disagreeClaim.provenance?.[0]?.speakerId !== "kenny") out.push(`disagreeing claim should be attributed to kenny`);
      const target = world.claims.find((c) => c.id === disagreeClaim.stanceTargetClaimId);
      if (!target) out.push(`disagreement did not resolve to a target claim`);
      else if (target.provenance?.[0]?.speakerId !== "sarah") out.push(`disagreement's target should be sarah's claim`);
      return out;
    },
  },

  // ─────────────────────────────── 4: a speaker changes their own position later
  {
    name: "4. a speaker changes their own position later",
    turns: [
      T("I think activation is the problem.", {
        speaker: "kenny",
        timestamp: 4000,
        entities: [E("activation", "concept", "activation")],
        claims: [C("activation is the problem", ["activation"], { uncertain: true })],
        topicEntityId: "activation",
        interpretation: "Kenny thinks activation is the problem.",
      }),
      T("On reflection, I don't think that's right — it's onboarding.", {
        speaker: "kenny",
        timestamp: 4400,
        entities: [E("onboarding", "concept", "onboarding")],
        claims: [C("onboarding is the real problem", ["onboarding"], { stance: { type: "disagrees", targetSurface: "activation is the problem" } })],
        topicEntityId: "onboarding",
        interpretation: "Kenny revises his own earlier position: onboarding, not activation.",
      }),
    ],
    check(traces, world) {
      const out = [];
      const first = world.claims.find((c) => c.text === "activation is the problem");
      const second = world.claims.find((c) => c.text === "onboarding is the real problem");
      if (!first || !second) return ["expected both of kenny's claims to persist in world.claims"];
      if (first.provenance?.[0]?.speakerId !== "kenny" || second.provenance?.[0]?.speakerId !== "kenny") {
        out.push("both claims should be attributed to kenny — this is self-revision, not a second speaker");
      }
      if ((first.provenance?.[0]?.timestamp ?? 0) >= (second.provenance?.[0]?.timestamp ?? 0)) {
        out.push("the earlier claim's timestamp should precede the revision's");
      }
      if (second.stanceTargetClaimId !== first.id) out.push("the revision should resolve its stance target back to kenny's own earlier claim");
      return out;
    },
  },

  // ─────────────────────────────── 5: recall by speaker + topic
  {
    name: '5. "go back to what Sarah said earlier about onboarding"',
    turns: [
      T("I think onboarding is confusing for new users.", {
        speaker: "sarah",
        timestamp: 5000,
        entities: [E("onboarding", "concept", "onboarding")],
        claims: [C("onboarding is confusing for new users", ["onboarding"])],
        topicEntityId: "onboarding",
        interpretation: "Sarah says onboarding is confusing.",
      }),
      T("Let's talk about pricing instead.", {
        speaker: "kenny",
        timestamp: 5100,
        entities: [E("pricing", "concept", "pricing")],
        topicEntityId: "pricing",
        interpretation: "Topic switches to pricing.",
      }),
      T("Pricing needs a simpler tier structure.", {
        speaker: "kenny",
        timestamp: 5140,
        entities: [E("pricing", "concept", "pricing", { attributes: [{ key: "issue", value: "needs simpler tiers" }] })],
        topicEntityId: "pricing",
        interpretation: "Kenny elaborates on pricing.",
      }),
      (() => {
        const ref = REF("t1", "what Sarah said earlier about onboarding", "topic_recall", {
          topicHint: "onboarding",
          speakerHint: "Sarah",
        });
        return T("Go back to what Sarah said earlier about onboarding.", {
          speaker: "kenny",
          timestamp: 5300,
          entities: [ref.entity],
          referenceMentions: [ref.mention],
          interpretation: "Recalling Sarah's earlier point about onboarding.",
        });
      })(),
    ],
    expectByTurn: {
      3: { chosenLabel: "onboarding", confidence: "high" },
    },
  },

  // ─────────────────────────────── 6: query by speaker + stance
  {
    name: '6. "what did Kenny disagree with?" (queryable from world state alone)',
    turns: [
      T("Activation is the problem.", {
        speaker: "sarah",
        timestamp: 6000,
        entities: [E("activation", "concept", "activation")],
        claims: [C("activation is the problem", ["activation"])],
        topicEntityId: "activation",
        interpretation: "Sarah claims activation is the problem.",
      }),
      T("Traffic has actually doubled this month.", {
        speaker: "sarah",
        timestamp: 6050,
        entities: [E("traffic", "state", "traffic", { attributes: [{ key: "trend", value: "doubled" }] })],
        claims: [C("traffic has doubled this month", ["traffic"])],
        topicEntityId: "traffic",
        interpretation: "Sarah notes traffic doubled.",
      }),
      T("I disagree that activation is the problem — I think it's discovery.", {
        speaker: "kenny",
        timestamp: 6120,
        entities: [E("discovery", "concept", "discovery")],
        claims: [C("discovery is the real problem", ["discovery"], { stance: { type: "disagrees", targetSurface: "activation is the problem" } })],
        topicEntityId: "discovery",
        interpretation: "Kenny disagrees that activation is the problem.",
      }),
    ],
    check(traces, world) {
      // "What did Kenny disagree with?" is answerable purely from
      // WorldState: filter claims by provenance.speakerId === "kenny" and
      // stance.type === "disagrees", then read stanceTargetClaimId.
      const kennyDisagreements = world.claims.filter(
        (c) => c.stance?.type === "disagrees" && (c.provenance ?? []).some((p) => p.speakerId === "kenny"),
      );
      if (kennyDisagreements.length !== 1) return [`expected exactly one of kenny's claims to be a disagreement, found ${kennyDisagreements.length}`];
      const target = world.claims.find((c) => c.id === kennyDisagreements[0].stanceTargetClaimId);
      if (!target) return ["kenny's disagreement did not resolve to a target claim"];
      if (target.text !== "activation is the problem") return [`expected kenny to disagree with "activation is the problem", got "${target.text}"`];
      if (!(target.provenance ?? []).some((p) => p.speakerId === "sarah")) return ["the claim kenny disagreed with should be attributed to sarah"];
      return [];
    },
  },

  // ─────────────────────────────── 7: independent mention, same entity
  {
    name: "7. two speakers independently mention the same semantic entity",
    turns: [
      T("We need to fix onboarding.", {
        speaker: "sarah",
        timestamp: 7000,
        entities: [E("onboarding", "concept", "onboarding")],
        topicEntityId: "onboarding",
        interpretation: "Sarah raises onboarding.",
      }),
      T("Yeah, onboarding is rough right now.", {
        speaker: "kenny",
        timestamp: 7500,
        entities: [E("onboarding", "concept", "onboarding")],
        topicEntityId: "onboarding",
        interpretation: "Kenny independently mentions onboarding too.",
      }),
    ],
    check(traces, world) {
      const matches = world.entities.filter((e) => e.label === "onboarding");
      if (matches.length !== 1) return [`expected ONE onboarding entity (identity is speaker-agnostic), found ${matches.length}`];
      const speakers = new Set((matches[0].provenance ?? []).map((p) => p.speakerId));
      if (!speakers.has("sarah") || !speakers.has("kenny")) {
        return [`expected onboarding's provenance to record both speakers, got [${[...speakers].join(", ")}]`];
      }
      return [];
    },
  },

  // ─────────────────────────────── 8: archived claims retain provenance
  {
    name: "8. archived claims retain their provenance",
    turns: [
      T("Traffic is the main problem.", {
        speaker: "sarah",
        timestamp: 8000,
        entities: [E("traffic", "state", "traffic")],
        claims: [C("traffic is the main problem", ["traffic"])],
        topicEntityId: "traffic",
        interpretation: "Sarah claims traffic is the main problem.",
      }),
      T("Actually let's set the traffic idea aside.", {
        speaker: "kenny",
        timestamp: 8200,
        entities: [],
        supersededMentions: ["traffic"],
        interpretation: "Kenny archives the traffic topic.",
      }),
    ],
    check(traces, world) {
      const out = [];
      const trafficEntity = world.entities.find((e) => e.label === "traffic");
      if (!trafficEntity) return ["traffic entity vanished entirely — should be superseded, not deleted"];
      if (trafficEntity.status !== "superseded") out.push(`expected traffic to be superseded, got "${trafficEntity.status}"`);
      const claim = world.claims.find((c) => c.text === "traffic is the main problem");
      if (!claim) out.push("the claim about traffic should still exist in world.claims after archiving");
      else if (claim.provenance?.[0]?.speakerId !== "sarah") out.push(`archived claim lost its provenance — expected sarah, got ${claim.provenance?.[0]?.speakerId}`);
      return out;
    },
  },
];
