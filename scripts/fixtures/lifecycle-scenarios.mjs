/**
 * Discourse-act lifecycle fixtures: reject / suspend / deemphasize /
 * invalidate / supersede / reactivate.
 *
 * Deltas are hand-authored as a real extractor would plausibly produce them
 * against the DiscourseActSchema contract in lib/expression/schemas.ts: the
 * model names the act and its own words for the target — never a world id —
 * and lib/expression/world/apply.ts resolves it deterministically the same
 * way it resolves every other free-text pointer in this engine.
 *
 * Each scenario asserts the exact status distinction the task cares about —
 * a caption system accumulates, a thought system changes its state — so
 * every check reads a specific WorldEntity.status / .supersededByEntityId /
 * WorldClaim.invalidated rather than just "is it gone".
 */

let n = 0;
const rid = () => `r${(n += 1)}`;
const cid = () => `c${(n += 1)}`;

const E = (id, type, label, extra = {}) => ({ id, type, label, ...extra });
const R = (source, type, target, extra = {}) => ({ id: rid(), source, type, target, ...extra });
const C = (text, about, extra = {}) => ({ id: cid(), text, ...(about ? { about } : {}), ...extra });
const ACT = (type, targetSurface, extra = {}) => ({ type, targetSurface, ...extra });

const D = (
  text,
  { entities = [], relations = [], claims = [], topicEntityId, emphasisEntityIds, supersededMentions, referenceMentions, discourseActs, interpretation = "" } = {},
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
    ...(discourseActs ? { discourseActs } : {}),
    interpretation,
  },
});

function entityByLabel(world, label) {
  return world.entities.find((e) => e.label === label);
}

export const LIFECYCLE_SCENARIOS = [
  // ─────────────────────────────────────────────────────────── reject
  {
    name: "reject: raise-money rejected outright",
    turns: [
      D("We should raise money.", {
        entities: [E("raise", "concept", "raise money")],
        topicEntityId: "raise",
        interpretation: "Proposing raising money.",
      }),
      D("Actually, forget that.", {
        entities: [],
        discourseActs: [ACT("reject", "raise money")],
        interpretation: "Rejecting the fundraising proposal.",
      }),
    ],
    check(world) {
      const raise = entityByLabel(world, "raise money");
      if (!raise) return ["raise-money entity vanished — should be kept, marked rejected"];
      if (raise.status !== "rejected") return [`expected status "rejected", got "${raise.status}"`];
      return [];
    },
  },

  // ─────────────────────────────────────────────────────────── suspend + reactivate
  {
    name: "suspend then reactivate across unrelated turns",
    turns: [
      D("We could partner with creators.", {
        entities: [E("creator", "concept", "creator partnership")],
        topicEntityId: "creator",
        interpretation: "Proposing a creator partnership.",
      }),
      D("Let's park that for now.", {
        entities: [],
        discourseActs: [ACT("suspend", "creator partnership")],
        interpretation: "Suspending the creator partnership idea.",
      }),
      D("Anyway, the weather has been rough this week.", { entities: [E("weather", "concept", "the weather")], interpretation: "Unrelated small talk." }),
      D("Let's talk about the roadmap for Q3 instead.", { entities: [E("roadmap", "concept", "Q3 roadmap")], interpretation: "Unrelated: Q3 roadmap." }),
      D("Go back to the creator idea.", {
        entities: [],
        discourseActs: [ACT("reactivate", "creator partnership")],
        interpretation: "Reactivating the creator partnership idea.",
      }),
    ],
    checkByTurn: {
      1: (world) => {
        const c = entityByLabel(world, "creator partnership");
        if (!c) return ["creator-partnership entity vanished"];
        return c.status === "suspended" ? [] : [`expected "suspended" right after parking, got "${c.status}"`];
      },
      4: (world) => {
        const c = entityByLabel(world, "creator partnership");
        if (!c) return ["creator-partnership entity vanished"];
        return c.status === "active" ? [] : [`expected "active" after reactivation, got "${c.status}"`];
      },
    },
    check(world) {
      const c = entityByLabel(world, "creator partnership");
      if (!c) return ["creator-partnership entity vanished by the end"];
      return c.status === "active" ? [] : [`expected final status "active", got "${c.status}"`];
    },
  },

  // ─────────────────────────────────────────────────────────── invalidate
  {
    name: "invalidate: a claim marked false, not deleted",
    turns: [
      D("Low traffic is the problem.", {
        entities: [E("traffic", "state", "low traffic")],
        claims: [C("low traffic is the problem", ["traffic"])],
        topicEntityId: "traffic",
        interpretation: "Claiming low traffic is the problem.",
      }),
      D("No, that's wrong. Traffic doubled.", {
        entities: [E("traffic", "state", "traffic", { attributes: [{ key: "trend", value: "doubled" }] })],
        claims: [C("traffic doubled", ["traffic"])],
        discourseActs: [ACT("invalidate", "low traffic is the problem")],
        interpretation: "Invalidating the low-traffic claim; traffic actually doubled.",
      }),
    ],
    check(world) {
      const claim = world.claims.find((c) => c.text === "low traffic is the problem");
      if (!claim) return ["the low-traffic claim vanished — should be kept, marked invalidated"];
      if (!claim.invalidated) return ["expected the low-traffic claim to be invalidated"];
      const traffic = entityByLabel(world, "traffic");
      if (!traffic || traffic.status !== "active") return ["the traffic entity itself should remain active — only the CLAIM about it is invalidated"];
      return [];
    },
  },

  // ─────────────────────────────────────────────────────────── supersede
  {
    name: "supersede: $20 replaced by $15",
    turns: [
      D("We should charge $20.", {
        entities: [E("p20", "quantity", "$20", { quantity: { value: 20, unit: "USD" } })],
        topicEntityId: "p20",
        interpretation: "Proposing a $20 price.",
      }),
      D("Actually make that $15.", {
        entities: [E("p15", "quantity", "$15", { quantity: { value: 15, unit: "USD" } })],
        discourseActs: [ACT("supersede", "$20", { supersededByLocalId: "p15" })],
        topicEntityId: "p15",
        interpretation: "Revising the price to $15.",
      }),
    ],
    check(world) {
      const p20 = entityByLabel(world, "$20");
      const p15 = entityByLabel(world, "$15");
      if (!p20 || !p15) return ["both price entities should exist in world history"];
      if (p20.status !== "superseded") return [`expected $20 status "superseded", got "${p20.status}"`];
      if (p20.supersededByEntityId !== p15.id) return [`expected $20.supersededByEntityId to point at $15 (${p15.id}), got ${p20.supersededByEntityId}`];
      if (p15.status !== "active") return [`expected $15 to be active, got "${p15.status}"`];
      return [];
    },
  },

  // ─────────────────────────────────────────────────────────── deemphasize
  {
    name: "deemphasize: still valid, lower priority, not deleted",
    turns: [
      D("Distribution matters.", {
        entities: [E("distribution", "concept", "distribution")],
        topicEntityId: "distribution",
        interpretation: "Distribution is raised as important.",
      }),
      D("It's just not the main issue right now.", {
        entities: [],
        discourseActs: [ACT("deemphasize", "distribution")],
        interpretation: "Distribution is deemphasized, not dismissed.",
      }),
    ],
    check(world) {
      const d = entityByLabel(world, "distribution");
      if (!d) return ["distribution entity vanished — should stay, just deemphasized"];
      if (d.status !== "deemphasized") return [`expected status "deemphasized", got "${d.status}"`];
      if (d.importance === "primary") return ["a deemphasized entity should never still be scored as primary"];
      return [];
    },
  },

  // ──── long targetSurface with extra words still hits the right entity ────
  {
    name: "reactivate: extra words in targetSurface do not lose to a coincidental claim hit",
    turns: [
      D("We paused the growth marketer role.", {
        entities: [E("role", "concept", "growth marketer role"), E("signups", "concept", "Signups")],
        claims: [C("The growth in signups from last month to this month is solid.", ["signups"])],
        discourseActs: [ACT("suspend", "growth marketer role")],
        topicEntityId: "role",
        interpretation: "Pausing the growth marketer role.",
      }),
      D("Let's reopen the growth marketer role that was paused a few weeks ago.", {
        entities: [],
        discourseActs: [ACT("reactivate", "the growth marketer role that was paused a few weeks ago")],
        interpretation: "Reactivating the paused growth marketer role.",
      }),
    ],
    check(world) {
      const role = entityByLabel(world, "growth marketer role");
      if (!role) return ["growth marketer role vanished"];
      if (role.status !== "active") return [`expected status "active" after reactivate, got "${role.status}"`];
      const signups = entityByLabel(world, "Signups");
      if (signups && signups.status !== "active") return [`Signups was mutated — status "${signups.status}"`];
      return [];
    },
  },

  // ──── parent/child labels: abstain rather than reject the product ────
  {
    name: "reject: parent/child labels stay unresolved rather than mutating the product",
    turns: [
      D("What if we got rid of the free tier?", {
        entities: [E("free", "object", "free tier"), E("revisit", "action", "revisit the free tier")],
        topicEntityId: "revisit",
        interpretation: "Proposing removing the free tier.",
      }),
      D("Okay, forget removing the free tier, that idea's dead.", {
        entities: [],
        discourseActs: [ACT("reject", "removing the free tier")],
        interpretation: "Abandoning the proposal to remove the free tier.",
      }),
    ],
    check(world) {
      const free = entityByLabel(world, "free tier");
      const proposal = entityByLabel(world, "revisit the free tier");
      if (!free) return ["free tier vanished"];
      if (free.status === "rejected") {
        return [`free tier (the product) was wrongly rejected — the pointer was "removing the free tier", which names the proposal`];
      }
      if (!proposal) return ["revisit the free tier vanished"];
      if (proposal.status !== "rejected") {
        return [`expected the proposal "revisit the free tier" to be rejected, got "${proposal.status}"`];
      }
      return [];
    },
  },
];

/**
 * The "nasty sequence" — eight turns exercising every act plus reference
 * resolution and correction, in one continuous world. The final state is
 * asserted exactly against the task's own description:
 *
 *   BOOTSTRAP            primary / active
 *   FUNDRAISING          active fallback, previously suspended, reactivated
 *   CREATOR PARTNERSHIP  rejected
 *   DISTRIBUTION PROBLEM still active
 */
export const NASTY_SEQUENCE = {
  name: "nasty sequence: eight turns of revision, one continuous world",
  turns: [
    D("We could raise, bootstrap, or partner with creators.", {
      entities: [
        E("decision", "concept", "the decision"),
        E("raise", "concept", "raise money"),
        E("bootstrap", "concept", "bootstrap"),
        E("creator", "concept", "creator partnership"),
      ],
      relations: [R("decision", "relates_to", "raise"), R("decision", "relates_to", "bootstrap"), R("decision", "relates_to", "creator")],
      topicEntityId: "decision",
      interpretation: "Three options: raise, bootstrap, or partner with creators.",
    }),
    D("Let's set raising aside for now.", {
      entities: [],
      discourseActs: [ACT("suspend", "raise money")],
      interpretation: "Suspending the fundraising option.",
    }),
    D("I think distribution is the main problem.", {
      entities: [E("distribution", "concept", "distribution problem")],
      topicEntityId: "distribution",
      interpretation: "Distribution is identified as the main problem.",
    }),
    D("Maybe creators solve that.", {
      entities: [E("creator", "concept", "creator partnership"), E("distribution", "concept", "distribution problem")],
      relations: [R("creator", "enables", "distribution")],
      topicEntityId: "creator",
      interpretation: "Creator partnership might solve the distribution problem.",
    }),
    D("Actually, forget the creator idea.", {
      entities: [],
      discourseActs: [ACT("reject", "creator partnership")],
      interpretation: "Rejecting the creator partnership idea entirely.",
    }),
    D("Go back to fundraising.", {
      entities: [],
      discourseActs: [ACT("reactivate", "raise money")],
      interpretation: "Reactivating the fundraising option.",
    }),
    D("The option we parked earlier might work if we only raise $500K.", {
      entities: [E("raise", "concept", "raise money", { attributes: [{ key: "amount", value: "$500K" }] })],
      topicEntityId: "raise",
      interpretation: "Reconsidering fundraising, scoped to $500K.",
    }),
    D("No, keep bootstrapping as the primary plan, but leave fundraising open as a fallback.", {
      entities: [E("bootstrap", "concept", "bootstrap"), E("raise", "concept", "raise money")],
      emphasisEntityIds: ["bootstrap"],
      discourseActs: [ACT("deemphasize", "raise money")],
      topicEntityId: "bootstrap",
      interpretation: "Bootstrap is the primary plan; fundraising stays open as a fallback, not the focus.",
    }),
  ],
  check(world) {
    const out = [];
    const bootstrap = entityByLabel(world, "bootstrap");
    const raise = entityByLabel(world, "raise money");
    const creator = entityByLabel(world, "creator partnership");
    const distribution = entityByLabel(world, "distribution problem");

    if (!bootstrap) out.push("bootstrap entity missing");
    else {
      if (bootstrap.status !== "active") out.push(`bootstrap: expected status "active", got "${bootstrap.status}"`);
      if (bootstrap.importance !== "primary") out.push(`bootstrap: expected importance "primary", got "${bootstrap.importance}"`);
    }

    if (!raise) out.push("raise-money entity missing");
    else {
      // "Leave fundraising open as a fallback" after a suspend+reactivate
      // cycle: it must be live (active or deemphasized — either is a valid
      // reading of "fallback"), never dropped back to an archived status,
      // and specifically NOT primary (bootstrap is).
      if (!["active", "deemphasized"].includes(raise.status)) out.push(`raise-money: expected an active/deemphasized fallback status, got "${raise.status}"`);
      if (raise.importance === "primary") out.push(`raise-money: should not be primary (bootstrap is), got importance "${raise.importance}"`);
    }

    if (!creator) out.push("creator-partnership entity missing — should be kept, rejected");
    else if (creator.status !== "rejected") out.push(`creator-partnership: expected status "rejected", got "${creator.status}"`);

    if (!distribution) out.push("distribution-problem entity missing");
    else if (distribution.status !== "active") out.push(`distribution-problem: expected status "active", got "${distribution.status}"`);

    return out;
  },
};
