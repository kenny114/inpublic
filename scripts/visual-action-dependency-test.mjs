/** Static Phase 7 ownership checks. */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const filesUnder = (directory) => fs.readdirSync(path.join(root, directory), { recursive: true })
  .filter((file) => typeof file === "string" && file.endsWith(".ts"))
  .map((file) => path.join(directory, file));

const failures = [];
const check = (name, condition) => {
  if (!condition) failures.push(name);
};

const publicSchema = read("lib/visual-actions/schema.ts");
const dispatcher = read("lib/visual-actions/dispatcher.ts");
const semanticSources = [
  ...filesUnder("lib/expression/meaning"),
  ...filesUnder("lib/expression/world"),
  "lib/expression/actions.ts",
].map(read).join("\n");

check("public action schema has no coordinate fields", !/\b(x|y|width|height)\s*:/.test(publicSchema));
check("public action schema has no raw canvas operation", !/(createRectangle|createArrow|updateScene|elementId)/.test(publicSchema));
check("VisualAction implementation imports no Excalidraw package", !/@excalidraw\//.test(`${publicSchema}\n${dispatcher}`));
check("dispatcher contains no model/provider call", !/(requestMeaningDelta|Anthropic|GoogleGenAI|generateContent|fetch\()/.test(dispatcher));
check("Meaning/world actions do not consume CanvasObservation", !/CanvasObservation/.test(semanticSources));
check("Meaning/world actions do not depend on VisualAction dispatcher", !/visual-actions/.test(semanticSources));
check("only orchestration depends on Canvas", /\.\.\/canvas/.test(dispatcher) && !/\.\.\/canvas/.test(read("lib/expression/actions.ts")));

if (failures.length) {
  console.error(`VisualAction dependency failures:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("VisualAction dependency tests passed");
}
