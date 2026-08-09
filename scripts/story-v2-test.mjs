import {
  activeStoryScene,
  resolveStoryEntity,
  resolveStoryVisual,
  undoStoryAction,
} from "../lib/story.ts";
import {
  applyStoryEvent,
  compileStoryEvent,
  emptyStoryPartialState,
  recognizeStoryPartial,
  storyEventIsSupported,
} from "../lib/storyV2.ts";
import {
  STORY_V2_ASSET_MANIFEST,
  storyEntityElementPrefix,
  storyEntityPositions,
} from "../lib/storyAssets.ts";
import { newStoryState } from "../lib/story.ts";

let pass = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`   ${condition ? "✓" : "✗"} ${name}${condition || !detail ? "" : ` — ${detail}`}`);
};

const applyText = (state, text, sequence) => {
  const event = compileStoryEvent(text, { state, sequence });
  const started = performance.now();
  const result = applyStoryEvent(state, event, 0);
  return { event, result, ms: performance.now() - started };
};

console.log("STORY MODE V2 — local compiler and atomic scene graph\n");

const sentence = compileStoryEvent("A cat sat under a tree.", { sequence: 1 });
check("compiler extracts cat and tree", sentence.entities.map((entity) => entity.mention).sort().join(",") === "cat,tree");
check("compiler extracts sitting", sentence.actions.some((action) => action.subjectRef === "cat-1" && action.action === "sit"));
check("compiler extracts under relationship", sentence.relations.some((relation) => relation.fromRef === "cat-1" && relation.toRef === "tree-1" && relation.relation === "under"));
check("event preserves raw and normalized speech", sentence.sourceText === "A cat sat under a tree." && sentence.normalizedText === "a cat sat under a tree");

const sunny = compileStoryEvent("The sun was shining.", { sequence: 1 });
const rainy = compileStoryEvent("Rain began to fall.", { sequence: 1 });
check("sun maps to sunlight environment", sunny.environment[0]?.effect === "sunlight" && sunny.entities.length === 0);
check("rain maps to rain environment", rainy.environment[0]?.effect === "rain" && rainy.environment[0]?.state === "replace" && rainy.entities.length === 0);
check("cut is not destructively converted to cat", !storyEventIsSupported(compileStoryEvent("There was a cut.", { sequence: 1 })));
const ranAway = compileStoryEvent("The cat ran away.", { state: newStoryState(), sequence: 2 });
check("observed 'cat ran away' maps to running away", ranAway.actions.some((action) => action.action === "run" && action.direction === "away"));
const fromRain = compileStoryEvent("The cat ran from the rain.", { state: newStoryState(), sequence: 2 });
check("observed 'cat ran from rain' keeps rain environmental", fromRain.environment.some((layer) => layer.effect === "rain") && fromRain.relations.some((relation) => relation.toRef === "environment:rain" && relation.relation === "away-from") && !fromRain.entities.some((entity) => entity.mention === "rain"));
const towardHouse = compileStoryEvent("The cat ran toward a house.", { state: newStoryState(), sequence: 2 });
check("observed 'cat ran toward house' compiles movement target", towardHouse.actions.some((action) => action.action === "run" && action.targetRef === "house-1") && towardHouse.relations.some((relation) => relation.toRef === "house-1" && relation.relation === "toward"));

console.log("\nIncremental recognition");
let partial = emptyStoryPartialState();
let update = recognizeStoryPartial(partial, "There was a cat", { sequence: 1 });
partial = update.state;
check("first ordinary-confidence partial waits", !update.event);
update = recognizeStoryPartial(partial, "There was a cat", { sequence: 1 });
partial = update.state;
const provisionalId = update.event?.entities[0]?.entityId;
check("stable partial creates one provisional cat", update.event?.provisional === true && provisionalId === "cat-1");
const preview = applyStoryEvent(newStoryState(), update.event, 0);
check("provisional preview creates no permanent operation", preview.accepted && preview.state.operations.length === 0);
const repeated = recognizeStoryPartial(partial, "There was a cat", { sequence: 1 });
check("repeated partial preserves provisional identity", repeated.event?.eventId === update.event?.eventId && repeated.event?.entities.length === 1);
const finalCat = compileStoryEvent("There was a cat.", { state: newStoryState(), sequence: 1 });
const committed = applyStoryEvent(newStoryState(), finalCat, 0);
check("final confirmation commits same cat id", resolveStoryEntity(committed.state, "cat")?.entityId === provisionalId && committed.state.operations.length === 1);
const correction = recognizeStoryPartial(repeated.state, "There was a cut", { sequence: 1 });
check("correction removes provisional cue", correction.removeProvisional && correction.ambiguity === "cut/cat" && !correction.event);
const confident = recognizeStoryPartial(emptyStoryPartialState(), "A tree appeared", { sequence: 1 }, 0.95);
check("high-confidence provider partial can preview immediately", confident.event?.entities[0]?.mention === "tree");

console.log("\nAtomic dependency order and continuity");
let state = newStoryState();
const first = applyText(state, "A cat sat under a tree.", 1);
state = first.result.state;
const catId = resolveStoryEntity(state, "cat")?.entityId;
const treeId = resolveStoryEntity(state, "tree")?.entityId;
check("cat and tree are created atomically", first.result.accepted && catId === "cat-1" && treeId === "tree-1");
check("relationship applies after both exist", resolveStoryEntity(state, "cat")?.placement.relativeTo === treeId && resolveStoryEntity(state, "cat")?.placement.relation === "under");
check("no unavailable-target rejection", first.result.decisions.every((decision) => decision.accepted));
check("one semantic event creates one undo operation", state.operations.length === 1 && state.operations[0].actionType === "story_event");
const pronoun = compileStoryEvent("It ran.", { state, sequence: 2 });
check("pronoun 'it' reuses the recent cat", pronoun.actions[0]?.subjectRef === catId && pronoun.entities.length === 0);
const staleEvent = compileStoryEvent("The cat stood up.", { state, sequence: 1 });
check("late reconciliation sequence is rejected", applyStoryEvent(state, staleEvent, 0).stale === true);

const broken = {
  eventId: "broken",
  sequence: 2,
  sourceText: "The ghost ran.",
  normalizedText: "the ghost ran",
  provisional: false,
  confidence: 1,
  entities: [],
  actions: [{ subjectRef: "ghost", action: "run" }],
  relations: [],
  environment: [],
};
const rolledBack = applyStoryEvent(state, broken, 0);
check("essential dependency failure rolls back whole event", !rolledBack.accepted && JSON.stringify(rolledBack.state.scenes) === JSON.stringify(state.scenes));

let step = applyText(state, "The cat stood up.", 2);
state = step.result.state;
check("same cat stands", resolveStoryEntity(state, "cat")?.entityId === catId && resolveStoryEntity(state, "cat")?.state.pose === "standing");
step = applyText(state, "The cat ran away from the tree.", 3);
state = step.result.state;
check("same cat runs", resolveStoryEntity(state, "cat")?.entityId === catId && resolveStoryEntity(state, "cat")?.state.pose === "running");
check("same tree remains", resolveStoryEntity(state, "tree")?.entityId === treeId);
check("running adds deterministic motion lines", resolveStoryEntity(state, "cat")?.effects.includes("motion-lines"));
const undone = undoStoryAction(state).state;
check("one undo restores pre-event pose and placement", resolveStoryEntity(undone, "cat")?.state.pose === "standing" && resolveStoryEntity(undone, "cat")?.placement.relation === "under");

console.log("\nEnvironment ontology");
let weather = newStoryState();
let weatherStep = applyText(weather, "The sun was shining.", 1);
weather = weatherStep.result.state;
check("sunlight is active without a sun object", activeStoryScene(weather)?.environment?.sunlight?.active === true && Object.keys(activeStoryScene(weather).entities).length === 0);
weatherStep = applyText(weather, "Rain began to fall.", 2);
weather = weatherStep.result.state;
check("rain replaces sunlight", activeStoryScene(weather)?.environment?.rain?.active === true && activeStoryScene(weather)?.environment?.sunlight?.active === false);
check("rain never becomes an ordinary object", resolveStoryEntity(weather, "rain") === null);
check("weather actions bypass object validation", weatherStep.result.decisions.every((decision) => decision.accepted && decision.unit === "environment"));

console.log("\nAsset correctness and editable rendering");
check("V2 registry contains the nine proof assets", ["cat", "tree", "house", "car", "person", "sunlight", "rain", "cloud", "puddle"].every((key) => STORY_V2_ASSET_MANIFEST.some((entry) => entry.assetKey === key)));
check("cat declares all required poses", ["idle", "sitting", "standing", "walking", "running"].every((pose) => STORY_V2_ASSET_MANIFEST.find((entry) => entry.assetKey === "cat")?.supportedPoses.includes(pose)));
check("mouse never resolves to cat", resolveStoryVisual("mouse", "animal").assetKey === "mouse" && resolveStoryVisual("mouse", "animal").assetKey !== "cat");
const fallbackEvent = {
  eventId: "fallback",
  sequence: 1,
  sourceText: "A zblorg appeared.",
  normalizedText: "a zblorg appeared",
  provisional: false,
  confidence: 1,
  entities: [{ entityId: "zblorg-1", mention: "zblorg", kind: "object", createIfMissing: true }],
  actions: [{ subjectRef: "zblorg-1", action: "appear" }],
  relations: [],
  environment: [],
};
const fallback = applyStoryEvent(newStoryState(), fallbackEvent, 0);
const fallbackEntity = resolveStoryEntity(fallback.state, "zblorg");
const fallbackPosition = fallbackEntity ? storyEntityPositions(activeStoryScene(fallback.state)).get(fallbackEntity.entityId) : undefined;
check("unsupported asset uses honest labelled fallback", fallback.accepted && fallbackEntity?.visualSource === "placeholder");
check("honest fallback receives a visible layout box", Boolean(fallbackPosition?.width && fallbackPosition?.height));

console.log("\nPose, movement, interruption, and undo");
let motion = newStoryState();
let motionStep = applyText(motion, "A cat appeared beside a tree.", 1);
motion = motionStep.result.state;
motionStep = applyText(motion, "The cat walked toward a house.", 2);
motion = motionStep.result.state;
const walkingCat = resolveStoryEntity(motion, "cat");
const house = resolveStoryEntity(motion, "house");
const walkingPositions = storyEntityPositions(activeStoryScene(motion));
const walkingBox = walkingPositions.get(walkingCat.entityId);
const houseBox = walkingPositions.get(house.entityId);
check("movement ends at deterministic target anchor", Math.abs(walkingBox.x - (houseBox.x - walkingBox.width - 110)) < 0.01);
motionStep = applyText(motion, "The cat ran away from the tree.", 3);
motion = motionStep.result.state;
const runningCat = resolveStoryEntity(motion, "cat");
const runningBox = storyEntityPositions(activeStoryScene(motion)).get(runningCat.entityId);
check("interrupted movement preserves semantic identity", runningCat.entityId === walkingCat.entityId && Object.values(activeStoryScene(motion).entities).filter((entity) => entity.assetKey === "cat").length === 1);
check("pose transition keeps stable element namespace", storyEntityElementPrefix(walkingCat.entityId, 0) === storyEntityElementPrefix(runningCat.entityId, 0));
check("final interrupted state persists", runningCat.state.pose === "running" && runningCat.placement.relation === "away");

console.log("\nExact proof and measured local timing");
const proofStatements = [
  "A cat sat under a tree.",
  "The sun was shining.",
  "Rain began to fall.",
  "The cat stood up and ran toward a house.",
];
let proof = newStoryState();
let proposed = 0;
let accepted = 0;
let rejected = 0;
const timings = [];
for (let index = 0; index < proofStatements.length; index += 1) {
  const applied = applyText(proof, proofStatements[index], index + 1);
  proof = applied.result.state;
  timings.push(applied.ms);
  proposed += applied.result.decisions.length;
  accepted += applied.result.decisions.filter((decision) => decision.accepted).length;
  rejected += applied.result.decisions.filter((decision) => !decision.accepted).length;
}
const proofScene = activeStoryScene(proof);
const proofCat = resolveStoryEntity(proof, "cat");
check("proof stays on one page", proofScene.pageIndices.length === 1 && proofScene.pageIndices[0] === 0);
check("proof has one cat, tree, and house", ["cat", "tree", "house"].every((asset) => Object.values(proofScene.entities).filter((entity) => entity.assetKey === asset).length === 1));
check("proof keeps the same cat identity", proofCat.entityId === "cat-1" && proofCat.state.pose === "running");
check("proof ends with rain active and sunlight replaced", proofScene.environment.rain.active && !proofScene.environment.sunlight.active);
check("proof cat moves toward house", proofCat.placement.relation === "toward" && proofCat.placement.relativeTo === resolveStoryEntity(proof, "house").entityId);
check("all supported proof units are accepted", proposed > 0 && accepted === proposed && rejected === 0, `${accepted}/${proposed}, rejected ${rejected}`);
check("local event reducer stays under 50ms", Math.max(...timings) < 50, `${Math.max(...timings).toFixed(2)}ms`);

console.log(`\n   Local reducer timings: ${timings.map((ms) => `${ms.toFixed(2)}ms`).join(", ")}`);
console.log(`   Proof actions: proposed ${proposed}, accepted ${accepted}, rejected ${rejected}`);
console.log(`\n${"─".repeat(64)}`);
if (failures.length === 0) console.log(`✓ ${pass} Story Mode V2 checks passed`);
else {
  console.log(`${pass} passed, ${failures.length} FAILED:`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exitCode = 1;
}
