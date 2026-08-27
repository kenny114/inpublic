/**
 * Quantitative semantics fixtures: metric name / value / unit / percentage /
 * currency / before-after / increase-decrease / target / comparison /
 * ordered series / approximation.
 *
 * Deltas are hand-authored as a real extractor would plausibly produce them
 * against the MetricSchema contract in lib/expression/schemas.ts — the
 * model states points/target/direction/changePercent, never a chart type
 * and never coordinates; lib/expression/world/apply.ts's mergeMetric folds
 * them into the entity's accumulated WorldMetric.history deterministically.
 */

let n = 0;
const rid = () => `r${(n += 1)}`;

const E = (id, type, label, extra = {}) => ({ id, type, label, ...extra });
const R = (source, type, target, extra = {}) => ({ id: rid(), source, type, target, ...extra });
const M = (unit, points, extra = {}) => ({ unit, points, ...extra });
const ACT = (type, targetSurface, extra = {}) => ({ type, targetSurface, ...extra });

const D = (
  text,
  { entities = [], relations = [], claims = [], topicEntityId, emphasisEntityIds, discourseActs, interpretation = "" } = {},
) => ({
  text,
  delta: {
    entities,
    relations,
    claims,
    ...(topicEntityId ? { topicEntityId } : {}),
    ...(emphasisEntityIds ? { emphasisEntityIds } : {}),
    ...(discourseActs ? { discourseActs } : {}),
    interpretation,
  },
});

function metricOf(world, label) {
  return world.entities.find((e) => e.label === label)?.metric;
}
function entityOf(world, label) {
  return world.entities.find((e) => e.label === label);
}

export const METRIC_SCENARIOS = [
  // ─────────────────────────────────────────────── single value + before/after
  {
    name: "single metric: traffic 200 -> 500 stays one entity, not four unrelated numbers",
    turns: [
      D("Traffic went from 200 users to 500 users, but conversion fell from 10% to 4%.", {
        entities: [
          E("traffic", "concept", "traffic", { metric: M("count", [{ value: 200, label: "before" }, { value: 500, label: "after" }]) }),
          E("conversion", "concept", "conversion", { metric: M("percent", [{ value: 10, label: "before" }, { value: 4, label: "after" }]) }),
        ],
        relations: [R("traffic", "contrasts_with", "conversion")],
        interpretation: "Traffic doubled while conversion fell.",
      }),
    ],
    check({ world, scene }) {
      const out = [];
      if (world.entities.filter((e) => /200|500|10%|4%/.test(e.label)).length) out.push("a raw number leaked into an entity label — should be metric points, not entities");
      const traffic = metricOf(world, "traffic");
      const conversion = metricOf(world, "conversion");
      if (!traffic || traffic.history.map((p) => p.value).join(",") !== "200,500") out.push(`traffic history wrong: ${JSON.stringify(traffic?.history)}`);
      if (!conversion || conversion.history.map((p) => p.value).join(",") !== "10,4") out.push(`conversion history wrong: ${JSON.stringify(conversion?.history)}`);
      const trafficObj = scene.objects.find((o) => o.entityId === entityOf(world, "traffic")?.id);
      const conversionObj = scene.objects.find((o) => o.entityId === entityOf(world, "conversion")?.id);
      if (!trafficObj || !["metric_value", "metric_series"].includes(trafficObj.primitive)) out.push(`traffic did not render as a metric primitive: ${trafficObj?.primitive}`);
      if (!conversionObj || !["metric_value", "metric_series"].includes(conversionObj.primitive)) out.push(`conversion did not render as a metric primitive: ${conversionObj?.primitive}`);
      return out;
    },
  },

  // ─────────────────────────────────────────────── update across turns (identity preserved)
  {
    name: "correction: conversion 4% -> later corrected to 6%, same entity",
    turns: [
      D("Conversion is 4%.", { entities: [E("conversion", "concept", "conversion", { metric: M("percent", [{ value: 4 }]) })], topicEntityId: "conversion", interpretation: "Conversion is 4%." }),
      D("Actually it moved up to 6% today.", {
        entities: [E("conversion", "concept", "conversion", { metric: M("percent", [{ value: 6, label: "today" }]) })],
        topicEntityId: "conversion",
        interpretation: "Conversion moved up to 6% today.",
      }),
    ],
    check({ world }) {
      const matches = world.entities.filter((e) => e.label === "conversion");
      if (matches.length !== 1) return [`expected ONE conversion entity, found ${matches.length}`];
      const metric = matches[0].metric;
      if (!metric || metric.history.map((p) => p.value).join(",") !== "4,6") return [`expected history [4,6], got ${JSON.stringify(metric?.history)}`];
      return [];
    },
  },

  // ─────────────────────────────────────────────── qualitative phrasing without exact numbers
  {
    name: 'qualitative: "Revenue doubled." / "Users fell by about 20%."',
    turns: [
      D("Revenue doubled.", { entities: [E("revenue", "concept", "revenue", { metric: M("currency", [], { changePercent: 100, currency: "USD" }) })], topicEntityId: "revenue", interpretation: "Revenue doubled." }),
      D("Users fell by about 20%.", { entities: [E("users", "concept", "users", { metric: M("count", [], { changePercent: -20, direction: "decrease" }) })], topicEntityId: "users", interpretation: "Users fell by roughly 20%." }),
    ],
    check({ world }) {
      const out = [];
      const revenue = metricOf(world, "revenue");
      const users = metricOf(world, "users");
      if (!revenue || revenue.changePercent !== 100) out.push(`revenue.changePercent expected 100, got ${revenue?.changePercent}`);
      if (!users || users.changePercent !== -20 || users.direction !== "decrease") out.push(`users metric wrong: ${JSON.stringify(users)}`);
      return out;
    },
  },

  // ─────────────────────────────────────────────── target vs actual
  {
    name: 'target: "We\'re at 80% of our target." / "The goal is $10k MRR."',
    turns: [
      D("We're at 80% of our target.", { entities: [E("progress", "concept", "progress", { metric: M("percent", [{ value: 80 }], { target: { value: 100 } }) })], topicEntityId: "progress", interpretation: "80% of target reached." }),
      D("The goal is $10k MRR.", { entities: [E("mrr", "concept", "MRR", { metric: M("currency", [], { currency: "USD", target: { value: 10000 } }) })], topicEntityId: "mrr", interpretation: "MRR target is $10k." }),
    ],
    check({ world, scene }) {
      const out = [];
      const progress = metricOf(world, "progress");
      if (!progress?.target || progress.target.value !== 100) out.push(`progress.target wrong: ${JSON.stringify(progress?.target)}`);
      const mrr = metricOf(world, "MRR");
      if (!mrr?.target || mrr.target.value !== 10000) out.push(`mrr.target wrong: ${JSON.stringify(mrr?.target)}`);
      const progressObj = scene.objects.find((o) => o.entityId === entityOf(world, "progress")?.id);
      if (!progressObj || progressObj.primitive !== "metric_gauge") out.push(`progress with a target should render as metric_gauge, got ${progressObj?.primitive}`);
      return out;
    },
  },

  // ─────────────────────────────────────────────── currency, two points same breath
  {
    name: 'currency series: "We did $7k last month and $9k this month."',
    turns: [
      D("We did $7k last month and $9k this month.", {
        entities: [E("revenue", "concept", "revenue", { metric: M("currency", [{ value: 7000, label: "last month" }, { value: 9000, label: "this month" }], { currency: "USD" }) })],
        topicEntityId: "revenue",
        interpretation: "Revenue was $7k last month, $9k this month.",
      }),
    ],
    check({ world }) {
      const revenue = metricOf(world, "revenue");
      if (!revenue || revenue.unit !== "currency" || revenue.history.map((p) => p.value).join(",") !== "7000,9000") {
        return [`revenue metric wrong: ${JSON.stringify(revenue)}`];
      }
      return [];
    },
  },

  // ─────────────────────────────────────────────── two-metric comparison, one flat
  {
    name: 'comparison: "Traffic increased but conversion stayed flat."',
    turns: [
      D("Traffic increased but conversion stayed flat.", {
        entities: [
          E("traffic", "concept", "traffic", { metric: M("count", [], { direction: "increase" }) }),
          E("conversion", "concept", "conversion", { metric: M("percent", [], { direction: "flat" }) }),
        ],
        relations: [R("traffic", "contrasts_with", "conversion")],
        interpretation: "Traffic increased while conversion held flat.",
      }),
    ],
    check({ plan }) {
      if (plan.grammar !== "comparison") return [`expected the "comparison" grammar for two contrasted metrics, got "${plan.grammar}"`];
      return [];
    },
  },

  // ─────────────────────────────────────────────── uncertainty preserved
  {
    name: 'approximation: "around 500", "roughly 10%", "maybe $20k" preserved, not rounded away',
    turns: [
      D("We had around 500 signups.", { entities: [E("signups", "concept", "signups", { metric: M("count", [{ value: 500, approximate: true }]) })], topicEntityId: "signups", interpretation: "Roughly 500 signups." }),
      D("Conversion is roughly 10%.", { entities: [E("conversion", "concept", "conversion", { metric: M("percent", [{ value: 10, approximate: true }]) })], topicEntityId: "conversion", interpretation: "Conversion is around 10%." }),
      D("Maybe $20k in revenue this quarter.", { entities: [E("revenue", "concept", "revenue", { metric: M("currency", [{ value: 20000, approximate: true }], { currency: "USD" }) })], topicEntityId: "revenue", interpretation: "Perhaps $20k in revenue." }),
    ],
    check({ world }) {
      const out = [];
      for (const label of ["signups", "conversion", "revenue"]) {
        const metric = metricOf(world, label);
        if (!metric?.history[0]?.approximate) out.push(`${label}: expected the point to be marked approximate, got ${JSON.stringify(metric?.history)}`);
      }
      return out;
    },
  },

  // ─────────────────────────────────────────────── units never silently mix
  {
    name: "unit mismatch: a percent restatement does not merge into a count history",
    turns: [
      D("Conversion is 200 signups.", { entities: [E("conversion", "concept", "conversion", { metric: M("count", [{ value: 200 }]) })], topicEntityId: "conversion", interpretation: "Conversion measured as a count of 200." }),
      D("Conversion is actually 4%.", { entities: [E("conversion", "concept", "conversion", { metric: M("percent", [{ value: 4 }]) })], topicEntityId: "conversion", interpretation: "Conversion is 4%, a percentage." }),
    ],
    check({ world, metricResolutions }) {
      const out = [];
      const metric = metricOf(world, "conversion");
      if (!metric || metric.unit !== "count" || metric.history.length !== 1 || metric.history[0].value !== 200) {
        out.push(`expected the original count-unit metric untouched, got ${JSON.stringify(metric)}`);
      }
      const mismatch = metricResolutions.find((r) => r.action === "unit_mismatch");
      if (!mismatch) out.push("expected a unit_mismatch MetricResolution to be reported");
      return out;
    },
  },

  // ─────────────────────────────────────────────── incompatible metrics do not fabricate a comparison
  {
    name: "no contrasts_with relation between two unrelated metrics: no forced comparison",
    turns: [
      D("Revenue is $7k this month. Separately, page load time is 1.2 seconds.", {
        entities: [
          E("revenue", "concept", "revenue", { metric: M("currency", [{ value: 7000 }], { currency: "USD" }) }),
          E("load-time", "concept", "load time", { metric: M("ratio", [{ value: 1.2 }]) }),
        ],
        interpretation: "Two unrelated metrics mentioned in the same turn, not contrasted.",
      }),
    ],
    check({ plan }) {
      if (plan.grammar === "comparison") return [`expected no forced comparison between unrelated metrics, got grammar "comparison"`];
      return [];
    },
  },

  // ─────────────────────────────────────────────── lifecycle integration
  {
    name: "deemphasized metric stays valid but not primary",
    turns: [
      D("Traffic went from 200 to 500.", { entities: [E("traffic", "concept", "traffic", { metric: M("count", [{ value: 200 }, { value: 500 }]) })], topicEntityId: "traffic", interpretation: "Traffic doubled." }),
      D("So traffic isn't really the problem.", { entities: [], discourseActs: [ACT("deemphasize", "traffic")], interpretation: "Traffic is deemphasized as the problem." }),
    ],
    check({ world }) {
      const traffic = entityOf(world, "traffic");
      if (!traffic) return ["traffic entity vanished"];
      if (traffic.status !== "deemphasized") return [`expected status "deemphasized", got "${traffic.status}"`];
      if (!traffic.metric || traffic.metric.history.length !== 2) return ["traffic metric history should survive deemphasis, not be dropped"];
      return [];
    },
  },
];

/**
 * The task's own six-turn conversation. Final state must distinguish:
 *   TRAFFIC     200 -> 500, deemphasized (not the primary problem)
 *   CONVERSION  10% -> 4% -> 6%
 *   TARGET      12% (on the conversion metric)
 */
export const METRIC_NASTY_SEQUENCE = {
  name: "six-turn conversation: traffic, conversion, target, correction",
  turns: [
    D("We had 200 visitors last week.", {
      entities: [E("traffic", "concept", "traffic", { metric: M("count", [{ value: 200, label: "last week" }]) })],
      topicEntityId: "traffic",
      interpretation: "200 visitors last week.",
    }),
    D("This week we had 500.", {
      entities: [E("traffic", "concept", "traffic", { metric: M("count", [{ value: 500, label: "this week" }]) })],
      topicEntityId: "traffic",
      interpretation: "500 visitors this week.",
    }),
    D("Conversion was 10% last week but it's only 4% now.", {
      entities: [E("conversion", "concept", "conversion", { metric: M("percent", [{ value: 10, label: "last week" }, { value: 4, label: "now" }]) })],
      topicEntityId: "conversion",
      interpretation: "Conversion fell from 10% to 4%.",
    }),
    D("So traffic isn't really the problem.", {
      entities: [],
      discourseActs: [ACT("deemphasize", "traffic")],
      interpretation: "Traffic is deemphasized as the problem.",
    }),
    D("Our target is 12% conversion.", {
      entities: [E("conversion", "concept", "conversion", { metric: M("percent", [], { target: { value: 12 } }) })],
      topicEntityId: "conversion",
      interpretation: "The conversion target is 12%.",
    }),
    D("Actually today's number just moved to 6%.", {
      entities: [E("conversion", "concept", "conversion", { metric: M("percent", [{ value: 6, label: "today" }]) })],
      topicEntityId: "conversion",
      interpretation: "Conversion moved to 6% today.",
    }),
  ],
  check({ world, scene }) {
    const out = [];
    const traffic = entityOf(world, "traffic");
    const conversion = entityOf(world, "conversion");

    if (!traffic) out.push("traffic entity missing");
    else {
      if (traffic.status !== "deemphasized") out.push(`traffic: expected status "deemphasized", got "${traffic.status}"`);
      const h = traffic.metric?.history.map((p) => p.value).join(",");
      if (h !== "200,500") out.push(`traffic history expected "200,500", got "${h}"`);
    }

    if (!conversion) out.push("conversion entity missing");
    else {
      const h = conversion.metric?.history.map((p) => p.value).join(",");
      if (h !== "10,4,6") out.push(`conversion history expected "10,4,6", got "${h}"`);
      if (conversion.metric?.target?.value !== 12) out.push(`conversion target expected 12, got ${conversion.metric?.target?.value}`);
      const obj = scene.objects.find((o) => o.entityId === conversion.id);
      if (!obj || obj.primitive !== "metric_gauge") out.push(`conversion (has a target) should render as metric_gauge, got ${obj?.primitive}`);
    }

    return out;
  },
};
