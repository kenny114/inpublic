import {
  activeStoryScene,
  resolveStoryEntity,
  resolveStoryVisual,
  restoreStoryState,
  storySnapshot,
  type StoryDirection,
  type StoryEntity,
  type StoryEntityKind,
  type StoryEnvironmentEffect,
  type StoryOperation,
  type StoryPlacement,
  type StoryRelation,
  type StoryScene,
  type StoryState,
} from "./story";

export type StorySemanticAction =
  | "sit"
  | "stand"
  | "walk"
  | "run"
  | "look"
  | "stop"
  | "hide"
  | "appear"
  | "disappear";

export type StorySpatialRelation =
  | "under"
  | "above"
  | "beside"
  | "behind"
  | "in-front-of"
  | "inside"
  | "toward"
  | "away-from";

export interface StoryEventEntity {
  entityId?: string;
  mention: string;
  kind: StoryEntityKind;
  assetKey?: StoryEntity["assetKey"];
  createIfMissing: boolean;
}

export interface StoryEventAction {
  subjectRef: string;
  action: StorySemanticAction;
  targetRef?: string;
  direction?: StoryDirection;
}

export interface StoryEventRelation {
  fromRef: string;
  toRef: string;
  relation: StorySpatialRelation;
}

export interface StoryEventEnvironment {
  effect: StoryEnvironmentEffect;
  state: "start" | "stop" | "replace";
}

/** A speech-derived semantic unit. Coordinates and drawing mechanics never enter this type. */
export interface StoryEvent {
  eventId: string;
  sequence: number;
  sourceText: string;
  normalizedText: string;
  provisional: boolean;
  confidence: number;
  entities: StoryEventEntity[];
  actions: StoryEventAction[];
  relations: StoryEventRelation[];
  environment: StoryEventEnvironment[];
}

export interface StoryCompileContext {
  state?: StoryState;
  provisional?: boolean;
  confidence?: number;
  sequence?: number;
  eventId?: string;
}

export const STORY_MODE_KEYTERMS = [
  "cat",
  "tree",
  "house",
  "car",
  "person",
  "sunlight",
  "rain",
  "cloud",
  "puddle",
] as const;

const ENTITY_RULES: Array<{
  pattern: RegExp;
  mention: string;
  kind: StoryEntityKind;
  assetKey: StoryEntity["assetKey"];
}> = [
  { pattern: /\b(?:cat|cats|kitten|kittens|feline)\b/i, mention: "cat", kind: "animal", assetKey: "cat" },
  { pattern: /\b(?:tree|trees)\b/i, mention: "tree", kind: "object", assetKey: "tree" },
  { pattern: /\b(?:house|houses|home)\b/i, mention: "house", kind: "location", assetKey: "house" },
  { pattern: /\b(?:car|cars|automobile)\b/i, mention: "car", kind: "vehicle", assetKey: "car" },
  { pattern: /\b(?:person|people|man|woman)\b/i, mention: "person", kind: "character", assetKey: "person" },
  { pattern: /\b(?:puddle|puddles|pool of water)\b/i, mention: "puddle", kind: "object", assetKey: "puddle" },
];

const normalizeStoryText = (value: string) => value
  .toLowerCase()
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[^a-z0-9'\s-]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const aliasesFor = (mention: string): string[] => {
  if (mention === "cat") return ["the cat", "it", "animal", "kitten", "feline"];
  if (mention === "person") return ["the person", "they", "them", "he", "she"];
  if (mention === "house") return ["the house", "home"];
  return [`the ${mention}`];
};

function existingId(state: StoryState | undefined, mention: string, kind?: StoryEntityKind): string | undefined {
  return state ? resolveStoryEntity(state, mention, kind)?.entityId : undefined;
}

function eventSubject(text: string, entities: StoryEventEntity[], state?: StoryState): string | undefined {
  const actor = entities.find((entity) => ["animal", "character", "vehicle"].includes(entity.kind));
  if (actor) return actor.entityId ?? actor.mention;
  if (/\b(?:it|he|she|they|the animal|the character)\b/i.test(text) && state) {
    return resolveStoryEntity(state, "it")?.entityId;
  }
  for (const rule of ENTITY_RULES) {
    if (rule.pattern.test(text)) return existingId(state, rule.mention, rule.kind) ?? rule.mention;
  }
  return undefined;
}

function relationTarget(
  text: string,
  entities: StoryEventEntity[],
  state: StoryState | undefined,
  relation: StorySpatialRelation,
): string | undefined {
  const relationPatterns: Record<StorySpatialRelation, RegExp> = {
    under: /\b(?:under|beneath|below)\s+(?:a |an |the )?([a-z -]+)/i,
    above: /\babove\s+(?:a |an |the )?([a-z -]+)/i,
    beside: /\b(?:beside|next to|by)\s+(?:a |an |the )?([a-z -]+)/i,
    behind: /\bbehind\s+(?:a |an |the )?([a-z -]+)/i,
    "in-front-of": /\bin front of\s+(?:a |an |the )?([a-z -]+)/i,
    inside: /\b(?:inside|into)\s+(?:a |an |the )?([a-z -]+)/i,
    toward: /\b(?:toward|towards|to)\s+(?:a |an |the )?([a-z -]+)/i,
    "away-from": /\b(?:away from|from)\s+(?:a |an |the )?([a-z -]+)/i,
  };
  const tail = relationPatterns[relation].exec(text)?.[1] ?? "";
  const targetRule = ENTITY_RULES.find((rule) => rule.pattern.test(tail));
  if (targetRule) {
    return existingId(state, targetRule.mention, targetRule.kind) ??
      entities.find((entity) => entity.mention === targetRule.mention)?.entityId ?? targetRule.mention;
  }
  if (/\brain\b/i.test(tail)) return "environment:rain";
  return undefined;
}

/** Compile the supported Story grammar locally. An empty event means reconciliation may be useful. */
export function compileStoryEvent(sourceText: string, context: StoryCompileContext = {}): StoryEvent {
  const normalizedText = normalizeStoryText(sourceText);
  const sequence = context.sequence ?? ((context.state?.lastEventSequence ?? 0) + 1);
  const entities: StoryEventEntity[] = [];
  for (const rule of ENTITY_RULES) {
    if (!rule.pattern.test(normalizedText)) continue;
    const id = existingId(context.state, rule.mention, rule.kind) ?? `${rule.mention}-1`;
    entities.push({
      entityId: id,
      mention: rule.mention,
      kind: rule.kind,
      assetKey: rule.assetKey,
      createIfMissing: true,
    });
  }

  const subjectRef = eventSubject(normalizedText, entities, context.state);
  const actions: StoryEventAction[] = [];
  const pushAction = (action: StorySemanticAction, direction?: StoryDirection) => {
    if (!subjectRef) return;
    actions.push({ subjectRef, action, ...(direction ? { direction } : {}) });
  };

  // Preserve spoken order when a clause contains multiple state changes.
  const actionMatches: Array<{ index: number; action: StorySemanticAction; direction?: StoryDirection }> = [];
  const actionRules: Array<[RegExp, StorySemanticAction]> = [
    [/\b(?:sat|sits|sitting|sit)\b/gi, "sit"],
    [/\b(?:stood up|stands up|got up|gets up|stood|stands|standing)\b/gi, "stand"],
    [/\b(?:walked|walks|walking|walk)\b/gi, "walk"],
    [/\b(?:ran|runs|running|run)\b/gi, "run"],
    [/\b(?:looked|looks|looking|look|watched|watches)\b/gi, "look"],
    [/\b(?:stopped|stops|stop|halted)\b/gi, "stop"],
    [/\b(?:hid|hides|hiding|hide)\b/gi, "hide"],
    [/\b(?:disappeared|disappears|vanished|vanishes)\b/gi, "disappear"],
    [/\b(?:appeared|appears|showed up|arrived)\b/gi, "appear"],
  ];
  for (const [pattern, action] of actionRules) {
    for (const match of normalizedText.matchAll(pattern)) actionMatches.push({ index: match.index ?? 0, action });
  }
  actionMatches.sort((left, right) => left.index - right.index);
  const direction: StoryDirection | undefined = /\b(?:toward|towards|into|to a|to the)\b/i.test(normalizedText)
    ? "toward"
    : /\b(?:away|away from|ran from|runs from)\b/i.test(normalizedText)
      ? "away"
      : undefined;
  for (const match of actionMatches) pushAction(match.action, ["walk", "run"].includes(match.action) ? direction : undefined);

  const relations: StoryEventRelation[] = [];
  const relationRules: Array<[RegExp, StorySpatialRelation]> = [
    [/\b(?:under|beneath|below)\b/i, "under"],
    [/\babove\b/i, "above"],
    [/\b(?:beside|next to)\b/i, "beside"],
    [/\bbehind\b/i, "behind"],
    [/\bin front of\b/i, "in-front-of"],
    [/\binside\b/i, "inside"],
    [/\b(?:toward|towards|to a|to the)\b/i, "toward"],
    [/\b(?:away from|ran from|runs from)\b/i, "away-from"],
  ];
  if (subjectRef) {
    for (const [pattern, relation] of relationRules) {
      if (!pattern.test(normalizedText)) continue;
      const toRef = relationTarget(normalizedText, entities, context.state, relation);
      if (toRef && toRef !== subjectRef) {
        relations.push({ fromRef: subjectRef, toRef, relation });
        const moving = [...actions].reverse().find((action: StoryEventAction) => action.action === "run" || action.action === "walk");
        if (moving) moving.targetRef = toRef;
      }
      break;
    }
  }

  const environment: StoryEventEnvironment[] = [];
  if (/\b(?:sun|sunlight|sunny|sunshine|shining)\b/i.test(normalizedText)) {
    environment.push({ effect: "sunlight", state: "start" });
  }
  if (/\b(?:rain|raining|rainfall|rainy)\b/i.test(normalizedText)) {
    environment.push({ effect: "rain", state: /\b(?:stopped|ended|cleared)\b/i.test(normalizedText) ? "stop" : "replace" });
  }
  if (/\b(?:wind|windy|breeze|blowing)\b/i.test(normalizedText)) environment.push({ effect: "wind", state: "start" });
  if (/\b(?:night|nighttime|darkness)\b/i.test(normalizedText)) environment.push({ effect: "night", state: "replace" });
  if (/\b(?:cloud|clouds|cloudy)\b/i.test(normalizedText)) environment.push({ effect: "clouds", state: "start" });

  return {
    eventId: context.eventId ?? `story-event-${sequence}-${stableHash(normalizedText)}`,
    sequence,
    sourceText,
    normalizedText,
    provisional: context.provisional === true,
    confidence: Math.max(0, Math.min(1, context.confidence ?? (context.provisional ? 0.65 : 1))),
    entities,
    actions,
    relations,
    environment,
  };
}

export function storyEventIsSupported(event: StoryEvent): boolean {
  return event.entities.length > 0 || event.actions.length > 0 || event.relations.length > 0 || event.environment.length > 0;
}

export interface StoryEventDecision {
  accepted: boolean;
  unit: "entity" | "action" | "relation" | "environment" | "event";
  target: string;
  reason: string;
}

export interface StoryEventApplyResult {
  state: StoryState;
  accepted: boolean;
  decisions: StoryEventDecision[];
  changedEntityIds: string[];
  changedRelationIds: string[];
  changedEnvironment: StoryEnvironmentEffect[];
  operation?: StoryOperation;
  stale: boolean;
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];

function touch(state: StoryState, entity: StoryEntity) {
  entity.lastMentionedAt = Date.now();
  state.activeEntityIds = unique([entity.entityId, ...state.activeEntityIds]).slice(0, 8);
  state.recentEntityIds = unique([entity.entityId, ...state.recentEntityIds]).slice(0, 12);
}

function resolveInScene(state: StoryState, reference: string): StoryEntity | undefined {
  return resolveStoryEntity(state, reference) ?? undefined;
}

function ensureEntity(state: StoryState, scene: StoryScene, mention: StoryEventEntity, pageIndex: number): StoryEntity {
  const existing = resolveInScene(state, mention.entityId ?? mention.mention) ?? resolveInScene(state, mention.mention);
  if (existing) {
    touch(state, existing);
    return existing;
  }
  const visual = resolveStoryVisual(mention.mention, mention.kind, mention.assetKey);
  const baseId = mention.entityId ?? `${mention.mention.replace(/\s+/g, "-")}-1`;
  let entityId = baseId;
  let suffix = 2;
  while (scene.entities[entityId]) entityId = `${baseId}-${suffix++}`;
  const now = Date.now();
  const entity: StoryEntity = {
    entityId,
    kind: mention.kind,
    ...(visual.assetKey ? { assetKey: visual.assetKey } : {}),
    visualSource: visual.visualSource,
    ...(visual.recipe ? { recipe: visual.recipe } : {}),
    label: mention.mention,
    aliases: aliasesFor(mention.mention),
    // Idle is a neutral presentation default, not a claim made by the speaker.
    state: { visible: true, ...(mention.kind === "animal" ? { pose: "idle" } : {}) },
    placement: { zone: mention.mention === "tree" || mention.mention === "house" ? "right" : "center" },
    effects: [],
    renderings: [{ pageIndex, elementIds: [] }],
    createdAt: now,
    lastMentionedAt: now,
    lifecycle: "active",
  };
  scene.entities[entityId] = entity;
  touch(state, entity);
  return entity;
}

const actionState: Record<StorySemanticAction, Partial<StoryEntity["state"]>> = {
  sit: { pose: "sitting", action: null },
  stand: { pose: "standing", action: null },
  walk: { pose: "walking", action: "moving" },
  run: { pose: "running", action: "running" },
  look: { action: "watching" },
  stop: { pose: "standing", action: "stopped" },
  hide: { visible: false },
  appear: { visible: true },
  disappear: { visible: false },
};

function relationPlacement(relation: StorySpatialRelation, toEntityId: string): StoryPlacement {
  return {
    relativeTo: toEntityId,
    relation: relation === "away-from" ? "away" : relation,
  };
}

/**
 * Apply one complete event against its proposed post-event scene. Nothing is
 * exposed until every dependency has resolved; failures return the untouched input.
 */
export function applyStoryEvent(input: StoryState, event: StoryEvent, pageIndex: number): StoryEventApplyResult {
  const original = restoreStoryState(input);
  const currentSequence = original.lastEventSequence ?? 0;
  if (!event.provisional && event.sequence <= currentSequence) {
    return {
      state: original,
      accepted: false,
      decisions: [{ accepted: false, unit: "event", target: event.eventId, reason: `stale sequence ${event.sequence}; current is ${currentSequence}` }],
      changedEntityIds: [], changedRelationIds: [], changedEnvironment: [], stale: true,
    };
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || !storyEventIsSupported(event)) {
    return {
      state: original,
      accepted: false,
      decisions: [{ accepted: false, unit: "event", target: event.eventId, reason: "empty event or invalid page" }],
      changedEntityIds: [], changedRelationIds: [], changedEnvironment: [], stale: false,
    };
  }

  const state = restoreStoryState(input);
  const before = storySnapshot(state);
  const decisions: StoryEventDecision[] = [];
  const changedEntityIds: string[] = [];
  const changedRelationIds: string[] = [];
  const changedEnvironment: StoryEnvironmentEffect[] = [];
  try {
    let scene = activeStoryScene(state);
    if (!scene) {
      const sceneId = "story-scene";
      scene = {
        sceneId,
        label: "Story",
        pageIndices: [pageIndex],
        locationEntityId: "",
        entities: {},
        relations: {},
        environment: {},
      };
      state.scenes[sceneId] = scene;
      state.activeSceneId = sceneId;
    }
    scene.environment ??= {};

    // Targets are materialized first, followed by actors and remaining props.
    const targetRefs = new Set(event.relations.map((relation) => relation.toRef));
    const orderedMentions = [...event.entities].sort((left, right) =>
      Number(targetRefs.has(right.entityId ?? right.mention)) - Number(targetRefs.has(left.entityId ?? left.mention)),
    );
    for (const mention of orderedMentions) {
      const entity = ensureEntity(state, scene, mention, pageIndex);
      changedEntityIds.push(entity.entityId);
      decisions.push({ accepted: true, unit: "entity", target: entity.entityId, reason: entity.visualSource === "placeholder" ? "honest labelled fallback" : "local editable asset resolved" });
    }

    for (const layer of event.environment) {
      if (layer.state === "replace") {
        for (const [effect, existing] of Object.entries(scene.environment)) {
          if (existing && effect !== layer.effect) existing.active = false;
        }
      }
      const existing = scene.environment[layer.effect];
      scene.environment[layer.effect] = {
        effect: layer.effect,
        active: layer.state !== "stop",
        opacity: layer.state === "stop" ? 0 : 100,
        startedAt: existing?.startedAt ?? Date.now(),
      };
      changedEnvironment.push(layer.effect);
      decisions.push({ accepted: true, unit: "environment", target: layer.effect, reason: "applied outside ordinary entity validation" });
    }

    for (const action of event.actions) {
      const subject = resolveInScene(state, action.subjectRef);
      if (!subject) throw new Error(`missing action subject ${action.subjectRef}`);
      subject.state = { ...subject.state, ...actionState[action.action], ...(action.direction ? { direction: action.direction } : {}) };
      subject.lifecycle = subject.state.visible === false ? "historical" : "active";
      if (action.action === "run" || action.action === "walk") {
        subject.effects = unique([...subject.effects, "motion-lines"]);
      } else if (action.action === "stop" || action.action === "sit" || action.action === "stand") {
        subject.effects = subject.effects.filter((effect) => effect !== "motion-lines");
      }
      if (action.targetRef && !action.targetRef.startsWith("environment:")) {
        const target = resolveInScene(state, action.targetRef);
        if (!target) throw new Error(`missing action target ${action.targetRef}`);
        subject.state.directionTargetId = target.entityId;
      }
      if (subject.state.visible !== false) touch(state, subject);
      changedEntityIds.push(subject.entityId);
      decisions.push({ accepted: true, unit: "action", target: `${subject.entityId}:${action.action}`, reason: "supported local action" });
    }

    for (const relation of event.relations) {
      const from = resolveInScene(state, relation.fromRef);
      if (!from) throw new Error(`missing relation subject ${relation.fromRef}`);
      if (relation.toRef.startsWith("environment:")) {
        // Weather has no object anchor. The directional state still applies,
        // but no fake rain entity is created merely to satisfy a relation.
        decisions.push({ accepted: true, unit: "relation", target: `${from.entityId}:${relation.relation}`, reason: "environment-relative direction recorded without an object entity" });
        continue;
      }
      const to = resolveInScene(state, relation.toRef);
      if (!to || from.entityId === to.entityId) throw new Error(`missing or identical relation target ${relation.toRef}`);
      from.placement = { ...from.placement, ...relationPlacement(relation.relation, to.entityId) };
      if (relation.relation === "toward" || relation.relation === "away-from") {
        from.state.direction = relation.relation === "toward" ? "toward" : "away";
        from.state.directionTargetId = to.entityId;
      }
      const relationId = `${from.entityId}-${relation.relation}-${to.entityId}`;
      if (relation.relation === "toward" || relation.relation === "away-from") {
        for (const [existingId, existing] of Object.entries(scene.relations)) {
          if (
            existing.fromEntityId === from.entityId &&
            (existing.relationType === "toward" || existing.relationType === "away-from") &&
            existingId !== relationId
          ) {
            delete scene.relations[existingId];
            changedRelationIds.push(existingId);
          }
        }
      }
      const record: StoryRelation = {
        relationId,
        fromEntityId: from.entityId,
        toEntityId: to.entityId,
        relationType: relation.relation,
        visual: relation.relation === "toward" || relation.relation === "away-from" ? "movement-arrow" : undefined,
        elementIds: scene.relations[relationId]?.elementIds ?? [],
      };
      scene.relations[relationId] = record;
      changedEntityIds.push(from.entityId, to.entityId);
      changedRelationIds.push(relationId);
      decisions.push({ accepted: true, unit: "relation", target: relationId, reason: "endpoints resolved in proposed post-event scene" });
    }

    state.lastEventSequence = event.sequence;
    let operation: StoryOperation | undefined;
    if (!event.provisional) {
      operation = {
        operationId: `story-event-op-${event.sequence}-${stableHash(event.eventId)}`,
        actionType: "story_event",
        eventId: event.eventId,
        timestamp: Date.now(),
        sourceText: event.sourceText,
        before,
      };
      state.operations.push(operation);
      if (state.operations.length > 200) state.operations.shift();
    }
    return {
      state,
      accepted: true,
      decisions,
      changedEntityIds: unique(changedEntityIds),
      changedRelationIds: unique(changedRelationIds),
      changedEnvironment: unique(changedEnvironment),
      operation,
      stale: false,
    };
  } catch (error) {
    return {
      state: original,
      accepted: false,
      decisions: [...decisions, { accepted: false, unit: "event", target: event.eventId, reason: String((error as Error).message ?? error) }],
      changedEntityIds: [], changedRelationIds: [], changedEnvironment: [], stale: false,
    };
  }
}

export interface StoryPartialState {
  signature: string;
  stableCount: number;
  provisionalEvent?: StoryEvent;
}

export interface StoryPartialResult {
  state: StoryPartialState;
  event?: StoryEvent;
  removeProvisional: boolean;
  ambiguity?: "cut/cat";
}

export const emptyStoryPartialState = (): StoryPartialState => ({ signature: "", stableCount: 0 });

const partialSignature = (event: StoryEvent) => [
  ...event.entities.map((entity) => `entity:${entity.mention}`),
  ...event.environment.map((layer) => `environment:${layer.effect}:${layer.state}`),
].sort().join("|");

/** Require two agreeing partials, or one provider result at >= 0.9 confidence. */
export function recognizeStoryPartial(
  previous: StoryPartialState,
  text: string,
  context: Omit<StoryCompileContext, "provisional" | "confidence"> = {},
  confidence = 0,
): StoryPartialResult {
  const event = compileStoryEvent(text, { ...context, provisional: true, confidence });
  const signature = partialSignature(event);
  const ambiguity = /\bcut\b/i.test(text) && !/\bcat\b/i.test(text) ? "cut/cat" as const : undefined;
  if (!signature || ambiguity) {
    return {
      state: { signature: "", stableCount: 0 },
      removeProvisional: Boolean(previous.provisionalEvent),
      ...(ambiguity ? { ambiguity } : {}),
    };
  }
  const stableCount = previous.signature === signature ? previous.stableCount + 1 : 1;
  const stable = stableCount >= 2 || confidence >= 0.9;
  if (!stable) {
    return {
      state: { signature, stableCount, provisionalEvent: previous.provisionalEvent },
      removeProvisional: false,
    };
  }
  const stableEvent: StoryEvent = {
    ...event,
    eventId: previous.signature === signature && previous.provisionalEvent
      ? previous.provisionalEvent.eventId
      : `story-provisional-${stableHash(signature)}`,
  };
  return {
    state: { signature, stableCount, provisionalEvent: stableEvent },
    event: stableEvent,
    removeProvisional: false,
  };
}
