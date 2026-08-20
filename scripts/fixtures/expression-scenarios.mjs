/**
 * The error-discovery corpus: the same thought said two ways.
 *
 * Every scenario carries a `paragraph` form (one settled utterance) and an
 * `incremental` form (the same content as several settled speech segments),
 * plus one set of expectations that BOTH must satisfy. That pairing is the
 * point: live speech never arrives as a paragraph, and a pipeline that
 * understands the paragraph but drifts across four segments is broken in the
 * only mode that actually ships.
 *
 * Expectations are written in terms of meaning, never pictures — "Mariam
 * must be recoverable as Kenny's mother", never "there must be a line from
 * 40,120 to 200,80". Pinning geometry would freeze the layout and stop it
 * improving, which is the opposite of what this loop is for.
 *
 * Deltas are written as an honest extractor would produce them, including
 * the inconsistencies a real one produces — the same thing typed `state` in
 * one segment and `event` in the next, a pronoun arriving with no antecedent
 * in its own segment. Smoothing those out here would hide exactly the
 * failures this corpus exists to find.
 */

let n = 0;
const rid = () => `r${(n += 1)}`;
const cid = () => `c${(n += 1)}`;

const E = (id, type, label, extra = {}) => ({ id, type, label, ...extra });
const R = (source, type, target, extra = {}) => ({ id: rid(), source, type, target, ...extra });
const C = (text, about, extra = {}) => ({ id: cid(), text, ...(about ? { about } : {}), ...extra });

const D = (text, { entities = [], relations = [], claims = [], topicEntityId, emphasisEntityIds, supersededMentions, interpretation = "" } = {}) => ({
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

const scenarios = [];
const scenario = (config) => scenarios.push(config);

// ───────────────────────────────────────────── identity / introduction

scenario({
  name: "identity: name and origin",
  category: "identity",
  paragraph: [
    D("My name is Kenny Farmer and I'm from Trinidad and Tobago.", {
      entities: [E("kenny", "person", "Kenny Farmer"), E("tt", "place", "Trinidad and Tobago")],
      relations: [R("kenny", "originates_from", "tt")],
      topicEntityId: "kenny",
    }),
  ],
  incremental: [
    D("My name is Kenny Farmer.", { entities: [E("kenny", "person", "Kenny Farmer")], topicEntityId: "kenny" }),
    D("I'm from Trinidad and Tobago.", {
      entities: [E("kenny", "person", "Kenny Farmer"), E("tt", "place", "Trinidad and Tobago")],
      relations: [R("kenny", "originates_from", "tt")],
      topicEntityId: "kenny",
    }),
  ],
  expect: {
    entities: ["Kenny Farmer", "Trinidad and Tobago"],
    singular: ["Kenny Farmer"],
    relations: [["Kenny Farmer", "originates_from", "Trinidad and Tobago"]],
    drawn: ["Kenny Farmer", "Trinidad and Tobago"],
    readable: [["Kenny Farmer", "originates_from", "Trinidad and Tobago"]],
    intent: "introduce",
    entityCount: 2,
  },
});

/**
 * The primary qualitative benchmark from the brief. A viewer should be able
 * to infer: Kenny is central, he is from Trinidad and Tobago, he belongs to
 * a five-person family, Mariam is specifically his MOTHER (not merely
 * nearby), and after the follow-up, that she teaches.
 */
scenario({
  name: "identity: the Kenny introduction (primary benchmark)",
  category: "identity",
  paragraph: [
    D("My name is Kenny Farmer, and I'm from Trinidad and Tobago. I have a family of five. My mother's name is Mariam.", {
      entities: [
        E("kenny", "person", "Kenny Farmer"),
        E("tt", "place", "Trinidad and Tobago"),
        E("family", "group", "family", { quantity: { value: 5 } }),
        E("mariam", "person", "Mariam"),
      ],
      relations: [
        R("kenny", "originates_from", "tt"),
        R("kenny", "member_of", "family"),
        R("mariam", "role_of", "kenny", { role: "mother" }),
        R("mariam", "member_of", "family"),
      ],
      topicEntityId: "kenny",
    }),
    D("She is a teacher.", {
      entities: [E("she", "person", "she", { attributes: [{ key: "occupation", value: "teacher" }] })],
      topicEntityId: "she",
      interpretation: "Mariam is a teacher.",
    }),
  ],
  incremental: [
    D("My name is Kenny Farmer.", { entities: [E("kenny", "person", "Kenny Farmer")], topicEntityId: "kenny" }),
    D("I'm from Trinidad and Tobago.", {
      entities: [E("kenny", "person", "Kenny Farmer"), E("tt", "place", "Trinidad and Tobago")],
      relations: [R("kenny", "originates_from", "tt")],
      topicEntityId: "kenny",
    }),
    D("I have a family of five.", {
      entities: [E("kenny", "person", "Kenny Farmer"), E("family", "group", "family", { quantity: { value: 5 } })],
      relations: [R("kenny", "member_of", "family")],
      topicEntityId: "family",
    }),
    D("My mother's name is Mariam.", {
      entities: [E("kenny", "person", "Kenny Farmer"), E("mariam", "person", "Mariam"), E("family", "group", "family")],
      relations: [R("mariam", "role_of", "kenny", { role: "mother" }), R("mariam", "member_of", "family")],
      topicEntityId: "mariam",
      emphasisEntityIds: ["mariam"],
    }),
    D("She is a teacher.", {
      entities: [E("she", "person", "she", { attributes: [{ key: "occupation", value: "teacher" }] })],
      topicEntityId: "she",
    }),
  ],
  expect: {
    entities: ["Kenny Farmer", "Trinidad and Tobago", "family", "Mariam"],
    singular: ["Kenny Farmer", "Mariam", "family"],
    relations: [
      ["Kenny Farmer", "originates_from", "Trinidad and Tobago"],
      ["Kenny Farmer", "member_of", "family"],
      ["Mariam", "role_of", "Kenny Farmer"],
    ],
    drawn: ["Kenny Farmer", "Mariam", "Trinidad and Tobago", "family"],
    // The kinship must be READABLE, not merely stored — this is the exact
    // failure the brief calls out as "disconnected icons".
    readable: [["Mariam", "role_of", "Kenny Farmer"], ["Kenny Farmer", "originates_from", "Trinidad and Tobago"]],
    intent: "introduce",
    entityCount: 4,
    minDimension: { entity: 1, relation: 1, quantity: 1 },
  },
  /** The follow-up must update Mariam rather than create a second person. */
  attributes: [["Mariam", "occupation", "teacher"]],
});

// ───────────────────────────────────────────── family / relationships

scenario({
  name: "family: five people, mother named, then her occupation",
  category: "family",
  paragraph: [
    D("There are five people in my family. My mother's name is Mariam.", {
      entities: [
        E("speaker", "person", "the speaker"),
        E("family", "group", "my family", { quantity: { value: 5 } }),
        E("mariam", "person", "Mariam"),
      ],
      relations: [
        R("speaker", "member_of", "family"),
        R("mariam", "role_of", "speaker", { role: "mother" }),
        R("mariam", "member_of", "family"),
      ],
      topicEntityId: "family",
    }),
    D("She teaches young children.", {
      entities: [
        E("she", "person", "she", { attributes: [{ key: "occupation", value: "teacher" }] }),
        E("children", "group", "young children"),
      ],
      relations: [R("she", "role_of", "children", { role: "teacher" })],
      topicEntityId: "she",
    }),
  ],
  incremental: [
    D("There are five people in my family.", {
      entities: [E("speaker", "person", "the speaker"), E("family", "group", "my family", { quantity: { value: 5 } })],
      relations: [R("speaker", "member_of", "family")],
      topicEntityId: "family",
    }),
    D("My mother's name is Mariam.", {
      entities: [E("speaker", "person", "the speaker"), E("mariam", "person", "Mariam"), E("family", "group", "my family")],
      relations: [R("mariam", "role_of", "speaker", { role: "mother" }), R("mariam", "member_of", "family")],
      topicEntityId: "mariam",
    }),
    D("She teaches young children.", {
      entities: [
        E("she", "person", "she", { attributes: [{ key: "occupation", value: "teacher" }] }),
        E("children", "group", "young children"),
      ],
      relations: [R("she", "role_of", "children", { role: "teacher" })],
      topicEntityId: "she",
    }),
  ],
  expect: {
    entities: ["the speaker", "my family", "Mariam", "young children"],
    singular: ["Mariam", "my family"],
    relations: [["Mariam", "role_of", "the speaker"], ["the speaker", "member_of", "my family"]],
    drawn: ["Mariam", "my family"],
    readable: [["Mariam", "role_of", "the speaker"]],
    minDimension: { quantity: 1 },
  },
  attributes: [["Mariam", "occupation", "teacher"]],
});

// ──────────────────────────────────────────────────── cause and effect

scenario({
  name: "causality: rain to traffic, then lateness",
  category: "causality",
  paragraph: [
    D("Heavy rain flooded the road, which caused traffic. The traffic made everyone late for work.", {
      entities: [
        E("rain", "event", "heavy rain"),
        E("flood", "event", "road flooding"),
        E("traffic", "state", "traffic"),
        E("late", "state", "lateness"),
      ],
      relations: [R("rain", "causes", "flood"), R("flood", "causes", "traffic"), R("traffic", "causes", "late")],
      topicEntityId: "rain",
    }),
  ],
  incremental: [
    D("Heavy rain flooded the road, which caused traffic.", {
      entities: [E("rain", "event", "heavy rain"), E("flood", "event", "road flooding"), E("traffic", "state", "traffic")],
      relations: [R("rain", "causes", "flood"), R("flood", "causes", "traffic")],
      topicEntityId: "rain",
    }),
    // The extractor genuinely types "traffic" differently here. The world
    // model has to recognise it anyway — this is the regression for the
    // ENTITY_IDENTITY split found live.
    D("The traffic made everyone late for work.", {
      entities: [E("traffic", "event", "traffic"), E("late", "state", "lateness")],
      relations: [R("traffic", "causes", "late")],
      topicEntityId: "traffic",
    }),
  ],
  expect: {
    entities: ["heavy rain", "road flooding", "traffic", "lateness"],
    singular: ["traffic"],
    relations: [["heavy rain", "causes", "road flooding"], ["traffic", "causes", "lateness"]],
    drawn: ["heavy rain", "road flooding", "traffic", "lateness"],
    readable: [["heavy rain", "causes", "road flooding"], ["traffic", "causes", "lateness"]],
    intent: "explain_causality",
    grammar: "cause_effect",
    minDimension: { causal: 1, ordering: 1 },
  },
});

scenario({
  name: "causality: multi-step AI/apps/trust",
  category: "causality",
  paragraph: [
    D("AI makes it easier to build software, so more applications get created. As the number of applications increases, users have more difficulty knowing which ones they can trust.", {
      entities: [
        E("ai", "concept", "AI"),
        E("building", "action", "building software"),
        E("apps", "group", "applications"),
        E("trust", "concept", "trust difficulty"),
      ],
      relations: [R("ai", "enables", "building"), R("building", "causes", "apps"), R("apps", "causes", "trust")],
      topicEntityId: "trust",
    }),
  ],
  incremental: [
    D("AI makes it easier to build software.", {
      entities: [E("ai", "concept", "AI"), E("building", "action", "building software")],
      relations: [R("ai", "enables", "building")],
      topicEntityId: "ai",
    }),
    D("So more applications get created.", {
      entities: [E("building", "action", "building software"), E("apps", "group", "applications")],
      relations: [R("building", "causes", "apps")],
      topicEntityId: "apps",
    }),
    D("As the number of applications increases, users have more difficulty knowing which ones they can trust.", {
      entities: [E("apps", "group", "applications"), E("trust", "concept", "trust difficulty")],
      relations: [R("apps", "causes", "trust")],
      topicEntityId: "trust",
    }),
  ],
  expect: {
    entities: ["AI", "building software", "applications", "trust difficulty"],
    singular: ["applications", "AI"],
    relations: [["AI", "enables", "building software"], ["applications", "causes", "trust difficulty"]],
    drawn: ["AI", "applications", "trust difficulty"],
    readable: [["AI", "enables", "building software"], ["applications", "causes", "trust difficulty"]],
    intent: "explain_causality",
    grammar: "cause_effect",
    minDimension: { causal: 1, ordering: 1 },
  },
});

// ─────────────────────────────────────────────────────────── comparison

scenario({
  name: "comparison: Plan A costs more but is twice as fast",
  category: "comparison",
  paragraph: [
    D("Plan A costs more than Plan B, but Plan A can be completed twice as quickly.", {
      entities: [E("a", "concept", "Plan A"), E("b", "concept", "Plan B"), E("cost", "concept", "cost"), E("speed", "concept", "speed")],
      relations: [
        R("a", "contrasts_with", "b"),
        R("a", "greater_than", "b", { magnitude: 2 }),
        R("a", "has_property", "cost"),
        R("a", "has_property", "speed"),
      ],
      topicEntityId: "a",
    }),
  ],
  incremental: [
    D("Plan A costs more than Plan B.", {
      entities: [E("a", "concept", "Plan A"), E("b", "concept", "Plan B"), E("cost", "concept", "cost")],
      relations: [R("a", "contrasts_with", "b"), R("a", "has_property", "cost")],
      topicEntityId: "a",
    }),
    D("But Plan A can be completed twice as quickly.", {
      entities: [E("a", "concept", "Plan A"), E("b", "concept", "Plan B"), E("speed", "concept", "speed")],
      relations: [R("a", "greater_than", "b", { magnitude: 2 }), R("a", "has_property", "speed")],
      topicEntityId: "a",
    }),
  ],
  expect: {
    entities: ["Plan A", "Plan B"],
    singular: ["Plan A", "Plan B"],
    relations: [["Plan A", "contrasts_with", "Plan B"]],
    drawn: ["Plan A", "Plan B"],
    readable: [["Plan A", "contrasts_with", "Plan B"]],
    intent: "compare",
    grammar: "comparison",
  },
});

// ───────────────────────────────────────────────────────────── sequence

scenario({
  name: "sequence: sign in, load projects, open dashboard",
  category: "sequence",
  paragraph: [
    D("First the user signs in, then we load their projects, and finally we open the dashboard.", {
      entities: [
        E("signin", "action", "sign in"),
        E("load", "action", "load projects"),
        E("dash", "action", "open dashboard"),
      ],
      relations: [R("signin", "precedes", "load", { step: 0 }), R("load", "precedes", "dash", { step: 1 })],
      topicEntityId: "signin",
    }),
  ],
  incremental: [
    D("First the user signs in.", { entities: [E("signin", "action", "sign in")], topicEntityId: "signin" }),
    D("Then we load their projects.", {
      entities: [E("signin", "action", "sign in"), E("load", "action", "load projects")],
      relations: [R("signin", "precedes", "load", { step: 0 })],
      topicEntityId: "load",
    }),
    D("And finally we open the dashboard.", {
      entities: [E("load", "action", "load projects"), E("dash", "action", "open dashboard")],
      relations: [R("load", "precedes", "dash", { step: 1 })],
      topicEntityId: "dash",
    }),
  ],
  expect: {
    entities: ["sign in", "load projects", "open dashboard"],
    relations: [["sign in", "precedes", "load projects"], ["load projects", "precedes", "open dashboard"]],
    drawn: ["sign in", "load projects", "open dashboard"],
    readable: [["sign in", "precedes", "load projects"], ["load projects", "precedes", "open dashboard"]],
    intent: "show_sequence",
    grammar: "sequence",
    minDimension: { ordering: 1 },
  },
});

// ──────────────────────────────────────────────────────────── hierarchy

scenario({
  name: "hierarchy: company, three teams, nested engineering",
  category: "hierarchy",
  paragraph: [
    D("The company has three main teams: engineering, marketing and sales. Engineering contains frontend and backend.", {
      entities: [
        E("company", "group", "the company"),
        E("eng", "group", "engineering"),
        E("mkt", "group", "marketing"),
        E("sales", "group", "sales"),
        E("fe", "group", "frontend"),
        E("be", "group", "backend"),
      ],
      relations: [
        R("company", "contains", "eng"),
        R("company", "contains", "mkt"),
        R("company", "contains", "sales"),
        R("eng", "contains", "fe"),
        R("eng", "contains", "be"),
      ],
      topicEntityId: "company",
    }),
  ],
  incremental: [
    D("The company has three main teams: engineering, marketing and sales.", {
      entities: [
        E("company", "group", "the company"),
        E("eng", "group", "engineering"),
        E("mkt", "group", "marketing"),
        E("sales", "group", "sales"),
      ],
      relations: [R("company", "contains", "eng"), R("company", "contains", "mkt"), R("company", "contains", "sales")],
      topicEntityId: "company",
    }),
    D("Engineering contains frontend and backend.", {
      entities: [E("eng", "group", "engineering"), E("fe", "group", "frontend"), E("be", "group", "backend")],
      relations: [R("eng", "contains", "fe"), R("eng", "contains", "be")],
      topicEntityId: "eng",
    }),
  ],
  expect: {
    entities: ["the company", "engineering", "marketing", "sales", "frontend", "backend"],
    singular: ["engineering"],
    relations: [["the company", "contains", "engineering"], ["engineering", "contains", "frontend"]],
    drawn: ["the company", "engineering"],
    readable: [["the company", "contains", "engineering"]],
    intent: "show_hierarchy",
    grammar: ["hierarchy", "grouping"],
  },
});

// ────────────────────────────────────────────────────────────── spatial

scenario({
  name: "spatial: chair beside desk, lamp behind chair",
  category: "spatial",
  paragraph: [
    D("The chair is beside the desk and the lamp is behind the chair.", {
      entities: [E("chair", "object", "the chair"), E("desk", "object", "the desk"), E("lamp", "object", "the lamp")],
      relations: [
        R("chair", "located_at", "desk", { spatial: "beside" }),
        R("lamp", "located_at", "chair", { spatial: "behind" }),
      ],
      topicEntityId: "chair",
    }),
  ],
  incremental: [
    D("The chair is beside the desk.", {
      entities: [E("chair", "object", "the chair"), E("desk", "object", "the desk")],
      relations: [R("chair", "located_at", "desk", { spatial: "beside" })],
      topicEntityId: "chair",
    }),
    D("The lamp is behind the chair.", {
      entities: [E("lamp", "object", "the lamp"), E("chair", "object", "the chair")],
      relations: [R("lamp", "located_at", "chair", { spatial: "behind" })],
      topicEntityId: "lamp",
    }),
  ],
  expect: {
    entities: ["the chair", "the desk", "the lamp"],
    singular: ["the chair"],
    relations: [["the chair", "located_at", "the desk"], ["the lamp", "located_at", "the chair"]],
    drawn: ["the chair", "the desk", "the lamp"],
    intent: "show_spatial",
    grammar: "spatial",
  },
});

// ───────────────────────────────────────────────────────────── quantity

scenario({
  name: "quantity: three people, four apples each, twelve total",
  category: "quantity",
  paragraph: [
    D("Three people each have four apples, giving us twelve apples altogether.", {
      entities: [
        E("people", "group", "people", { quantity: { value: 3 } }),
        E("each", "quantity", "apples each", { quantity: { value: 4 } }),
        E("total", "quantity", "apples altogether", { quantity: { value: 12 } }),
      ],
      relations: [R("people", "causes", "total"), R("total", "greater_than", "each")],
      topicEntityId: "total",
    }),
  ],
  incremental: [
    D("Three people each have four apples.", {
      entities: [
        E("people", "group", "people", { quantity: { value: 3 } }),
        E("each", "quantity", "apples each", { quantity: { value: 4 } }),
      ],
      relations: [R("people", "relates_to", "each")],
      topicEntityId: "people",
    }),
    D("That gives us twelve apples altogether.", {
      entities: [
        E("people", "group", "people", { quantity: { value: 3 } }),
        E("total", "quantity", "apples altogether", { quantity: { value: 12 } }),
      ],
      relations: [R("people", "causes", "total")],
      topicEntityId: "total",
    }),
  ],
  expect: {
    entities: ["people", "apples altogether"],
    drawn: ["apples altogether"],
    minDimension: { quantity: 1 },
  },
});

// ───────────────────────────────────────────────────────── state change

scenario({
  name: "state change: ice to water to steam",
  category: "state-change",
  paragraph: [
    D("The ice melted into water and eventually evaporated into steam.", {
      entities: [E("ice", "state", "ice"), E("water", "state", "water"), E("steam", "state", "steam")],
      relations: [R("ice", "transforms_into", "water"), R("water", "transforms_into", "steam")],
      topicEntityId: "ice",
    }),
  ],
  incremental: [
    D("The ice melted into water.", {
      entities: [E("ice", "state", "ice"), E("water", "state", "water")],
      relations: [R("ice", "transforms_into", "water")],
      topicEntityId: "water",
    }),
    D("And eventually it evaporated into steam.", {
      entities: [E("water", "state", "water"), E("steam", "state", "steam")],
      relations: [R("water", "transforms_into", "steam")],
      topicEntityId: "steam",
    }),
  ],
  expect: {
    entities: ["ice", "water", "steam"],
    singular: ["water"],
    relations: [["ice", "transforms_into", "water"], ["water", "transforms_into", "steam"]],
    drawn: ["ice", "water", "steam"],
    readable: [["ice", "transforms_into", "water"], ["water", "transforms_into", "steam"]],
    intent: "show_transformation",
    grammar: "process",
    minDimension: { ordering: 1 },
  },
});

// ──────────────────────────────────────────────────────────── narrative

scenario({
  name: "narrative: boy finds an injured bird, carries it home",
  category: "narrative",
  paragraph: [
    D("A boy walked through a forest and found an injured bird beneath a tree. He picked it up and carried it home.", {
      entities: [
        E("boy", "person", "a boy"),
        E("walk", "action", "walking through the forest"),
        E("find", "event", "finding the bird"),
        E("bird", "object", "injured bird"),
        E("tree", "object", "a tree"),
        E("carry", "action", "carrying it home"),
      ],
      relations: [
        R("walk", "precedes", "find", { step: 0 }),
        R("find", "precedes", "carry", { step: 1 }),
        R("bird", "located_at", "tree", { spatial: "below" }),
      ],
      topicEntityId: "boy",
    }),
  ],
  incremental: [
    D("A boy walked through a forest and found an injured bird beneath a tree.", {
      entities: [
        E("boy", "person", "a boy"),
        E("walk", "action", "walking through the forest"),
        E("find", "event", "finding the bird"),
        E("bird", "object", "injured bird"),
        E("tree", "object", "a tree"),
      ],
      relations: [R("walk", "precedes", "find", { step: 0 }), R("bird", "located_at", "tree", { spatial: "below" })],
      topicEntityId: "boy",
    }),
    D("He picked it up and carried it home.", {
      entities: [E("find", "event", "finding the bird"), E("carry", "action", "carrying it home")],
      relations: [R("find", "precedes", "carry", { step: 1 })],
      topicEntityId: "carry",
    }),
  ],
  expect: {
    entities: ["a boy", "injured bird", "carrying it home"],
    singular: ["injured bird"],
    relations: [["finding the bird", "precedes", "carrying it home"]],
    intent: ["narrate", "show_sequence"],
  },
});

// ───────────────────────────────────────────────────── abstract thought

scenario({
  name: "abstract: fear prevents opportunity",
  category: "abstract",
  paragraph: [
    D("Fear can stop someone from taking an opportunity even when the opportunity could improve their life.", {
      entities: [
        E("fear", "concept", "fear"),
        E("taking", "action", "taking an opportunity"),
        E("life", "concept", "a better life"),
      ],
      relations: [R("fear", "prevents", "taking"), R("taking", "causes", "life")],
      claims: [C("the opportunity could improve their life", ["taking"])],
      topicEntityId: "fear",
    }),
  ],
  incremental: [
    D("Fear can stop someone from taking an opportunity.", {
      entities: [E("fear", "concept", "fear"), E("taking", "action", "taking an opportunity")],
      relations: [R("fear", "prevents", "taking")],
      topicEntityId: "fear",
    }),
    D("Even when the opportunity could improve their life.", {
      entities: [E("taking", "action", "taking an opportunity"), E("life", "concept", "a better life")],
      relations: [R("taking", "causes", "life")],
      topicEntityId: "life",
    }),
  ],
  expect: {
    entities: ["fear", "taking an opportunity", "a better life"],
    relations: [["fear", "prevents", "taking an opportunity"]],
    drawn: ["fear", "taking an opportunity"],
    readable: [["fear", "prevents", "taking an opportunity"]],
    // The whole meaning is the negation. A scene that draws fear -> opportunity
    // with an unlabelled arrow says the opposite of what was said.
    minDimension: { polarity: 1 },
  },
});

// ───────────────────────────────────────────────────────────── argument

scenario({
  name: "argument: cheap software is not always cheaper",
  category: "argument",
  paragraph: [
    D("Cheap software is not always cheaper because maintenance costs can eventually exceed the original purchase price.", {
      entities: [
        E("cheap", "concept", "cheap software"),
        E("maintenance", "concept", "maintenance cost"),
        E("purchase", "concept", "purchase price"),
      ],
      relations: [R("maintenance", "greater_than", "purchase"), R("maintenance", "refutes", "cheap")],
      claims: [C("cheap software is not always cheaper", ["cheap"])],
      topicEntityId: "cheap",
    }),
  ],
  incremental: [
    D("Cheap software is not always cheaper.", {
      entities: [E("cheap", "concept", "cheap software")],
      claims: [C("cheap software is not always cheaper", ["cheap"])],
      topicEntityId: "cheap",
    }),
    D("Because maintenance costs can eventually exceed the original purchase price.", {
      entities: [
        E("cheap", "concept", "cheap software"),
        E("maintenance", "concept", "maintenance cost"),
        E("purchase", "concept", "purchase price"),
      ],
      relations: [R("maintenance", "greater_than", "purchase"), R("maintenance", "refutes", "cheap")],
      topicEntityId: "maintenance",
    }),
  ],
  expect: {
    entities: ["cheap software", "maintenance cost", "purchase price"],
    relations: [["maintenance cost", "refutes", "cheap software"]],
    drawn: ["cheap software", "maintenance cost"],
    readable: [["maintenance cost", "refutes", "cheap software"]],
    minDimension: { polarity: 1 },
  },
});

// ────────────────────────────────────────────── branching explanation

scenario({
  name: "branching: demand, supply and prices",
  category: "branching",
  paragraph: [
    D("If demand rises while supply stays the same, prices tend to rise. If supply also rises enough, that pressure can be reduced.", {
      entities: [
        E("demand", "concept", "rising demand"),
        E("supply-flat", "state", "flat supply"),
        E("prices", "concept", "rising prices"),
        E("supply-up", "concept", "rising supply"),
      ],
      relations: [
        R("demand", "causes", "prices"),
        R("supply-flat", "enables", "prices"),
        R("supply-up", "prevents", "prices"),
      ],
      topicEntityId: "prices",
    }),
  ],
  incremental: [
    D("If demand rises while supply stays the same, prices tend to rise.", {
      entities: [
        E("demand", "concept", "rising demand"),
        E("supply-flat", "state", "flat supply"),
        E("prices", "concept", "rising prices"),
      ],
      relations: [R("demand", "causes", "prices"), R("supply-flat", "enables", "prices")],
      topicEntityId: "prices",
    }),
    D("If supply also rises enough, that pressure can be reduced.", {
      entities: [E("supply-up", "concept", "rising supply"), E("prices", "concept", "rising prices")],
      relations: [R("supply-up", "prevents", "prices")],
      topicEntityId: "supply-up",
    }),
  ],
  expect: {
    entities: ["rising demand", "rising prices", "rising supply"],
    singular: ["rising prices"],
    relations: [["rising demand", "causes", "rising prices"], ["rising supply", "prevents", "rising prices"]],
    drawn: ["rising demand", "rising prices", "rising supply"],
    // Both branches must survive: a picture showing only the "prices rise"
    // arm has lost half the explanation.
    readable: [["rising demand", "causes", "rising prices"], ["rising supply", "prevents", "rising prices"]],
    minDimension: { polarity: 1 },
  },
});

// ─────────────────────────────────────────────────────────── correction

scenario({
  name: "correction: brother becomes cousin",
  category: "correction",
  paragraph: [
    D("John is Sarah's brother.", {
      entities: [E("john", "person", "John"), E("sarah", "person", "Sarah")],
      relations: [R("john", "role_of", "sarah", { role: "brother" })],
      topicEntityId: "john",
    }),
    D("Actually, I meant John is Sarah's cousin.", {
      entities: [E("john", "person", "John"), E("sarah", "person", "Sarah")],
      relations: [R("john", "role_of", "sarah", { role: "cousin" })],
      topicEntityId: "john",
    }),
  ],
  incremental: [
    D("John is Sarah's brother.", {
      entities: [E("john", "person", "John"), E("sarah", "person", "Sarah")],
      relations: [R("john", "role_of", "sarah", { role: "brother" })],
      topicEntityId: "john",
    }),
    D("Actually, I meant John is Sarah's cousin.", {
      entities: [E("john", "person", "John"), E("sarah", "person", "Sarah")],
      relations: [R("john", "role_of", "sarah", { role: "cousin" })],
      topicEntityId: "john",
    }),
  ],
  expect: {
    entities: ["John", "Sarah"],
    singular: ["John", "Sarah"],
    entityCount: 2,
    relations: [["John", "role_of", "Sarah"]],
    drawn: ["John", "Sarah"],
    readable: [["John", "role_of", "Sarah"]],
  },
  /** The corrected role must win, and the wrong one must be gone. */
  roles: { expected: "cousin", retired: "brother" },
});

// ─────────────────────────────────────────────── reference resolution

scenario({
  name: "reference: ambiguous 'him' is not blindly guessed",
  category: "reference",
  paragraph: [
    D("Kenny spoke to David after work. David told him that the meeting had been moved.", {
      entities: [
        E("kenny", "person", "Kenny"),
        E("david", "person", "David"),
        E("meeting", "event", "the meeting"),
      ],
      relations: [R("david", "relates_to", "meeting")],
      topicEntityId: "david",
    }),
  ],
  incremental: [
    D("Kenny spoke to David after work.", {
      entities: [E("kenny", "person", "Kenny"), E("david", "person", "David")],
      relations: [R("kenny", "relates_to", "david")],
      topicEntityId: "david",
    }),
    D("David told him that the meeting had been moved.", {
      entities: [E("david", "person", "David"), E("him", "person", "him"), E("meeting", "event", "the meeting")],
      relations: [R("david", "relates_to", "meeting")],
      topicEntityId: "david",
    }),
  ],
  expect: {
    entities: ["Kenny", "David", "the meeting"],
    singular: ["Kenny", "David"],
    // Three real things. A fourth would mean "him" became a person.
    entityCount: 3,
  },
});

export const SCENARIOS = scenarios;
export const SCENARIO_CATEGORIES = [...new Set(scenarios.map((s) => s.category))];
