import { PAGE_H, PAGE_PAD, PAGE_W, pageOrigin } from "./ops";
import type { SceneElement } from "./scene";
import {
  storyEntityAssetIsValid,
  type StoryAssetKey,
  type StoryEntity,
  type StoryEnvironmentEffect,
  type StoryRelation,
  type StoryScene,
} from "./story";
import {
  BLUE,
  BROWN,
  colorHex,
  composePrimitives,
  effectElements,
  ellipse,
  GREEN,
  INK,
  label as labelText,
  line,
  MOTION,
  recipeSize,
  rectangle,
  resolveProceduralRecipe,
  SAND,
  sizeScale,
  SOFT,
  SUN,
  type Box,
  type Point,
  type Size,
} from "./storyPrimitives";

export const STORY_ASSET_KEYS: StoryAssetKey[] = [
  "child", "person", "cat", "dog", "mouse", "car", "road", "palm-tree", "tree",
  "beach", "sand", "water", "waves", "sun", "cloud", "rain", "puddle", "house",
  "movement-arrow", "speech-bubble",
];

export const STORY_BOUNDS = {
  x: PAGE_PAD,
  y: 124,
  width: PAGE_W - PAGE_PAD * 2,
  height: PAGE_H - 124 - PAGE_PAD,
};

const SIZES: Record<StoryAssetKey, Size> = {
  child: { width: 72, height: 126 },
  person: { width: 78, height: 138 },
  cat: { width: 104, height: 72 },
  dog: { width: 112, height: 78 },
  mouse: { width: 68, height: 42 },
  car: { width: 158, height: 82 },
  road: { width: 620, height: 46 },
  "palm-tree": { width: 112, height: 205 },
  tree: { width: 128, height: 190 },
  beach: { width: 880, height: 310 },
  sand: { width: 880, height: 170 },
  water: { width: 450, height: 190 },
  waves: { width: 420, height: 75 },
  sun: { width: 88, height: 88 },
  cloud: { width: 145, height: 72 },
  rain: { width: 130, height: 110 },
  puddle: { width: 118, height: 34 },
  house: { width: 190, height: 160 },
  "movement-arrow": { width: 120, height: 44 },
  "speech-bubble": { width: 170, height: 105 },
};

/**
 * Every consumer asks for a size the same way, so a composed subject and a
 * prepared asset are interchangeable everywhere below.
 */
export function storyEntitySize(entity: StoryEntity): Size {
  const base = entity.assetKey
    ? SIZES[entity.assetKey]
    : recipeSize(entity.recipe ?? resolveProceduralRecipe(entity.label, entity.kind));
  const scale = sizeScale(entity.state.appearance?.size);
  return { width: Math.round(base.width * scale), height: Math.round(base.height * scale) };
}

function stableize(
  elements: SceneElement[],
  prefix: string,
): SceneElement[] {
  const owner = prefix.split(":p")[0];
  return elements.map((element, index) => ({
    ...element,
    id: `${prefix}:${index}`,
    groupIds: [`inpublic:${owner}`],
    customData: {
      ...((element as Record<string, unknown>).customData as Record<string, unknown> | undefined),
      inpublicStoryOwner: owner,
      editableAsset: true,
    },
    version: (element.version as number) ?? 1,
    versionNonce: 1000 + index,
  }));
}

export function storyEntityElementPrefix(entityId: string, pageIndex: number): string {
  return `story:${entityId}:p${pageIndex}`;
}

function basePosition(entity: StoryEntity, order: number, pageIndex: number): Point {
  const origin = pageOrigin(pageIndex);
  const x0 = origin.x + STORY_BOUNDS.x;
  const y0 = origin.y + STORY_BOUNDS.y;
  const column = entity.placement.zone === "left"
    ? 0.18
    : entity.placement.zone === "right"
      ? 0.76
      : 0.48;
  const row = Math.floor(order / 3);
  return {
    x: x0 + STORY_BOUNDS.width * column - storyEntitySize(entity).width / 2 + (order % 3) * 12,
    y: y0 + 220 + row * 105,
  };
}

function fixedBackgroundPosition(entity: StoryEntity, pageIndex: number): Point | null {
  const origin = pageOrigin(pageIndex);
  const x = origin.x + STORY_BOUNDS.x;
  const y = origin.y + STORY_BOUNDS.y;
  switch (entity.assetKey) {
    case "beach": return { x: x + 34, y: y + 220 };
    case "sand": return { x: x + 34, y: y + 350 };
    case "water": return { x: x + 462, y: y + 325 };
    case "waves": return { x: x + 470, y: y + 355 };
    case "sun": return { x: x + 735, y: y + 22 };
    case "cloud": return { x: x + 650, y: y + 42 };
    case "rain": return { x: x + 665, y: y + 100 };
    case "road": return { x: x + 34, y: y + 400 };
    default: return null;
  }
}

export function storyEntityPositions(scene: StoryScene): Map<string, Box> {
  const positions = new Map<string, Box>();
  const visible = Object.values(scene.entities).filter((entity) => entity.state.visible !== false && storyEntityAssetIsValid(entity));
  const orderByPage = new Map<number, number>();
  visible.forEach((entity) => {
    const pageIndex = entity.renderings.at(-1)?.pageIndex ?? scene.pageIndices.at(-1) ?? 0;
    const order = orderByPage.get(pageIndex) ?? 0;
    orderByPage.set(pageIndex, order + 1);
    const fixed = fixedBackgroundPosition(entity, pageIndex);
    const point = fixed ?? basePosition(entity, order, pageIndex);
    positions.set(entity.entityId, { ...point, ...storyEntitySize(entity) });
  });

  // Free-standing subjects are spread out first, so anything anchored to one
  // of them follows it rather than being left behind at its old spot.
  separateFreeEntities(visible, positions);

  // Resolve relative placement after every target has a deterministic anchor.
  for (const entity of visible) {
    const current = positions.get(entity.entityId);
    const target = entity.placement.relativeTo
      ? positions.get(entity.placement.relativeTo)
      : undefined;
    if (!current || !target) continue;
    const relation = entity.placement.relation ?? "near";
    if (relation === "under") {
      current.x = target.x + target.width / 2 - current.width / 2;
      current.y = target.y + target.height - current.height * 0.35;
    } else if (relation === "in-front-of" || relation === "behind") {
      current.x = target.x - current.width * 0.35;
      current.y = target.y + current.height * 0.15;
    } else if (relation === "on") {
      // Sitting on a surface: centred along it, resting on its top edge.
      current.x = target.x + target.width * 0.22;
      current.y = target.y - current.height + Math.min(10, target.height * 0.3);
    } else if (relation === "inside") {
      current.x = target.x + target.width / 2 - current.width / 2;
      current.y = target.y + target.height / 2 - current.height / 2;
    } else if (relation === "toward") {
      current.x = target.x - current.width - 110;
      current.y = target.y + target.height / 2 - current.height / 2;
    } else if (relation === "away") {
      // Away means visibly separated from the thing it left.
      current.x = target.x - current.width - 230;
      current.y = target.y + target.height - current.height;
    } else {
      current.x = target.x - current.width - 26;
      current.y = target.y + target.height - current.height;
    }
  }

  return positions;
}

/** Backdrops are meant to sit behind everything, so they never move aside. */
const BACKDROP_KINDS = new Set(["background", "location"]);

function overlaps(a: Box, b: Box, pad: number): boolean {
  return a.x < b.x + b.width + pad && a.x + a.width + pad > b.x &&
    a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;
}

/**
 * Nudge free-standing subjects apart.
 *
 * Anything placed relative to something else has been put where the sentence
 * asked for it, and backdrops are meant to be drawn through — only the
 * remaining subjects are moved, and only along a deterministic path, so the
 * same scene always lays out the same way.
 */
function separateFreeEntities(entities: StoryEntity[], positions: Map<string, Box>) {
  const pad = 18;
  const anchored: Box[] = [];
  const free: Array<{ entity: StoryEntity; box: Box }> = [];
  for (const entity of entities) {
    const box = positions.get(entity.entityId);
    if (!box) continue;
    if (entity.placement.relativeTo || BACKDROP_KINDS.has(entity.kind)) anchored.push(box);
    else free.push({ entity, box });
  }
  free.sort((a, b) => a.entity.createdAt - b.entity.createdAt || a.entity.entityId.localeCompare(b.entity.entityId));

  const placed = [...anchored];
  for (const { entity, box } of free) {
    const pageIndex = entity.renderings.at(-1)?.pageIndex ?? 0;
    const left = pageOrigin(pageIndex).x + STORY_BOUNDS.x;
    const right = left + STORY_BOUNDS.width;
    const rowTop = box.y;
    let row = 0;
    for (let guard = 0; guard < 40; guard += 1) {
      const blocker = placed.find((other) => overlaps(box, other, pad));
      if (!blocker) break;
      box.x = blocker.x + blocker.width + pad;
      // A crowded band spills onto the next row rather than off the sheet.
      if (box.x + box.width > right) {
        row += 1;
        box.x = left;
        box.y = rowTop + row * (box.height + pad + 24);
      }
    }
    placed.push(box);
  }
}

/** Which poses each family of prepared art actually draws differently. */
const POSE_VARIANTS: Record<string, string[]> = {
  person: ["standing", "walking", "running", "sitting", "sleeping", "jumping"],
  animal: ["idle", "standing", "walking", "running", "sitting", "sleeping", "jumping", "watching"],
  vehicle: ["driving", "stopped", "parked"],
};

export function storyPoseVariants(assetKey?: StoryAssetKey): string[] {
  if (!assetKey) return [];
  if (assetKey === "child" || assetKey === "person") return POSE_VARIANTS.person;
  if (assetKey === "cat" || assetKey === "dog" || assetKey === "mouse") return POSE_VARIANTS.animal;
  if (assetKey === "car") return POSE_VARIANTS.vehicle;
  return [];
}

function personArt(x: number, y: number, width: number, height: number, pose: string, stroke: string) {
  const cx = x + width / 2;
  const head = Math.min(width, height) * 0.2;
  const ink = { strokeColor: stroke };
  if (pose === "sleeping") {
    const y0 = y + height * 0.62;
    return [
      ellipse(x, y0 - head, head, head, ink),
      line(x + head, y0, [[0, 0], [width, 0]], ink),
      line(x + head, y0 - head * 0.6, [[0, 0], [width * 0.5, -head * 0.2]], ink),
      line(x + width * 0.5, y0 - 26, [[0, 0], [10, -12], [-4, -12]], { strokeColor: SOFT }),
    ];
  }
  const hipY = y + height * 0.58;
  const walking = pose === "walking";
  const running = pose === "running";
  const sitting = pose === "sitting";
  const jumping = pose === "jumping";
  const lean = running ? width * 0.12 : 0;
  if (sitting) {
    return [
      ellipse(cx - head / 2, y + height * 0.2, head, head, ink),
      line(cx, y + height * 0.2 + head, [[0, 0], [0, height * 0.28]], ink),
      line(cx, y + height * 0.4, [[0, 0], [-width * 0.3, height * 0.08]], ink),
      line(cx, y + height * 0.4, [[0, 0], [width * 0.3, height * 0.08]], ink),
      line(cx, y + height * 0.76, [[0, 0], [width * 0.36, 0], [width * 0.36, height * 0.22]], ink),
      line(cx, y + height * 0.76, [[0, 0], [-width * 0.1, height * 0.22]], ink),
    ];
  }
  return [
    ellipse(cx - head / 2 + lean, y, head, head, ink),
    line(cx + lean, y + head, [[0, 0], [-lean, height * 0.4]], ink),
    line(cx, y + height * 0.3, running
      ? [[0, 0], [-width * 0.42, -height * 0.1]]
      : walking ? [[0, 0], [-width * 0.35, height * 0.18]] : [[0, 0], [-width * 0.3, height * 0.1]], ink),
    line(cx, y + height * 0.3, running
      ? [[0, 0], [width * 0.42, height * 0.12]]
      : walking ? [[0, 0], [width * 0.38, -height * 0.04]] : [[0, 0], [width * 0.3, height * 0.1]], ink),
    line(cx, hipY, running
      ? [[0, 0], [-width * 0.44, height * 0.24]]
      : jumping ? [[0, 0], [-width * 0.34, height * 0.28]]
        : walking ? [[0, 0], [-width * 0.34, height * 0.35]] : [[0, 0], [-width * 0.2, height * 0.38]], ink),
    line(cx, hipY, running
      ? [[0, 0], [width * 0.3, height * 0.36]]
      : jumping ? [[0, 0], [width * 0.34, height * 0.28]]
        : walking ? [[0, 0], [width * 0.36, height * 0.24]] : [[0, 0], [width * 0.2, height * 0.38]], ink),
  ];
}

function animalArt(x: number, y: number, width: number, height: number, pose: string, dog: boolean, stroke: string) {
  const ink = { strokeColor: stroke };
  if (pose === "sleeping") {
    return [
      ellipse(x + 6, y + height * 0.5, width * 0.72, height * 0.4, ink),
      ellipse(x + width * 0.68, y + height * 0.46, height * 0.34, height * 0.32, ink),
      line(x + 6, y + height * 0.6, [[0, 0], [-16, -6], [-22, 6]], ink),
      line(x + width * 0.4, y + height * 0.34, [[0, 0], [10, -12], [-4, -12]], { strokeColor: SOFT }),
    ];
  }
  const sitting = pose === "sitting";
  const running = pose === "running";
  const jumping = pose === "jumping";
  const bodyY = y + (sitting ? height * 0.32 : height * 0.4);
  const bodyW = width * (sitting ? 0.52 : 0.62);
  const bodyH = height * (sitting ? 0.55 : 0.38);
  const head = dog ? 30 : 26;
  const hx = x + bodyW + 8;
  return [
    ellipse(x + 12, bodyY, bodyW, bodyH, ink),
    ellipse(hx, y + 16, head, head, ink),
    line(hx + 4, y + 18, dog ? [[0, 0], [-8, -16], [7, -5]] : [[0, 0], [5, -14], [12, -2]], ink),
    line(hx + head - 4, y + 18, dog ? [[0, 0], [9, -14], [-5, -4]] : [[0, 0], [-4, -14], [-11, -2]], ink),
    line(x + 13, bodyY + 8, running ? [[0, 0], [-22, -6], [-28, 6]] : [[0, 0], [-18, -18], [-23, -2]], ink),
    line(x + 30, bodyY + bodyH - 2, running
      ? [[0, 0], [-19, 18]]
      : jumping ? [[0, 0], [-14, 22]] : [[0, 0], [-3, 20]], ink),
    line(x + 55, bodyY + bodyH - 2, running
      ? [[0, 0], [20, 14]]
      : jumping ? [[0, 0], [16, 20]] : [[0, 0], [4, 20]], ink),
  ];
}

function mouseArt(x: number, y: number, width: number, height: number, stroke: string) {
  const ink = { strokeColor: stroke };
  return [
    ellipse(x + 5, y + 13, width * 0.62, height * 0.58, ink),
    ellipse(x + width * 0.58, y + 16, height * 0.46, height * 0.42, ink),
    ellipse(x + width * 0.58, y + 8, 12, 12, ink),
    ellipse(x + width * 0.72, y + 9, 11, 11, ink),
    line(x + 4, y + 23, [[0, 0], [-14, -8], [-20, 3]], ink),
    line(x + width * 0.88, y + 27, [[0, 0], [8, -2]], ink),
  ];
}

function carArt(x: number, y: number, width: number, height: number, pose: string, stroke: string) {
  const body = composePrimitives("vehicle", "car", { x, y }, { width, height }, stroke);
  if (pose !== "stopped" && pose !== "parked") return body;
  // A stopped car is the same car with its wheels chocked by a ground line.
  return [...body, line(x - 6, y + height + 2, [[0, 0], [width + 12, 0]], { strokeColor: SOFT })];
}

function assetSkeleton(entity: StoryEntity, p: Point, size: Size): Record<string, unknown>[] {
  const { width, height } = size;
  const pose = entity.state.pose ?? "standing";
  const stroke = colorHex(entity.state.appearance?.color, INK);
  if (!entity.assetKey) {
    const recipe = entity.recipe ?? resolveProceduralRecipe(entity.label, entity.kind);
    return composePrimitives(recipe, entity.label, p, size, stroke);
  }
  switch (entity.assetKey) {
    case "child":
    case "person":
      return personArt(p.x, p.y, width, height, pose, stroke);
    case "cat":
      return animalArt(p.x, p.y, width, height, pose, false, stroke);
    case "dog":
      return animalArt(p.x, p.y, width, height, pose, true, stroke);
    case "mouse":
      return mouseArt(p.x, p.y, width, height, stroke);
    case "car":
      return carArt(p.x, p.y, width, height, pose, stroke);
    case "road":
      return [
        line(p.x, p.y, [[0, 0], [width, 0]], { strokeColor: SOFT, strokeWidth: 3 }),
        line(p.x, p.y + height, [[0, 0], [width, 0]], { strokeColor: SOFT, strokeWidth: 3 }),
        ...Array.from({ length: 6 }, (_, i) =>
          line(p.x + 40 + i * (width / 6), p.y + height / 2, [[0, 0], [46, 0]], { strokeColor: "#ced4da" }),
        ),
      ];
    case "palm-tree":
      return [
        line(p.x + width / 2, p.y + 35, [[0, 0], [-8, height - 38]], { strokeColor: BROWN, strokeWidth: 4 }),
        line(p.x + width / 2, p.y + 38, [[0, 0], [-48, -21], [-61, -2]], { strokeColor: GREEN, strokeWidth: 3 }),
        line(p.x + width / 2, p.y + 38, [[0, 0], [47, -24], [58, -5]], { strokeColor: GREEN, strokeWidth: 3 }),
        line(p.x + width / 2, p.y + 38, [[0, 0], [-30, 10], [-47, 29]], { strokeColor: GREEN, strokeWidth: 3 }),
        line(p.x + width / 2, p.y + 38, [[0, 0], [32, 9], [49, 29]], { strokeColor: GREEN, strokeWidth: 3 }),
      ];
    case "tree":
      return [
        rectangle(p.x + width * 0.42, p.y + height * 0.45, width * 0.18, height * 0.55, { strokeColor: BROWN }),
        ellipse(p.x + 4, p.y, width * 0.62, height * 0.55, { strokeColor: GREEN }),
        ellipse(p.x + width * 0.36, p.y + 8, width * 0.6, height * 0.52, { strokeColor: GREEN }),
      ];
    case "beach":
      return [line(p.x, p.y + 90, [[0, 0], [190, -24], [390, 4], [600, -20], [width, 10]], { strokeColor: "#f08c00", strokeWidth: 3 })];
    case "sand":
      return [rectangle(p.x, p.y, width, height, { strokeColor: "#e0a800", backgroundColor: SAND, fillStyle: "hachure", opacity: 45 })];
    case "water":
      return [rectangle(p.x, p.y, width, height, { strokeColor: BLUE, backgroundColor: "#d0ebff", fillStyle: "hachure", opacity: 55 })];
    case "waves": {
      const marks = [];
      for (let row = 0; row < 3; row++) {
        marks.push(line(p.x, p.y + row * 22, [[0, 0], [45, -8], [90, 0], [135, -8], [180, 0], [225, -8], [270, 0], [315, -8], [390, 0]], { strokeColor: BLUE }));
      }
      return marks;
    }
    case "sun": {
      const marks: Record<string, unknown>[] = [ellipse(p.x + 20, p.y + 20, 48, 48, { strokeColor: SUN, backgroundColor: "#fff3bf", fillStyle: "solid" })];
      const cx = p.x + 44; const cy = p.y + 44;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        marks.push(line(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34, [[0, 0], [Math.cos(a) * 15, Math.sin(a) * 15]], { strokeColor: SUN }));
      }
      return marks;
    }
    case "cloud":
      return [
        ellipse(p.x, p.y + 28, 65, 38, { strokeColor: SOFT, backgroundColor: "#f1f3f5", fillStyle: "hachure" }),
        ellipse(p.x + 35, p.y + 8, 76, 56, { strokeColor: SOFT, backgroundColor: "#f1f3f5", fillStyle: "hachure" }),
        ellipse(p.x + 82, p.y + 30, 58, 34, { strokeColor: SOFT, backgroundColor: "#f1f3f5", fillStyle: "hachure" }),
      ];
    case "rain": {
      const marks: Record<string, unknown>[] = [];
      for (let i = 0; i < 5; i++) marks.push(line(p.x + 16 + i * 24, p.y, [[0, 0], [-8, 24]], { strokeColor: BLUE }));
      return marks;
    }
    case "puddle":
      return [ellipse(p.x, p.y, width, height, { strokeColor: BLUE, backgroundColor: "#d0ebff", fillStyle: "hachure", opacity: 70 })];
    case "house":
      return [
        rectangle(p.x + 18, p.y + 55, width - 36, height - 55, { strokeColor: BROWN }),
        line(p.x, p.y + 60, [[0, 0], [width / 2, -58], [width, 0]], { strokeColor: BROWN, strokeWidth: 3 }),
        rectangle(p.x + width * 0.43, p.y + height * 0.62, width * 0.2, height * 0.38, { strokeColor: BROWN }),
      ];
    case "speech-bubble":
      return [ellipse(p.x, p.y, width, height * 0.75), line(p.x + width * 0.28, p.y + height * 0.68, [[0, 0], [-12, 30], [25, 7]])];
    case "movement-arrow":
      return [line(p.x, p.y + height / 2, [[0, 0], [width, 0]], { endArrowhead: "arrow" })];
  }
}

/** A placeholder says what it stands for, so the speaker can define it later. */
function placeholderCaption(entity: StoryEntity, p: Point, size: Size): Record<string, unknown>[] {
  if (entity.visualSource !== "placeholder") return [];
  return [labelText(p.x, p.y + size.height + 4, entity.label, { fontSize: 15, strokeColor: SOFT })];
}

export async function buildStoryEntityElements(
  entity: StoryEntity,
  position: Point,
  pageIndex: number,
): Promise<SceneElement[]> {
  if (entity.state.visible === false || !storyEntityAssetIsValid(entity)) return [];
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const size = storyEntitySize(entity);
  const box: Box = { ...position, ...size };
  const skeleton = [
    ...assetSkeleton(entity, position, size),
    ...placeholderCaption(entity, position, size),
    // Effects belong to the entity's element group, so they move and hide with it.
    ...entity.effects.flatMap((effect) => effectElements(effect, box, entity.state.direction)),
  ];
  const built = convertToExcalidrawElements(skeleton as never) as unknown as SceneElement[];
  return stableize(built, storyEntityElementPrefix(entity.entityId, pageIndex));
}

export async function buildStoryRelationElements(
  relation: StoryRelation,
  positions: Map<string, Box>,
  pageIndex: number,
): Promise<SceneElement[]> {
  if (!relation.visual) return [];
  const from = positions.get(relation.fromEntityId);
  const to = positions.get(relation.toEntityId);
  if (!from || !to) return [];
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const away = relation.relationType.includes("away");
  const start = { x: from.x + from.width, y: from.y + from.height / 2 };
  const end = { x: to.x, y: to.y + to.height / 2 };
  const skeleton = relation.visual === "motion-lines"
    ? effectElements("motion-lines", from, away ? "away" : "toward")
    : [{
        type: "arrow",
        // An away-from arrow points out of the pair, not between them.
        x: away ? from.x - 16 : start.x,
        y: away ? from.y + from.height / 2 : start.y,
        points: away ? [[0, 0], [-72, 0]] : [[0, 0], [end.x - start.x, end.y - start.y]],
        strokeColor: away ? MOTION : "#e8590c",
        strokeWidth: 2,
        roughness: 2,
        endArrowhead: "arrow",
      }];
  const built = convertToExcalidrawElements(skeleton as never) as unknown as SceneElement[];
  return stableize(built, `story-rel:${relation.relationId}:p${pageIndex}`);
}

/** Environment layers are editable Excalidraw primitives rendered behind entities. */
export async function buildStoryEnvironmentElements(
  scene: StoryScene,
  pageIndex: number,
): Promise<SceneElement[]> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const origin = pageOrigin(pageIndex);
  const x = origin.x + STORY_BOUNDS.x;
  const y = origin.y + STORY_BOUNDS.y;
  const layers = scene.environment ?? {};
  const skeleton: Array<{ effect: StoryEnvironmentEffect; shapes: Record<string, unknown>[]; opacity: number }> = [];
  const sunlight = layers.sunlight;
  if (sunlight?.active) {
    const sunX = x + STORY_BOUNDS.width - 118;
    const sunY = y + 34;
    const shapes: Record<string, unknown>[] = [
      ellipse(sunX, sunY, 54, 54, { strokeColor: SUN, backgroundColor: "#fff3bf", fillStyle: "solid" }),
    ];
    for (let index = 0; index < 10; index += 1) {
      const angle = index * Math.PI / 5;
      shapes.push(line(
        sunX + 27 + Math.cos(angle) * 38,
        sunY + 27 + Math.sin(angle) * 38,
        [[0, 0], [Math.cos(angle) * 22, Math.sin(angle) * 22]],
        { strokeColor: SUN, strokeWidth: 2 },
      ));
    }
    // Long restrained rays make "sunlight" read as weather, not an object.
    shapes.push(
      line(sunX - 20, sunY + 86, [[0, 0], [-130, 145]], { strokeColor: "#ffd43b", opacity: 26 }),
      line(sunX + 16, sunY + 88, [[0, 0], [-70, 165]], { strokeColor: "#ffd43b", opacity: 26 }),
    );
    skeleton.push({ effect: "sunlight", shapes, opacity: sunlight.opacity });
  }
  const clouds = layers.clouds;
  if (clouds?.active) {
    skeleton.push({
      effect: "clouds",
      opacity: clouds.opacity,
      shapes: [
        ellipse(x + 520, y + 46, 86, 42, { strokeColor: SOFT, backgroundColor: "#f1f3f5", fillStyle: "hachure" }),
        ellipse(x + 570, y + 28, 92, 58, { strokeColor: SOFT, backgroundColor: "#f1f3f5", fillStyle: "hachure" }),
        ellipse(x + 628, y + 49, 70, 38, { strokeColor: SOFT, backgroundColor: "#f1f3f5", fillStyle: "hachure" }),
      ],
    });
  }
  const rain = layers.rain;
  if (rain?.active) {
    const shapes: Record<string, unknown>[] = [
      ellipse(x + 430, y + 30, 122, 54, { strokeColor: SOFT, backgroundColor: "#e9ecef", fillStyle: "hachure" }),
      ellipse(x + 510, y + 18, 136, 70, { strokeColor: SOFT, backgroundColor: "#e9ecef", fillStyle: "hachure" }),
      ellipse(x + 606, y + 34, 112, 52, { strokeColor: SOFT, backgroundColor: "#e9ecef", fillStyle: "hachure" }),
    ];
    for (let column = 0; column < 22; column += 1) {
      const startX = x + 32 + column * 39;
      const startY = y + 104 + (column % 3) * 14;
      shapes.push(line(startX, startY, [[0, 0], [-12, 34]], { strokeColor: BLUE, strokeWidth: 2, opacity: 70 }));
    }
    skeleton.push({ effect: "rain", shapes, opacity: rain.opacity });
  }
  const wind = layers.wind;
  if (wind?.active) {
    skeleton.push({
      effect: "wind",
      opacity: wind.opacity,
      shapes: [0, 1, 2].map((row) => line(x + 72, y + 100 + row * 54, [[0, 0], [190, -10], [260, 4]], { strokeColor: "#74c0fc", strokeWidth: 2 })),
    });
  }
  const night = layers.night;
  if (night?.active) {
    skeleton.push({
      effect: "night",
      opacity: Math.min(42, night.opacity),
      shapes: [rectangle(x, y, STORY_BOUNDS.width, STORY_BOUNDS.height, { strokeColor: "#495057", backgroundColor: "#343a40", fillStyle: "hachure", opacity: 28 })],
    });
  }
  return skeleton.flatMap((layer) => {
    const built = convertToExcalidrawElements(layer.shapes as never) as unknown as SceneElement[];
    return stableize(built.map((element) => ({ ...element, opacity: Math.min(Number(element.opacity ?? 100), layer.opacity) })), `story-env:${layer.effect}:p${pageIndex}`);
  });
}

export interface StoryAssetManifestEntry {
  assetKey: "cat" | "tree" | "house" | "car" | "person" | "sunlight" | "rain" | "cloud" | "puddle";
  aliases: string[];
  kind: "character" | "animal" | "vehicle" | "object" | "location" | "environment";
  supportedPoses: string[];
  anchors: { center: Point; feet: Point; front: Point; back: Point };
  build: "entity" | "environment";
}

/** The deliberately small, local V2 registry. All recipes resolve without network I/O. */
export const STORY_V2_ASSET_MANIFEST: StoryAssetManifestEntry[] = [
  { assetKey: "cat", aliases: ["cat", "kitten", "feline"], kind: "animal", supportedPoses: ["idle", "sitting", "standing", "walking", "running"], anchors: { center: { x: 52, y: 36 }, feet: { x: 52, y: 72 }, front: { x: 104, y: 36 }, back: { x: 0, y: 36 } }, build: "entity" },
  { assetKey: "tree", aliases: ["tree"], kind: "object", supportedPoses: [], anchors: { center: { x: 64, y: 95 }, feet: { x: 64, y: 190 }, front: { x: 128, y: 95 }, back: { x: 0, y: 95 } }, build: "entity" },
  { assetKey: "house", aliases: ["house", "home"], kind: "location", supportedPoses: [], anchors: { center: { x: 95, y: 80 }, feet: { x: 95, y: 160 }, front: { x: 190, y: 80 }, back: { x: 0, y: 80 } }, build: "entity" },
  { assetKey: "car", aliases: ["car", "automobile"], kind: "vehicle", supportedPoses: ["idle", "standing", "walking", "running"], anchors: { center: { x: 79, y: 41 }, feet: { x: 79, y: 82 }, front: { x: 158, y: 41 }, back: { x: 0, y: 41 } }, build: "entity" },
  { assetKey: "person", aliases: ["person", "man", "woman"], kind: "character", supportedPoses: ["idle", "sitting", "standing", "walking", "running"], anchors: { center: { x: 39, y: 69 }, feet: { x: 39, y: 138 }, front: { x: 78, y: 69 }, back: { x: 0, y: 69 } }, build: "entity" },
  { assetKey: "sunlight", aliases: ["sun", "sunlight", "sunny"], kind: "environment", supportedPoses: [], anchors: { center: { x: 0, y: 0 }, feet: { x: 0, y: 0 }, front: { x: 0, y: 0 }, back: { x: 0, y: 0 } }, build: "environment" },
  { assetKey: "rain", aliases: ["rain", "raining", "rainfall"], kind: "environment", supportedPoses: [], anchors: { center: { x: 0, y: 0 }, feet: { x: 0, y: 0 }, front: { x: 0, y: 0 }, back: { x: 0, y: 0 } }, build: "environment" },
  { assetKey: "cloud", aliases: ["cloud", "clouds", "cloudy"], kind: "environment", supportedPoses: [], anchors: { center: { x: 0, y: 0 }, feet: { x: 0, y: 0 }, front: { x: 0, y: 0 }, back: { x: 0, y: 0 } }, build: "environment" },
  { assetKey: "puddle", aliases: ["puddle", "pool of water"], kind: "object", supportedPoses: [], anchors: { center: { x: 59, y: 17 }, feet: { x: 59, y: 34 }, front: { x: 118, y: 17 }, back: { x: 0, y: 17 } }, build: "entity" },
];

export function storySceneFits(count: number): boolean {
  // Five background pieces plus roughly six foreground actors/objects remain legible.
  return count <= 11;
}
