import {
  CAMERA_RULES,
  READABILITY_CONTRACT,
  effectiveTextSize,
  initialCompositionState,
  proposeCamera,
  recordingViewport,
  rectsOverlap,
  worldToScreen,
} from "../lib/composition.ts";
import { activeStoryScene, newStoryState, resolveStoryEntity } from "../lib/story.ts";
import { applyStoryEvent, compileStoryEvent } from "../lib/storyV2.ts";
import { STORY_BOUNDS, storyEntityPositions } from "../lib/storyAssets.ts";
import { PAGE_PAD, PAGE_W, pageOrigin } from "../lib/ops.ts";

let pass = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`   ${condition ? "✓" : "✗"} ${name}${condition || !detail ? "" : ` — ${detail}`}`);
};

const viewport = recordingViewport(1528, 698);
const baseInput = {
  viewport,
  focalSubject: "primary",
  activeCluster: "page:0",
  reason: "important content left the safe frame",
  now: 10_000,
};

console.log("VISUAL COMPOSITION — recording-space regressions\n");

const unreadable = proposeCamera({
  ...baseInput,
  state: initialCompositionState(),
  currentCamera: { scrollX: 0, scrollY: 0, zoom: 0.7 },
  focalBounds: { x: 80, y: 120, width: 520, height: 260 },
  text: [{ id: "support", fontSize: 21, role: "supporting" }],
});
check("minimum effective font size is enforced", unreadable.move && unreadable.effectiveTextSize >= READABILITY_CONTRACT.supporting,
  `${unreadable.effectiveTextSize}px`);

const collisionWorld = { x: 1210, y: 45, width: 180, height: 100 };
const collision = proposeCamera({
  ...baseInput,
  state: initialCompositionState(),
  currentCamera: { scrollX: 0, scrollY: 0, zoom: 1 },
  focalBounds: collisionWorld,
});
const collisionScreen = worldToScreen(collisionWorld, collision.target);
check("webcam-safe collision is removed", collision.webcamCollisions === 0 && !rectsOverlap(collisionScreen, viewport.webcamBounds));

const stable = proposeCamera({
  ...baseInput,
  state: initialCompositionState(),
  currentCamera: { scrollX: 80, scrollY: 40, zoom: 1 },
  focalBounds: { x: 100, y: 80, width: 420, height: 260 },
  text: [{ id: "primary", fontSize: 26, role: "primary" }],
});
check("minor addition already in frame does not move camera", !stable.move);

const hysteresis = proposeCamera({
  ...baseInput,
  state: { ...initialCompositionState(), lastMovementAt: 0 },
  currentCamera: { scrollX: -20, scrollY: -20, zoom: 0.96 },
  focalBounds: { x: 80, y: 60, width: 980, height: 563 },
  explicitNavigation: true,
});
check("small zoom difference is held by hysteresis", hysteresis.target.zoom === 0.96,
  `${hysteresis.target.zoom}`);
check("zoom change is bounded", Math.abs(hysteresis.target.zoom - 0.96) <= CAMERA_RULES.maximumZoomChange);

let story = newStoryState();
const statements = [
  "A cat appeared.",
  "The cat sat under a tree.",
  "The sun was shining.",
  "Rain began to fall.",
  "The cat ran toward a house.",
  "A car appeared.",
  "The cat ran away from the car.",
];
for (let index = 0; index < statements.length; index += 1) {
  const event = compileStoryEvent(statements[index], { state: story, sequence: index + 1 });
  story = applyStoryEvent(story, event, 0).state;
}
const scene = activeStoryScene(story);
const positions = storyEntityPositions(scene);
const origin = pageOrigin(0);
const stage = { x: origin.x + STORY_BOUNDS.x, y: origin.y + STORY_BOUNDS.y, width: STORY_BOUNDS.width, height: STORY_BOUNDS.height };
check("every Story entity remains inside one stage", [...positions.values()].every((box) =>
  box.x >= stage.x && box.y >= stage.y && box.x + box.width <= stage.x + stage.width && box.y + box.height <= stage.y + stage.height));
const cat = resolveStoryEntity(story, "cat");
const tree = resolveStoryEntity(story, "tree");
const house = resolveStoryEntity(story, "house");
const car = resolveStoryEntity(story, "car");
check("stable entity identity survives all pose changes", cat?.entityId === "cat-1" && Object.values(scene.entities).filter((entity) => entity.assetKey === "cat").length === 1);
check("toward destination exists without moving the tree", Boolean(tree && house && positions.get(tree.entityId).x < positions.get(house.entityId).x));
check("away-from affects actual placement", Boolean(cat && car && Math.abs(positions.get(cat.entityId).x - positions.get(car.entityId).x) > 100));
check("superseded movement relation is removed", Object.values(scene.relations).filter((relation) =>
  relation.fromEntityId === cat.entityId && ["toward", "away-from"].includes(relation.relationType)).length === 1);
check("Story stays on one page", scene.pageIndices.length === 1 && scene.pageIndices[0] === 0);

const storyFrame = proposeCamera({
  ...baseInput,
  state: initialCompositionState(),
  currentCamera: { scrollX: 0, scrollY: 0, zoom: 1 },
  focalBounds: stage,
  activeCluster: scene.sceneId,
  focalSubject: cat.entityId,
  primarySubjectChanged: true,
});
check("Story stage has useful occupied-canvas ratio", storyFrame.occupiedCanvasRatio >= 0.55,
  String(storyFrame.occupiedCanvasRatio));
check("Story stage avoids webcam safe region", storyFrame.webcamCollisions === 0);

const standardFrame = { x: PAGE_PAD, y: PAGE_PAD, width: PAGE_W - PAGE_PAD * 2, height: 470 };
const returned = proposeCamera({
  ...baseInput,
  state: storyFrame.state,
  currentCamera: storyFrame.target,
  focalBounds: standardFrame,
  activeCluster: "page:0",
  focalSubject: "inpublic",
  primarySubjectChanged: true,
  now: 12_000,
  text: [{ id: "standard-primary", fontSize: 26, role: "primary" }],
});
check("mode switch preserves readable composition", returned.effectiveTextSize >= READABILITY_CONTRACT.primary && returned.target.zoom >= 0.84);

console.log(`\n   safe frame: ${JSON.stringify(viewport.safeBounds)}`);
console.log(`   webcam region: ${JSON.stringify(viewport.webcamBounds)}`);
console.log(`   final Story occupied ratio: ${storyFrame.occupiedCanvasRatio}`);
console.log(`\n${"─".repeat(64)}`);
if (failures.length === 0) console.log(`✓ ${pass} visual composition checks passed`);
else {
  console.log(`${pass} passed, ${failures.length} FAILED:`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exitCode = 1;
}
