/** Deterministic Phase 6 checks: no browser, network, provider, or paid model. */

import assert from "node:assert/strict";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { ExpressionLiveController } from "../lib/expression/live.ts";
import {
  PersistedExpressionStateSchema,
  restoreWorldState,
  serializeWorldState,
} from "../lib/expression/persistence.ts";
import { EMPTY_WORLD_STATE, WorldStateSchema } from "../lib/expression/schemas.ts";
import { createConflictRecoverySession } from "../lib/persist.ts";

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

const firstDelta = {
  entities: [
    { id: "a", type: "person", label: "Alice", confidence: "high" },
    { id: "x", type: "concept", label: "Project X", confidence: "high" },
  ],
  relations: [
    { id: "r1", source: "a", type: "role_of", target: "x", role: "manager", confidence: "high" },
  ],
  claims: [
    { id: "c1", text: "Project X is the priority", about: ["x"], confidence: "medium" },
  ],
  topicEntityId: "a",
  interpretation: "Alice manages Project X.",
};

const session = new ExpressionSession();
await session.ingestDelta(
  { id: "turn-7", source: "human_speech", text: "Alice manages Project X.", seq: 7, speakerId: "kenny", timestamp: 1234 },
  firstDelta,
);
const richWorld = session.getWorld();
const richState = session.snapshotState();

check("rich WorldState validates", () => assert.equal(WorldStateSchema.safeParse(richWorld).success, true));
check("rich state round-trips exactly", () => {
  const restored = restoreWorldState(JSON.parse(JSON.stringify(richState)));
  assert.equal(restored.status, "restored");
  // JSON persistence intentionally omits optional properties whose value was
  // undefined; compare the semantic JSON shape rather than JS object slots.
  assert.deepEqual(restored.world, JSON.parse(JSON.stringify(richWorld)));
  assert.equal(restored.world.entities[0].provenance?.[0].speakerId, "kenny");
  assert.equal(restored.world.relations.length, 1);
  assert.equal(restored.world.claims.length, 1);
});

check("empty WorldState round-trips", () => {
  const restored = restoreWorldState(serializeWorldState(EMPTY_WORLD_STATE));
  assert.equal(restored.status, "restored");
  assert.deepEqual(restored.world, EMPTY_WORLD_STATE);
});

check("old project without expressionState falls back empty", () => {
  const restored = restoreWorldState(undefined);
  assert.equal(restored.status, "missing");
  assert.deepEqual(restored.world, EMPTY_WORLD_STATE);
});

check("unsupported version is not interpreted as current", () => {
  assert.equal(restoreWorldState({ version: 0, world: richWorld }).status, "unsupported_version");
  assert.equal(restoreWorldState({ version: 2, world: richWorld }).status, "unsupported_version");
});

check("malformed and partially corrupt state fail safely", () => {
  assert.equal(restoreWorldState({ version: 1, world: { entities: [] } }).status, "invalid");
  const corrupt = structuredClone(richState);
  corrupt.world.relations[0].source = "missing-entity";
  assert.equal(restoreWorldState(corrupt).status, "invalid");
});

const canvas = [{ id: "canvas-a", type: "rectangle" }];
const persistedSession = {
  id: "project-a",
  savedAt: 1,
  startedAt: null,
  page: 0,
  elements: canvas,
  semantic: { concepts: [], relationships: [], sections: [], operations: [] },
  expressionState: richState,
  log: [],
};

check("project JSON serialization includes the versioned semantic envelope", () => {
  const parsed = JSON.parse(JSON.stringify(persistedSession));
  assert.equal(PersistedExpressionStateSchema.safeParse(parsed.expressionState).success, true);
  assert.deepEqual(parsed.elements, canvas);
});

check("invalid semantic input cannot damage an otherwise valid canvas snapshot", () => {
  const invalidProject = { ...persistedSession, expressionState: { version: 1, world: null } };
  const runtime = new ExpressionSession();
  assert.equal(runtime.restoreState(invalidProject.expressionState).status, "invalid");
  assert.deepEqual(invalidProject.elements, canvas);
  assert.deepEqual(runtime.getWorld(), EMPTY_WORLD_STATE);
});

check("409 recovery keeps the matching canvas and WorldState together", () => {
  const copy = createConflictRecoverySession(persistedSession, "recovery-a");
  assert.equal(copy.id, "recovery-a");
  assert.deepEqual(copy.elements, persistedSession.elements);
  assert.deepEqual(copy.expressionState, persistedSession.expressionState);
  assert.equal(copy.cloudUpdatedAt, undefined);
});

const updates = [];
const beforeReload = new ExpressionLiveController({ debounceMs: 0, onUpdate: (update) => updates.push(update) });
const first = await beforeReload.express({ id: "first", text: "Alice manages Project X.", delta: firstDelta });
assert.equal(first.status, "updated");
const aliceId = beforeReload.getWorld().entities.find((entity) => entity.label === "Alice")?.id;
const saved = beforeReload.snapshotState();

const afterReload = new ExpressionLiveController({ debounceMs: 0, onUpdate: (update) => updates.push(update) });
const restoreResult = afterReload.restoreState(JSON.parse(JSON.stringify(saved)));
const continuation = await afterReload.express({
  id: "second",
  text: "She reports to David now.",
  delta: {
    entities: [
      { id: "s", type: "person", label: "she" },
      { id: "d", type: "person", label: "David" },
    ],
    relations: [{ id: "r2", source: "s", type: "depends_on", target: "d" }],
    claims: [],
    topicEntityId: "s",
    interpretation: "Alice reports to David now.",
  },
});

check("reconstructed runtime preserves identity and resolves a later pronoun", () => {
  assert.equal(restoreResult.status, "restored");
  assert.equal(continuation.status, "updated");
  const world = afterReload.getWorld();
  assert.equal(world.entities.some((entity) => entity.label.toLowerCase() === "she"), false);
  assert.equal(world.entities.find((entity) => entity.label === "Alice")?.id, aliceId);
  assert.equal(world.relations.some((relation) => relation.source === aliceId && world.entities.find((entity) => entity.id === relation.target)?.label === "David"), true);
  assert.equal(world.seq, saved.world.seq + 1);
});

const provenance = Array.from({ length: 6 }, (_, index) => ({
  speakerId: `speaker-${index}`,
  timestamp: index,
  sourceSegmentIds: [`segment-${index}`],
}));
const boundedWorld = {
  topic: "Bounded synthetic world",
  interpretation: "A structurally near-current-bounds fixture for persistence sizing.",
  entities: Array.from({ length: 64 }, (_, index) => ({
    id: `e${index}`,
    type: "concept",
    label: `Entity ${index}`,
    description: `Synthetic entity ${index}`,
    attributes: Array.from({ length: 8 }, (__, attr) => ({ key: `key${attr}`, value: `value-${index}-${attr}` })),
    confidence: "high",
    status: "active",
    importance: index === 0 ? "primary" : "supporting",
    firstSeenSeq: index,
    lastTouchedSeq: 63,
    aliases: Array.from({ length: 12 }, (__, alias) => `entity-${index}-alias-${alias}`),
    provenance,
    metric: { unit: "count", history: Array.from({ length: 12 }, (__, point) => ({ value: point, label: `point-${point}` })) },
  })),
  relations: Array.from({ length: 128 }, (_, index) => ({
    id: `r${index}`,
    source: `e${index % 64}`,
    type: "relates_to",
    target: `e${(index + 1) % 64}`,
    confidence: "medium",
    firstSeenSeq: index % 64,
    lastTouchedSeq: 63,
    provenance,
  })),
  claims: Array.from({ length: 48 }, (_, index) => ({
    id: `c${index}`,
    text: `Synthetic claim ${index}`,
    about: [`e${index % 64}`],
    confidence: "medium",
    importance: "supporting",
    firstSeenSeq: index,
    lastTouchedSeq: 63,
    provenance,
  })),
  salience: Array.from({ length: 16 }, (_, index) => `e${index}`),
  seq: 63,
};

check("near-current-bounds synthetic WorldState validates", () => {
  assert.equal(WorldStateSchema.safeParse(boundedWorld).success, true);
});

const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
const sizes = {
  empty: bytes(serializeWorldState(EMPTY_WORLD_STATE)),
  representative: bytes(richState),
  boundedSynthetic: bytes(serializeWorldState(boundedWorld)),
};

console.log(`WorldState persistence: ${passed} passed`);
console.log(`Serialized expression-state bytes: empty=${sizes.empty}, representative=${sizes.representative}, bounded=${sizes.boundedSynthetic}`);
