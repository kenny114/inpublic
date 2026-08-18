import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeThought } from "./analyze.ts";

const cause = analyzeThought("Marketing creates traffic. Traffic creates sign ups.");
assert.equal(cause.plan.family, "causal_chain");
assert.ok(cause.graph.edges.some((edge) => edge.kind === "causes"));

const sequence = analyzeThought("First, collect data. Then clean data. Finally train the model.");
assert.equal(sequence.plan.family, "process_flow");
assert.ok(sequence.graph.edges.filter((edge) => edge.kind === "before").length >= 2);

const spatial = analyzeThought("The sensor sits inside the vehicle.");
assert.equal(spatial.plan.family, "spatial_map");

const transformation = analyzeThought("Water changes into steam.");
assert.equal(transformation.plan.family, "state_transformation");

const uncertainty = analyzeThought("Sign ups increased, but I don't know if the website caused it.");
assert.ok(uncertainty.graph.ambiguities.length > 0);
assert.ok(!uncertainty.graph.edges.some((edge) => edge.kind === "causes"));

const plain = analyzeThought("Today was an interesting day.");
assert.equal(plain.plan.family, "text_only");

const resultPath = new URL("./results/shadow-results.json", import.meta.url);
if (fs.existsSync(resultPath)) {
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  assert.equal(result.corpusSummary.selectedRecordings, 8);
  assert.ok(result.metrics.settledThoughts >= 20);
  assert.ok(result.examples.length >= 15 && result.examples.length <= 30);
  assert.ok(result.audioInventory.every((item) => typeof item.selected === "boolean"));
}

console.log("Universal Visual Grammar V1 shadow tests passed.");

