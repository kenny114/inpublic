/** Static Phase 10 routing/ownership checks. */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const interaction = ["lib/interaction/classify.ts", "lib/interaction/orchestrator.ts", "lib/interaction/types.ts"].map(read).join("\n");
const board = read("components/Board.tsx");
const interim = board.slice(board.indexOf("const handleInterim"), board.indexOf("const handleLiveOps"));
const failures = [];
const check = (name, condition) => { if (!condition) failures.push(name); };

check("interaction orchestration imports no Excalidraw implementation", !/@excalidraw|ExcalidrawElement|updateScene/.test(interaction));
check("classification makes no network or model call", !/(fetch\(|Anthropic|generateContent|requestMeaningDelta|requestVisualAgentDecision)/.test(read("lib/interaction/classify.ts")));
check("interim speech never submits to LiveInteractionOrchestrator or VisualAgent", !/(liveInteractionRef\.current\?\.submit|visualAgentRef\.current.*run)/.test(interim));
check("settled speech has one routing entry", (board.match(/const handleSettledInteraction/g) ?? []).length === 1);
check("orchestrator delegates rather than dispatching canvas/editor actions", !/(updateScene|applyElements|setActiveTool|dispatch\(\{\s*type:\s*["']focus)/.test(interaction));
check("routing taxonomy remains bounded", /"express" \| "manipulate" \| "present" \| "ignore"/.test(read("lib/interaction/types.ts")));
check("routing metrics explicitly record zero routing model calls", /routingModelCalls:\s*0/.test(interaction));

if (failures.length) {
  console.error(`Live interaction dependency failures:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Live interaction dependency tests passed");
}
