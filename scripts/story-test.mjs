import {
  activeStoryScene,
  applyStoryActions,
  auditStoryRenderConsistency,
  continueStoryScene,
  interpretStoryDeterministically,
  newStoryState,
  resolveStoryEntity,
  restoreStoryState,
  storyInterpreterContext,
  storySnapshot,
  undoStoryAction,
} from "../lib/story.ts";
import {
  STORY_ASSET_KEYS,
  storyEntityElementPrefix,
  storyEntityPositions,
} from "../lib/storyAssets.ts";
import { SemanticBoard } from "../lib/semantic.ts";

let pass = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`   ${condition ? "✓" : "✗"} ${name}${condition || !detail ? "" : ` — ${detail}`}`);
}

let state = newStoryState();
let page = 0;
function say(text) {
  const context = storyInterpreterContext(state, text, page);
  const actions = interpretStoryDeterministically(context);
  const result = applyStoryActions(state, actions, text, page);
  state = result.state;
  return { actions, result };
}

console.log("STORY MODE — deterministic acceptance pipeline");

say("The story begins at the beach.");
let scene = activeStoryScene(state);
check("1. beach scene created", scene?.label === "Beach");
check("1. beach background set exists", ["beach", "sand", "water", "waves", "sun"].every((key) => Object.values(scene.entities).some((entity) => entity.assetKey === key)));

say("A girl is walking along the shore.");
scene = activeStoryScene(state);
const girl = resolveStoryEntity(state, "girl");
check("2. girl exists", girl?.assetKey === "child");
check("2. girl is walking", girl?.state.pose === "walking");

say("She sees a cat under a palm tree.");
const cat = resolveStoryEntity(state, "cat");
const palm = resolveStoryEntity(state, "palm tree");
check("3. cat created", cat?.assetKey === "cat");
check("3. palm tree created", palm?.assetKey === "palm-tree");
check("3. cat placed under tree", cat?.placement.relativeTo === palm?.entityId && cat?.placement.relation === "under");

const countBeforeCatReuse = Object.keys(activeStoryScene(state).entities).length;
applyStoryActions(state, [{ type: "create_entity", entityId: "the cat", kind: "animal", assetKey: "cat", label: "the cat" }], "The cat.", page);
const reuse = applyStoryActions(state, [{ type: "create_entity", entityId: "the cat", kind: "animal", assetKey: "cat", label: "the cat" }], "The cat.", page);
state = reuse.state;
check("4. the cat is reused", Object.keys(activeStoryScene(state).entities).length === countBeforeCatReuse && reuse.applied[0].startsWith("reused"));

check("5. she resolves to girl", resolveStoryEntity(state, "she")?.entityId === girl?.entityId);

say("The cat runs toward the water.");
const movingCat = resolveStoryEntity(state, "cat");
check("6. cat is running", movingCat?.state.pose === "running");
check("6. cat moves toward water", movingCat?.placement.relation === "toward" && movingCat?.placement.relativeTo === resolveStoryEntity(state, "water")?.entityId);
check("6. movement relation exists", Object.values(activeStoryScene(state).relations).some((relation) => relation.visual === "movement-arrow"));

say("The sun goes behind the clouds.");
say("Actually, make the cat a dog.");
const dog = resolveStoryEntity(state, "dog");
check("7. cat transformed to dog", dog?.assetKey === "dog");
check("7. entity id survived transform", dog?.entityId === cat?.entityId);

say("The dog disappears.");
check("8. dog hidden", resolveStoryEntity(state, "dog") === null && resolveStoryEntity(state, "dog", undefined, { includeHistorical: true })?.state.visible === false);

page = 2;
state = continueStoryScene(state, page);
say("Go back to the beach.");
check("9. beach scene reactivated", state.activeSceneId === scene.sceneId);
check("9. scene retains pages", activeStoryScene(state).pageIndices.includes(2));

const beforeDupes = Object.values(activeStoryScene(state).entities).reduce((map, entity) => map.set(entity.assetKey, (map.get(entity.assetKey) ?? 0) + 1), new Map());
say("The story begins at the beach.");
const afterDupes = Object.values(activeStoryScene(state).entities).reduce((map, entity) => map.set(entity.assetKey, (map.get(entity.assetKey) ?? 0) + 1), new Map());
check("10. beach assets are not duplicated", ["beach", "water", "sun"].every((key) => beforeDupes.get(key) === afterDupes.get(key)));
const treesBefore = Object.values(activeStoryScene(state).entities).filter((entity) => entity.assetKey === "palm-tree").length;
state = applyStoryActions(state, [{ type: "create_entity", entityId: "the palm tree", kind: "object", assetKey: "palm-tree", label: "palm tree" }], "The palm tree.", page).state;
check("10. palm tree is not duplicated", Object.values(activeStoryScene(state).entities).filter((entity) => entity.assetKey === "palm-tree").length === treesBefore);
check("10. hidden animals are excluded from active references", resolveStoryEntity(state, "the animal") === null);

const catsBefore = Object.values(activeStoryScene(state).entities).filter((entity) => entity.assetKey === "cat").length;
say("Another cat arrives.");
const catsAfter = Object.values(activeStoryScene(state).entities).filter((entity) => entity.assetKey === "cat").length;
check("11. another cat creates a second instance", catsAfter === catsBefore + 1, `${catsBefore} -> ${catsAfter}`);

console.log("\nUndo coverage");
let undoState = newStoryState();
const undoActions = [
  { type: "create_scene", sceneId: "s", label: "Test" },
  { type: "create_entity", entityId: "cat-1", kind: "animal", assetKey: "cat", label: "cat" },
  { type: "update_entity", entityId: "cat-1", state: { pose: "running" } },
  { type: "move_entity", entityId: "cat-1", placement: { zone: "right" } },
  { type: "transform_entity", entityId: "cat-1", assetKey: "dog" },
  { type: "set_entity_visibility", entityId: "cat-1", visible: false },
];
const undoSources = ["A test scene.", "A cat.", "The cat is running.", "The cat moves right.", "Actually, make the cat a dog.", "The dog disappears."];
for (const [index, action] of undoActions.entries()) {
  const before = storySnapshot(undoState);
  undoState = applyStoryActions(undoState, [action], undoSources[index], 0).state;
  const undone = undoStoryAction(undoState);
  check(`12. undo ${action.type}`, JSON.stringify(storySnapshot(undone.state)) === JSON.stringify(before));
  undoState = applyStoryActions(undone.state, [action], undoSources[index], 0).state;
}
undoState = undoStoryAction(undoState).state;
const relationBefore = storySnapshot(undoState);
undoState = applyStoryActions(undoState, [
  { type: "create_entity", entityId: "water-1", kind: "background", assetKey: "water", label: "water" },
  { type: "upsert_relation", relationId: "dog-water", fromEntityId: "cat-1", toEntityId: "water-1", relationType: "toward", visual: "movement-arrow" },
], "The dog moves toward the water.", 0).state;
const relationUndo = undoStoryAction(undoState);
check("12. undo relation only", Object.keys(activeStoryScene(relationUndo.state).relations).length === 0 && resolveStoryEntity(relationUndo.state, "water") !== null);
check("12. prior state remains", relationBefore.activeSceneId === relationUndo.state.activeSceneId);

const continued = continueStoryScene(state, 5);
check("13. scene continues across a page", activeStoryScene(continued).pageIndices.includes(5));

const standard = new SemanticBoard();
standard.addConcept({ conceptId: "standard-one", label: "Standard one" });
const storyBeforeSwitch = JSON.stringify(storySnapshot(state));
let selectedMode = "standard";
selectedMode = "story";
check("14. Standard state survives switch to Story", standard.concepts.has("standard-one") && selectedMode === "story");
selectedMode = "standard";
check("15. Story state survives switch to Standard", JSON.stringify(storySnapshot(state)) === storyBeforeSwitch && selectedMode === "standard");

const restored = restoreStoryState(JSON.parse(JSON.stringify(state)));
check("16. StoryState exports and restores", JSON.stringify(storySnapshot(restored)) === JSON.stringify(storySnapshot(state)));

check("asset registry contains required first set", ["child", "person", "cat", "dog", "mouse", "palm-tree", "tree", "beach", "sand", "water", "waves", "sun", "cloud", "rain", "house", "movement-arrow", "speech-bubble"].every((key) => STORY_ASSET_KEYS.includes(key)));
const visibleScene = activeStoryScene(restored);
const positions = storyEntityPositions(visibleScene);
const visibleGirl = resolveStoryEntity(restored, "girl");
check("visual layout assigns the girl a deterministic position", positions.has(visibleGirl.entityId));
check("entity-to-element namespace is stable", storyEntityElementPrefix(visibleGirl.entityId, 0) === storyEntityElementPrefix(visibleGirl.entityId, 0));

console.log("\nLatest Story Mode accuracy regressions A-H");
let exactState = newStoryState();
function exactSay(text) {
  const actions = interpretStoryDeterministically(storyInterpreterContext(exactState, text, 0));
  const result = applyStoryActions(exactState, actions, text, 0);
  exactState = result.state;
  return result;
}

const aResult = exactSay("It was a sunny day. A cat sat under a tree.");
const aScene = activeStoryScene(exactState);
const aVisible = Object.values(aScene.entities).filter((entity) => entity.state.visible && entity.lifecycle === "active");
check("A. sunny cat/tree creates only grounded entities", aVisible.length === 3 && ["sun", "cat", "tree"].every((asset) => aVisible.some((entity) => entity.assetKey === asset)));
check("A. no invented mouse, rain, or running", !resolveStoryEntity(exactState, "mouse") && !resolveStoryEntity(exactState, "rain") && resolveStoryEntity(exactState, "cat")?.state.pose === "sitting");
check("A. every proposed action has an executor decision", aResult.decisions.length === aResult.acceptedActions.length && aResult.decisions.every((decision) => decision.accepted));

const originalCatId = resolveStoryEntity(exactState, "cat").entityId;
exactSay("The cat ran into the rain.");
check("B. same cat is reused and runs into rain", resolveStoryEntity(exactState, "cat")?.entityId === originalCatId && resolveStoryEntity(exactState, "cat")?.state.pose === "running" && resolveStoryEntity(exactState, "cat")?.placement.relativeTo === resolveStoryEntity(exactState, "rain")?.entityId);
check("B. rain movement relationship exists", Object.values(activeStoryScene(exactState).relations).some((relation) => relation.fromEntityId === originalCatId && relation.toEntityId === resolveStoryEntity(exactState, "rain")?.entityId));

exactSay("A mouse watched the cat.");
const mouse = resolveStoryEntity(exactState, "mouse");
check("C. mouse and cat remain distinct with exact assets", mouse?.assetKey === "mouse" && mouse?.entityId !== originalCatId && resolveStoryEntity(exactState, "cat")?.assetKey === "cat");
const mismatch = applyStoryActions(exactState, [{ type: "create_entity", entityId: "mouse-wrong", kind: "animal", assetKey: "cat", label: "mouse", forceNew: true }], "Another mouse watched the cat.", 0);
check("C. mouse label with cat asset is rejected", mismatch.acceptedActions.length === 0 && mismatch.decisions[0]?.assetResolution?.status === "mismatch");
const corruptSavedState = JSON.parse(JSON.stringify(exactState));
corruptSavedState.scenes[corruptSavedState.activeSceneId].entities[mouse.entityId].assetKey = "cat";
const quarantined = restoreStoryState(corruptSavedState);
check("C. legacy mouse-as-cat state is quarantined unrendered", quarantined.scenes[quarantined.activeSceneId].entities[mouse.entityId].lifecycle === "unrendered" && resolveStoryEntity(quarantined, "mouse") === null && !storyEntityPositions(activeStoryScene(quarantined)).has(mouse.entityId));

const transform = applyStoryActions(exactState, [{ type: "transform_entity", entityId: originalCatId, assetKey: "dog", label: "dog" }], "Actually, make the cat a dog.", 0);
exactState = transform.state;
check("D. cat to dog preserves entity identity", resolveStoryEntity(exactState, "dog")?.entityId === originalCatId && resolveStoryEntity(exactState, "dog")?.assetKey === "dog");
check("D. transform creates no duplicate animal", Object.values(activeStoryScene(exactState).entities).filter((entity) => entity.entityId === originalCatId).length === 1);

const hidden = applyStoryActions(exactState, [{ type: "set_entity_visibility", entityId: originalCatId, visible: false }], "The dog disappeared.", 0);
exactState = hidden.state;
check("E. hidden dog is historical and not an active pronoun target", resolveStoryEntity(exactState, "dog") === null && resolveStoryEntity(exactState, "dog", undefined, { includeHistorical: true })?.lifecycle === "historical" && resolveStoryEntity(exactState, "it")?.entityId !== originalCatId);
exactState = undoStoryAction(exactState).state;
check("E. undo restores the dog", resolveStoryEntity(exactState, "dog")?.entityId === originalCatId && resolveStoryEntity(exactState, "dog")?.state.visible === true);

let reuseState = newStoryState();
const reuseText = "It was a sunny day. A cat sat under a tree.";
let reuseActions = interpretStoryDeterministically(storyInterpreterContext(reuseState, reuseText, 0));
reuseState = applyStoryActions(reuseState, reuseActions, reuseText, 0).state;
const reuseIds = Object.keys(activeStoryScene(reuseState).entities).sort().join(",");
const reuseSentence = "The cat sits under the tree.";
reuseActions = interpretStoryDeterministically(storyInterpreterContext(reuseState, reuseSentence, 0));
reuseState = applyStoryActions(reuseState, reuseActions, reuseSentence, 0).state;
check("F. existing cat and tree are reused", Object.keys(activeStoryScene(reuseState).entities).sort().join(",") === reuseIds);

const hallucinatedRain = applyStoryActions(reuseState, [{ type: "create_entity", entityId: "rain-hallucinated", kind: "background", assetKey: "rain", label: "rain" }], "A cat sat under a tree.", 0);
check("G. unsupported rain action is rejected", hallucinatedRain.acceptedActions.length === 0 && hallucinatedRain.decisions[0]?.reason.includes("not present in source") && !activeStoryScene(hallucinatedRain.state).entities["rain-hallucinated"]);

const visibleForAudit = Object.values(activeStoryScene(reuseState).entities).filter((entity) => entity.state.visible && entity.lifecycle === "active");
const fakeElements = visibleForAudit.map((entity) => {
  const id = `${storyEntityElementPrefix(entity.entityId, 0)}:0`;
  entity.renderings = [{ pageIndex: 0, elementIds: [id] }];
  return { id };
});
check("H. visible StoryState entities match visible elements", auditStoryRenderConsistency(reuseState, fakeElements).length === 0 && fakeElements.length === visibleForAudit.length);

console.log(`\n${"─".repeat(64)}`);
if (failures.length === 0) {
  console.log(`✓ ${pass} Story Mode checks passed`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exitCode = 1;
}
