import assert from "node:assert/strict";

import { createExcalidrawCanvasRuntime } from "../lib/canvas/index.ts";
import { skeletonsForScene as boundarySkeletons } from "../lib/canvas/excalidraw/conversion.ts";
import { skeletonsForScene as compatibilitySkeletons } from "../lib/expression/render/excalidraw.ts";

const emptyPatch = () => ({
  added: [],
  moved: [],
  updated: [],
  removed: [],
  connectorsAdded: [],
  connectorsRemoved: [],
  connectorsRerouted: [],
});

const alpha = {
  id: "o-alpha",
  entityId: "alpha",
  regionId: "r-alpha",
  primitive: "node",
  label: "Alpha",
  x: 0,
  y: 0,
  w: 200,
  h: 72,
  weight: 2,
};

const scene = {
  objects: [alpha],
  connectors: [],
  width: 200,
  height: 72,
};

const skeletons = boundarySkeletons(scene, { x: 72, y: 16 });
assert.deepEqual(
  compatibilitySkeletons(scene, { x: 72, y: 16 }),
  skeletons,
  "the compatibility export must preserve the exact conversion result",
);
assert.deepEqual(
  skeletons.map(({ id, type }) => ({ id, type })),
  [
    { id: "o-alpha", type: "rectangle" },
    { id: "o-alpha-label", type: "text" },
  ],
  "one semantic object must retain its established canvas ids",
);

const applied = [];
let appState = { scrollX: -20, scrollY: 30, zoom: { value: 0.8 }, width: 1200, height: 700 };
const runtime = createExcalidrawCanvasRuntime({
  // The contract test owns a deterministic converter: upstream Excalidraw is
  // not the subject under test, and its browser bundle is not imported here.
  convertElements: (items) => items.map((item) => ({
    ...item,
    id: `upstream-${item.id}`,
    width: item.width ?? 0,
    height: item.height ?? 0,
    opacity: Number(item.opacity ?? 100),
  })),
});
runtime.attach({
  updateScene(update) {
    applied.push(update);
    if (update.appState) appState = { ...appState, ...update.appState };
  },
  getAppState() {
    return appState;
  },
  getSceneElements() {
    return applied.at(-1)?.elements ?? [];
  },
});

const untouched = { id: "user-note", type: "text", x: 900, y: 40, width: 120, height: 30, opacity: 100 };
const first = await runtime.applyExpression({
  scene,
  patch: { ...emptyPatch(), added: [alpha] },
  elements: [untouched],
  pen: { originX: 0, originY: 0, x: 0, y: 0, lineH: 0 },
  pageIndex: 0,
});

assert.ok(first.addedIds.includes("o-alpha"), "the first expression adds its stable object id");
assert.strictEqual(first.elements.find((element) => element.id === untouched.id), untouched, "unowned elements remain untouched by reconciliation");
runtime.applyElements(first.elements);
assert.strictEqual(applied.at(-1).elements, first.elements, "the adapter applies the reconciled scene without rewriting it");

const noChange = await runtime.applyExpression({
  scene,
  patch: emptyPatch(),
  elements: first.elements,
  pen: { originX: 0, originY: 0, x: 0, y: 0, lineH: 0 },
  pageIndex: 0,
});
assert.strictEqual(noChange.elements, first.elements, "an empty patch performs no scene destruction or replacement");
assert.deepEqual(noChange.addedIds, []);
assert.deepEqual(noChange.updatedIds, []);
assert.deepEqual(noChange.removedIds, []);

const renamed = { ...alpha, label: "Alpha Prime" };
const renamedScene = { ...scene, objects: [renamed] };
const second = await runtime.applyExpression({
  scene: renamedScene,
  patch: { ...emptyPatch(), updated: [{ object: renamed, prev: alpha }] },
  elements: first.elements,
  pen: { originX: 0, originY: 0, x: 0, y: 0, lineH: 0 },
  pageIndex: 0,
});
assert.ok(second.updatedIds.includes("o-alpha-label"), "changed canvas content updates in place");
assert.ok(!second.addedIds.includes("o-alpha"), "an update never duplicates the semantic object's canvas identity");
assert.ok(second.elements.some((element) => element.id === "o-alpha"), "the semantic object's established canvas id survives the update");
assert.strictEqual(second.elements.find((element) => element.id === untouched.id), untouched, "an update still preserves unrelated elements by reference");

assert.deepEqual(runtime.readViewport(), { scrollX: -20, scrollY: 30, zoom: 0.8, width: 1200, height: 700 });
runtime.applyViewport({ scrollX: 44, scrollY: -12, zoom: 1.25 });
assert.deepEqual(
  applied.at(-1),
  { appState: { scrollX: 44, scrollY: -12, zoom: { value: 1.25 } } },
  "viewport application preserves the pre-boundary updateScene payload",
);

runtime.resetExpressionIdentity();
runtime.attach(null);
runtime.applyElements(second.elements);
runtime.applyViewport({ scrollX: 0, scrollY: 0, zoom: 1 });
assert.equal(applied.length, 2, "a detached adapter is a safe no-op");

console.log("canvas boundary contract tests passed");
