/**
 * Visual Action Engine acceptance.
 *
 * Runs the twelve specified story sentences through the deterministic
 * interpreter, the executor, and the layout resolver — no network, no model.
 */
import {
  activeStoryScene,
  applyStoryActions,
  auditStoryRenderConsistency,
  interpretStoryDeterministically,
  newStoryState,
  parseStoryActions,
  resolveStoryEntity,
  resolveStoryVisual,
  restoreStoryState,
  storyInterpreterContext,
  storyPoseActionCompatible,
  storySemanticText,
  undoStoryAction,
} from "../lib/story.ts";
import {
  storyEntityElementPrefix,
  storyEntityPositions,
  storyEntitySize,
  storyPoseVariants,
} from "../lib/storyAssets.ts";

let pass = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`   ${condition ? "✓" : "✗"} ${name}${condition || !detail ? "" : ` — ${detail}`}`);
}

let state = newStoryState();
let page = 0;
const latencies = [];

function say(text) {
  const started = process.hrtime.bigint();
  const context = storyInterpreterContext(state, text, page);
  const actions = interpretStoryDeterministically(context);
  const result = applyStoryActions(state, actions, text, page);
  state = result.state;
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  latencies.push({ text, ms, requested: actions.length, accepted: result.acceptedActions.length });
  return result;
}

const entity = (ref) => resolveStoryEntity(state, ref);
const visible = () => Object.values(activeStoryScene(state)?.entities ?? {})
  .filter((e) => e.state.visible !== false && e.lifecycle === "active");
const assetsOnStage = () => visible().map((e) => e.assetKey ?? `composed:${e.recipe}`);

console.log("VISUAL ACTION ENGINE — twelve specified sentences\n");

// 1
say("It was a sunny day.");
check("1. sun appears", entity("sun")?.assetKey === "sun");
check("1. nothing else is invented", visible().length === 1, assetsOnStage().join(","));

// 2
say("A cat sat under a tree.");
const catId = entity("cat")?.entityId;
check("2. cat appears in a sitting pose", entity("cat")?.state.pose === "sitting");
check("2. tree appears", entity("tree")?.assetKey === "tree");
check("2. cat is placed under the tree",
  entity("cat")?.placement.relation === "under" &&
  entity("cat")?.placement.relativeTo === entity("tree")?.entityId);
check("2. sitting cat has no action", !entity("cat")?.state.action);

// 3
say("The cat stood up.");
check("3. same cat is reused", entity("cat")?.entityId === catId);
check("3. pose becomes standing", entity("cat")?.state.pose === "standing");
check("3. no second cat was created",
  visible().filter((e) => e.assetKey === "cat").length === 1);

// 4
say("The cat walked toward the water.");
check("4. water appears", entity("water")?.assetKey === "water");
check("4. pose becomes walking", entity("cat")?.state.pose === "walking");
check("4. action is moving", entity("cat")?.state.action === "moving");
check("4. direction is toward the water",
  entity("cat")?.state.direction === "toward" &&
  entity("cat")?.placement.relativeTo === entity("water")?.entityId);
check("4. identity survived", entity("cat")?.entityId === catId);

// 5
say("The cat ran away from the tree.");
check("5. pose becomes running", entity("cat")?.state.pose === "running");
check("5. action is running", entity("cat")?.state.action === "running");
check("5. direction is away", entity("cat")?.state.direction === "away");
check("5. moved away from the tree",
  entity("cat")?.placement.relation === "away" &&
  entity("cat")?.placement.relativeTo === entity("tree")?.entityId);
check("5. motion lines were added", entity("cat")?.effects.includes("motion-lines"));
check("5. away relation recorded",
  Object.values(activeStoryScene(state).relations)
    .some((r) => r.fromEntityId === catId && r.relationType === "moves-away-from"));

// 6
const carResult = say("A red car moved down the road.");
const carId = entity("car")?.entityId;
check("6. road appears", entity("road")?.assetKey === "road");
check("6. car appears", Boolean(carId));
check("6. car is red", entity("car")?.state.appearance?.color === "red");
check("6. car is driving and moving",
  entity("car")?.state.pose === "driving" && entity("car")?.state.action === "moving");
check("6. car is placed on the road",
  entity("car")?.placement.relation === "on" &&
  entity("car")?.placement.relativeTo === entity("road")?.entityId);
check("6. car shows movement", entity("car")?.effects.includes("motion-lines"));
check("6. every car action was accepted",
  carResult.decisions.every((d) => d.accepted),
  carResult.decisions.filter((d) => !d.accepted).map((d) => d.reason).join("; "));

// 7
say("The car turned left and stopped.");
check("7. same car is reused", entity("car")?.entityId === carId);
check("7. direction is left", entity("car")?.state.direction === "left");
check("7. action becomes stopped", entity("car")?.state.action === "stopped");
check("7. pose becomes stopped", entity("car")?.state.pose === "stopped");
check("7. motion lines were removed", !entity("car")?.effects.includes("motion-lines"));

// 8
say("The cat disappeared.");
check("8. cat is hidden", entity("cat") === null);
check("8. cat is retained as historical",
  resolveStoryEntity(state, "cat", undefined, { includeHistorical: true })?.entityId === catId);
state = undoStoryAction(state).state;
check("8. undo restores the cat", entity("cat")?.entityId === catId && entity("cat")?.state.visible === true);

// 9
say("A strange machine appeared.");
const machine = entity("machine");
check("9. machine exists", Boolean(machine));
check("9. machine is composed, not an unrelated asset",
  machine?.assetKey === undefined && machine?.visualSource === "composed",
  `${machine?.visualSource}/${machine?.assetKey}`);
check("9. machine uses the device recipe", machine?.recipe === "device");
check("9. no unrelated asset was borrowed",
  !visible().some((e) => e.label === "machine" && e.assetKey));

// 10
let rainState = newStoryState();
function rainSay(text) {
  const actions = interpretStoryDeterministically(storyInterpreterContext(rainState, text, 0));
  const result = applyStoryActions(rainState, actions, text, 0);
  rainState = result.state;
  return result;
}
rainSay("A cat sat under a tree.");
rainSay("The cat ran in the rain.");
check("10. rain appears when it is spoken", resolveStoryEntity(rainState, "rain")?.assetKey === "rain");
check("10. cat is running", resolveStoryEntity(rainState, "cat")?.state.pose === "running");

// 11
let dryState = newStoryState();
function drySay(text) {
  const actions = interpretStoryDeterministically(storyInterpreterContext(dryState, text, 0));
  const result = applyStoryActions(dryState, actions, text, 0);
  dryState = result.state;
  return result;
}
drySay("A cat sat under a tree.");
const dryResult = drySay("The cat ran away.");
check("11. cat is running", resolveStoryEntity(dryState, "cat")?.state.pose === "running");
check("11. no rain from a mis-heard 'ran'", resolveStoryEntity(dryState, "rain") === null);
check("11. motion lines only", resolveStoryEntity(dryState, "cat")?.effects.includes("motion-lines"));
const injectedRain = applyStoryActions(dryState, [
  { type: "create_entity", entityId: "rain-1", kind: "background", assetKey: "rain", label: "rain" },
], "The cat ran away.", 0);
check("11. an injected rain action is rejected with a reason",
  injectedRain.acceptedActions.length === 0 &&
  injectedRain.decisions[0].reason.includes("not present in source"),
  injectedRain.decisions[0]?.reason);

// 12
let bothState = newStoryState();
const bothText = "It was sunny, and the cat sat under the tree.";
const bothActions = interpretStoryDeterministically(storyInterpreterContext(bothState, bothText, 0));
const bothResult = applyStoryActions(bothState, bothActions, bothText, 0);
bothState = bothResult.state;
const bothVisible = Object.values(activeStoryScene(bothState).entities).filter((e) => e.state.visible !== false);
check("12. sun, cat and tree all appear",
  ["sun", "cat", "tree"].every((a) => bothVisible.some((e) => e.assetKey === a)),
  bothVisible.map((e) => e.assetKey).join(","));
check("12. cat is sitting", resolveStoryEntity(bothState, "cat")?.state.pose === "sitting");
check("12. under-tree relationship exists",
  resolveStoryEntity(bothState, "cat")?.placement.relation === "under");

console.log("\nEngine invariants");

check("pose and action stay separable",
  storyPoseActionCompatible("sitting", "running") === false &&
  storyPoseActionCompatible("running", "moving") === true);

check("unknown nouns never borrow a prepared asset",
  resolveStoryVisual("machine", "object").assetKey === undefined &&
  resolveStoryVisual("contraption", "object").visualSource === "composed" &&
  resolveStoryVisual("zblorg", "object").visualSource === "placeholder");

check("prepared assets win over composition",
  resolveStoryVisual("car", "vehicle").visualSource === "asset" &&
  resolveStoryVisual("cat", "animal").assetKey === "cat");

check("pose variants are declared for the drawn families",
  storyPoseVariants("cat").includes("sleeping") &&
  storyPoseVariants("car").includes("stopped") &&
  storyPoseVariants("child").includes("jumping") &&
  storyPoseVariants("tree").length === 0);

check("appearance size changes the drawn box", (() => {
  const base = storyEntitySize({ assetKey: "car", label: "car", kind: "vehicle", state: { visible: true } });
  const big = storyEntitySize({ assetKey: "car", label: "car", kind: "vehicle", state: { visible: true, appearance: { size: "large" } } });
  return big.width > base.width;
})());

check("high-confidence correction is used for meaning, low is not",
  storySemanticText("the cat ran in the rain", { normalizedText: "the cat ran in the rain", confidence: 0.95 }) === "the cat ran in the rain" &&
  storySemanticText("the cat rain away", { normalizedText: "the cat ran away", confidence: 0.4 }) === "the cat rain away" &&
  storySemanticText("the cat rain away", { normalizedText: "the cat ran away", confidence: 0.9 }) === "the cat ran away");

check("new action types survive the wire parser", (() => {
  const parsed = parseStoryActions({
    actions: [
      { type: "add_visual_effect", entityId: "cat-1", effect: "motion-lines" },
      { type: "remove_visual_effect", entityId: "cat-1", effect: "smoke" },
      { type: "remove_relation", relationId: "cat-tree" },
      { type: "update_entity", entityId: "cat-1", pose: "running", action: "running", direction: "away", targetEntityId: "tree-1" },
      { type: "create_entity", entityId: "m-1", kind: "object", label: "machine" },
      { type: "add_visual_effect", entityId: "cat-1", effect: "nonsense" },
    ],
  });
  const update = parsed.find((a) => a.type === "update_entity");
  return parsed.length === 5 &&
    update.state.pose === "running" &&
    update.state.action === "running" &&
    update.state.direction === "away" &&
    update.targetEntityId === "tree-1" &&
    parsed.some((a) => a.type === "create_entity" && a.assetKey === undefined);
})());

check("every visible entity has a layout box", (() => {
  const scene = activeStoryScene(state);
  const positions = storyEntityPositions(scene);
  return visible().every((e) => positions.has(e.entityId));
})());

check("hidden entities get no layout box", (() => {
  const hidden = applyStoryActions(state, [
    { type: "set_entity_visibility", entityId: catId, visible: false },
  ], "The cat disappeared.", page).state;
  return !storyEntityPositions(activeStoryScene(hidden)).has(catId);
})());

check("element ids stay namespaced to their entity", (() => {
  const scene = activeStoryScene(state);
  for (const e of visible()) {
    e.renderings = [{ pageIndex: 0, elementIds: [`${storyEntityElementPrefix(e.entityId, 0)}:0`] }];
  }
  const elements = visible().map((e) => ({ id: e.renderings[0].elementIds[0] }));
  return auditStoryRenderConsistency({ ...state, scenes: { [scene.sceneId]: scene } }, elements).length === 0;
})());

check("StoryState round-trips with the new fields", (() => {
  const restored = restoreStoryState(JSON.parse(JSON.stringify(state)));
  const car = resolveStoryEntity(restored, "car");
  const m = resolveStoryEntity(restored, "machine");
  return car?.state.appearance?.color === "red" && m?.visualSource === "composed";
})());

check("pre-engine saved state is migrated, not discarded", (() => {
  const legacy = {
    activeSceneId: "s",
    scenes: {
      s: {
        sceneId: "s", label: "S", pageIndices: [0], locationEntityId: "",
        entities: {
          "cat-1": {
            entityId: "cat-1", kind: "animal", assetKey: "cat", label: "cat", aliases: [],
            state: { visible: true, pose: "sitting" }, placement: {}, renderings: [],
            createdAt: 1, lastMentionedAt: 1, lifecycle: "active",
          },
        },
        relations: {},
      },
    },
    activeEntityIds: ["cat-1"], recentEntityIds: ["cat-1"], operations: [],
  };
  const restored = restoreStoryState(legacy);
  const cat = restored.scenes.s.entities["cat-1"];
  return cat.visualSource === "asset" && Array.isArray(cat.effects) && cat.effects.length === 0;
})());

console.log("\nLocal latency, interpreter + executor (no network)");
for (const entry of latencies) {
  console.log(`   ${entry.ms.toFixed(2)}ms  ${entry.accepted}/${entry.requested} actions  "${entry.text}"`);
}
const worst = Math.max(...latencies.map((l) => l.ms));
check(`local pipeline stays well under one frame budget (worst ${worst.toFixed(2)}ms)`, worst < 50);

console.log(`\n${"─".repeat(64)}`);
if (failures.length === 0) {
  console.log(`✓ ${pass} Visual Action Engine checks passed`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exitCode = 1;
}
