/**
 * Adversarial entity-identity fixtures: for lib/expression/world/identity.ts's
 * two-stage resolver, driven through the REAL pipeline
 * (ExpressionSession.ingestDelta with `enableIdentityLayer: true`) rather
 * than by calling retrieveIdentityCandidates/resolveEntityIdentity directly.
 *
 * Deltas are hand-authored (as an honest extractor would produce them) so
 * these run with no network and no API key, exactly like every other
 * scripts/fixtures/*.mjs file — but stage 2 (the semantic judge) is
 * genuinely exercised too, via a SCRIPTED judge instead of the real model.
 * A scenario's `judgeScript` says what the judge should answer for a given
 * mention label; any mention not listed falls through to the same
 * `abstainIdentityJudge` production code uses by default, so "no script
 * entry" is itself a real test of "abstain rather than guess" — not a gap
 * in the fixture.
 *
 * The real model's judgment (does it actually SAY same_entity for "the
 * rebuild" vs "full rebuild" in practice) is verified separately, live, by
 * scripts/expression-meeting-stress-replay.mjs — that is the one thing a
 * scripted judge cannot honestly stand in for.
 */

let n = 0;
const rid = () => `r${(n += 1)}`;

const E = (id, type, label, extra = {}) => ({ id, type, label, ...extra });
const R = (source, type, target, extra = {}) => ({ id: rid(), source, type, target, ...extra });
const M = (unit, points, extra = {}) => ({ unit, points, ...extra });
const ACT = (type, targetSurface, extra = {}) => ({ type, targetSurface, ...extra });

const D = (text, { entities = [], relations = [], claims = [], topicEntityId, discourseActs, interpretation = "" } = {}, speakerId) => ({
  text,
  speakerId,
  delta: { entities, relations, claims, ...(topicEntityId ? { topicEntityId } : {}), ...(discourseActs ? { discourseActs } : {}), interpretation },
});

/** One scripted judge answer: when a mention's label matches, always answer the same way — same_entity resolves to whichever CURRENT candidate has label `target`. */
const J = (mentionLabel, verdict, target) => ({ mentionLabel: mentionLabel.toLowerCase(), verdict, target });

/** Builds a scenario-scoped IdentityJudge from its judgeScript — unmatched mentions fall through to a real "uncertain" abstention, not a silent default pick. */
export function scriptedJudge(judgeScript) {
  return async (mention, candidates) => {
    const entry = (judgeScript ?? []).find((j) => j.mentionLabel === mention.label.toLowerCase());
    if (!entry) return { index: null, verdict: "uncertain", reason: "no script entry — abstaining (this IS the production default behaviour)" };
    if (entry.verdict !== "same_entity") return { index: null, verdict: entry.verdict, reason: "scripted" };
    const index = candidates.findIndex((c) => c.label.toLowerCase() === entry.target.toLowerCase());
    if (index < 0) return { index: null, verdict: "uncertain", reason: `scripted target "${entry.target}" was not among the candidates offered — treating as uncertain rather than guessing` };
    return { index, verdict: "same_entity", reason: "scripted" };
  };
}

function liveEntities(world) {
  return world.entities.filter((e) => e.status !== "superseded" && e.status !== "rejected");
}
function entityByAnyLabel(world, ...labels) {
  const wanted = new Set(labels.map((l) => l.toLowerCase()));
  return world.entities.filter((e) => wanted.has(e.label.toLowerCase()) || e.aliases.some((a) => wanted.has(a)));
}

// Enough unrelated filler turns between two mentions to push the earlier one
// outside the default 6-turn recency window, so a later reuse of a short
// generic label cannot lean on "recently discussed" as free corroboration.
function filler(n, topicLabel) {
  return Array.from({ length: n }, (_, i) =>
    D(`filler ${i}`, { entities: [E(`filler-${i}`, "concept", `unrelated topic ${i}`)], interpretation: topicLabel }),
  );
}

export const IDENTITY_SCENARIOS = [
  // ───────────────────────────────── paraphrase across speakers merges to one entity
  {
    name: "\"full rebuild\" / \"the rebuild\" / \"rebuilding the product\" across three speakers merge to one entity",
    judgeScript: [J("the rebuild", "same_entity", "full rebuild"), J("rebuilding the product", "same_entity", "full rebuild")],
    turns: [
      D("We could rebuild onboarding from scratch.", { entities: [E("e1", "action", "full rebuild", { description: "rebuild the onboarding flow from scratch" })] }, "priya"),
      D("I don't think the rebuild is worth it this quarter.", { entities: [E("e1", "action", "the rebuild")] }, "sam"),
      D("Rebuilding the product is a six week project.", { entities: [E("e1", "action", "rebuilding the product")] }, "morgan"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const matches = entityByAnyLabel(world, "full rebuild", "the rebuild", "rebuilding the product");
      if (matches.length !== 1) out.push(`expected exactly 1 entity for the rebuild across all three phrasings, found ${matches.length}: ${matches.map((e) => e.label).join(", ")}`);
      const merges = identityResolutions.filter((r) => r.action === "merge").length;
      if (merges < 2) out.push(`expected at least 2 of the 3 turns to merge into the first, only ${merges} did`);
      return out;
    },
  },

  // ───────────────────────────────── exact repeat auto-merges at stage 1, no judge needed
  {
    name: "exact repeat of a metric label auto-merges deterministically (no judge call)",
    judgeScript: [], // deliberately empty — if this scenario needs the judge at all, stage 1 failed at the one thing it must handle for free
    turns: [
      D("Activation rate is at 32%.", { entities: [E("e1", "concept", "activation rate", { metric: M("percent", [{ value: 32 }]) })] }, "jordan"),
      D("Activation rate moved to 45%.", { entities: [E("e1", "concept", "activation rate", { metric: M("percent", [{ value: 45 }]) })] }, "morgan"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const matches = entityByAnyLabel(world, "activation rate");
      if (matches.length !== 1) out.push(`expected 1 entity, found ${matches.length}`);
      const hist = matches[0]?.metric?.history?.map((p) => p.value).join(",");
      if (hist !== "32,45") out.push(`expected merged metric history "32,45", got "${hist}"`);
      const second = identityResolutions[1];
      if (!second || second.usedJudge) out.push(`expected the second mention to resolve deterministically without the judge, usedJudge=${second?.usedJudge}`);
      return out;
    },
  },

  // ───────────────────────────────── false-merge guard: superficially similar, genuinely different
  {
    name: "\"the growth marketer role\" and \"the growth in signups\" stay two distinct entities",
    judgeScript: [], // no script entry — the correct behaviour here is to abstain, same as production default
    turns: [
      D("We paused the growth marketer role.", { entities: [E("e1", "concept", "the growth marketer role")] }, "alex"),
      D("The growth in signups has been strong this month.", { entities: [E("e2", "concept", "the growth in signups")] }, "jordan"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const role = entityByAnyLabel(world, "the growth marketer role");
      const growth = entityByAnyLabel(world, "the growth in signups");
      if (role.length !== 1 || growth.length !== 1 || role[0].id === growth[0]?.id) {
        out.push(`expected two distinct entities, got role=${JSON.stringify(role.map((e) => e.id))} growth=${JSON.stringify(growth.map((e) => e.id))}`);
      }
      const secondAction = identityResolutions[1]?.action;
      // "hold" (abstained with candidates on the table) and "create" (no
      // candidates at all) are both correct non-merge outcomes here — the
      // fixture's actual requirement is just that it never falsely merges.
      if (secondAction === "merge") out.push(`expected the second mention NOT to merge, got action="${secondAction}"`);
      return out;
    },
  },

  // ───────────────────────────────── same generic noun under different active topics, far apart — must not silently merge
  {
    name: "\"the fix\" reused for a genuinely different thing after a long topic drift does not silently merge",
    judgeScript: [], // no script entry: the corroboration guard should defer to the judge, which then correctly abstains
    turns: [
      D("The fix for step four should ship Thursday.", { entities: [E("e1", "action", "the fix", { description: "fix step four of the onboarding flow" })] }, "sam"),
      ...filler(8, "billing incident discussion"),
      D("The fix for the billing retry bug needs a full week.", { entities: [E("e2", "action", "the fix", { description: "fix the payment webhook retry logic" })] }, "priya"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const fixes = world.entities.filter((e) => e.label.toLowerCase() === "the fix");
      if (fixes.length !== 2) out.push(`expected the two unrelated "the fix" mentions to stay as 2 distinct entities, found ${fixes.length}`);
      const last = identityResolutions[identityResolutions.length - 1];
      if (last?.action === "merge") out.push(`expected the second "the fix" NOT to merge into the unrelated first one, got action="${last?.action}"`);
      return out;
    },
  },

  // ───────────────────────────────── old concept recalled after a long topic switch — SHOULD merge, judge confirms
  {
    name: "a concept recalled by consistent full phrasing after a long topic switch still merges via the judge",
    judgeScript: [J("usage-based pricing", "same_entity", "usage-based pricing model")],
    turns: [
      D("What if we did a usage-based pricing model instead of fixed tiers?", { entities: [E("e1", "concept", "usage-based pricing model")] }, "priya"),
      ...filler(8, "incident review"),
      D("Usage-based pricing is worth another look given the billing bug.", { entities: [E("e2", "concept", "usage-based pricing")] }, "morgan"),
    ],
    check({ world }) {
      const out = [];
      const matches = entityByAnyLabel(world, "usage-based pricing model", "usage-based pricing");
      if (matches.length !== 1) out.push(`expected the judge to merge these back into 1 entity, found ${matches.length}`);
      return out;
    },
  },

  // ───────────────────────────────── metric wording with time qualifiers
  {
    name: "\"traffic\" / \"traffic this month\" / \"our traffic numbers\" merge into one metric identity",
    judgeScript: [J("traffic this month", "same_entity", "traffic"), J("our traffic numbers", "same_entity", "traffic")],
    turns: [
      D("Traffic is at 200.", { entities: [E("e1", "concept", "traffic", { metric: M("count", [{ value: 200 }]) })] }, "jordan"),
      ...filler(3, "other business"),
      D("Traffic this month is up to 500.", { entities: [E("e2", "concept", "traffic this month", { metric: M("count", [{ value: 500 }]) })] }, "jordan"),
      D("Our traffic numbers look even better this week — 650.", { entities: [E("e3", "concept", "our traffic numbers", { metric: M("count", [{ value: 650 }]) })] }, "alex"),
    ],
    check({ world }) {
      const out = [];
      const matches = entityByAnyLabel(world, "traffic", "traffic this month", "our traffic numbers");
      if (matches.length !== 1) out.push(`expected one traffic metric identity across all three time-qualified phrasings, found ${matches.length}: ${matches.map((e) => e.label).join(", ")}`);
      const hist = matches[0]?.metric?.history?.map((p) => p.value).join(",");
      if (hist !== "200,500,650") out.push(`expected merged history "200,500,650", got "${hist}"`);
      return out;
    },
  },

  // ───────────────────────────────── ambiguous mention where abstention is correct
  {
    name: "two competing candidates with no script entry correctly abstain rather than pick one",
    judgeScript: [], // uncertain by default — the point of this fixture
    turns: [
      D("Sam's plan is to redesign onboarding.", { entities: [E("e1", "concept", "the plan", { description: "redesign the onboarding flow" })] }, "sam"),
      D("Jordan's plan is to cut pricing tiers instead.", { entities: [E("e2", "concept", "the plan", { description: "cut down the pricing tiers" })] }, "jordan"),
      D("Let's go with the plan.", { entities: [E("e3", "concept", "the plan")] }, "morgan"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const plans = world.entities.filter((e) => e.label.toLowerCase() === "the plan");
      // Two clearly distinct plans must already exist (turn 1 and 2 cannot
      // have merged with each other — different speakers, different, and
      // contradictory, descriptions, no script entry).
      if (plans.length < 2) out.push(`expected turns 1 and 2 to stay distinct (different plans), found ${plans.length} "the plan" entities`);
      const third = identityResolutions[2];
      if (third?.action === "merge") out.push(`expected the third, genuinely ambiguous "the plan" to abstain (create) rather than guess which of two candidates it meant, but it merged into ${third.resultingEntityId}`);
      return out;
    },
  },

  // ───────────────────────────────── explicit judge "uncertain": real abstention, not just a missing script entry
  {
    name: "two genuinely indistinguishable candidates: the judge explicitly says uncertain, and that IS the correct answer",
    judgeScript: [J("the vendor", "uncertain")], // the judge is EXPLICITLY asked and EXPLICITLY declines — proves `hold` works end to end, not just "no script entry" defaulting to it
    turns: [
      D("Vendor Atlas is on the table.", { entities: [E("e1", "concept", "Vendor Atlas")] }, "sam"),
      D("Vendor Borealis is also on the table.", { entities: [E("e2", "concept", "Vendor Borealis")] }, "priya"),
      D("Let's think about the vendor some more.", { entities: [E("e3", "concept", "the vendor")] }, "morgan"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const third = identityResolutions[2];
      if (third?.action !== "hold") out.push(`expected explicit judge uncertainty to produce action="hold", got "${third?.action}"`);
      if (third?.judgeVerdict !== "uncertain") out.push(`expected judgeVerdict "uncertain", got "${third?.judgeVerdict}"`);
      const distinctEntities = new Set(world.entities.map((e) => e.id)).size;
      if (distinctEntities !== 3) out.push(`expected Vendor Atlas, Vendor Borealis, and "the vendor" to remain 3 distinct entities, found ${distinctEntities}`);
      return out;
    },
  },

  // ───────────────────────────────── suspended entity reactivates on a judge-confirmed strong re-mention
  {
    name: "a suspended entity reactivates when an ordinary re-mention is confirmed by the judge, not merely lexically close",
    judgeScript: [J("creator partnership", "same_entity", "creator partnership")],
    turns: [
      D("We could do a creator partnership.", { entities: [E("e1", "concept", "creator partnership")] }, "sam"),
      D("Let's set that aside for now.", { discourseActs: [ACT("suspend", "creator partnership")] }, "sam"),
      D("Actually, creator partnership could work after all.", { entities: [E("e2", "concept", "creator partnership")] }, "priya"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const matches = entityByAnyLabel(world, "creator partnership");
      if (matches.length !== 1) out.push(`expected exactly 1 entity, found ${matches.length}`);
      if (matches[0]?.status !== "active") out.push(`expected the suspended entity to reactivate to "active", got "${matches[0]?.status}"`);
      const last = identityResolutions[identityResolutions.length - 1];
      if (!last?.reactivate) out.push(`expected the identity resolution to be flagged reactivate=true`);
      return out;
    },
  },

  // ───────────────────────────────── rejected entity is recallable but does NOT silently regain validity
  {
    name: "a rejected entity can be identity-linked by a later mention without regaining validity",
    judgeScript: [J("raise money", "same_entity", "raise money")],
    turns: [
      D("We could raise money instead of bootstrapping.", { entities: [E("e1", "concept", "raise money")] }, "sam"),
      D("No, forget raising money, that's not the direction.", { discourseActs: [ACT("reject", "raise money")] }, "morgan"),
      D("I still think raise money was the right call, for the record.", { entities: [E("e2", "concept", "raise money")] }, "priya"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const matches = entityByAnyLabel(world, "raise money");
      if (matches.length !== 1) out.push(`expected exactly 1 entity (recalled, not duplicated), found ${matches.length}`);
      if (matches[0]?.status !== "rejected") out.push(`expected status to STAY "rejected" (recallable is not the same as valid again), got "${matches[0]?.status}"`);
      const last = identityResolutions[identityResolutions.length - 1];
      if (last?.reactivate) out.push(`expected reactivate to be false/absent for a rejected target — only suspended entities reactivate`);
      return out;
    },
  },

  // ───────────────────────────────── word-form variation resolves at stage 1, no judge needed
  {
    name: "\"rebuild\" / \"rebuilding\" — pure word-form variation resolves deterministically, without a model call",
    judgeScript: [], // if this needs the judge at all, the stemming normalization failed at its one job
    turns: [
      D("The rebuild is a big project.", { entities: [E("e1", "action", "rebuild")] }, "priya"),
      D("Rebuilding will take six weeks.", { entities: [E("e2", "action", "rebuilding")] }, "sam"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const matches = entityByAnyLabel(world, "rebuild", "rebuilding");
      if (matches.length !== 1) out.push(`expected 1 entity across the word-form variants, found ${matches.length}`);
      const second = identityResolutions[1];
      if (!second || second.usedJudge) out.push(`expected the word-form variant to resolve deterministically without the judge, usedJudge=${second?.usedJudge}`);
      if (second?.action !== "merge") out.push(`expected action="merge", got "${second?.action}"`);
      return out;
    },
  },

  // ───────────────────────────────── semantic type reconciliation: role-bridged pair merges via the judge
  {
    name: "\"the email verification step\" as an object, then as an action — same stable thing, judge-confirmed",
    judgeScript: [J("fix the email verification step", "same_entity", "the email verification step")],
    turns: [
      D("The email verification step has a bug.", { entities: [E("e1", "object", "the email verification step", { description: "sends the code twice sometimes" })] }, "priya"),
      D("Fix the email verification step, it's a small race condition.", { entities: [E("e2", "action", "fix the email verification step", { description: "resolve the double-send race condition" })] }, "priya"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const matches = entityByAnyLabel(world, "the email verification step", "fix the email verification step");
      if (matches.length !== 1) out.push(`expected the object/action role variation to merge into 1 entity, found ${matches.length}`);
      const second = identityResolutions[1];
      if (second?.action !== "merge") out.push(`expected action="merge", got "${second?.action}"`);
      if (!second?.usedJudge) out.push(`expected a role-bridged (cross-type) match to ALWAYS go through the judge, never auto-merge deterministically, but usedJudge=${second?.usedJudge}`);
      return out;
    },
  },

  // ───────────────────────────────── specific phrase permutation merges at stage 1, no judge
  {
    name: "\"step four fix\" / \"fix step four\" merge deterministically without a judge",
    judgeScript: [],
    turns: [
      D("The step four fix should ship Thursday.", { entities: [E("e1", "action", "step four fix")] }, "sam"),
      ...filler(8, "unrelated billing talk"),
      D("I still want the fix step four before anything else.", { entities: [E("e2", "action", "fix step four")] }, "priya"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const matches = entityByAnyLabel(world, "step four fix", "fix step four");
      if (matches.length !== 1) out.push(`expected 1 entity across the phrase permutation, found ${matches.length}: ${matches.map((e) => e.label).join(", ")}`);
      const last = identityResolutions[identityResolutions.length - 1];
      if (last?.usedJudge) out.push(`expected stage-1 merge without the judge, usedJudge=${last?.usedJudge}`);
      if (last?.action !== "merge") out.push(`expected action="merge", got "${last?.action}"`);
      return out;
    },
  },

  // ───────────────────────────────── definite phrase-head anaphora ("the rebuild" names "full rebuild")
  {
    name: "\"the rebuild\" names the existing \"full rebuild\" at stage 1, no judge",
    judgeScript: [],
    turns: [
      D("A full rebuild would take six weeks.", { entities: [E("e1", "action", "full rebuild")] }, "morgan"),
      ...filler(8, "incident review"),
      D("I don't think the rebuild is worth it this quarter.", { entities: [E("e2", "action", "the rebuild")] }, "sam"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const matches = entityByAnyLabel(world, "full rebuild", "the rebuild");
      if (matches.length !== 1) out.push(`expected "the rebuild" to attach to "full rebuild", found ${matches.length}: ${matches.map((e) => `${e.id}:${e.label}`).join(", ")}`);
      const last = identityResolutions[identityResolutions.length - 1];
      if (last?.usedJudge) out.push(`expected phrase-head anaphora to resolve without the judge, usedJudge=${last?.usedJudge}`);
      if (last?.action !== "merge") out.push(`expected action="merge", got "${last?.action}"`);
      return out;
    },
  },

  // ───────────────────────────────── hyphenated vs spaced labels are the same concept
  {
    name: "\"email-verification-step\" and \"email verification step\" are one entity, even after a long gap",
    judgeScript: [],
    turns: [
      D("The email verification step sends the code twice.", { entities: [E("e1", "object", "email-verification-step")] }, "priya"),
      ...filler(8, "pricing review"),
      D("Email verification step is still broken.", { entities: [E("e2", "object", "email verification step")] }, "priya"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const matches = entityByAnyLabel(world, "email-verification-step", "email verification step");
      if (matches.length !== 1) out.push(`expected hyphen and spaces to identify as one thing, found ${matches.length}`);
      const last = identityResolutions[identityResolutions.length - 1];
      if (last?.action !== "merge") out.push(`expected action="merge", got "${last?.action}"`);
      if (last?.usedJudge) out.push(`expected a specific phrase to auto-merge without the judge`);
      return out;
    },
  },

  // ───────────────────────────────── semantic type reconciliation: genuinely incompatible types stay blocked
  {
    name: "a person and a place sharing a label never become eligible, even with the role bridge active",
    judgeScript: [J("Washington", "same_entity", "Washington")], // scripted to MERGE if given the chance — it must never be given the chance
    turns: [
      D("Washington is leading the design work.", { entities: [E("e1", "person", "Washington")] }, "sam"),
      D("We're targeting Washington for the launch region.", { entities: [E("e2", "place", "Washington")] }, "morgan"),
    ],
    check({ world, identityResolutions }) {
      const out = [];
      const matches = world.entities.filter((e) => e.label === "Washington");
      if (matches.length !== 2) out.push(`expected the person and the place to stay 2 distinct entities regardless of the (deliberately wrong) scripted judge, found ${matches.length}`);
      const second = identityResolutions[1];
      if (second?.candidateCount !== 0) out.push(`expected 0 eligible candidates — person/place is a real ontological boundary, not a role bridge — got ${second?.candidateCount}`);
      if (second?.action === "merge") out.push(`expected NOT to merge; person and place must never be eligible for each other under any circumstance`);
      return out;
    },
  },
];

export function summarizeInstrumentation(allResolutions) {
  const creations = allResolutions.filter((r) => r.action === "create").length;
  const reuses = allResolutions.filter((r) => r.action === "merge").length;
  const uncertain = allResolutions.filter((r) => r.judgeVerdict === "uncertain").length;
  const judged = allResolutions.filter((r) => r.usedJudge).length;
  return { total: allResolutions.length, creations, reuses, judged, uncertain };
}

export { liveEntities };
