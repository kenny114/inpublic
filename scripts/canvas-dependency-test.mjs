import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function typescriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) return typescriptFiles(target);
      return /\.tsx?$/.test(entry.name) ? [target] : [];
    }),
  );
  return nested.flat();
}

const expressionFiles = await typescriptFiles("lib/expression");
const excalidrawLeaks = [];
for (const file of expressionFiles) {
  const source = await readFile(file, "utf8");
  if (/from\s+["']@excalidraw\//.test(source) || /import\s*\(["']@excalidraw\//.test(source)) excalidrawLeaks.push(file);
}
assert.deepEqual(excalidrawLeaks, [], "Expression must not import Excalidraw packages");

const semanticRoots = ["lib/expression/meaning", "lib/expression/world", "lib/expression/intent"];
const observationConsumers = [];
for (const root of semanticRoots) {
  for (const file of await typescriptFiles(root)) {
    const source = await readFile(file, "utf8");
    if (/\bCanvasObservation\b/.test(source)) observationConsumers.push(file);
  }
}
assert.deepEqual(observationConsumers, [], "Meaning, WorldState, and intent must not consume CanvasObservation yet");

console.log("canvas dependency direction tests passed");
