/**
 * The visual-expression corpus: 100+ cases spanning very different forms of
 * human thought.
 *
 * Each case supplies the MeaningDelta the extractor would produce, rather
 * than calling a model. That is deliberate and it is what makes this a
 * useful test rather than a slow one: the extractor is ONE layer, and it is
 * the only non-deterministic one. Fixing it lets the other eight layers —
 * world, intent, grammar, planner, primitives, composer, renderer,
 * evaluator — be asserted exactly, over a hundred cases, in under a second,
 * with no API key. The extractor's own quality is measured separately and
 * against real speech, by scripts/expression-live.mjs.
 *
 * Deltas here are written as an honest extractor would write them, not as
 * whatever makes the assertions pass. Where a sentence is genuinely
 * ambiguous the delta reflects the ambiguity.
 */

let seq = 0;
const nextId = (prefix) => `${prefix}${(seq += 1)}`;

/** entity */
const E = (id, type, label, extra = {}) => ({ id, type, label, ...extra });
/** relation */
const R = (source, type, target, extra = {}) => ({ id: nextId("r"), source, type, target, ...extra });
/** claim */
const C = (text, about, extra = {}) => ({ id: nextId("c"), text, ...(about ? { about } : {}), ...extra });

/** one turn: the text a person said, and what it means */
const T = (text, { entities = [], relations = [], claims = [], topicEntityId, emphasisEntityIds, supersededMentions, interpretation = "" } = {}) => ({
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

const cases = [];
const add = (name, category, turns, expect = {}) => cases.push({ name, category, turns, expect });

// ────────────────────────────────────────────────────────── identity

add("name only", "identity", [T("My name is Kenny Farmer.", { entities: [E("kenny", "person", "Kenny Farmer")], topicEntityId: "kenny", interpretation: "The speaker is named Kenny Farmer." })]);

add(
  "name and origin",
  "identity",
  [
    T("My name is Kenny Farmer.", { entities: [E("kenny", "person", "Kenny Farmer")], topicEntityId: "kenny" }),
    T("I'm from Trinidad and Tobago.", {
      entities: [E("kenny", "person", "Kenny Farmer"), E("tt", "place", "Trinidad and Tobago")],
      relations: [R("kenny", "originates_from", "tt")],
      topicEntityId: "kenny",
    }),
  ],
  { intent: "introduce", grammar: "scene" },
);

add(
  "family of five",
  "identity",
  [
    T("My name is Kenny.", { entities: [E("kenny", "person", "Kenny")], topicEntityId: "kenny" }),
    T("I have a family of five.", {
      entities: [E("kenny", "person", "Kenny"), E("family", "group", "family", { quantity: { value: 5 } })],
      relations: [R("kenny", "member_of", "family")],
      topicEntityId: "family",
    }),
  ],
  { grammar: ["scene", "grouping", "hierarchy"] },
);

add(
  "the flagship four-sentence introduction",
  "identity",
  [
    T("My name is Kenny Farmer.", { entities: [E("kenny", "person", "Kenny Farmer")], topicEntityId: "kenny" }),
    T("I'm from Trinidad and Tobago.", {
      entities: [E("kenny", "person", "Kenny Farmer"), E("tt", "place", "Trinidad and Tobago")],
      relations: [R("kenny", "originates_from", "tt")],
      topicEntityId: "kenny",
    }),
    T("I have a family of five.", {
      entities: [E("kenny", "person", "Kenny Farmer"), E("family", "group", "family", { quantity: { value: 5 } })],
      relations: [R("kenny", "member_of", "family")],
      topicEntityId: "family",
    }),
    T("My mother's name is Mariam.", {
      entities: [E("kenny", "person", "Kenny Farmer"), E("mariam", "person", "Mariam"), E("family", "group", "family")],
      relations: [R("mariam", "role_of", "kenny", { role: "mother" }), R("mariam", "member_of", "family")],
      topicEntityId: "mariam",
      emphasisEntityIds: ["mariam"],
    }),
  ],
  { intent: "introduce", entitiesDrawn: ["kenny-farmer", "mariam"], noAmbiguity: true },
);

add("pronoun continues the subject", "identity", [
  T("My mother's name is Mariam.", {
    entities: [E("speaker", "person", "I"), E("mariam", "person", "Mariam")],
    relations: [R("mariam", "role_of", "speaker", { role: "mother" })],
    topicEntityId: "mariam",
  }),
  T("She teaches children.", {
    entities: [E("she", "person", "she", { attributes: [{ key: "occupation", value: "teacher" }] })],
    topicEntityId: "she",
    interpretation: "Mariam is a teacher.",
  }),
], { entityCount: 2 });

add("occupation as a property", "identity", [
  T("Ana is a doctor.", {
    entities: [E("ana", "person", "Ana", { attributes: [{ key: "occupation", value: "doctor" }] })],
    topicEntityId: "ana",
  }),
]);

add("two people, one role", "identity", [
  T("Ravi is Priya's brother.", {
    entities: [E("ravi", "person", "Ravi"), E("priya", "person", "Priya")],
    relations: [R("ravi", "role_of", "priya", { role: "brother" })],
  }),
], { noAmbiguity: true });

add("a team and its lead", "identity", [
  T("Dara leads the design team.", {
    entities: [E("dara", "person", "Dara"), E("team", "group", "design team")],
    relations: [R("dara", "role_of", "team", { role: "lead" }), R("dara", "member_of", "team")],
  }),
], { noAmbiguity: true });

add("company origin", "identity", [
  T("The company started in Lagos.", {
    entities: [E("company", "group", "the company"), E("lagos", "place", "Lagos")],
    relations: [R("company", "originates_from", "lagos")],
  }),
]);

add("named group with named members", "identity", [
  T("The band is Sam, Tomo and Rue.", {
    entities: [E("band", "group", "the band", { quantity: { value: 3 } }), E("sam", "person", "Sam"), E("tomo", "person", "Tomo"), E("rue", "person", "Rue")],
    relations: [R("sam", "member_of", "band"), R("tomo", "member_of", "band"), R("rue", "member_of", "band")],
    topicEntityId: "band",
  }),
], { grammar: ["grouping", "hierarchy", "scene"] });

// ───────────────────────────────────────────────────────── causality

add("rain floods road causes traffic", "causality", [
  T("Heavy rain flooded the road, which caused traffic.", {
    entities: [E("rain", "event", "heavy rain"), E("flood", "event", "flooded road"), E("traffic", "event", "traffic")],
    relations: [R("rain", "causes", "flood"), R("flood", "causes", "traffic")],
    topicEntityId: "rain",
  }),
], { intent: "explain_causality", grammar: "cause_effect" });

add("the AI app trust chain", "causality", [
  T("AI is making it easier to build apps, so we'll end up with thousands of apps, but that creates a trust problem because people don't know which apps are legitimate.", {
    entities: [
      E("ai", "concept", "AI"),
      E("app-building", "action", "building apps"),
      E("many-apps", "concept", "thousands of apps"),
      E("trust", "concept", "trust problem"),
    ],
    relations: [R("ai", "enables", "app-building"), R("app-building", "causes", "many-apps"), R("many-apps", "causes", "trust")],
    claims: [C("people cannot tell which apps are legitimate", ["trust"])],
    topicEntityId: "trust",
  }),
], { intent: "explain_causality", grammar: "cause_effect", minPreservation: 1 });

add("single cause", "causality", [
  T("The outage caused the refunds.", {
    entities: [E("outage", "event", "outage"), E("refunds", "event", "refunds")],
    relations: [R("outage", "causes", "refunds")],
  }),
], { intent: "explain_causality" });

add("prevention", "causality", [
  T("The seatbelt prevented a serious injury.", {
    entities: [E("seatbelt", "object", "seatbelt"), E("injury", "event", "serious injury")],
    relations: [R("seatbelt", "prevents", "injury")],
  }),
], { intent: "explain_causality" });

add("dependency", "causality", [
  T("The report depends on the survey results.", {
    entities: [E("report", "object", "report"), E("survey", "object", "survey results")],
    relations: [R("report", "depends_on", "survey")],
  }),
]);

add("enabling chain of four", "causality", [
  T("Cheap sensors enable cheap robots, which lower factory costs, which lower prices.", {
    entities: [E("sensors", "object", "cheap sensors"), E("robots", "object", "cheap robots"), E("costs", "concept", "factory costs"), E("prices", "concept", "prices")],
    relations: [R("sensors", "enables", "robots"), R("robots", "causes", "costs"), R("costs", "causes", "prices")],
  }),
], { intent: "explain_causality", grammar: "cause_effect" });

add("fear prevents opportunity", "abstract", [
  T("Fear can prevent people from taking opportunities.", {
    entities: [E("fear", "concept", "fear"), E("opportunity", "concept", "taking opportunities")],
    relations: [R("fear", "prevents", "opportunity")],
  }),
], { intent: "explain_causality" });

add("burnout loop", "causality", [
  T("Long hours cause fatigue, and fatigue causes mistakes.", {
    entities: [E("hours", "concept", "long hours"), E("fatigue", "state", "fatigue"), E("mistakes", "event", "mistakes")],
    relations: [R("hours", "causes", "fatigue"), R("fatigue", "causes", "mistakes")],
  }),
], { intent: "explain_causality", grammar: "cause_effect" });

add("interest rates", "causality", [
  T("Higher rates slow borrowing, which slows construction.", {
    entities: [E("rates", "concept", "higher rates"), E("borrowing", "action", "borrowing"), E("construction", "action", "construction")],
    relations: [R("rates", "causes", "borrowing"), R("borrowing", "causes", "construction")],
  }),
], { grammar: "cause_effect" });

add("cause with an aside", "causality", [
  T("The migration broke search, and search is what most users open first.", {
    entities: [E("migration", "event", "the migration"), E("search", "object", "search")],
    relations: [R("migration", "causes", "search")],
    claims: [C("most users open search first", ["search"])],
  }),
]);

// ────────────────────────────────────────────────────────── sequence

add("three-step login flow", "sequence", [
  T("First authenticate the user, then fetch their projects, then open the dashboard.", {
    entities: [E("auth", "action", "authenticate user"), E("fetch", "action", "fetch projects"), E("dashboard", "action", "open dashboard")],
    relations: [R("auth", "precedes", "fetch", { step: 0 }), R("fetch", "precedes", "dashboard", { step: 1 })],
  }),
], { intent: "show_sequence", grammar: "sequence" });

// A sequence built one step per turn, which is how speech actually arrives.
// By the last turn the first step is live but no longer recent, and the
// visual horizon used to drop it — so the grammar saw two steps and drew a
// process that begins at "load projects", reading as complete while stating
// something the speaker never said. Every step in the world must reach the
// canvas (lib/expression/planner/visibility.ts, keepOrderedChainsWhole).
add("a sequence assembled one step per turn", "sequence", [
  T("First the user signs in.", {
    entities: [E("signin", "action", "sign in")],
    topicEntityId: "signin",
  }),
  T("Then we load their projects.", {
    entities: [E("signin", "action", "sign in"), E("load", "action", "load projects")],
    relations: [R("signin", "precedes", "load", { step: 0 })],
    topicEntityId: "load",
  }),
  T("And finally we open the dashboard.", {
    entities: [E("load", "action", "load projects"), E("dash", "action", "open dashboard")],
    relations: [R("load", "precedes", "dash", { step: 1 })],
    topicEntityId: "dash",
  }),
], {
  intent: "show_sequence",
  grammar: "sequence",
  entitiesDrawn: ["sign-in", "load-projects", "open-dashboard"],
});

add("morning routine", "sequence", [
  T("I wake up, then I run, then I shower.", {
    entities: [E("wake", "action", "wake up"), E("run", "action", "run"), E("shower", "action", "shower")],
    relations: [R("wake", "precedes", "run", { step: 0 }), R("run", "precedes", "shower", { step: 1 })],
  }),
], { grammar: "sequence" });

add("deploy pipeline", "sequence", [
  T("Tests run, then the build, then the deploy.", {
    entities: [E("tests", "action", "tests"), E("build", "action", "build"), E("deploy", "action", "deploy")],
    relations: [R("tests", "precedes", "build", { step: 0 }), R("build", "precedes", "deploy", { step: 1 })],
  }),
], { intent: "show_sequence" });

add("two-step only", "sequence", [
  T("Sign the contract before you start work.", {
    entities: [E("sign", "action", "sign contract"), E("work", "action", "start work")],
    relations: [R("sign", "precedes", "work", { step: 0 })],
  }),
], { intent: "show_sequence" });

add("five-step onboarding", "sequence", [
  T("Create an account, verify email, pick a plan, invite the team, then import data.", {
    entities: [E("create", "action", "create account"), E("verify", "action", "verify email"), E("plan", "action", "pick a plan"), E("invite", "action", "invite team"), E("import", "action", "import data")],
    relations: [
      R("create", "precedes", "verify", { step: 0 }),
      R("verify", "precedes", "plan", { step: 1 }),
      R("plan", "precedes", "invite", { step: 2 }),
      R("invite", "precedes", "import", { step: 3 }),
    ],
  }),
], { grammar: "sequence" });

// ────────────────────────────────────────────────────── state change

add("water changes state", "state-change", [
  T("The water started frozen, melted into liquid, then evaporated.", {
    entities: [E("ice", "state", "frozen"), E("liquid", "state", "liquid"), E("vapour", "state", "vapour")],
    relations: [R("ice", "transforms_into", "liquid"), R("liquid", "transforms_into", "vapour")],
  }),
], { intent: "show_transformation", grammar: "process" });

add("caterpillar", "state-change", [
  T("The caterpillar becomes a chrysalis and then a butterfly.", {
    entities: [E("caterpillar", "state", "caterpillar"), E("chrysalis", "state", "chrysalis"), E("butterfly", "state", "butterfly")],
    relations: [R("caterpillar", "transforms_into", "chrysalis"), R("chrysalis", "transforms_into", "butterfly")],
  }),
], { intent: "show_transformation" });

add("draft to published", "state-change", [
  T("A draft becomes a review, and a review becomes a published post.", {
    entities: [E("draft", "state", "draft"), E("review", "state", "in review"), E("published", "state", "published")],
    relations: [R("draft", "transforms_into", "review"), R("review", "transforms_into", "published")],
  }),
], { grammar: "process" });

// ─────────────────────────────────────────────────────── comparison

add("plan A versus plan B", "comparison", [
  T("Plan A costs more but finishes twice as quickly as Plan B.", {
    entities: [E("a", "concept", "Plan A"), E("b", "concept", "Plan B")],
    relations: [R("a", "contrasts_with", "b"), R("a", "greater_than", "b", { magnitude: 2 })],
  }),
], { intent: "compare", grammar: "comparison", comparisonPoles: ["plan-a", "plan-b"] });

// The delta the REAL extractor produces for this sentence, malformed edges
// and all: it measures cost and speed as their own entities, and compares
// each against Plan B — a cost set against a plan. The poles must still come
// out Plan A vs Plan B, lifted through has_property, rather than two
// dimensions of Plan A with Plan B nowhere on the sheet.
add("plan A versus plan B, measured on dimensions", "comparison", [
  T("Plan A costs more but finishes twice as quickly as Plan B.", {
    entities: [
      E("a", "concept", "Plan A"),
      E("b", "concept", "Plan B"),
      E("a-cost", "quantity", "Plan A cost"),
      E("a-speed", "quantity", "Plan A speed"),
    ],
    relations: [
      R("a", "contrasts_with", "b"),
      R("a", "has_property", "a-cost"),
      R("a", "has_property", "a-speed"),
      R("a-cost", "greater_than", "b", { magnitude: 1 }),
      R("a-speed", "greater_than", "b", { magnitude: 2 }),
    ],
    topicEntityId: "a",
  }),
], { intent: "compare", grammar: "comparison", comparisonPoles: ["plan-a", "plan-b"] });

// The same sentence with NO ownership stated — the shape the extractor
// produced before the prompt required has_property. The dimension-level
// contrast is all there is, so it is honestly the best available pair.
add("dimensions in tension within one subject", "comparison", [
  T("Plan A costs more but finishes twice as quickly.", {
    entities: [E("a-cost", "quantity", "Plan A cost"), E("a-speed", "quantity", "Plan A speed")],
    relations: [R("a-cost", "contrasts_with", "a-speed")],
  }),
], { grammar: "comparison", comparisonPoles: ["plan-a-cost", "plan-a-speed"] });

add("rent versus buy", "comparison", [
  T("Renting is cheaper now, buying is cheaper later.", {
    entities: [E("rent", "concept", "renting"), E("buy", "concept", "buying")],
    relations: [R("rent", "contrasts_with", "buy")],
  }),
], { intent: "compare" });

add("two quantities in tension", "comparison", [
  T("We have four engineers and we need seven.", {
    entities: [E("have", "group", "engineers we have", { quantity: { value: 4 } }), E("need", "group", "engineers we need", { quantity: { value: 7 } })],
    relations: [R("have", "less_than", "need")],
  }),
], { grammar: ["comparison", "quantity"] });

add("speed versus accuracy", "comparison", [
  T("The fast model is less accurate than the slow one.", {
    entities: [E("fast", "concept", "fast model"), E("slow", "concept", "slow model")],
    relations: [R("fast", "less_than", "slow"), R("fast", "contrasts_with", "slow")],
  }),
], { intent: "compare" });

add("comparison with properties", "comparison", [
  T("Plan A is expensive and quick; Plan B is cheap and slow.", {
    entities: [E("a", "concept", "Plan A"), E("b", "concept", "Plan B"), E("expensive", "concept", "expensive"), E("quick", "concept", "quick"), E("cheap", "concept", "cheap"), E("slow", "concept", "slow")],
    relations: [
      R("a", "contrasts_with", "b"),
      R("a", "has_property", "expensive"),
      R("a", "has_property", "quick"),
      R("b", "has_property", "cheap"),
      R("b", "has_property", "slow"),
    ],
  }),
], { grammar: "comparison" });

// ────────────────────────────────────────────────────────── trade-off

add("hiring trade-off", "trade-off", [
  T("Hiring more engineers increases development speed but increases monthly burn.", {
    entities: [E("hiring", "action", "hiring engineers"), E("speed", "concept", "development speed"), E("burn", "concept", "monthly burn")],
    relations: [R("hiring", "causes", "speed"), R("hiring", "causes", "burn"), R("speed", "contrasts_with", "burn")],
  }),
]);

add("caching trade-off", "trade-off", [
  T("Caching makes reads fast but makes staleness possible.", {
    entities: [E("cache", "concept", "caching"), E("fast", "concept", "fast reads"), E("stale", "concept", "stale data")],
    relations: [R("cache", "causes", "fast"), R("cache", "causes", "stale"), R("fast", "contrasts_with", "stale")],
  }),
]);

add("remote work trade-off", "trade-off", [
  T("Remote work widens the hiring pool but weakens spontaneous conversation.", {
    entities: [E("remote", "concept", "remote work"), E("pool", "concept", "hiring pool"), E("talk", "concept", "spontaneous conversation")],
    relations: [R("remote", "causes", "pool"), R("remote", "prevents", "talk")],
  }),
]);

// ────────────────────────────────────────────────────────── hierarchy

add("company departments", "hierarchy", [
  T("The company contains engineering, sales and marketing.", {
    entities: [E("company", "group", "the company"), E("eng", "group", "engineering"), E("sales", "group", "sales"), E("marketing", "group", "marketing")],
    relations: [R("company", "contains", "eng"), R("company", "contains", "sales"), R("company", "contains", "marketing")],
    topicEntityId: "company",
  }),
], { intent: "show_hierarchy", grammar: ["hierarchy", "grouping"] });

add("book parts", "hierarchy", [
  T("The book has three parts, and the first part has four chapters.", {
    entities: [E("book", "object", "the book"), E("parts", "group", "three parts", { quantity: { value: 3 } }), E("chapters", "group", "four chapters", { quantity: { value: 4 } })],
    relations: [R("parts", "part_of", "book"), R("chapters", "part_of", "parts")],
  }),
]);

add("solar system", "hierarchy", [
  T("The solar system contains the sun and the planets.", {
    entities: [E("system", "group", "solar system"), E("sun", "object", "the sun"), E("planets", "group", "the planets")],
    relations: [R("system", "contains", "sun"), R("system", "contains", "planets")],
  }),
], { intent: "show_hierarchy" });

add("team of teams", "hierarchy", [
  T("Platform contains infra and tooling; product contains web and mobile.", {
    entities: [E("platform", "group", "platform"), E("infra", "group", "infra"), E("tooling", "group", "tooling"), E("product", "group", "product"), E("web", "group", "web"), E("mobile", "group", "mobile")],
    relations: [R("platform", "contains", "infra"), R("platform", "contains", "tooling"), R("product", "contains", "web"), R("product", "contains", "mobile")],
  }),
], { intent: "show_hierarchy" });

add("taxonomy", "hierarchy", [
  T("A sparrow is a bird, and a bird is an animal.", {
    entities: [E("sparrow", "concept", "sparrow"), E("bird", "concept", "bird"), E("animal", "concept", "animal")],
    relations: [R("sparrow", "instance_of", "bird"), R("bird", "instance_of", "animal")],
  }),
]);

// ────────────────────────────────────────────────────────── quantity

add("twelve apples", "mathematics", [
  T("Three people each have four apples, so there are twelve apples altogether.", {
    entities: [E("people", "group", "people", { quantity: { value: 3 } }), E("apples-each", "quantity", "apples each", { quantity: { value: 4 } }), E("total", "quantity", "apples altogether", { quantity: { value: 12 } })],
    relations: [R("people", "causes", "total"), R("total", "greater_than", "apples-each")],
  }),
], { minPreservation: 0.5 });

add("five in the family", "quantity", [
  T("There are five people in my family.", {
    entities: [E("family", "group", "my family", { quantity: { value: 5 } })],
    topicEntityId: "family",
  }),
], { intent: "show_quantity" });

add("two counted groups", "quantity", [
  T("Six chairs and two tables.", {
    entities: [E("chairs", "object", "chairs", { quantity: { value: 6 } }), E("tables", "object", "tables", { quantity: { value: 2 } })],
  }),
], { intent: "show_quantity" });

add("percentage", "quantity", [
  T("About sixty percent of users never return.", {
    entities: [E("churned", "group", "users who never return", { quantity: { value: 60, unit: "%", approximate: true } })],
  }),
]);

add("counted things compared", "quantity", [
  T("We shipped nine features this quarter and three last quarter.", {
    entities: [E("this-q", "quantity", "this quarter", { quantity: { value: 9 } }), E("last-q", "quantity", "last quarter", { quantity: { value: 3 } })],
    relations: [R("this-q", "greater_than", "last-q", { magnitude: 3 })],
  }),
], { intent: ["show_quantity", "compare"] });

// ─────────────────────────────────────────────────────────── spatial

add("lamp chair desk", "spatial", [
  T("The lamp is behind the chair and the chair is beside the desk.", {
    entities: [E("lamp", "object", "lamp"), E("chair", "object", "chair"), E("desk", "object", "desk")],
    relations: [R("lamp", "located_at", "chair", { spatial: "behind" }), R("chair", "located_at", "desk", { spatial: "beside" })],
  }),
], { intent: "show_spatial", grammar: "spatial" });

add("book on table", "spatial", [
  T("The book is on the table.", {
    entities: [E("book", "object", "book"), E("table", "object", "table")],
    relations: [R("book", "located_at", "table", { spatial: "on" })],
  }),
], { intent: "show_spatial" });

add("shop above the bakery", "spatial", [
  T("The shop is above the bakery.", {
    entities: [E("shop", "object", "the shop"), E("bakery", "object", "the bakery")],
    relations: [R("shop", "located_at", "bakery", { spatial: "above" })],
  }),
], { intent: "show_spatial" });

add("keys inside the drawer", "spatial", [
  T("The keys are inside the drawer.", {
    entities: [E("keys", "object", "keys"), E("drawer", "object", "drawer")],
    relations: [R("keys", "located_at", "drawer", { spatial: "inside" })],
  }),
]);

add("three rooms in a row", "spatial", [
  T("The kitchen is beside the hall, and the hall is beside the study.", {
    entities: [E("kitchen", "place", "kitchen"), E("hall", "place", "hall"), E("study", "place", "study")],
    relations: [R("kitchen", "located_at", "hall", { spatial: "beside" }), R("hall", "located_at", "study", { spatial: "beside" })],
  }),
], { grammar: "spatial" });

// ────────────────────────────────────────────────────────── argument

add("cheap software argument", "argument", [
  T("Cheap software isn't always cheaper because maintenance can eventually cost more than the original purchase.", {
    entities: [E("cheap", "concept", "cheap software"), E("maintenance", "concept", "maintenance cost"), E("purchase", "concept", "purchase price")],
    relations: [R("maintenance", "greater_than", "purchase"), R("maintenance", "refutes", "cheap")],
    claims: [C("cheap software is not always cheaper", ["cheap"])],
  }),
]);

add("two reasons for one claim", "argument", [
  T("We should delay: the tests are flaky and the docs aren't ready.", {
    entities: [E("delay", "concept", "delaying"), E("flaky", "concept", "flaky tests"), E("docs", "concept", "unfinished docs")],
    relations: [R("flaky", "supports", "delay"), R("docs", "supports", "delay")],
  }),
], { intent: "argue", grammar: "hierarchy" });

add("evidence against", "argument", [
  T("The survey refutes the idea that price is the main objection.", {
    entities: [E("survey", "object", "the survey"), E("price-objection", "concept", "price is the main objection")],
    relations: [R("survey", "refutes", "price-objection")],
  }),
], { intent: "argue" });

add("three supporting reasons", "argument", [
  T("Remote hiring works: wider pool, lower cost, and better retention.", {
    entities: [E("remote", "concept", "remote hiring"), E("pool", "concept", "wider pool"), E("cost", "concept", "lower cost"), E("retention", "concept", "better retention")],
    relations: [R("pool", "supports", "remote"), R("cost", "supports", "remote"), R("retention", "supports", "remote")],
  }),
], { intent: "argue" });

// ───────────────────────────────────────────────────────── narrative

add("boy and bird", "narrative", [
  T("A boy walked through the forest and discovered an injured bird underneath a tree.", {
    entities: [E("boy", "person", "a boy"), E("walk", "action", "walking through the forest"), E("find", "event", "finding the bird"), E("bird", "object", "injured bird"), E("tree", "object", "a tree")],
    relations: [R("walk", "precedes", "find", { step: 0 }), R("bird", "located_at", "tree", { spatial: "below" })],
    topicEntityId: "boy",
  }),
]);

add("a trip", "narrative", [
  T("She packed, drove north, and arrived after dark.", {
    entities: [E("her", "person", "she"), E("pack", "action", "packing"), E("drive", "action", "driving north"), E("arrive", "event", "arriving after dark")],
    relations: [R("pack", "precedes", "drive", { step: 0 }), R("drive", "precedes", "arrive", { step: 1 })],
  }),
], { intent: ["narrate", "show_sequence"] });

add("a founding story", "narrative", [
  T("Two friends built a tool for themselves, then people started asking for it.", {
    entities: [E("friends", "group", "two friends", { quantity: { value: 2 } }), E("build", "action", "building a tool"), E("demand", "event", "people asking for it")],
    relations: [R("build", "precedes", "demand", { step: 0 }), R("build", "causes", "demand")],
  }),
]);

// ───────────────────────────────────────────────────────── abstract

add("trust takes time", "abstract", [
  T("Trust takes a long time to build and no time at all to lose.", {
    entities: [E("trust", "concept", "trust"), E("build", "action", "building trust"), E("lose", "action", "losing trust")],
    relations: [R("build", "contrasts_with", "lose"), R("build", "part_of", "trust"), R("lose", "part_of", "trust")],
  }),
]);

add("a reflection with no structure", "abstract", [
  T("That meeting really opened my eyes.", {
    entities: [E("meeting", "event", "the meeting")],
    claims: [C("the meeting changed the speaker's perspective", ["meeting"])],
    topicEntityId: "meeting",
  }),
]);

add("uncertainty", "abstract", [
  T("I think the delay might be the vendor, but I'm not sure.", {
    entities: [E("delay", "event", "the delay"), E("vendor", "group", "the vendor")],
    relations: [R("vendor", "causes", "delay", { confidence: "low" })],
    claims: [C("the speaker is unsure the vendor caused the delay", ["delay"], { uncertain: true })],
  }),
]);

add("a definition", "definition", [
  T("Latency is the time between a request and its response.", {
    entities: [E("latency", "concept", "latency"), E("gap", "concept", "time between request and response")],
    relations: [R("latency", "equivalent_to", "gap")],
  }),
]);

add("category membership defines", "definition", [
  T("A hash map is a data structure with constant-time lookup.", {
    entities: [E("hashmap", "concept", "hash map"), E("ds", "concept", "data structure"), E("lookup", "concept", "constant-time lookup")],
    relations: [R("hashmap", "instance_of", "ds"), R("hashmap", "has_property", "lookup")],
  }),
], { intent: ["define", "describe", "show_relationships"] });

// ─────────────────────────────────────────────────── multi-turn evolution

add("world grows across four turns", "multi-turn", [
  T("We're building a scheduling tool.", { entities: [E("tool", "object", "scheduling tool")], topicEntityId: "tool" }),
  T("It's for clinics.", {
    entities: [E("tool", "object", "scheduling tool"), E("clinics", "group", "clinics")],
    relations: [R("tool", "relates_to", "clinics")],
  }),
  T("Clinics lose money on no-shows.", {
    entities: [E("clinics", "group", "clinics"), E("noshows", "event", "no-shows"), E("loss", "concept", "lost money")],
    relations: [R("noshows", "causes", "loss")],
  }),
  T("So reminders are the whole product.", {
    entities: [E("reminders", "object", "reminders"), E("noshows", "event", "no-shows")],
    relations: [R("reminders", "prevents", "noshows")],
    emphasisEntityIds: ["reminders"],
  }),
], { finalEntityCount: 5, noAmbiguity: true });

add("correction supersedes", "multi-turn", [
  T("The bridge flooded.", { entities: [E("bridge", "object", "the bridge"), E("flood", "event", "flooding")], relations: [R("flood", "causes", "bridge")] }),
  T("Actually, not the bridge — the road.", {
    entities: [E("road", "object", "the road")],
    supersededMentions: ["the bridge"],
    interpretation: "The speaker corrects: it was the road, not the bridge.",
  }),
], { supersededEntities: 1 });

add("pronoun across three turns", "multi-turn", [
  T("Priya joined last month.", { entities: [E("priya", "person", "Priya")], topicEntityId: "priya" }),
  T("She runs the data team.", {
    entities: [E("she", "person", "she"), E("data", "group", "data team")],
    relations: [R("she", "role_of", "data", { role: "lead" })],
  }),
  T("That team owns the warehouse.", {
    entities: [E("that-team", "group", "that team"), E("warehouse", "object", "the warehouse")],
    relations: [R("that-team", "contains", "warehouse")],
  }),
], { finalEntityCount: 3 });

add("subject shifts mid-conversation", "multi-turn", [
  T("Our onboarding is slow.", { entities: [E("onboarding", "concept", "onboarding")], topicEntityId: "onboarding" }),
  T("Slow onboarding causes churn.", {
    entities: [E("onboarding", "concept", "onboarding"), E("churn", "concept", "churn")],
    relations: [R("onboarding", "causes", "churn")],
  }),
  T("Churn is what kills the revenue.", {
    entities: [E("churn", "concept", "churn"), E("revenue", "concept", "revenue")],
    relations: [R("churn", "causes", "revenue")],
  }),
], { intent: "explain_causality", grammar: "cause_effect" });

add("detail arrives late", "multi-turn", [
  T("The team is five people.", { entities: [E("team", "group", "the team", { quantity: { value: 5 } })], topicEntityId: "team" }),
  T("Two of them are contractors.", {
    entities: [E("contractors", "group", "contractors", { quantity: { value: 2 } }), E("team", "group", "the team")],
    relations: [R("contractors", "member_of", "team")],
  }),
]);

// ─────────────────────────────────────────────── everyday speech, mixed

const everyday = [
  ["I moved to Berlin last year.", [E("speaker", "person", "I"), E("berlin", "place", "Berlin")], [R("speaker", "located_at", "berlin", { spatial: "near" })]],
  ["The server ran out of disk.", [E("server", "object", "the server"), E("disk", "concept", "disk space")], [R("server", "depends_on", "disk")]],
  ["My sister runs a bakery.", [E("sister", "person", "my sister"), E("bakery", "object", "a bakery")], [R("sister", "role_of", "bakery", { role: "owner" })]],
  ["Three of the four tests fail.", [E("failing", "group", "failing tests", { quantity: { value: 3 } }), E("all", "group", "tests", { quantity: { value: 4 } })], [R("failing", "part_of", "all")]],
  ["The prototype convinced the board.", [E("prototype", "object", "the prototype"), E("board", "group", "the board")], [R("prototype", "causes", "board")]],
  ["Winter here is short.", [E("winter", "time", "winter"), E("short", "concept", "short")], [R("winter", "has_property", "short")]],
  ["He left before the announcement.", [E("he", "person", "he"), E("leaving", "action", "leaving"), E("announcement", "event", "the announcement")], [R("leaving", "precedes", "announcement", { step: 0 })]],
  ["Our costs doubled.", [E("costs", "concept", "our costs", { quantity: { value: 2, unit: "x" } })], []],
  ["The old system and the new one disagree.", [E("old", "object", "old system"), E("new", "object", "new system")], [R("old", "contrasts_with", "new")]],
  ["Lagos is where it started.", [E("lagos", "place", "Lagos"), E("it", "event", "the beginning")], [R("it", "originates_from", "lagos")]],
  ["Every release breaks something.", [E("release", "event", "a release"), E("breakage", "event", "something breaking")], [R("release", "causes", "breakage")]],
  ["The kitchen is below the studio.", [E("kitchen", "place", "kitchen"), E("studio", "place", "studio")], [R("kitchen", "located_at", "studio", { spatial: "below" })]],
  ["Design owns the component library.", [E("design", "group", "design"), E("library", "object", "component library")], [R("design", "contains", "library")]],
  ["Rest makes you faster, not slower.", [E("rest", "concept", "rest"), E("speed", "concept", "being faster")], [R("rest", "causes", "speed")]],
  ["I want to learn to sail.", [E("speaker", "person", "I"), E("sailing", "action", "learning to sail")], [R("speaker", "wants", "sailing")]],
  ["The invoice is larger than the estimate.", [E("invoice", "object", "the invoice"), E("estimate", "object", "the estimate")], [R("invoice", "greater_than", "estimate")]],
  ["Two teams share one repo.", [E("teams", "group", "two teams", { quantity: { value: 2 } }), E("repo", "object", "the repo")], [R("teams", "depends_on", "repo")]],
  ["She studied physics, then switched to law.", [E("she", "person", "she"), E("physics", "concept", "physics"), E("law", "concept", "law")], [R("physics", "precedes", "law", { step: 0 })]],
  ["Nobody reads the changelog.", [E("changelog", "object", "the changelog")], []],
  ["The chair is in front of the window.", [E("chair", "object", "the chair"), E("window", "object", "the window")], [R("chair", "located_at", "window", { spatial: "in_front_of" })]],
  ["Feedback made the design simpler.", [E("feedback", "concept", "feedback"), E("simpler", "concept", "a simpler design")], [R("feedback", "causes", "simpler")]],
  ["We ship on Fridays.", [E("we", "group", "we"), E("friday", "time", "Fridays"), E("shipping", "action", "shipping")], [R("shipping", "located_at", "friday", { spatial: "near" })]],
  ["Our two offices are in Accra and Lisbon.", [E("offices", "group", "our offices", { quantity: { value: 2 } }), E("accra", "place", "Accra"), E("lisbon", "place", "Lisbon")], [R("offices", "located_at", "accra", { spatial: "near" }), R("offices", "located_at", "lisbon", { spatial: "near" })]],
  ["A good test fails for one reason.", [E("test", "concept", "a good test"), E("reason", "concept", "one reason")], [R("test", "depends_on", "reason")]],
  ["The launch slipped a week.", [E("launch", "event", "the launch"), E("slip", "event", "a week's delay", { quantity: { value: 1, unit: "week" } })], [R("slip", "causes", "launch")]],
  ["Mentorship changed his career.", [E("mentorship", "concept", "mentorship"), E("career", "concept", "his career")], [R("mentorship", "causes", "career")]],
  ["Read the error before you fix it.", [E("read", "action", "reading the error"), E("fix", "action", "fixing it")], [R("read", "precedes", "fix", { step: 0 })]],
  ["The dataset has four columns.", [E("dataset", "object", "the dataset"), E("columns", "group", "columns", { quantity: { value: 4 } })], [R("columns", "part_of", "dataset")]],
  ["Silence in a review usually means confusion.", [E("silence", "state", "silence in a review"), E("confusion", "state", "confusion")], [R("silence", "causes", "confusion", { confidence: "low" })]],
  ["My father taught me to cook.", [E("father", "person", "my father"), E("speaker", "person", "I"), E("cooking", "action", "cooking")], [R("father", "role_of", "speaker", { role: "father" }), R("father", "causes", "cooking")]],
  ["The API is stable, the SDK isn't.", [E("api", "object", "the API"), E("sdk", "object", "the SDK")], [R("api", "contrasts_with", "sdk")]],
  ["Six weeks of work, two days of demo.", [E("work", "concept", "work", { quantity: { value: 6, unit: "weeks" } }), E("demo", "concept", "demo", { quantity: { value: 2, unit: "days" } })], [R("work", "greater_than", "demo")]],
  ["Cold starts are why it feels slow.", [E("cold", "event", "cold starts"), E("slow", "state", "feeling slow")], [R("cold", "causes", "slow")]],
  ["The archive sits behind the office.", [E("archive", "place", "the archive"), E("office", "place", "the office")], [R("archive", "located_at", "office", { spatial: "behind" })]],
  ["Practice beats talent when talent doesn't practise.", [E("practice", "concept", "practice"), E("talent", "concept", "talent")], [R("practice", "greater_than", "talent")]],
  ["Our churn dropped by half.", [E("churn", "concept", "churn", { quantity: { value: 0.5, unit: "x" } })], []],
  ["The compiler catches it, the linter doesn't.", [E("compiler", "object", "the compiler"), E("linter", "object", "the linter")], [R("compiler", "contrasts_with", "linter")]],
  ["Everything depends on the schema.", [E("everything", "concept", "the rest of the system"), E("schema", "object", "the schema")], [R("everything", "depends_on", "schema")]],
  ["He arrived, sat down, and said nothing.", [E("he", "person", "he"), E("arrive", "action", "arriving"), E("sit", "action", "sitting down"), E("silence", "action", "saying nothing")], [R("arrive", "precedes", "sit", { step: 0 }), R("sit", "precedes", "silence", { step: 1 })]],
  ["A small leak sank a large ship.", [E("leak", "object", "a small leak"), E("ship", "object", "a large ship")], [R("leak", "causes", "ship")]],
  ["Documentation is part of the feature.", [E("docs", "object", "documentation"), E("feature", "concept", "the feature")], [R("docs", "part_of", "feature")]],
  ["We tried three approaches and kept one.", [E("tried", "group", "approaches tried", { quantity: { value: 3 } }), E("kept", "group", "approaches kept", { quantity: { value: 1 } })], [R("tried", "greater_than", "kept")]],
  ["The city grew around the port.", [E("city", "place", "the city"), E("port", "place", "the port")], [R("city", "located_at", "port", { spatial: "near" })]],
  ["Nothing was decided.", [E("meeting", "event", "the meeting")], []],
  ["The migration is why the numbers moved.", [E("migration", "event", "the migration"), E("numbers", "concept", "the numbers")], [R("migration", "causes", "numbers")]],
  ["Two of us stayed late.", [E("us", "group", "people who stayed", { quantity: { value: 2 } })], []],
  ["Trust is slower than speed.", [E("trust", "concept", "trust"), E("speed", "concept", "speed")], [R("trust", "less_than", "speed")]],
  ["The rehearsal is before the talk.", [E("rehearsal", "event", "the rehearsal"), E("talk", "event", "the talk")], [R("rehearsal", "precedes", "talk", { step: 0 })]],
  ["Our stack is Postgres, Redis and a queue.", [E("stack", "group", "our stack"), E("pg", "object", "Postgres"), E("redis", "object", "Redis"), E("queue", "object", "a queue")], [R("stack", "contains", "pg"), R("stack", "contains", "redis"), R("stack", "contains", "queue")]],
  ["It works, but nobody knows why.", [E("it", "object", "the system")], []],
  ["Bad naming costs more than bad code.", [E("naming", "concept", "bad naming"), E("code", "concept", "bad code")], [R("naming", "greater_than", "code")]],
];

for (const [text, entities, relations] of everyday) {
  add(`everyday: ${text.slice(0, 40)}`, "everyday", [T(text, { entities, relations })]);
}

export const CORPUS = cases;
export const CORPUS_CATEGORIES = [...new Set(cases.map((c) => c.category))];
