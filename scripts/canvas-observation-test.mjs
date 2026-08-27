import assert from "node:assert/strict";

import { createExcalidrawCanvasRuntime } from "../lib/canvas/index.ts";

let elements = [];
let appState = {
  scrollX: 0,
  scrollY: 0,
  zoom: { value: 1 },
  width: 1280,
  height: 720,
  selectedElementIds: {},
  selectedGroupIds: {},
};
let writes = 0;

const runtime = createExcalidrawCanvasRuntime();
runtime.attach({
  updateScene() {
    writes += 1;
  },
  getSceneElements() {
    return elements;
  },
  getAppState() {
    return appState;
  },
});

const empty = runtime.observe();
assert.ok(empty, "an attached empty canvas returns an observation");
assert.deepEqual(empty.elements, []);
assert.deepEqual(empty.selection, { elementIds: [], groupIds: [] });

elements = [
  {
    id: "shape-1",
    type: "rectangle",
    x: 20,
    y: 30,
    width: 160,
    height: 80,
    angle: 0,
    version: 1,
    groupIds: ["group-1"],
    frameId: "frame-1",
    containerId: null,
    strokeColor: "#000",
  },
];
const added = runtime.observe();
assert.ok(added);
assert.deepEqual(added.elements, [
  {
    id: "shape-1",
    type: "rectangle",
    x: 20,
    y: 30,
    width: 160,
    height: 80,
    angle: 0,
    groupIds: ["group-1"],
    frameId: "frame-1",
    containerId: null,
    revision: 1,
    order: 0,
  },
]);
assert.notEqual(added.revisions.scene, empty.revisions.scene, "adding an element changes the scene revision");

const unchanged = runtime.observe();
assert.deepEqual(unchanged, added, "unchanged live state produces the same complete observation");

elements = [{ ...elements[0], x: 95, y: 44, version: 2 }];
const moved = runtime.observe();
assert.ok(moved);
assert.equal(moved.elements[0].id, added.elements[0].id, "movement preserves canvas identity");
assert.deepEqual({ x: moved.elements[0].x, y: moved.elements[0].y }, { x: 95, y: 44 });
assert.notEqual(moved.revisions.scene, added.revisions.scene, "movement changes the scene revision");

appState = { ...appState, selectedElementIds: { "shape-1": true }, selectedGroupIds: { "group-1": true } };
const selected = runtime.observe();
assert.ok(selected);
assert.deepEqual(selected.selection, { elementIds: ["shape-1"], groupIds: ["group-1"] });
assert.equal(selected.revisions.scene, moved.revisions.scene, "selection alone does not change scene revision");
assert.notEqual(selected.revisions.selection, moved.revisions.selection, "selection has its own revision");

appState = { ...appState, scrollX: -120, scrollY: 60, zoom: { value: 1.4 } };
const panned = runtime.observe();
assert.ok(panned);
assert.deepEqual(panned.viewport, { scrollX: -120, scrollY: 60, zoom: 1.4, width: 1280, height: 720 });
assert.equal(panned.revisions.scene, selected.revisions.scene, "viewport alone does not change scene revision");
assert.equal(panned.revisions.selection, selected.revisions.selection, "viewport alone does not change selection revision");
assert.notEqual(panned.revisions.viewport, selected.revisions.viewport, "viewport has its own revision");

elements = [];
appState = { ...appState, selectedElementIds: {}, selectedGroupIds: {} };
const deleted = runtime.observe();
assert.ok(deleted);
assert.deepEqual(deleted.elements, [], "deleted live elements disappear from the normalized scene");
assert.notEqual(deleted.revisions.scene, panned.revisions.scene, "deletion changes the scene revision");

assert.equal(writes, 0, "observation never writes to the editor");
runtime.attach(null);
assert.equal(runtime.observe(), null, "a detached canvas has no live observation");

console.log("canvas observation tests passed");
