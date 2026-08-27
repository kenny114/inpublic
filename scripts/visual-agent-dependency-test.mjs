/** Static Phase 8 ownership and leakage checks. */

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

const agentFiles = filesUnder("lib/agent");
const agent = agentFiles.map(read).join("\n");
const deterministicAgent = ["lib/agent/types.ts", "lib/agent/context.ts", "lib/agent/decide.ts", "lib/agent/loop.ts"].map(read).join("\n");
const canvas = filesUnder("lib/canvas").map(read).join("\n");
const expression = filesUnder("lib/expression").map(read).join("\n");
const actionSchema = read("lib/visual-actions/schema.ts");

check("Agent imports no Excalidraw package", !/@excalidraw\//.test(agent));
check("Agent contains no raw editor mutation", !/(updateScene|applyElements\(|ExcalidrawElement)/.test(agent));
check("AgentDecision embeds the existing VisualAction schema", /action:\s*VisualActionSchema/.test(read("lib/agent/types.ts")));
check("AgentDecision exposes no action arrays", !/actions:\s*z\./.test(read("lib/agent/types.ts")));
check("deterministic loop contains no model/provider call", !/(Anthropic|generateContent|complete\(|fetch\()/.test(deterministicAgent));
check("Canvas does not depend on Agent", !/(\.\.\/agent|@\/lib\/agent)/.test(canvas));
check("Expression does not depend on Agent", !/(\.\.\/agent|@\/lib\/agent)/.test(expression));
check("VisualAction public schema remains geometry-free", !/\b(x|y|width|height)\s*:/.test(actionSchema));
check("Agent orchestrates Canvas observation and VisualAction dispatch", /observe\(\)/.test(read("lib/agent/loop.ts")) && /VisualActionDispatcher/.test(read("lib/agent/loop.ts")));
check("only the server model adapter imports centralized LLM", agentFiles.filter((file) => /\.\.\/llm/.test(read(file))).every((file) => file.endsWith("model.ts")));

if (failures.length) {
  console.error(`VisualAgent dependency failures:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("VisualAgent dependency tests passed");
}
