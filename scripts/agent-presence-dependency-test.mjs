/** Static Phase 9 ownership and non-interference checks. */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const presence = ["lib/canvas/presence/types.ts", "lib/canvas/presence/controller.ts", "lib/canvas/presence/overlay.tsx"].map(read).join("\n");
const actionSchema = read("lib/visual-actions/schema.ts");
const observation = read("lib/canvas/excalidraw/observation.ts");
const loop = read("lib/agent/loop.ts");
const persistence = ["lib/persist.ts", "lib/expression/persistence.ts"].map(read).join("\n");
const failures = [];
const check = (name, condition) => { if (!condition) failures.push(name); };

check("presence is Canvas-owned", fs.existsSync(path.join(root, "lib/canvas/presence/controller.ts")));
check("presence overlay cannot receive pointer input", /pointer-events-none/.test(presence));
check("presence never writes Excalidraw scene, tools, cursor, or collaborators", !/(updateScene|setActiveTool|setCursor|collaborators)/.test(presence));
check("presence is absent from CanvasObservation normalization and revision hashes", !/presence/i.test(observation));
check("presence is absent from session and semantic persistence", !/AgentPresence|agentPresence/.test(persistence));
check("VisualAction remains semantic and geometry-free", !/presence|\b(x|y|width|height)\s*:/.test(actionSchema));
check("agent emits semantic targets without coordinates", /entityId: action\.entityId/.test(loop) && !/target:\s*\{[^}]*\b(x|y)\s*:/.test(loop));
check("presence lifecycle makes no model or network call", !/(fetch\(|Anthropic|generateContent|complete\()/.test(presence));

if (failures.length) {
  console.error(`Agent presence dependency failures:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Agent presence dependency tests passed");
}
