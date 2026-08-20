/**
 * The Visual Semantics layer, tested where it can be tested: the mapping
 * (lib/meaning/lexicon.ts) and the skeleton it produces (lib/meaning/sign.ts).
 *
 * The single most important assertion in this file is `no text descriptor` —
 * that is the whole wordless direction expressed as a check. Everything else
 * guards the mapping from regressing into "one symbol per phrase."
 *
 *   node --import ./scripts/ts-register.mjs scripts/meaning-lexicon-test.mjs
 */

import { signForConcept, formForRelationship, glyphExists, CHARGE_STROKE } from "../lib/meaning/lexicon.ts";
import { signSkeleton, signGeometry, SIGN_BASE } from "../lib/meaning/sign.ts";
import { GLYPHS, GLYPH_NAMES } from "../lib/meaning/glyphs.ts";
import { RelationshipTypeSchema } from "../lib/meaning/types.ts";

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const concept = (label, extra = {}) => ({ id: "c1", label, importance: "supporting", ...extra });

// --- glyph art is well-formed --------------------------------------------

for (const name of GLYPH_NAMES) {
  const art = GLYPHS[name];
  const inBox = (v) => Number.isFinite(v) && v >= -5 && v <= 105;
  const strokesOk = art.strokes.every((s) => s.length >= 2 && s.every(([x, y]) => inBox(x) && inBox(y)));
  const ellipsesOk = art.ellipses.every((e) => e.length === 4 && e.every(inBox));
  check(`glyph ${name} authored in the 0-100 box`, strokesOk && ellipsesOk);
  check(`glyph ${name} draws something`, art.strokes.length + art.ellipses.length > 0);
}
check("mass fallback exists", Boolean(GLYPHS.mass));

// --- the mapping ----------------------------------------------------------

const CASES = [
  // [spoken concept, expected glyph, expected charge]
  ["the reason", "source", "neutral"],
  ["why revenue fell", "source", "neutral"],
  ["users are leaving", "exit", "problem"],
  ["churn", "exit", "problem"],
  ["onboarding", "funnel", "neutral"],
  ["the signup flow", "funnel", "neutral"],
  ["onboarding is too complicated", "funnel", "problem"],
  ["a really complex integration", "tangle", "problem"],
  ["people are confused", "fog", "problem"],
  ["growth", "rise", "solution"],
  ["revenue is declining", "fall", "problem"],
  ["we made it simpler", "simple", "solution"],
  ["we fixed it", "repair", "solution"],
  ["a big opportunity", "opening", "solution"],
  ["the real value", "value", "solution"],
  ["users are blocked", "blockage", "problem"],
  ["it keeps crashing", "crack", "problem"],
  ["the problem", "crack", "problem"],
  ["we have to decide", "fork", "neutral"],
  ["every time they come back", "loop", "neutral"],
  ["it costs too much", "weight", "problem"],
  ["our users", "people", "neutral"],
  ["the team", "people", "neutral"],
];

for (const [label, glyph, charge] of CASES) {
  const sign = signForConcept(concept(label));
  check(`"${label}" -> ${glyph}`, sign.glyph === glyph, `got ${sign.glyph} (${sign.reason})`);
  check(`"${label}" charge ${charge}`, sign.charge === charge, `got ${sign.charge}`);
}

// Every glyph a rule can produce must actually be drawable.
for (const [, glyph] of CASES) {
  check(`glyph "${glyph}" is drawable`, glyphExists(glyph));
}

// --- fallback never becomes text -----------------------------------------

const unknown = signForConcept(concept("the quarterly planning ritual"));
check("unmatched concept still yields a sign", Boolean(unknown.glyph));
check("unmatched concept falls back to mass, not a label", unknown.glyph === "mass", `got ${unknown.glyph}`);

// --- modifiers are independent of the glyph ------------------------------

const complicatedOnboarding = signForConcept(concept("onboarding", { description: "it is far too complicated" }));
check(
  "modifiers compose onto an object glyph rather than replacing it",
  complicatedOnboarding.glyph === "funnel" && complicatedOnboarding.texture === "cluttered",
  `${complicatedOnboarding.glyph}/${complicatedOnboarding.texture}`,
);

const negated = signForConcept(concept("users are not leaving"));
check("negation is detected", negated.negated === true);
check("negation does not erase the glyph", negated.glyph === "exit");

const primary = signForConcept(concept("growth", { importance: "primary" }));
const detail = signForConcept(concept("growth", { importance: "detail" }));
check("emphasis becomes scale", primary.scale > detail.scale, `${primary.scale} vs ${detail.scale}`);

const quantified = signForConcept(concept("growth", { quantity: { value: 40, unit: "%" } }));
check("a stated quantity adds scale", quantified.scale > signForConcept(concept("growth")).scale);
check("quantity scale stays bounded", signForConcept(concept("growth", { quantity: { value: 1e9 } })).scale < 2.4);

check("low confidence is drawn tentatively", signForConcept(concept("growth", { confidence: "low" })).tentative === true);
check("high confidence is not tentative", signForConcept(concept("growth", { confidence: "high" })).tentative === false);

// --- relationships map to structure, not always to arrows -----------------

const forms = {};
for (const type of RelationshipTypeSchema.options) forms[type] = formForRelationship({ type });
check("causal relations become causal arrows", forms.causes === "causal_arrow" && forms.leads_to === "causal_arrow");
check("containment becomes nesting, not an arrow", forms.contains === "nest" && forms.part_of === "nest");
check("contrast becomes adjacency, not a 'vs' arrow", forms.contrasts === "adjacent");
check("every relationship type has a form", RelationshipTypeSchema.options.every((t) => Boolean(forms[t])));

// --- the skeleton: the wordless invariant ---------------------------------

const ALL_SIGNS = [
  ...CASES.map(([label]) => signForConcept(concept(label))),
  unknown,
  negated,
  primary,
  signForConcept(concept("growth", { confidence: "low" })),
];

for (const sign of ALL_SIGNS) {
  const skeleton = signSkeleton("node-1", sign, 500, 400);
  const anyText = skeleton.some((el) => el.type === "text" || typeof el.text === "string" || typeof el.label === "object");
  check(`no text descriptor for ${sign.glyph}`, !anyText);
  check(`${sign.glyph} draws ink beyond the anchor`, skeleton.length > 1);

  const anchor = skeleton[0];
  const { size } = signGeometry(sign);
  check(`${sign.glyph} anchor is bindable`, anchor.type === "rectangle" && anchor.id === "node-1");
  check(`${sign.glyph} anchor is invisible`, anchor.strokeColor === "transparent" && anchor.backgroundColor === "transparent");
  check(
    `${sign.glyph} anchor is centred on the requested point`,
    Math.abs(anchor.x + size / 2 - 500) < 0.01 && Math.abs(anchor.y + size / 2 - 400) < 0.01,
  );
  check(`${sign.glyph} inks by charge`, skeleton.slice(1).every((el) => typeof el.strokeColor === "string"));
}

// Charge reaches the ink.
const problemSkeleton = signSkeleton("n", signForConcept(concept("users are leaving")), 0, 0);
check("problem charge draws in the problem ink", problemSkeleton.some((el) => el.strokeColor === CHARGE_STROKE.problem));
const solutionSkeleton = signSkeleton("n", signForConcept(concept("we fixed it")), 0, 0);
check("solution charge draws in the solution ink", solutionSkeleton.some((el) => el.strokeColor === CHARGE_STROKE.solution));

// Clutter adds ink; simplicity does not.
const cluttered = signSkeleton("n", signForConcept(concept("way too complicated")), 0, 0);
const clean = signSkeleton("n", signForConcept(concept("we made it simpler")), 0, 0);
check("clutter adds strokes", cluttered.length > clean.length, `${cluttered.length} vs ${clean.length}`);

// Determinism: the same sign twice must produce identical ink, or the canvas
// would shimmer every time an unrelated concept moved.
const a = JSON.stringify(signSkeleton("n", signForConcept(concept("too complicated")), 10, 10));
const b = JSON.stringify(signSkeleton("n", signForConcept(concept("too complicated")), 10, 10));
check("sign rendering is deterministic", a === b);

// Geometry scales with emphasis.
check("base geometry is the unscaled box", signGeometry({ scale: 1 }).size === SIGN_BASE);
check("primary importance draws larger", signGeometry(primary).size > signGeometry(detail).size);

// --- report ---------------------------------------------------------------

if (failures.length) {
  console.error(`meaning-lexicon-test: ${pass} passed, ${failures.length} FAILED`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`meaning-lexicon-test: ${pass} passed`);
