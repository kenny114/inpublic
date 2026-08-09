import type { SceneElement } from "./scene";
import type { CompositionState } from "./composition";
import { isThoughtComplete } from "./pagination";
import {
  isStoryEffect,
  resolveProceduralRecipe,
  type StoryEffect,
  type StoryRecipe,
} from "./storyPrimitives";

export type InPublicMode = "standard" | "story";

/** How a visible entity is drawn. Prepared art, primitives, or a labelled box. */
export type StoryVisualSource = "asset" | "composed" | "procedural" | "placeholder";

export type StoryEntityKind =
  | "character"
  | "animal"
  | "vehicle"
  | "object"
  | "location"
  | "background";

export type StoryAssetKey =
  | "child"
  | "person"
  | "cat"
  | "dog"
  | "mouse"
  | "car"
  | "road"
  | "palm-tree"
  | "tree"
  | "beach"
  | "sand"
  | "water"
  | "waves"
  | "sun"
  | "cloud"
  | "rain"
  | "puddle"
  | "house"
  | "movement-arrow"
  | "speech-bubble";

export type StoryZone = "left" | "center" | "right" | "background";

/** Where it is moving or facing. Never a coordinate. */
export type StoryDirection = "left" | "right" | "up" | "down" | "toward" | "away";

export interface StoryAppearance {
  color?: string;
  size?: string;
}

export interface StoryPlacement {
  zone?: StoryZone;
  relativeTo?: string;
  relation?: string;
}

/**
 * Pose, action and direction are kept apart on purpose.
 *
 *   pose      — body position: sitting, standing, driving
 *   action    — what it is doing: running, moving, eating
 *   direction — where it is going or facing
 *
 * A cat can be in a running pose while its action is null (a photograph of a
 * run), and a car can be in a driving pose while stopped. Collapsing them
 * loses exactly the distinctions this layer exists to draw.
 */
export interface StoryEntityState {
  pose?: string;
  action?: string | null;
  direction?: StoryDirection;
  /** The entity the direction is measured against, once resolved. */
  directionTargetId?: string;
  visible: boolean;
  emotion?: string;
  appearance?: StoryAppearance;
}

export interface StoryRendering {
  pageIndex: number;
  elementIds: string[];
}

export interface StoryEntity {
  entityId: string;
  kind: StoryEntityKind;
  /** Set only when visualSource is "asset". Composed entities have none. */
  assetKey?: StoryAssetKey;
  visualSource: StoryVisualSource;
  /** Primitive family used when there is no prepared asset. */
  recipe?: StoryRecipe;
  label: string;
  aliases: string[];
  state: StoryEntityState;
  placement: StoryPlacement;
  /** Visual modifiers drawn with the entity and hidden with it. */
  effects: StoryEffect[];
  renderings: StoryRendering[];
  createdAt: number;
  lastMentionedAt: number;
  lifecycle: "active" | "historical" | "unrendered";
}

export type StoryRelationVisual = "movement-arrow" | "motion-lines";

export interface StoryRelation {
  relationId: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: string;
  visual?: StoryRelationVisual;
  elementIds: string[];
}

export type StoryEnvironmentEffect =
  | "sunlight"
  | "rain"
  | "wind"
  | "night"
  | "clouds";

export interface StoryEnvironmentLayer {
  effect: StoryEnvironmentEffect;
  active: boolean;
  /** The stable renderer target. Animation frames are never persisted here. */
  opacity: number;
  startedAt: number;
}

export interface StoryScene {
  sceneId: string;
  label: string;
  pageIndices: number[];
  locationEntityId: string;
  entities: Record<string, StoryEntity>;
  relations: Record<string, StoryRelation>;
  /** Weather and light are scene state, never ordinary object entities. */
  environment?: Partial<Record<StoryEnvironmentEffect, StoryEnvironmentLayer>>;
}

export interface StorySnapshot {
  activeSceneId: string;
  scenes: Record<string, StoryScene>;
  activeEntityIds: string[];
  recentEntityIds: string[];
  lastEventSequence?: number;
}

export interface StoryOperation {
  operationId: string;
  actionType: StoryAction["type"] | "story_event";
  eventId?: string;
  timestamp: number;
  sourceText: string;
  before: StorySnapshot;
  compositionBefore?: CompositionState;
}

export interface StoryState extends StorySnapshot {
  operations: StoryOperation[];
  /** Guards late asynchronous reconciliation from overwriting newer speech. */
  lastEventSequence?: number;
}

export type StoryAction =
  | { type: "create_scene"; sceneId: string; label: string }
  | { type: "activate_scene"; sceneId: string }
  | {
      type: "create_entity";
      entityId: string;
      kind: StoryEntityKind;
      /** Omit to let the renderer compose the subject from primitives. */
      assetKey?: StoryAssetKey;
      label: string;
      aliases?: string[];
      state?: Partial<StoryEntityState>;
      placement?: StoryPlacement;
      effects?: StoryEffect[];
      forceNew?: boolean;
    }
  | {
      type: "update_entity";
      entityId: string;
      state?: Partial<StoryEntityState>;
      label?: string;
      aliases?: string[];
      /** What the direction is measured against, e.g. "away" from the tree. */
      targetEntityId?: string;
    }
  | { type: "move_entity"; entityId: string; placement: StoryPlacement }
  | {
      type: "transform_entity";
      entityId: string;
      assetKey: StoryAssetKey;
      label?: string;
    }
  | { type: "set_entity_visibility"; entityId: string; visible: boolean }
  | {
      type: "upsert_relation";
      relationId: string;
      fromEntityId: string;
      toEntityId: string;
      relationType: string;
      visual?: StoryRelationVisual;
    }
  | { type: "remove_relation"; relationId: string }
  | { type: "add_visual_effect"; entityId: string; effect: StoryEffect }
  | { type: "remove_visual_effect"; entityId: string; effect: StoryEffect };

export interface StoryInterpreterContext {
  mode: "story";
  transcript: string;
  activeScene: string;
  existingEntities: StoryEntity[];
  recentEntities: StoryEntity[];
  historicalEntities: StoryEntity[];
  existingRelations: StoryRelation[];
  currentPage: number;
}

export interface StoryApplyResult {
  state: StoryState;
  applied: string[];
  changedEntityIds: string[];
  changedRelationIds: string[];
  activatedSceneId?: string;
  acceptedActions: StoryAction[];
  decisions: StoryActionDecision[];
}

export interface StoryActionDecision {
  actionIndex: number;
  actionType: StoryAction["type"];
  target: string;
  accepted: boolean;
  reason: string;
  entityResolutions: Array<{ reference: string; entityId?: string; status: "resolved" | "created" | "missing" | "historical" }>;
  /** `resolved` is a prepared asset key, or the primitive recipe standing in for one. */
  assetResolution?: { requested: string; resolved?: string; status: "matched" | "mismatch" | "needs_asset" };
  warnings: string[];
}

export interface StoryInterpretation {
  sourceText: string;
  normalizedText?: string;
  confidence: number;
  actions: StoryAction[];
  warnings: string[];
}

const ASSET_KEYS: StoryAssetKey[] = [
  "child", "person", "cat", "dog", "mouse", "car", "road", "palm-tree", "tree",
  "beach", "sand", "water", "waves", "sun", "cloud", "rain", "puddle", "house",
  "movement-arrow", "speech-bubble",
];

const KINDS: StoryEntityKind[] = [
  "character", "animal", "vehicle", "object", "location", "background",
];

const DIRECTIONS: StoryDirection[] = ["left", "right", "up", "down", "toward", "away"];

const clean = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/^(?:a|an|the)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

const slug = (value: string): string =>
  normalize(value).replace(/\s+/g, "-") || "story-item";

const unique = <T>(values: T[]): T[] => [...new Set(values)];

const clone = <T>(value: T): T => structuredClone(value);

const ASSET_LABELS: Record<StoryAssetKey, string[]> = {
  child: ["child", "girl", "boy"], person: ["person", "woman", "man"],
  cat: ["cat", "kitten"], dog: ["dog", "puppy"], mouse: ["mouse", "mice"],
  car: ["car", "automobile"], road: ["road", "street", "lane"],
  "palm-tree": ["palm tree", "palm"], tree: ["tree"], beach: ["beach", "shore"],
  sand: ["sand"], water: ["water", "sea", "ocean"], waves: ["wave", "waves"],
  sun: ["sun", "sunny"], cloud: ["cloud", "clouds"], rain: ["rain", "rainy"],
  puddle: ["puddle", "pool of water"], house: ["house", "home"], "movement-arrow": ["movement arrow"],
  "speech-bubble": ["speech bubble"],
};

const ASSET_KINDS: Record<StoryAssetKey, StoryEntityKind[]> = {
  child: ["character"], person: ["character"], cat: ["animal"], dog: ["animal"], mouse: ["animal"],
  car: ["vehicle", "object"], road: ["object", "location", "background"],
  "palm-tree": ["object"], tree: ["object"], beach: ["location"],
  sand: ["background"], water: ["background", "location"], waves: ["background"],
  sun: ["background"], cloud: ["background"], rain: ["background"], puddle: ["object"], house: ["object", "location"],
  "movement-arrow": ["object"], "speech-bubble": ["object"],
};

const wordIn = (text: string, phrase: string): boolean => {
  const escaped = normalize(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return Boolean(escaped) && new RegExp(`\\b${escaped}\\b`, "i").test(normalize(text));
};

export function storyAssetMatchesLabel(assetKey: StoryAssetKey, label: string): boolean {
  const key = normalize(label);
  return ASSET_LABELS[assetKey].some((candidate) => normalize(candidate) === key);
}

export function storyAssetMatchesKind(assetKey: StoryAssetKey, kind: StoryEntityKind): boolean {
  return ASSET_KINDS[assetKey].includes(kind);
}

/**
 * A composed or placeholder entity has nothing to mismatch, so it is valid by
 * construction. Only a claimed prepared asset can lie about what it depicts.
 */
export function storyEntityAssetIsValid(
  entity: Pick<StoryEntity, "assetKey" | "kind" | "label"> & { visualSource?: StoryVisualSource },
): boolean {
  if (!entity.assetKey) return entity.visualSource !== "asset";
  return storyAssetMatchesLabel(entity.assetKey, entity.label) && storyAssetMatchesKind(entity.assetKey, entity.kind);
}

function assetMentioned(text: string, assetKey?: StoryAssetKey): boolean {
  if (!assetKey) return false;
  return ASSET_LABELS[assetKey].some((label) => wordIn(text, label));
}

/** The prepared asset for a spoken noun, if one exists. */
export function storyAssetForLabel(label: string, kind?: StoryEntityKind): StoryAssetKey | undefined {
  const key = normalize(label);
  return ASSET_KEYS.find((assetKey) =>
    ASSET_LABELS[assetKey].some((candidate) => normalize(candidate) === key) &&
    (!kind || ASSET_KINDS[assetKey].includes(kind)),
  );
}

export interface StoryVisualResolution {
  visualSource: StoryVisualSource;
  assetKey?: StoryAssetKey;
  recipe?: StoryRecipe;
}

/**
 * Asset first, primitives second, labelled placeholder last. An unfamiliar
 * noun never borrows another subject's art.
 */
export function resolveStoryVisual(
  label: string,
  kind: StoryEntityKind,
  requested?: StoryAssetKey,
): StoryVisualResolution {
  if (requested && storyAssetMatchesLabel(requested, label) && storyAssetMatchesKind(requested, kind)) {
    return { visualSource: "asset", assetKey: requested };
  }
  const matched = storyAssetForLabel(label, kind);
  if (matched) return { visualSource: "asset", assetKey: matched };
  const recipe = resolveProceduralRecipe(label, kind);
  return recipe === "placeholder"
    ? { visualSource: "placeholder", recipe }
    : { visualSource: "composed", recipe };
}

/**
 * Which poses the renderer can actually draw. Validation refuses anything
 * outside this table rather than silently drawing the default pose.
 */
const POSES_BY_KIND: Record<StoryEntityKind, string[]> = {
  character: ["standing", "sitting", "walking", "running", "sleeping", "jumping"],
  animal: ["idle", "standing", "sitting", "walking", "running", "sleeping", "jumping", "watching"],
  vehicle: ["driving", "stopped", "parked"],
  object: ["standing", "stopped"],
  location: ["standing"],
  background: ["standing", "shining", "falling", "stopped"],
};

const ACTIONS_BY_KIND: Record<StoryEntityKind, string[]> = {
  character: ["moving", "running", "walking", "jumping", "eating", "sleeping", "watching", "stopped"],
  animal: ["moving", "running", "walking", "jumping", "eating", "sleeping", "watching", "stopped"],
  vehicle: ["moving", "driving", "stopped", "turning"],
  object: ["moving", "stopped"],
  location: [],
  background: ["falling", "shining", "moving", "stopped"],
};

export function storyPoseSupported(kind: StoryEntityKind, pose: string): boolean {
  return POSES_BY_KIND[kind].includes(normalize(pose));
}

export function storyActionSupported(kind: StoryEntityKind, action: string): boolean {
  return ACTIONS_BY_KIND[kind].includes(normalize(action));
}

/** A pose and an action must describe the same body. Sitting is not running. */
const POSE_ACTION_CONFLICTS: Array<[RegExp, RegExp]> = [
  [/^sitting$/, /^(?:running|walking|jumping|moving)$/],
  [/^sleeping$/, /^(?:running|walking|jumping|moving|eating)$/],
  [/^stopped|parked$/, /^(?:moving|running|driving)$/],
];

export function storyPoseActionCompatible(pose?: string, action?: string | null): boolean {
  if (!pose || !action) return true;
  const p = normalize(pose);
  const a = normalize(action);
  return !POSE_ACTION_CONFLICTS.some(([posePattern, actionPattern]) => posePattern.test(p) && actionPattern.test(a));
}

export function newStoryState(): StoryState {
  return {
    activeSceneId: "",
    scenes: {},
    activeEntityIds: [],
    recentEntityIds: [],
    operations: [],
    lastEventSequence: 0,
  };
}

export function storySnapshot(state: StoryState): StorySnapshot {
  return {
    activeSceneId: state.activeSceneId,
    scenes: clone(state.scenes),
    activeEntityIds: [...state.activeEntityIds],
    recentEntityIds: [...state.recentEntityIds],
    lastEventSequence: state.lastEventSequence ?? 0,
  };
}

export function restoreStoryState(value?: Partial<StoryState> | null): StoryState {
  const empty = newStoryState();
  if (!value) return empty;
  const restored: StoryState = {
    activeSceneId: clean(value.activeSceneId),
    scenes: clone(value.scenes ?? {}),
    activeEntityIds: Array.isArray(value.activeEntityIds)
      ? [...value.activeEntityIds]
      : [],
    recentEntityIds: Array.isArray(value.recentEntityIds)
      ? [...value.recentEntityIds]
      : [],
    operations: Array.isArray(value.operations) ? clone(value.operations) : [],
    lastEventSequence: Number.isFinite(value.lastEventSequence) ? value.lastEventSequence : 0,
  };
  for (const scene of Object.values(restored.scenes)) {
    scene.environment ??= {};
    for (const entity of Object.values(scene.entities)) {
      // Sessions saved before the Visual Action Engine carry neither a visual
      // source nor an effect list; both are derivable from what they do have.
      entity.visualSource ??= entity.assetKey ? "asset" : "placeholder";
      entity.effects ??= [];
      if (entity.visualSource !== "asset" && !entity.recipe) {
        entity.recipe = resolveProceduralRecipe(entity.label, entity.kind);
      }
      entity.lifecycle ??= entity.state.visible === false ? "historical" : "active";
      if (!storyEntityAssetIsValid(entity)) entity.lifecycle = "unrendered";
    }
  }
  const activeScene = restored.scenes[restored.activeSceneId];
  restored.activeEntityIds = restored.activeEntityIds.filter((id) => activeScene?.entities[id]?.lifecycle === "active");
  restored.recentEntityIds = restored.recentEntityIds.filter((id) => activeScene?.entities[id]?.lifecycle === "active");
  return restored;
}

export function activeStoryScene(state: StoryState): StoryScene | null {
  return state.scenes[state.activeSceneId] ?? null;
}

function entityAliases(entity: StoryEntity): string[] {
  return unique([entity.entityId, entity.label, entity.assetKey ?? "", ...entity.aliases])
    .map(normalize)
    .filter(Boolean);
}

function isGenericReference(ref: string): boolean {
  return /^(?:it|she|he|her|him|they|them|animal|character|person|girl|boy)$/i.test(
    normalize(ref),
  );
}

function compatible(entity: StoryEntity, ref: string, kind?: StoryEntityKind): boolean {
  if (kind && entity.kind !== kind) return false;
  const key = normalize(ref);
  const canonicalAssets = ASSET_KEYS.filter((assetKey) => ASSET_LABELS[assetKey].some((label) => normalize(label) === key));
  if (canonicalAssets.length && (!entity.assetKey || !canonicalAssets.includes(entity.assetKey))) {
    // A composed entity may still be the referent if the noun is its label.
    if (entity.visualSource === "asset" || normalize(entity.label) !== key) return false;
  }
  if (/^(?:she|her|girl)$/i.test(key)) {
    return entity.kind === "character" &&
      (entity.aliases.some((a) => /^(?:she|her|girl)$/i.test(normalize(a))) ||
        /\b(?:girl|woman|female)\b/i.test(entity.label));
  }
  if (/^animal$/i.test(key)) return entity.kind === "animal";
  // "it" is the most recent compatible actor of any kind — a cat, or a car.
  if (/^(?:it|they|them)$/i.test(key)) {
    return entity.kind === "animal" || entity.kind === "vehicle" ||
      entity.kind === "object" || entity.kind === "character";
  }
  if (/^(?:he|him|boy|character|person)$/i.test(key)) return entity.kind === "character";
  return true;
}

/** Executor-level identity resolution. The model is never trusted to dedupe. */
export function resolveStoryEntity(
  state: StoryState,
  reference: string,
  kind?: StoryEntityKind,
  options: { includeHistorical?: boolean } = {},
): StoryEntity | null {
  const scene = activeStoryScene(state);
  if (!scene) return null;
  const eligible = (entity: StoryEntity) => options.includeHistorical === true || (entity.state.visible !== false && entity.lifecycle === "active");
  if (scene.entities[reference] && eligible(scene.entities[reference]) && compatible(scene.entities[reference], reference, kind)) {
    return scene.entities[reference];
  }
  const key = normalize(reference);
  // Exact visible aliases precede broader canonical-label matching.
  for (const entity of Object.values(scene.entities)) {
    if (!eligible(entity)) continue;
    if (!compatible(entity, reference, kind)) continue;
    if (entity.aliases.map(normalize).includes(key)) return entity;
  }
  for (const entity of Object.values(scene.entities)) {
    if (!eligible(entity) || !compatible(entity, reference, kind)) continue;
    if (normalize(entity.label) === key || normalize(entity.assetKey ?? "") === key) return entity;
  }
  if (isGenericReference(reference)) {
    for (const id of state.recentEntityIds) {
      const entity = scene.entities[id];
      if (entity && eligible(entity) && compatible(entity, reference, kind)) return entity;
    }
  }
  return null;
}

function touchEntity(state: StoryState, entity: StoryEntity) {
  entity.lastMentionedAt = Date.now();
  if (entity.lifecycle === "active" && entity.state.visible !== false) {
    state.activeEntityIds = unique([entity.entityId, ...state.activeEntityIds]).slice(0, 8);
    state.recentEntityIds = unique([entity.entityId, ...state.recentEntityIds]).slice(0, 12);
  }
}

function nextEntityId(scene: StoryScene, requested: string, label: string): string {
  const base = slug(requested || label);
  if (!scene.entities[base]) return base;
  let index = 2;
  while (scene.entities[`${base}-${index}`]) index += 1;
  return `${base}-${index}`;
}

function sceneByReference(state: StoryState, reference: string): StoryScene | null {
  if (state.scenes[reference]) return state.scenes[reference];
  const key = normalize(reference);
  return Object.values(state.scenes).find((scene) => normalize(scene.label) === key) ?? null;
}

function pushOperation(
  state: StoryState,
  action: StoryAction,
  before: StorySnapshot,
  sourceText: string,
) {
  state.operations.push({
    operationId: `story-op-${Date.now().toString(36)}-${state.operations.length + 1}`,
    actionType: action.type,
    timestamp: Date.now(),
    sourceText,
    before,
  });
  if (state.operations.length > 200) state.operations.shift();
}

function applyOne(
  state: StoryState,
  action: StoryAction,
  sourceText: string,
  currentPage: number,
): { applied: string; entityIds: string[]; relationIds: string[]; activated?: string } {
  const before = storySnapshot(state);
  const forceAnother = /\b(?:another|a second|a different)\b/i.test(sourceText);

  if (action.type === "create_scene") {
    const existing = sceneByReference(state, action.sceneId) ?? sceneByReference(state, action.label);
    if (existing) {
      state.activeSceneId = existing.sceneId;
      return { applied: `activated ${existing.sceneId}`, entityIds: [], relationIds: [], activated: existing.sceneId };
    }
    const sceneId = slug(action.sceneId || action.label);
    state.scenes[sceneId] = {
      sceneId,
      label: action.label,
      pageIndices: [currentPage],
      locationEntityId: "",
      entities: {},
      relations: {},
      environment: {},
    };
    state.activeSceneId = sceneId;
    pushOperation(state, action, before, sourceText);
    return { applied: `created scene ${sceneId}`, entityIds: [], relationIds: [], activated: sceneId };
  }

  if (action.type === "activate_scene") {
    const scene = sceneByReference(state, action.sceneId);
    if (!scene) return { applied: `missing scene ${action.sceneId}`, entityIds: [], relationIds: [] };
    state.activeSceneId = scene.sceneId;
    return { applied: `activated ${scene.sceneId}`, entityIds: [], relationIds: [], activated: scene.sceneId };
  }

  const scene = activeStoryScene(state);
  if (!scene) return { applied: `no active scene for ${action.type}`, entityIds: [], relationIds: [] };

  if (action.type === "create_entity") {
    const shouldForce = action.forceNew === true || forceAnother;
    const existing = shouldForce
      ? null
      : resolveStoryEntity(state, action.entityId, action.kind) ??
        resolveStoryEntity(state, action.label, action.kind);
    if (existing) {
      touchEntity(state, existing);
      return { applied: `reused ${existing.entityId}`, entityIds: [existing.entityId], relationIds: [] };
    }
    const entityId = nextEntityId(scene, action.entityId, action.label);
    const now = Date.now();
    const visual = resolveStoryVisual(action.label, action.kind, action.assetKey);
    const entity: StoryEntity = {
      entityId,
      kind: action.kind,
      ...(visual.assetKey ? { assetKey: visual.assetKey } : {}),
      visualSource: visual.visualSource,
      ...(visual.recipe ? { recipe: visual.recipe } : {}),
      label: action.label,
      aliases: unique([
        action.label,
        visual.assetKey ?? "",
        ...(action.aliases ?? []),
      ].filter(Boolean)),
      state: { visible: true, ...action.state },
      placement: { zone: "center", ...action.placement },
      effects: unique(action.effects ?? []),
      renderings: [{ pageIndex: currentPage, elementIds: [] }],
      createdAt: now,
      lastMentionedAt: now,
      lifecycle: "active",
    };
    scene.entities[entityId] = entity;
    if (entity.kind === "location" && !scene.locationEntityId) {
      scene.locationEntityId = entityId;
    }
    touchEntity(state, entity);
    pushOperation(state, action, before, sourceText);
    return { applied: `created ${entityId}`, entityIds: [entityId], relationIds: [] };
  }

  if (action.type === "upsert_relation") {
    const from = resolveStoryEntity(state, action.fromEntityId);
    const to = resolveStoryEntity(state, action.toEntityId);
    if (!from || !to || from.entityId === to.entityId) {
      return { applied: `missing relation endpoint ${action.fromEntityId}->${action.toEntityId}`, entityIds: [], relationIds: [] };
    }
    const existing = scene.relations[action.relationId] ??
      Object.values(scene.relations).find(
        (relation) => relation.fromEntityId === from.entityId &&
          relation.toEntityId === to.entityId &&
          relation.relationType === action.relationType,
      );
    const relationId = existing?.relationId || slug(action.relationId || `${from.entityId}-${to.entityId}`);
    scene.relations[relationId] = {
      relationId,
      fromEntityId: from.entityId,
      toEntityId: to.entityId,
      relationType: action.relationType,
      visual: action.visual,
      elementIds: existing?.elementIds ?? [],
    };
    touchEntity(state, from);
    touchEntity(state, to);
    pushOperation(state, action, before, sourceText);
    return { applied: `${existing ? "updated" : "created"} relation ${relationId}`, entityIds: [from.entityId, to.entityId], relationIds: [relationId] };
  }

  if (action.type === "remove_relation") {
    const relation = scene.relations[action.relationId] ??
      Object.values(scene.relations).find((item) => slug(item.relationId) === slug(action.relationId));
    if (!relation) return { applied: `missing relation ${action.relationId}`, entityIds: [], relationIds: [] };
    delete scene.relations[relation.relationId];
    pushOperation(state, action, before, sourceText);
    return { applied: `removed relation ${relation.relationId}`, entityIds: [], relationIds: [relation.relationId] };
  }

  const reference = "entityId" in action ? action.entityId : "";
  const entity = resolveStoryEntity(state, reference);
  if (!entity) return { applied: `missing ${reference}`, entityIds: [], relationIds: [] };

  if (action.type === "update_entity") {
    if (action.label) entity.label = action.label;
    entity.aliases = unique([...entity.aliases, ...(action.aliases ?? []), entity.label]);
    const target = action.targetEntityId
      ? resolveStoryEntity(state, action.targetEntityId)?.entityId
      : undefined;
    entity.state = {
      ...entity.state,
      ...action.state,
      ...(action.state?.appearance
        ? { appearance: { ...entity.state.appearance, ...action.state.appearance } }
        : {}),
      ...(target ? { directionTargetId: target } : {}),
    };
  } else if (action.type === "add_visual_effect") {
    entity.effects = unique([...entity.effects, action.effect]);
  } else if (action.type === "remove_visual_effect") {
    entity.effects = entity.effects.filter((effect) => effect !== action.effect);
  } else if (action.type === "move_entity") {
    const relative = action.placement.relativeTo
      ? resolveStoryEntity(state, action.placement.relativeTo)?.entityId ?? action.placement.relativeTo
      : undefined;
    entity.placement = { ...entity.placement, ...action.placement, ...(relative ? { relativeTo: relative } : {}) };
  } else if (action.type === "transform_entity") {
    const oldLabel = entity.label;
    entity.assetKey = action.assetKey;
    entity.visualSource = "asset";
    delete entity.recipe;
    entity.label = action.label || action.assetKey.replace(/-/g, " ");
    entity.aliases = unique([...entity.aliases, oldLabel, entity.label, action.assetKey]);
  } else if (action.type === "set_entity_visibility") {
    entity.state.visible = action.visible;
    entity.lifecycle = action.visible ? "active" : "historical";
    if (!action.visible) {
      state.activeEntityIds = state.activeEntityIds.filter((id) => id !== entity.entityId);
      state.recentEntityIds = state.recentEntityIds.filter((id) => id !== entity.entityId);
    }
  }
  touchEntity(state, entity);
  pushOperation(state, action, before, sourceText);
  return { applied: `${action.type.replace("_entity", "").replace("set_", "")} ${entity.entityId}`, entityIds: [entity.entityId], relationIds: [] };
}

function actionTarget(action: StoryAction): string {
  if ("entityId" in action) return action.entityId;
  if ("sceneId" in action) return action.sceneId;
  return action.relationId;
}

/**
 * "left" is a departure or a direction depending on the verb in front of it.
 * "The car turned left" must not hide the car.
 */
function departureMentioned(sourceText: string): boolean {
  if (/\b(?:disappears?|disappeared|vanishes?|vanished|went away|ran off|hide|hidden|gone)\b/i.test(sourceText)) return true;
  return /\b(?:leaves?|left)\b/i.test(sourceText) &&
    !/\b(?:turn\w*|to the|on the|the)\s+left\b/i.test(sourceText);
}

function explicitHistoricalReference(sourceText: string): boolean {
  return /\b(?:previous|former|hidden|disappeared|vanished|earlier)\b/i.test(sourceText);
}

function mentionedEntity(sourceText: string, entity: StoryEntity): boolean {
  return entityAliases(entity).some((alias) => !isGenericReference(alias) && wordIn(sourceText, alias));
}

function sourceRefersToEntity(sourceText: string, entity: StoryEntity): boolean {
  if (mentionedEntity(sourceText, entity)) return true;
  if (/\bthe animal\b/i.test(sourceText) && entity.kind === "animal") return true;
  if (/\bit\b/i.test(sourceText) && compatible(entity, "it")) return true;
  if (/\b(?:she|her)\b/i.test(sourceText) && compatible(entity, "she")) return true;
  if (/\b(?:he|him)\b/i.test(sourceText) && compatible(entity, "he")) return true;
  return false;
}

function poseGrounded(sourceText: string, pose: string): boolean {
  const key = normalize(pose);
  if (/^sitt/.test(key)) return /\b(?:sit|sits|sat|sitting)\b/i.test(sourceText);
  if (/^runn?/.test(key)) return /\b(?:run|runs|ran|running)\b/i.test(sourceText);
  if (/^walk/.test(key)) return /\b(?:walk|walks|walked|walking)\b/i.test(sourceText);
  if (/^stand/.test(key)) return /\b(?:stand|stands|stood|standing|stood up|got up)\b/i.test(sourceText);
  if (/^sleep/.test(key)) return /\b(?:sleep|sleeps|slept|sleeping|asleep|naps?|napped)\b/i.test(sourceText);
  if (/^jump/.test(key)) return /\b(?:jump|jumps|jumped|jumping|leapt|leaps?)\b/i.test(sourceText);
  if (/^driv/.test(key)) return /\b(?:driv\w*|drove|moved?|moves|moving|went|rolled|travell?\w*|turn\w*)\b/i.test(sourceText);
  if (/^(?:stopped|parked)$/.test(key)) return /\b(?:stop|stops|stopped|stopping|parked|halted|still)\b/i.test(sourceText);
  if (/^watch/.test(key)) return /\b(?:watch|watches|watched|watching)\b/i.test(sourceText);
  if (/^shin/.test(key)) return /\b(?:shine|shines|shone|shining|sunny)\b/i.test(sourceText);
  if (/^fall/.test(key)) return /\b(?:fall|falls|fell|falling|rain)\b/i.test(sourceText);
  return wordIn(sourceText, key);
}

/** What it is doing, as distinct from how its body is arranged. */
function actionGrounded(sourceText: string, action: string): boolean {
  const key = normalize(action);
  if (/^mov/.test(key)) return /\b(?:mov\w*|driv\w*|drove|went|travell?\w*|head\w*|rolled|ran|runs?|walk\w*)\b/i.test(sourceText);
  if (/^turn/.test(key)) return /\b(?:turn|turns|turned|turning)\b/i.test(sourceText);
  if (/^eat/.test(key)) return /\b(?:eat|eats|ate|eating|feeds?|fed)\b/i.test(sourceText);
  return poseGrounded(sourceText, key);
}

function directionGrounded(sourceText: string, direction: StoryDirection): boolean {
  switch (direction) {
    case "away": return /\b(?:away|off|fled|escap\w*)\b/i.test(sourceText);
    case "toward": return /\b(?:toward|towards|into|to the|up to|at the|after)\b/i.test(sourceText);
    case "left": return /\bleft\b/i.test(sourceText);
    case "right": return /\bright\b/i.test(sourceText);
    case "up": return /\b(?:up|upward|upwards|above)\b/i.test(sourceText);
    case "down": return /\b(?:down|downward|downwards|below)\b/i.test(sourceText);
  }
}

function appearanceGrounded(sourceText: string, appearance: StoryAppearance): boolean {
  if (appearance.color && !wordIn(sourceText, appearance.color)) return false;
  if (appearance.size && !/\b(?:tiny|small|little|medium|big|large|huge|giant)\b/i.test(sourceText)) return false;
  return true;
}

/**
 * Effects are the most tempting thing for a model to add unprompted, so each
 * one names the speech that licenses it. Motion marks need a motion verb;
 * rain needs the word rain, not a mis-heard "ran".
 */
const EFFECT_GROUNDING: Record<StoryEffect, RegExp> = {
  "motion-lines": /\b(?:ran|run|runs|running|mov\w*|drove|driv\w*|walk\w*|rush\w*|sped|speed\w*|fled|away|toward|towards)\b/i,
  "speed-lines": /\b(?:fast|quick\w*|sped|speed\w*|rush\w*|rac\w*|dash\w*|zoom\w*)\b/i,
  "direction-arrow": /\b(?:toward|towards|away|into|left|right|up|down|north|south|forward)\b/i,
  "emotion-mark": /\b(?:surprised|shocked|startled|amazed|excited|scared|frightened|happy|angry)\b/i,
  "speech-bubble": /\b(?:said|says|shouted|shouts|called|calls|asked|asks|spoke|speaks|meowed|barked)\b/i,
  "rain-lines": /\brain\w*\b/i,
  smoke: /\b(?:smoke|smoking|smok\w*|steam|exhaust|fire|burning)\b/i,
  "light-rays": /\b(?:shin\w*|glow\w*|bright|sunny|light|beam\w*|sparkl\w*)\b/i,
  "sound-marks": /\b(?:loud|noise|noisy|honk\w*|bang\w*|beep\w*|roar\w*|sound\w*|crash\w*)\b/i,
};

function effectGrounded(sourceText: string, effect: StoryEffect): boolean {
  return EFFECT_GROUNDING[effect].test(sourceText);
}

function relationGrounded(sourceText: string, relation: string): boolean {
  const key = normalize(relation);
  if (key.includes("under")) return /\b(?:under|beneath|below)\b/i.test(sourceText);
  if (key.includes("toward")) return /\b(?:toward|towards|into|after|chases?|runs?)\b/i.test(sourceText);
  if (key.includes("behind")) return /\bbehind\b/i.test(sourceText);
  if (key.includes("front")) return /\b(?:in front|before)\b/i.test(sourceText);
  if (key.includes("away")) return /\b(?:away|off|fled|escap\w*)\b/i.test(sourceText);
  if (key === "on" || key.includes("-on") || key.includes("on-")) {
    return /\b(?:on|onto|along|down|up)\b/i.test(sourceText);
  }
  if (key.includes("near")) return /\b(?:near|beside|by|along)\b/i.test(sourceText);
  if (key.includes("watch")) return /\b(?:watch|watches|watched|watching|sees?|saw)\b/i.test(sourceText);
  if (key.includes("chase")) return /\b(?:chase|chases|chased|after)\b/i.test(sourceText);
  return wordIn(sourceText, key);
}

function validateStoryAction(
  state: StoryState,
  action: StoryAction,
  sourceText: string,
  actionIndex: number,
): StoryActionDecision {
  const resolutions: StoryActionDecision["entityResolutions"] = [];
  const base = {
    actionIndex,
    actionType: action.type,
    target: actionTarget(action),
    entityResolutions: resolutions,
    warnings: [] as string[],
  };
  const accept = (reason: string, extra: Partial<StoryActionDecision> = {}): StoryActionDecision =>
    ({ ...base, accepted: true, reason, ...extra });
  const reject = (reason: string, extra: Partial<StoryActionDecision> = {}): StoryActionDecision =>
    ({ ...base, accepted: false, reason, ...extra });
  const allowHistorical = explicitHistoricalReference(sourceText);
  const resolve = (reference: string, kind?: StoryEntityKind): StoryEntity | null => {
    const active = resolveStoryEntity(state, reference, kind);
    if (active) {
      resolutions.push({ reference, entityId: active.entityId, status: "resolved" });
      return active;
    }
    const historical = resolveStoryEntity(state, reference, kind, { includeHistorical: true });
    if (historical) resolutions.push({ reference, entityId: historical.entityId, status: "historical" });
    else resolutions.push({ reference, status: "missing" });
    return allowHistorical ? historical : null;
  };

  if (action.type === "create_scene") {
    const existing = sceneByReference(state, action.sceneId) ?? sceneByReference(state, action.label);
    if (existing) return wordIn(sourceText, existing.label) || /\b(?:go|return|back)\b/i.test(sourceText)
      ? accept("existing scene explicitly referenced")
      : reject("scene activation is not supported by this sentence");
    if (!state.activeSceneId) return accept("structural first scene");
    return wordIn(sourceText, action.label)
      ? accept("new scene label is present in source")
      : reject("new scene is not supported by this sentence");
  }
  if (action.type === "activate_scene") {
    const scene = sceneByReference(state, action.sceneId);
    if (!scene) return reject(`missing scene ${action.sceneId}`);
    return wordIn(sourceText, scene.label) && /\b(?:go|return|back|scene|again)\b/i.test(sourceText)
      ? accept("scene return is explicit")
      : reject("scene activation is not explicit");
  }
  if (!activeStoryScene(state)) return reject("no active scene");

  if (action.type === "create_entity") {
    // A claimed asset must depict the label. An absent asset is not a failure:
    // the renderer composes it, or falls back to a labelled placeholder.
    if (action.assetKey && !storyAssetMatchesLabel(action.assetKey, action.label)) {
      return reject(`asset ${action.assetKey} does not match label ${action.label}`, {
        assetResolution: { requested: action.assetKey, status: "mismatch" },
      });
    }
    if (action.assetKey && !storyAssetMatchesKind(action.assetKey, action.kind)) {
      return reject(`asset ${action.assetKey} is incompatible with kind ${action.kind}`, {
        assetResolution: { requested: action.assetKey, status: "mismatch" },
      });
    }
    const visual = resolveStoryVisual(action.label, action.kind, action.assetKey);
    const assetResolution: StoryActionDecision["assetResolution"] = visual.assetKey
      ? { requested: action.assetKey ?? visual.assetKey, resolved: visual.assetKey, status: "matched" }
      : { requested: action.assetKey ?? action.label, resolved: visual.recipe, status: "needs_asset" };
    const beachPreset = /\bbeach\b/i.test(sourceText) &&
      ["beach", "sand", "water", "waves", "sun"].includes(visual.assetKey ?? "");
    if (!assetMentioned(sourceText, visual.assetKey) && !wordIn(sourceText, action.label) && !beachPreset) {
      return reject(`${action.label} is not present in source`, { assetResolution });
    }
    const existing = resolveStoryEntity(state, action.entityId, action.kind) ?? resolveStoryEntity(state, action.label, action.kind);
    if (existing && action.forceNew !== true && !/\b(?:another|second|different)\b/i.test(sourceText)) {
      resolutions.push({ reference: action.label, entityId: existing.entityId, status: "resolved" });
    } else {
      resolutions.push({ reference: action.label, status: "created" });
    }
    const pose = action.state?.pose;
    const doing = action.state?.action;
    if (pose && !poseGrounded(sourceText, pose)) {
      return reject(`pose ${pose} is not supported by source`, { assetResolution });
    }
    if (pose && !storyPoseSupported(action.kind, pose)) {
      return reject(`pose ${pose} cannot be drawn for a ${action.kind}`, { assetResolution });
    }
    if (doing && !actionGrounded(sourceText, doing)) {
      return reject(`action ${doing} is not supported by source`, { assetResolution });
    }
    if (doing && !storyActionSupported(action.kind, doing)) {
      return reject(`action ${doing} cannot be drawn for a ${action.kind}`, { assetResolution });
    }
    if (!storyPoseActionCompatible(pose, doing)) {
      return reject(`pose ${pose} conflicts with action ${doing}`, { assetResolution });
    }
    if (action.state?.direction && !directionGrounded(sourceText, action.state.direction)) {
      return reject(`direction ${action.state.direction} is not supported by source`, { assetResolution });
    }
    if (action.state?.appearance && !appearanceGrounded(sourceText, action.state.appearance)) {
      return reject(`appearance is not described in source`, { assetResolution });
    }
    const ungroundedEffect = (action.effects ?? []).find((effect) => !effectGrounded(sourceText, effect));
    if (ungroundedEffect) {
      return reject(`effect ${ungroundedEffect} is not supported by source`, { assetResolution });
    }
    if (action.placement?.relation && !relationGrounded(sourceText, action.placement.relation)) {
      return reject(`placement ${action.placement.relation} is not supported by source`, { assetResolution });
    }
    if (action.placement?.relativeTo && !resolveStoryEntity(state, action.placement.relativeTo)) {
      return reject(`placement target ${action.placement.relativeTo} is unavailable`, { assetResolution });
    }
    const how = visual.visualSource === "asset"
      ? "grounded entity created"
      : visual.visualSource === "placeholder"
        ? `grounded entity created as a labelled placeholder`
        : `grounded entity composed from ${visual.recipe} primitives`;
    return accept(existing ? "grounded entity reused" : beachPreset ? "explicit beach scene preset" : how, { assetResolution });
  }

  if (action.type === "remove_relation") {
    const scene = activeStoryScene(state);
    const relation = scene?.relations[action.relationId];
    if (!relation) return reject(`missing relation ${action.relationId}`);
    return /\b(?:stop\w*|no longer|not any ?more|separat\w*|apart|let go|releas\w*)\b/i.test(sourceText)
      ? accept("relation removal is explicit")
      : reject("relation removal is inferred rather than explicit");
  }

  if (action.type === "upsert_relation") {
    const from = resolve(action.fromEntityId);
    const to = resolve(action.toEntityId);
    if (!from || !to || from.entityId === to.entityId) return reject("relation endpoints are not active and distinct");
    if (!sourceRefersToEntity(sourceText, from) || !relationGrounded(sourceText, action.relationType)) {
      return reject(`relation ${action.relationType} is not grounded in source`);
    }
    return accept("relation and endpoints are grounded");
  }

  const entity = resolve(action.entityId);
  if (!entity) return reject(`target ${action.entityId} is not an active entity`);
  if (!sourceRefersToEntity(sourceText, entity)) return reject(`target ${entity.label} is not referenced by source`);

  if (action.type === "update_entity") {
    const pose = action.state?.pose;
    const doing = action.state?.action;
    const direction = action.state?.direction;
    const appearance = action.state?.appearance;
    const emotion = action.state?.emotion;
    if (pose && !poseGrounded(sourceText, pose)) return reject(`pose ${pose} is not supported by source`);
    if (pose && !storyPoseSupported(entity.kind, pose)) return reject(`pose ${pose} cannot be drawn for a ${entity.kind}`);
    if (doing && !actionGrounded(sourceText, doing)) return reject(`action ${doing} is not supported by source`);
    if (doing && !storyActionSupported(entity.kind, doing)) return reject(`action ${doing} cannot be drawn for a ${entity.kind}`);
    // The incoming pose wins over a stale one when only the action is changing.
    if (!storyPoseActionCompatible(pose ?? (doing ? undefined : entity.state.pose), doing ?? entity.state.action)) {
      return reject(`pose ${pose ?? entity.state.pose} conflicts with action ${doing ?? entity.state.action}`);
    }
    if (direction && !directionGrounded(sourceText, direction)) return reject(`direction ${direction} is not supported by source`);
    if (appearance && !appearanceGrounded(sourceText, appearance)) return reject("appearance is not described in source");
    if (emotion && !wordIn(sourceText, emotion)) return reject(`emotion ${emotion} is not supported by source`);
    if (action.targetEntityId) {
      const target = resolve(action.targetEntityId);
      if (!target) return reject(`direction target ${action.targetEntityId} is unavailable`);
      if (!mentionedEntity(sourceText, target)) return reject(`direction target ${target.label} is not present in source`);
    }
    const empty = !pose && !doing && doing !== null && !direction && !appearance && !emotion &&
      !action.label && !(action.aliases?.length);
    if (empty) return reject("empty update");
    return accept("entity update is grounded");
  }
  if (action.type === "add_visual_effect" || action.type === "remove_visual_effect") {
    if (!isStoryEffect(action.effect)) return reject(`unknown visual effect ${action.effect}`);
    if (action.type === "remove_visual_effect") {
      return entity.effects.includes(action.effect)
        ? accept("effect removal targets an existing effect")
        : reject(`effect ${action.effect} is not present on ${entity.entityId}`);
    }
    return effectGrounded(sourceText, action.effect)
      ? accept("visual effect is grounded")
      : reject(`effect ${action.effect} is not supported by source`);
  }
  if (action.type === "move_entity") {
    const relation = action.placement.relation;
    if (!relation) {
      const zone = action.placement.zone;
      return zone && wordIn(sourceText, zone)
        ? accept("explicit zone movement is grounded")
        : reject("movement relation or explicit zone is not grounded in source");
    }
    if (!relationGrounded(sourceText, relation)) return reject("movement relation is not grounded in source");
    if (action.placement.relativeTo) {
      const target = resolve(action.placement.relativeTo);
      if (!target) return reject(`movement target ${action.placement.relativeTo} is unavailable`);
      if (!mentionedEntity(sourceText, target) && !assetMentioned(sourceText, target.assetKey)) {
        return reject(`movement target ${target.label} is not present in source`);
      }
    }
    return accept("movement is grounded");
  }
  if (action.type === "transform_entity") {
    const label = action.label || action.assetKey.replace(/-/g, " ");
    const assetResolution: StoryActionDecision["assetResolution"] = storyAssetMatchesLabel(action.assetKey, label)
      ? { requested: action.assetKey, resolved: action.assetKey, status: "matched" }
      : { requested: action.assetKey, status: "mismatch" };
    if (assetResolution.status !== "matched") return reject("transform asset and label mismatch", { assetResolution });
    if (!storyAssetMatchesKind(action.assetKey, entity.kind)) return reject(`transform asset ${action.assetKey} is incompatible with kind ${entity.kind}`, { assetResolution });
    if (!assetMentioned(sourceText, action.assetKey) || !/\b(?:make|turn|change|actually|correct)\b/i.test(sourceText)) {
      return reject("transform is not explicitly requested", { assetResolution });
    }
    return accept("explicit type-safe transform", { assetResolution });
  }
  if (action.type === "set_entity_visibility") {
    const grounded = action.visible
      ? /\b(?:appears?|appeared|returns?|visible|back)\b/i.test(sourceText)
      : departureMentioned(sourceText);
    return grounded ? accept("visibility change is explicit") : reject("visibility change is inferred rather than explicit");
  }
  return reject("unsupported action");
}

export interface StoryApplyOptions {
  /** Conservative speech correction, used for meaning when it is trustworthy. */
  normalizedText?: string;
  confidence?: number;
}

/** Correction is only allowed to change meaning when the corrector is sure. */
export const STORY_NORMALIZATION_CONFIDENCE = 0.8;

export function storySemanticText(
  sourceText: string,
  options: StoryApplyOptions = {},
): string {
  const normalized = clean(options.normalizedText);
  if (!normalized) return sourceText;
  return (options.confidence ?? 0) >= STORY_NORMALIZATION_CONFIDENCE ? normalized : sourceText;
}

export function applyStoryActions(
  input: StoryState,
  actions: StoryAction[],
  sourceText: string,
  currentPage: number,
  options: StoryApplyOptions = {},
): StoryApplyResult {
  // Raw speech stays in the operation log and the decision record; only
  // grounding reads the corrected text.
  const semanticText = storySemanticText(sourceText, options);
  const state = restoreStoryState(input);
  const applied: string[] = [];
  const entityIds: string[] = [];
  const relationIds: string[] = [];
  let activatedSceneId: string | undefined;
  const acceptedActions: StoryAction[] = [];
  const decisions: StoryActionDecision[] = [];
  for (const [actionIndex, action] of actions.slice(0, 16).entries()) {
    if (!Number.isInteger(currentPage) || currentPage < 0) {
      decisions.push({
        actionIndex,
        actionType: action.type,
        target: actionTarget(action),
        accepted: false,
        reason: `invalid target page ${currentPage}`,
        entityResolutions: [],
        warnings: [],
      });
      continue;
    }
    if (!isThoughtComplete(semanticText)) {
      decisions.push({
        actionIndex,
        actionType: action.type,
        target: actionTarget(action),
        accepted: false,
        reason: "source transcript is incomplete",
        entityResolutions: [],
        warnings: [],
      });
      continue;
    }
    const decision = validateStoryAction(state, action, semanticText, actionIndex);
    decisions.push(decision);
    if (!decision.accepted) continue;
    acceptedActions.push(action);
    const result = applyOne(state, action, semanticText, currentPage);
    applied.push(result.applied);
    entityIds.push(...result.entityIds);
    relationIds.push(...result.relationIds);
    activatedSceneId = result.activated ?? activatedSceneId;
  }
  return {
    state,
    applied,
    changedEntityIds: unique(entityIds),
    changedRelationIds: unique(relationIds),
    activatedSceneId,
    acceptedActions,
    decisions,
  };
}

export function undoStoryAction(state: StoryState): { state: StoryState; operation?: StoryOperation } {
  const operation = state.operations.at(-1);
  if (!operation) return { state };
  return {
    state: {
      ...clone(operation.before),
      operations: state.operations.slice(0, -1),
    },
    operation,
  };
}

export function continueStoryScene(
  input: StoryState,
  pageIndex: number,
): StoryState {
  const state = restoreStoryState(input);
  const scene = activeStoryScene(state);
  if (scene && !scene.pageIndices.includes(pageIndex)) scene.pageIndices.push(pageIndex);
  return state;
}

export function storyInterpreterContext(
  state: StoryState,
  transcript: string,
  currentPage: number,
): StoryInterpreterContext {
  const scene = activeStoryScene(state);
  const allEntities = scene ? Object.values(scene.entities) : [];
  const entities = allEntities.filter((entity) => entity.lifecycle === "active" && entity.state.visible !== false);
  const byId = new Map(entities.map((entity) => [entity.entityId, entity]));
  return {
    mode: "story",
    transcript,
    activeScene: scene?.sceneId ?? "",
    existingEntities: entities,
    recentEntities: state.recentEntityIds
      .map((id) => byId.get(id))
      .filter((entity): entity is StoryEntity => Boolean(entity)),
    historicalEntities: allEntities.filter((entity) => entity.lifecycle !== "active" || entity.state.visible === false),
    existingRelations: scene ? Object.values(scene.relations) : [],
    currentPage,
  };
}

function rawAppearance(value: unknown): StoryAppearance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const appearance: StoryAppearance = {};
  if (clean(item.color)) appearance.color = clean(item.color).toLowerCase();
  if (clean(item.size)) appearance.size = clean(item.size).toLowerCase();
  return Object.keys(appearance).length ? appearance : undefined;
}

function rawEffects(value: unknown): StoryEffect[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const effects = value.map(clean).filter(isStoryEffect);
  return effects.length ? unique(effects) : undefined;
}

/**
 * The interpreter may write pose/action/direction/appearance either nested
 * under `state` or flat on the action, because both read naturally. Both are
 * folded into one entity state here so nothing downstream has to care.
 */
function rawEntityState(item: Record<string, unknown>): Partial<StoryEntityState> | undefined {
  const nested = item.state && typeof item.state === "object"
    ? item.state as Record<string, unknown>
    : {};
  const merged: Record<string, unknown> = { ...nested };
  for (const key of ["pose", "action", "direction", "emotion", "appearance", "visible"]) {
    if (item[key] !== undefined) merged[key] = item[key];
  }
  const state: Partial<StoryEntityState> = {};
  if (clean(merged.pose)) state.pose = clean(merged.pose).toLowerCase();
  // An explicit null clears the action — "the cat stopped running".
  if (merged.action === null) state.action = null;
  else if (clean(merged.action)) state.action = clean(merged.action).toLowerCase();
  const direction = clean(merged.direction).toLowerCase() as StoryDirection;
  if (DIRECTIONS.includes(direction)) state.direction = direction;
  if (clean(merged.emotion)) state.emotion = clean(merged.emotion).toLowerCase();
  const appearance = rawAppearance(merged.appearance);
  if (appearance) state.appearance = appearance;
  if (typeof merged.visible === "boolean") state.visible = merged.visible;
  return Object.keys(state).length ? state : undefined;
}

function rawAction(value: unknown): StoryAction | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const type = clean(item.type) as StoryAction["type"];
  const entityId = clean(item.entityId);
  const placement = item.placement && typeof item.placement === "object"
    ? item.placement as StoryPlacement
    : undefined;
  const state = rawEntityState(item);
  switch (type) {
    case "create_scene":
      return clean(item.label) ? { type, sceneId: clean(item.sceneId) || slug(clean(item.label)), label: clean(item.label) } : null;
    case "activate_scene":
      return clean(item.sceneId) ? { type, sceneId: clean(item.sceneId) } : null;
    case "create_entity": {
      const requested = clean(item.assetKey) as StoryAssetKey;
      const kind = clean(item.kind) as StoryEntityKind;
      const label = clean(item.label);
      if (!entityId || !label || !KINDS.includes(kind)) return null;
      // An unknown assetKey is not fatal. The renderer composes the subject
      // from primitives instead of borrowing another subject's art.
      return {
        type, entityId, kind, label,
        ...(ASSET_KEYS.includes(requested) ? { assetKey: requested } : {}),
        aliases: Array.isArray(item.aliases) ? item.aliases.map(clean).filter(Boolean) : undefined,
        state,
        placement,
        effects: rawEffects(item.effects),
        forceNew: item.forceNew === true,
      };
    }
    case "update_entity":
      return entityId
        ? {
            type, entityId, state,
            label: clean(item.label) || undefined,
            aliases: Array.isArray(item.aliases) ? item.aliases.map(clean).filter(Boolean) : undefined,
            targetEntityId: clean(item.targetEntityId) || undefined,
          }
        : null;
    case "move_entity":
      return entityId && placement ? { type, entityId, placement } : null;
    case "transform_entity": {
      const assetKey = clean(item.assetKey) as StoryAssetKey;
      return entityId && ASSET_KEYS.includes(assetKey) ? { type, entityId, assetKey, label: clean(item.label) || undefined } : null;
    }
    case "set_entity_visibility":
      return entityId && typeof item.visible === "boolean" ? { type, entityId, visible: item.visible } : null;
    case "upsert_relation": {
      const fromEntityId = clean(item.fromEntityId);
      const toEntityId = clean(item.toEntityId);
      const relationType = clean(item.relationType);
      if (!fromEntityId || !toEntityId || !relationType) return null;
      return {
        type,
        relationId: clean(item.relationId) || slug(`${fromEntityId}-${toEntityId}-${relationType}`),
        fromEntityId,
        toEntityId,
        relationType,
        visual: item.visual === "movement-arrow" || item.visual === "motion-lines"
          ? item.visual
          : undefined,
      };
    }
    case "remove_relation":
      return clean(item.relationId) ? { type, relationId: clean(item.relationId) } : null;
    case "add_visual_effect":
    case "remove_visual_effect": {
      const effect = clean(item.effect);
      return entityId && isStoryEffect(effect) ? { type, entityId, effect } : null;
    }
    default:
      return null;
  }
}

export function parseStoryActions(raw: string | unknown): StoryAction[] {
  let payload: unknown = raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    try {
      payload = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/[[{][\s\S]*[\]}]/);
      if (!match) return [];
      try { payload = JSON.parse(match[0]); } catch { return []; }
    }
  }
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { actions?: unknown[] })?.actions)
      ? (payload as { actions: unknown[] }).actions
      : [];
  return list.map(rawAction).filter((action): action is StoryAction => action !== null).slice(0, 16);
}

export function parseStoryInterpretation(raw: string | unknown, sourceText: string): StoryInterpretation | null {
  let payload: unknown = raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    try {
      payload = JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { actions?: unknown }).actions)) return null;
  const item = payload as Record<string, unknown>;
  const proposed = item.actions as unknown[];
  const warnings = proposed.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const action = value as Record<string, unknown>;
    if (action.type !== "create_entity" && action.type !== "transform_entity") return [];
    const requested = clean(action.assetKey) as StoryAssetKey;
    if (ASSET_KEYS.includes(requested)) return [];
    const label = clean(action.label) || requested || "unknown";
    if (action.type === "transform_entity") return [`needs_asset:${label}`];
    // No prepared asset is only worth reporting when primitives cannot do it.
    const kind = clean(action.kind) as StoryEntityKind;
    const visual = resolveStoryVisual(label, KINDS.includes(kind) ? kind : "object");
    return visual.visualSource === "asset"
      ? []
      : [`${visual.visualSource}:${label}${visual.recipe ? `:${visual.recipe}` : ""}`];
  });
  const confidence = typeof item.confidence === "number"
    ? Math.max(0, Math.min(1, item.confidence))
    : 0.5;
  return {
    sourceText,
    normalizedText: clean(item.normalizedText) || sourceText.trim().replace(/\s+/g, " "),
    confidence,
    actions: parseStoryActions(payload),
    warnings,
  };
}

// ---- deterministic visual-action floor --------------------------------------

interface SubjectRule {
  pattern: RegExp;
  label: string;
  kind: StoryEntityKind;
  aliases: string[];
}

const SUBJECT_RULES: SubjectRule[] = [
  { pattern: /\bcats?\b/, label: "cat", kind: "animal", aliases: ["the cat", "it", "animal"] },
  { pattern: /\bdogs?\b/, label: "dog", kind: "animal", aliases: ["the dog", "it", "animal"] },
  { pattern: /\b(?:mouse|mice)\b/, label: "mouse", kind: "animal", aliases: ["the mouse", "it"] },
  { pattern: /\bcars?\b/, label: "car", kind: "vehicle", aliases: ["the car", "it"] },
  { pattern: /\b(?:girl|child)\b/, label: "girl", kind: "character", aliases: ["she", "her", "child"] },
  { pattern: /\b(?:person|man|woman)\b/, label: "person", kind: "character", aliases: ["they", "them"] },
];

/** Nouns that can be the object of a movement or a spatial relation. */
const OBJECT_RULES: Array<{ pattern: RegExp; label: string; kind: StoryEntityKind; zone: StoryZone }> = [
  { pattern: /\bpalm trees?\b/, label: "palm tree", kind: "object", zone: "right" },
  { pattern: /\btrees?\b/, label: "tree", kind: "object", zone: "right" },
  { pattern: /\broads?\b/, label: "road", kind: "object", zone: "center" },
  { pattern: /\bwater\b|\bsea\b|\bocean\b/, label: "water", kind: "background", zone: "right" },
  { pattern: /\brain\b/, label: "rain", kind: "background", zone: "background" },
  { pattern: /\bhouses?\b|\bhome\b/, label: "house", kind: "object", zone: "right" },
  { pattern: /\bclouds?\b/, label: "cloud", kind: "background", zone: "right" },
];

/** Verb -> pose and action. The two are set together but stay separate fields. */
const VERB_RULES: Array<{ pattern: RegExp; pose: string; action: string | null }> = [
  { pattern: /\b(?:stood up|stands up|gets up|got up|standing|stands|stood)\b/, pose: "standing", action: null },
  { pattern: /\b(?:sat|sits|sitting|sit)\b/, pose: "sitting", action: null },
  { pattern: /\b(?:ran|runs|running|run)\b/, pose: "running", action: "running" },
  { pattern: /\b(?:walked|walks|walking|walk)\b/, pose: "walking", action: "moving" },
  { pattern: /\b(?:jumped|jumps|jumping|leapt)\b/, pose: "jumping", action: "jumping" },
  { pattern: /\b(?:slept|sleeps|sleeping|asleep|napped)\b/, pose: "sleeping", action: "sleeping" },
  { pattern: /\b(?:stopped|stops|parked|halted)\b/, pose: "stopped", action: "stopped" },
  { pattern: /\b(?:drove|drives|driving|moved|moves|moving|rolled|travelled|traveled)\b/, pose: "driving", action: "moving" },
];

const DIRECTION_RULES: Array<{ pattern: RegExp; direction: StoryDirection }> = [
  { pattern: /\baway\b/, direction: "away" },
  { pattern: /\b(?:toward|towards|into)\b/, direction: "toward" },
  { pattern: /\bleft\b/, direction: "left" },
  { pattern: /\bright\b/, direction: "right" },
  { pattern: /\bdown\b/, direction: "down" },
  { pattern: /\bup\b/, direction: "up" },
];

const COLOR_WORDS = /\b(red|orange|yellow|green|blue|purple|pink|brown|black|white|grey|gray|silver)\b/;

/** A pose the renderer cannot draw for this kind degrades to one it can. */
function poseForKind(kind: StoryEntityKind, pose: string, action: string | null): { pose: string; action: string | null } {
  if (storyPoseSupported(kind, pose)) {
    return { pose, action: action && storyActionSupported(kind, action) ? action : null };
  }
  if (kind === "vehicle") {
    const vehiclePose = /^(?:stopped|parked)$/.test(pose) ? "stopped" : "driving";
    return { pose: vehiclePose, action: vehiclePose === "stopped" ? "stopped" : "moving" };
  }
  return { pose: "standing", action: action && storyActionSupported(kind, action) ? action : null };
}

/**
 * The generic subject-verb-object floor.
 *
 * It runs only for subjects the scripted beach rules above did not already
 * handle, so it adds reach without changing any behaviour those rules own.
 */
function interpretVisualActions(
  context: StoryInterpreterContext,
  handled: Set<string>,
): StoryAction[] {
  const text = context.transcript.toLowerCase();
  const actions: StoryAction[] = [];
  const subject = SUBJECT_RULES.find((rule) => rule.pattern.test(text) && !handled.has(rule.label));
  const verb = VERB_RULES.find((rule) => rule.pattern.test(text));
  const direction = DIRECTION_RULES.find((rule) => rule.pattern.test(text))?.direction;
  const appeared = /\b(?:appeared|appears|arrived|arrives|showed up)\b/.test(text);
  const vanished = departureMentioned(text);

  // An object that is spoken about is worth drawing even when the subject is
  // the thing acting on it. "toward the water" needs water on the page.
  const objects = OBJECT_RULES.filter((rule) => rule.pattern.test(text) && !handled.has(rule.label));
  for (const object of objects) {
    if (entityIn(context, object.label)) continue;
    actions.push({
      type: "create_entity",
      entityId: `${slug(object.label)}-1`,
      kind: object.kind,
      label: object.label,
      placement: { zone: object.zone },
      ...(object.label === "rain" ? { state: { pose: "falling" } } : {}),
    });
  }

  if (!subject) {
    // An unfamiliar noun that enters the scene still gets a sketch of its own.
    const unknown = text.match(/\b(?:a|an|the)\s+(?:[a-z]+\s+)?([a-z]+)\s+(?:appeared|arrived|showed up)\b/);
    const noun = unknown?.[1];
    if (noun && !storyAssetForLabel(noun) && !entityIn(context, noun)) {
      actions.push({
        type: "create_entity",
        entityId: `${slug(noun)}-1`,
        kind: "object",
        label: noun,
        placement: { zone: "center" },
      });
    }
    return actions;
  }

  // Look the subject up by its own name only. Its pronoun aliases ("it") are
  // shared with every other actor and would resolve to the wrong one.
  const existing = entityIn(context, subject.label);
  const appearance = COLOR_WORDS.exec(text)?.[1];
  const target = objects[0] ?? OBJECT_RULES.find((rule) => rule.pattern.test(text));
  const targetId = target
    ? entityIn(context, target.label)?.entityId ?? `${slug(target.label)}-1`
    : undefined;

  if (vanished && existing) {
    return [...actions, { type: "set_entity_visibility", entityId: existing.entityId, visible: false }];
  }

  const posed = verb ? poseForKind(subject.kind, verb.pose, verb.action) : undefined;

  if (!existing) {
    actions.push({
      type: "create_entity",
      entityId: `${slug(subject.label)}-1`,
      kind: subject.kind,
      label: subject.label,
      aliases: subject.aliases,
      state: {
        ...(posed ? { pose: posed.pose, action: posed.action } : {}),
        ...(direction ? { direction } : {}),
        ...(appearance ? { appearance: { color: appearance } } : {}),
      },
      placement: {
        zone: subject.kind === "vehicle" ? "left" : "center",
        ...(targetId && target?.label === "road" ? { relativeTo: targetId, relation: "on" } : {}),
      },
    });
  } else if (posed || direction || appearance) {
    actions.push({
      type: "update_entity",
      entityId: existing.entityId,
      state: {
        ...(posed ? { pose: posed.pose, action: posed.action } : {}),
        ...(direction ? { direction } : {}),
        ...(appearance ? { appearance: { color: appearance } } : {}),
      },
      ...(targetId && direction ? { targetEntityId: targetId } : {}),
    });
  } else if (appeared && !existing) {
    actions.push({ type: "set_entity_visibility", entityId: subject.label, visible: true });
  }

  const subjectRef = existing?.entityId ?? `${slug(subject.label)}-1`;

  // Movement toward or away from a named thing is a relationship, not just a
  // pose. Placement moves the sketch; the relation records why.
  if (targetId && direction && (direction === "toward" || direction === "away")) {
    actions.push(
      { type: "move_entity", entityId: subjectRef, placement: { relativeTo: targetId, relation: direction } },
      {
        type: "upsert_relation",
        relationId: slug(`${subjectRef}-${direction}-${targetId}`),
        fromEntityId: subjectRef,
        toEntityId: targetId,
        relationType: direction === "away" ? "moves-away-from" : "moves-toward",
        visual: "movement-arrow",
      },
    );
  }

  if (posed?.action && /^(?:running|moving)$/.test(posed.action)) {
    actions.push({ type: "add_visual_effect", entityId: subjectRef, effect: "motion-lines" });
  } else if (posed?.action === "stopped" && existing?.effects.includes("motion-lines")) {
    actions.push({ type: "remove_visual_effect", entityId: subjectRef, effect: "motion-lines" });
  }
  return actions;
}

const entityIn = (context: StoryInterpreterContext, ...refs: string[]) => {
  const keys = refs.map(normalize);
  return context.existingEntities.find((entity) =>
    entityAliases(entity).some((alias) => keys.includes(alias)),
  );
};

/** Offline floor for known story speech and model failures. */
export function interpretStoryDeterministically(
  context: StoryInterpreterContext,
): StoryAction[] {
  const text = context.transcript.toLowerCase();
  const actions: StoryAction[] = [];
  const sceneId = context.activeScene || "beach-scene";
  if (!context.activeScene && /\b(?:cat|dog|mouse|tree|sun|sunny|rain|beach|girl|child|person|house|car|road|water|machine|appeared)\b/.test(text)) {
    actions.push({ type: "create_scene", sceneId: "default-scene", label: "Scene" });
  }
  if (/\b(?:sun|sunny)\b/.test(text) && !entityIn(context, "sun")) {
    actions.push({ type: "create_entity", entityId: "sun-1", kind: "background", assetKey: "sun", label: "sun", state: { pose: "shining" }, placement: { zone: "right" } });
  }
  if (/\bcat\b.*\b(?:sit|sits|sat|sitting)\b.*\b(?:under|beneath|below)\b.*\btree\b/.test(text)) {
    if (!entityIn(context, "cat")) actions.push({ type: "create_entity", entityId: "cat-1", kind: "animal", assetKey: "cat", label: "cat", aliases: ["the cat", "it", "animal"], state: { pose: "sitting" }, placement: { zone: "center" } });
    else actions.push({ type: "update_entity", entityId: "cat", state: { pose: "sitting" } });
    if (!entityIn(context, "tree")) actions.push({ type: "create_entity", entityId: "tree-1", kind: "object", assetKey: "tree", label: "tree", placement: { zone: "right" } });
    actions.push({ type: "move_entity", entityId: "cat", placement: { zone: "center", relativeTo: "tree", relation: "under" } });
  }
  if (/\bmouse\b.*\b(?:watch|watches|watched|watching|sees?|saw)\b.*\bcat\b/.test(text)) {
    if (!entityIn(context, "mouse")) actions.push({ type: "create_entity", entityId: "mouse-1", kind: "animal", assetKey: "mouse", label: "mouse", state: { pose: "watching" }, placement: { zone: "left" } });
    actions.push({ type: "upsert_relation", relationId: "mouse-watches-cat", fromEntityId: "mouse", toEntityId: "cat", relationType: "watched" });
  }
  if (/\bcat\b.*\b(?:run|runs|ran|running)\b.*\b(?:into|toward|towards)\b.*\brain\b/.test(text)) {
    if (!entityIn(context, "rain")) actions.push({ type: "create_entity", entityId: "rain-1", kind: "background", assetKey: "rain", label: "rain", state: { pose: "falling" }, placement: { zone: "background" } });
    actions.push(
      { type: "update_entity", entityId: "cat", state: { pose: "running" } },
      { type: "move_entity", entityId: "cat", placement: { relativeTo: "rain", relation: "toward" } },
      { type: "upsert_relation", relationId: "cat-rain", fromEntityId: "cat", toEntityId: "rain", relationType: "runs-toward", visual: "movement-arrow" },
    );
  }
  if (/\b(?:story begins|begins|start)\b.*\bbeach\b|\bbeach story\b/.test(text)) {
    actions.push({ type: "create_scene", sceneId: "beach-scene", label: "Beach" });
    const backgrounds: Array<[string, StoryEntityKind, StoryAssetKey, StoryZone]> = [
      ["beach-1", "location", "beach", "background"],
      ["sand-1", "background", "sand", "background"],
      ["water-1", "background", "water", "background"],
      ["waves-1", "background", "waves", "background"],
      ["sun-1", "background", "sun", "right"],
    ];
    for (const [entityId, kind, assetKey, zone] of backgrounds) {
      actions.push({ type: "create_entity", entityId, kind, assetKey, label: assetKey, placement: { zone } });
    }
    return actions;
  }
  if (/\b(?:girl|child)\b.*\bwalk/.test(text)) {
    actions.push({
      type: "create_entity", entityId: "girl-1", kind: "character", assetKey: "child",
      label: "girl", aliases: ["she", "her", "child"], state: { pose: "walking" },
      placement: { zone: "left", relativeTo: "water-1", relation: "near" },
    });
  }
  if (/\b(?:she|girl)\b.*\b(?:sees?|saw)\b.*\bcat\b/.test(text) || /\bcat\b.*\bpalm tree\b/.test(text)) {
    actions.push(
      { type: "create_entity", entityId: "cat-1", kind: "animal", assetKey: "cat", label: "cat", aliases: ["the cat", "it", "animal"], placement: { zone: "center" } },
      { type: "create_entity", entityId: "palm-tree-1", kind: "object", assetKey: "palm-tree", label: "palm tree", placement: { zone: "right" } },
      { type: "move_entity", entityId: "cat-1", placement: { zone: "center", relativeTo: "palm-tree-1", relation: "under" } },
    );
  }
  if (/\bcat\b.*\b(?:runs?|moves?)\b.*\bwater\b/.test(text)) {
    actions.push(
      { type: "update_entity", entityId: "cat", state: { pose: "running" } },
      { type: "move_entity", entityId: "cat", placement: { relativeTo: "water", relation: "toward" } },
      { type: "upsert_relation", relationId: "cat-water", fromEntityId: "cat", toEntityId: "water", relationType: "runs-toward", visual: "movement-arrow" },
    );
  }
  if (/\bsun\b.*\bbehind\b.*\bcloud/.test(text)) {
    if (!entityIn(context, "sun")) actions.push({ type: "create_entity", entityId: "sun-1", kind: "background", assetKey: "sun", label: "sun", placement: { zone: "right" } });
    if (!entityIn(context, "cloud", "clouds")) actions.push({ type: "create_entity", entityId: "cloud-1", kind: "background", assetKey: "cloud", label: "cloud", aliases: ["clouds"], placement: { zone: "right", relativeTo: "sun-1", relation: "in-front-of" } });
    actions.push({ type: "upsert_relation", relationId: "sun-cloud", fromEntityId: "sun", toEntityId: "cloud", relationType: "behind" });
  }
  if (/\b(?:make|turn|change)\b.*\bcat\b.*\bdog\b/.test(text)) {
    actions.push({ type: "transform_entity", entityId: "cat", assetKey: "dog", label: "dog" });
  }
  if (/\bdog\b.*\b(?:disappears?|disappeared|vanishes?|vanished|leaves?|left)\b/.test(text)) {
    actions.push({ type: "set_entity_visibility", entityId: "dog", visible: false });
  }
  if (/\b(?:go|come|return)(?:ing)?\s+back\b.*\bbeach\b/.test(text)) {
    actions.push({ type: "activate_scene", sceneId: "beach-scene" });
  }
  if (/\b(?:another|a second|a different)\s+cat\b/.test(text)) {
    actions.push({ type: "create_entity", entityId: "cat", kind: "animal", assetKey: "cat", label: "cat", aliases: ["the cat", "it", "animal"], placement: { zone: "right" }, forceNew: true });
  }
  if (actions.length === 0 && /\b(?:girl|she)\b/.test(text)) {
    const girl = entityIn(context, "girl", "she", "her");
    if (girl) actions.push({ type: "update_entity", entityId: "she", state: {} });
  }

  // Whatever the scripted rules did not claim falls to the generic
  // subject-verb-object floor.
  const handled = new Set<string>();
  for (const action of actions) {
    if ("label" in action && action.label) handled.add(normalize(action.label));
    if ("entityId" in action) handled.add(normalize(action.entityId).replace(/-\d+$/, ""));
  }
  actions.push(...interpretVisualActions(context, handled));
  return actions;
}

/** Story element ids are derived data and may be refreshed after rendering. */
export function setStoryRendering(
  state: StoryState,
  sceneId: string,
  entityId: string,
  pageIndex: number,
  elements: SceneElement[],
) {
  const entity = state.scenes[sceneId]?.entities[entityId];
  if (!entity) return;
  const rendering = entity.renderings.find((item) => item.pageIndex === pageIndex);
  const ids = elements.map((element) => element.id);
  if (rendering) rendering.elementIds = ids;
  else entity.renderings.push({ pageIndex, elementIds: ids });
  entity.lifecycle = ids.length ? "active" : "unrendered";
}

export function auditStoryRenderConsistency(
  state: StoryState,
  elements: SceneElement[],
): string[] {
  const ids = new Set(elements.map((element) => element.id));
  const warnings: string[] = [];
  for (const scene of Object.values(state.scenes)) {
    for (const entity of Object.values(scene.entities)) {
      const renderedIds = entity.renderings.flatMap((rendering) => rendering.elementIds);
      if (entity.state.visible === false || entity.lifecycle === "historical") {
        const present = renderedIds.filter((id) => ids.has(id));
        if (present.length) warnings.push(`hidden entity ${entity.entityId} still has visible elements`);
        continue;
      }
      if (entity.lifecycle === "active" && renderedIds.length === 0) {
        warnings.push(`active entity ${entity.entityId} is unrendered`);
      }
      for (const id of renderedIds) {
        if (!ids.has(id)) warnings.push(`entity ${entity.entityId} references missing element ${id}`);
        if (!id.startsWith(`story:${entity.entityId}:`)) warnings.push(`entity ${entity.entityId} has unstable element id ${id}`);
      }
      if (!storyEntityAssetIsValid(entity)) {
        warnings.push(`entity ${entity.entityId} label ${entity.label} mismatches asset ${entity.assetKey}`);
      }
    }
  }
  return unique(warnings);
}
