/**
 * Live smoke test for ordinal/topic-recall reference resolution: real
 * speech, real model call (lib/expression/meaning/extract.ts's
 * extractMeaning), real sanitizeDelta, real world/apply.ts, real
 * lib/expression/world/references.ts resolver, real composer. Nothing here
 * hand-constructs a ReferenceMention — every one instrumented below is
 * whatever the live model actually produced from plain text, which is the
 * only way to know the prompt wiring (not just the deterministic resolver)
 * actually works.
 *
 * Requires ANTHROPIC_API_KEY. Costs real tokens (a handful of cheap
 * SCRIBE_MODEL calls) — this is a manual/occasional smoke test, not part of
 * the regular `npm test` regression suite.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-reference-live-replay.mjs
 */

import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { extractMeaning } from "../lib/expression/meaning/extract.ts";
import { formatTrace } from "../lib/expression/trace.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — this script makes real model calls and cannot run without it.");
  process.exit(1);
}

function labelOf(world, id) {
  return world.entities.find((e) => e.id === id)?.label ?? null;
}

function statusOf(world, id) {
  return world.entities.find((e) => e.id === id)?.status ?? null;
}

/**
 * One continuous conversation, run as a single ExpressionSession so later
 * turns can reference earlier ones — exactly the "speak naturally for
 * several turns" scenario this wiring exists to prove. Turns are grouped
 * into two runs so the six required phrasings and their adversarial
 * variants can be checked independently without one run's length making
 * the other's candidates harder to read.
 */
const CONVERSATIONS = [
  {
    name: "topic switch, ordinal reference, archived-topic recall",
    turns: [
      "Our main problem is low awareness.",
      "Actually, let's set that aside for now.",
      "For funding, we could raise money or bootstrap.",
      "The second one is probably safest.",
      "Let's also think about distribution — partnerships or paid ads.",
      "Go back to the first option.",
      "What we were saying earlier about funding?",
      "The other one.",
      "Go back to the original problem.",
    ],
    // Which turns (0-indexed) are the required natural-language probes worth reporting on specifically.
    highlight: [3, 5, 6, 7, 8],
  },
  {
    name: "adversarial: two ordinal groups disambiguated by topic hint in one sentence",
    turns: [
      "For funding we could do a seed round or bootstrap.",
      "For distribution we could do partnerships or paid ads.",
      "No, I meant the first distribution idea, not the first funding option.",
    ],
    highlight: [2],
  },
  {
    name: "control: ordinary speech, no reference language",
    turns: [
      "The team shipped the new dashboard yesterday.",
      "It received good feedback from three customers.",
      "We should extend it to support exports next.",
    ],
    highlight: [0, 1, 2],
  },
];

let anyFindings = false;

for (const convo of CONVERSATIONS) {
  console.log(`\n${"═".repeat(80)}\n${convo.name}\n${"═".repeat(80)}`);
  const session = new ExpressionSession({ extract: (text, recent) => extractMeaning(text, recent) });

  for (const [index, text] of convo.turns.entries()) {
    const trace = await session.ingest({ id: `t${index}`, source: "human_speech", text, seq: index });
    const isHighlight = convo.highlight.includes(index);

    console.log(`\n  turn ${index + 1}: "${text}"`);
    if (isHighlight) {
      console.log(
        formatTrace(trace)
          .split(/\r?\n/)
          .map((l) => `      ${l}`)
          .join("\n"),
      );
    } else {
      console.log(`      entities: ${trace.world.entities.filter((e) => e.status !== "superseded").map((e) => e.id).join(", ") || "(none)"}`);
      for (const r of trace.referenceResolutions) {
        const outcome = r.chosenId ? `-> ${labelOf(trace.world, r.chosenId)}` : "-> UNRESOLVED";
        console.log(`      REFERENCE "${r.surface}" (${r.kind}) ${outcome}  [${r.confidence}] ${r.reason}`);
      }
    }

    // ---- structural invariants, checked regardless of the model's exact wording ----

    // No canvas geometry participates in resolution: candidates never carry x/y/w/h.
    for (const r of trace.referenceResolutions) {
      for (const c of r.candidates) {
        if ("x" in c || "y" in c || "w" in c || "h" in c) {
          console.log(`      ✗ INVARIANT VIOLATED: candidate carries geometry: ${JSON.stringify(c)}`);
          anyFindings = true;
        }
      }
    }

    // An unresolved reference must never leak its literal surface text onto the canvas as if it were content.
    for (const r of trace.referenceResolutions) {
      if (r.chosenId) continue;
      const leaked = trace.scene.objects.find((o) => o.label && o.label.toLowerCase() === r.surface.toLowerCase());
      if (leaked) {
        console.log(`      ✗ INVARIANT VIOLATED: unresolved "${r.surface}" appears verbatim as a scene object label`);
        anyFindings = true;
      }
    }

    // The model must never be able to supply a target directly: the schema
    // has no field for it, so this is enforced by construction, but confirm
    // no delta entity claims an id that already exists as a WORLD id
    // (which would be indistinguishable from the model choosing a target
    // itself rather than the resolver doing it).
    for (const e of trace.delta.entities) {
      if (trace.worldBefore.entities.some((w) => w.id === e.id)) {
        console.log(`      ⚠ delta entity "${e.id}" reused an existing WORLD id verbatim — check this wasn't the model guessing a target`);
      }
    }

    if (convo.name.startsWith("control") && trace.referenceResolutions.length) {
      console.log(`      ✗ ordinary speech produced ${trace.referenceResolutions.length} referenceMentions (expected 0)`);
      anyFindings = true;
    }
  }
}

console.log(`\n${"═".repeat(80)}`);
console.log(anyFindings ? "one or more structural invariants were violated — see ✗ lines above" : "no structural invariants were violated across all conversations");
console.log("This is a live, non-deterministic smoke test: read the REFERENCE lines above to judge whether the model's real phrasing triggered sensible candidates, not just whether an assertion passed.");
