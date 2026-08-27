/**
 * Opt-in paid evaluation of structured decision quality. This is deliberately
 * absent from npm test. Run only with RUN_VISUAL_AGENT_LIVE_EVAL=1 and a
 * configured provider key.
 */

if (process.env.RUN_VISUAL_AGENT_LIVE_EVAL !== "1") {
  console.log("VisualAgent live evaluation skipped (set RUN_VISUAL_AGENT_LIVE_EVAL=1 to run paid calls)");
  process.exit(0);
}

const { AgentContextSchema, AgentDecisionSchema } = await import("../lib/agent/index.ts");
const { decideWithVisualAgentModel, VISUAL_AGENT_MODEL } = await import("../lib/agent/model.ts");

const baseCanvas = {
  revisions: { scene: "scene-live-eval", selection: "selection-live-eval", viewport: "viewport-live-eval" },
  elements: [],
  selection: { elementIds: [], groupIds: [] },
  viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 1280, height: 720 },
};
const entities = [
  { id: "alice", type: "person", label: "Alice", status: "active", importance: "primary", lastTouchedSeq: 2 },
  { id: "project-x", type: "concept", label: "Project X", status: "active", importance: "supporting", lastTouchedSeq: 2 },
];
const scenarios = [
  {
    name: "add manager relationship",
    instruction: "Add a relationship showing Alice manages Project X.",
    relations: [],
    accept: (decision) => decision.type === "act" && decision.action.type === "relate_entities"
      && decision.action.sourceEntityId === "alice" && decision.action.targetEntityId === "project-x",
  },
  {
    name: "remove relationship",
    instruction: "Remove the relationship between Alice and Project X.",
    relations: [{ id: "alice-manages-project-x", sourceEntityId: "alice", targetEntityId: "project-x", type: "role_of", role: "manager", lastTouchedSeq: 2 }],
    accept: (decision) => decision.type === "act" && decision.action.type === "remove_relation"
      && decision.action.relationId === "alice-manages-project-x",
  },
  {
    name: "focus semantic identity",
    instruction: "Focus on Alice.",
    relations: [],
    accept: (decision) => decision.type === "act" && decision.action.type === "focus" && decision.action.entityId === "alice",
  },
  {
    name: "already satisfied",
    instruction: "Make sure Alice is shown as the manager of Project X.",
    relations: [{ id: "alice-manages-project-x", sourceEntityId: "alice", targetEntityId: "project-x", type: "role_of", role: "manager", lastTouchedSeq: 2 }],
    accept: (decision) => decision.type === "done",
  },
];

let passed = 0;
for (const scenario of scenarios) {
  const context = AgentContextSchema.parse({
    instruction: scenario.instruction,
    world: { entities, relations: scenario.relations, claims: [], salience: ["alice", "project-x"], sequence: 2 },
    canvas: baseCanvas,
    step: 1,
    remainingSteps: 4,
  });
  const raw = await decideWithVisualAgentModel(context);
  const parsed = AgentDecisionSchema.safeParse(raw);
  const ok = parsed.success && scenario.accept(parsed.data);
  if (ok) passed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${scenario.name}: ${JSON.stringify(raw)}`);
}

console.log(`VisualAgent live evaluation (${VISUAL_AGENT_MODEL}): ${passed}/${scenarios.length}`);
if (passed !== scenarios.length) process.exitCode = 1;
