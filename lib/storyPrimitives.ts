/**
 * The deterministic drawing vocabulary for Story Mode.
 *
 * Nothing here knows about the interpreter. It is given a resolved visual
 * (a recipe, a box, a colour, an effect) and returns Excalidraw skeletons.
 * The model never reaches this file — it only names meaning, and meaning is
 * turned into shapes here.
 */

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export type Box = Point & Size;

/** Shared native-Excalidraw art direction tokens. */
export const STORY_VISUAL_TOKENS = {
  stroke: { primary: "#343a40", secondary: "#5c6770", width: 2.4, environmentWidth: 1.8 },
  fill: {
    character: "#fff4e6",
    foliage: "#d3f9d8",
    wood: "#f1e3d3",
    structure: "#fff4e6",
    vehicle: "#e7f5ff",
    water: "#d0ebff",
    cloud: "#f1f3f5",
    ground: "#f8f9fa",
  },
  opacity: { environment: 42, supporting: 72, committed: 100, provisional: 35 },
  depth: { background: 0, middle: 1, action: 2, foreground: 3 },
  scale: { character: 1, prop: 1.15, destination: 1.2, environment: 1 },
} as const;

export const INK = STORY_VISUAL_TOKENS.stroke.primary;
export const SOFT = STORY_VISUAL_TOKENS.stroke.secondary;
export const BLUE = "#4dabf7";
export const SAND = "#ffe8a1";
export const SUN = "#fab005";
export const GREEN = "#37b24d";
export const BROWN = "#8d6e63";
export const MOTION = "#868e96";

/** Named colours a speaker actually says out loud. */
export const COLOR_HEX: Record<string, string> = {
  red: "#e03131",
  orange: "#f76707",
  yellow: "#f59f00",
  green: "#2f9e44",
  blue: "#1971c2",
  purple: "#9c36b5",
  pink: "#e64980",
  brown: BROWN,
  black: "#212529",
  white: "#adb5bd",
  grey: "#868e96",
  gray: "#868e96",
  silver: "#adb5bd",
};

export function colorHex(color?: string, fallback: string = INK): string {
  if (!color) return fallback;
  return COLOR_HEX[color.trim().toLowerCase()] ?? fallback;
}

export const SIZE_SCALE: Record<string, number> = {
  tiny: 0.6,
  small: 0.75,
  medium: 1,
  big: 1.3,
  large: 1.3,
  huge: 1.6,
};

export function sizeScale(size?: string): number {
  if (!size) return 1;
  return SIZE_SCALE[size.trim().toLowerCase()] ?? 1;
}

type Shape = Record<string, unknown>;

export const line = (x: number, y: number, points: number[][], extra: Shape = {}): Shape => ({
  type: "line", x, y, points, strokeColor: INK, strokeWidth: STORY_VISUAL_TOKENS.stroke.width, roughness: 1.5, ...extra,
});
export const ellipse = (x: number, y: number, width: number, height: number, extra: Shape = {}): Shape => ({
  type: "ellipse", x, y, width, height, strokeColor: INK,
  backgroundColor: "transparent", strokeWidth: STORY_VISUAL_TOKENS.stroke.width, roughness: 1.5, ...extra,
});
export const rectangle = (x: number, y: number, width: number, height: number, extra: Shape = {}): Shape => ({
  type: "rectangle", x, y, width, height, strokeColor: INK,
  backgroundColor: "transparent", strokeWidth: STORY_VISUAL_TOKENS.stroke.width, roughness: 1.5, ...extra,
});
export const triangle = (x: number, y: number, width: number, height: number, extra: Shape = {}): Shape =>
  line(x, y + height, [[0, 0], [width / 2, -height], [width, 0], [0, 0]], extra);
export const label = (x: number, y: number, text: string, extra: Shape = {}): Shape => ({
  type: "text", x, y, text, fontSize: 17, strokeColor: SOFT, ...extra,
});

/**
 * Procedural recipes. This is deliberately a short list: an unfamiliar noun
 * becomes the nearest honest outline, never a random prepared asset.
 */
export type StoryRecipe =
  | "vehicle"
  | "container"
  | "structure"
  | "creature"
  | "plant"
  | "device"
  | "placeholder";

const RECIPE_WORDS: Array<[StoryRecipe, RegExp]> = [
  ["vehicle", /\b(?:car|truck|bus|van|tractor|train|cart|wagon|bike|bicycle|motorbike|scooter|lorry|taxi)\b/],
  ["container", /\b(?:box|crate|chest|bucket|basket|bag|barrel|case|jar|tin|package|parcel)\b/],
  ["structure", /\b(?:house|hut|shed|barn|tower|bridge|wall|shop|school|castle|building|cabin|tent)\b/],
  ["creature", /\b(?:bird|fish|horse|cow|sheep|rabbit|fox|bear|frog|duck|goat|pig|animal|creature|monster)\b/],
  ["plant", /\b(?:bush|flower|plant|shrub|grass|fern|cactus|hedge)\b/],
  ["device", /\b(?:machine|robot|engine|computer|radio|phone|television|tv|printer|device|contraption|gadget)\b/],
];

/** Pick the closest primitive family for a noun with no prepared asset. */
export function resolveProceduralRecipe(labelText: string, kind?: string): StoryRecipe {
  const key = labelText.toLowerCase();
  for (const [recipe, pattern] of RECIPE_WORDS) {
    if (pattern.test(key)) return recipe;
  }
  if (kind === "vehicle") return "vehicle";
  if (kind === "animal") return "creature";
  if (kind === "location") return "structure";
  return "placeholder";
}

const RECIPE_SIZES: Record<StoryRecipe, Size> = {
  vehicle: { width: 150, height: 78 },
  container: { width: 96, height: 84 },
  structure: { width: 170, height: 150 },
  creature: { width: 104, height: 78 },
  plant: { width: 86, height: 92 },
  device: { width: 120, height: 110 },
  placeholder: { width: 130, height: 90 },
};

export function recipeSize(recipe: StoryRecipe): Size {
  return { ...RECIPE_SIZES[recipe] };
}

/**
 * Compose a sketch from primitives. `text` is only lettered when the shape
 * cannot carry its own meaning — a placeholder box, or a device.
 */
export function composePrimitives(
  recipe: StoryRecipe,
  text: string,
  p: Point,
  size: Size,
  stroke: string = INK,
): Shape[] {
  const { width, height } = size;
  switch (recipe) {
    case "vehicle": {
      const bodyH = height * 0.46;
      const bodyY = p.y + height * 0.24;
      const wheel = Math.max(16, height * 0.28);
      return [
        rectangle(p.x, bodyY, width, bodyH, { strokeColor: stroke, backgroundColor: STORY_VISUAL_TOKENS.fill.vehicle, fillStyle: "solid" }),
        line(p.x + width * 0.2, bodyY, [
          [0, 0], [width * 0.12, -height * 0.22], [width * 0.42, -height * 0.22], [width * 0.52, 0],
        ], { strokeColor: stroke }),
        ellipse(p.x + width * 0.14, bodyY + bodyH - wheel * 0.35, wheel, wheel, { strokeColor: INK }),
        ellipse(p.x + width * 0.66, bodyY + bodyH - wheel * 0.35, wheel, wheel, { strokeColor: INK }),
      ];
    }
    case "container":
      return [
        rectangle(p.x, p.y + height * 0.16, width, height * 0.84, { strokeColor: stroke }),
        line(p.x, p.y + height * 0.16, [[0, 0], [width * 0.18, -height * 0.16], [width, -height * 0.16], [width * 0.82, 0]], { strokeColor: stroke }),
      ];
    case "structure":
      return [
        rectangle(p.x + width * 0.1, p.y + height * 0.38, width * 0.8, height * 0.62, { strokeColor: stroke }),
        triangle(p.x, p.y, width, height * 0.4, { strokeColor: stroke, strokeWidth: 3 }),
        rectangle(p.x + width * 0.42, p.y + height * 0.66, width * 0.18, height * 0.34, { strokeColor: stroke }),
      ];
    case "creature": {
      const bodyW = width * 0.6;
      const bodyH = height * 0.42;
      const bodyY = p.y + height * 0.36;
      return [
        ellipse(p.x + 8, bodyY, bodyW, bodyH, { strokeColor: stroke }),
        ellipse(p.x + bodyW + 4, p.y + height * 0.14, height * 0.32, height * 0.32, { strokeColor: stroke }),
        line(p.x + width * 0.24, bodyY + bodyH, [[0, 0], [-2, height * 0.22]], { strokeColor: stroke }),
        line(p.x + width * 0.48, bodyY + bodyH, [[0, 0], [3, height * 0.22]], { strokeColor: stroke }),
        line(p.x + 8, bodyY + bodyH * 0.4, [[0, 0], [-width * 0.16, -height * 0.16]], { strokeColor: stroke }),
      ];
    }
    case "plant":
      return [
        line(p.x + width / 2, p.y + height * 0.45, [[0, 0], [0, height * 0.55]], { strokeColor: BROWN, strokeWidth: 3 }),
        ellipse(p.x + width * 0.14, p.y, width * 0.72, height * 0.55, { strokeColor: stroke === INK ? GREEN : stroke }),
      ];
    case "device":
      return [
        rectangle(p.x, p.y + height * 0.2, width, height * 0.68, { strokeColor: stroke }),
        rectangle(p.x + width * 0.14, p.y + height * 0.32, width * 0.4, height * 0.28, { strokeColor: SOFT }),
        ellipse(p.x + width * 0.68, p.y + height * 0.34, 18, 18, { strokeColor: SOFT }),
        line(p.x + width * 0.24, p.y + height * 0.2, [[0, 0], [0, -height * 0.18]], { strokeColor: SOFT }),
        ellipse(p.x + width * 0.18, p.y + height * 0.02, 12, 12, { strokeColor: SOFT }),
        line(p.x + width * 0.12, p.y + height * 0.88, [[0, 0], [0, height * 0.12]], { strokeColor: SOFT }),
        line(p.x + width * 0.82, p.y + height * 0.88, [[0, 0], [0, height * 0.12]], { strokeColor: SOFT }),
        label(p.x + 6, p.y + height + 6, text, { fontSize: 17 }),
      ];
    case "placeholder":
      return [
        rectangle(p.x, p.y, width, height * 0.72, { strokeColor: SOFT, strokeStyle: "dashed" }),
        label(p.x + 8, p.y + height * 0.78, text, { fontSize: 17 }),
      ];
  }
}

/**
 * Visual modifiers. Every effect is drawn relative to the box of the entity
 * it belongs to, so it moves and hides with that entity.
 */
export type StoryEffect =
  | "motion-lines"
  | "direction-arrow"
  | "speed-lines"
  | "emotion-mark"
  | "speech-bubble"
  | "rain-lines"
  | "smoke"
  | "light-rays"
  | "sound-marks";

export const STORY_EFFECTS: StoryEffect[] = [
  "motion-lines", "direction-arrow", "speed-lines", "emotion-mark",
  "speech-bubble", "rain-lines", "smoke", "light-rays", "sound-marks",
];

export function isStoryEffect(value: string): value is StoryEffect {
  return (STORY_EFFECTS as string[]).includes(value);
}

/** Motion marks trail the subject, so they sit opposite the travel direction. */
function trailSign(direction?: string): number {
  return direction === "left" ? 1 : -1;
}

export function effectElements(
  effect: StoryEffect,
  box: Box,
  direction?: string,
  text?: string,
): Shape[] {
  const sign = trailSign(direction);
  const trailX = sign < 0 ? box.x - 10 : box.x + box.width + 10;
  switch (effect) {
    case "motion-lines":
      return [0, 1, 2].map((row) =>
        line(trailX, box.y + box.height * (0.3 + row * 0.22), [[0, 0], [sign * (26 + row * 6), 0]], {
          strokeColor: MOTION, strokeWidth: 2,
        }),
      );
    case "speed-lines":
      return [0, 1, 2, 3].map((row) =>
        line(trailX, box.y + box.height * (0.2 + row * 0.2), [[0, 0], [sign * (34 - row * 4), row % 2 ? 4 : -4]], {
          strokeColor: MOTION, strokeWidth: 1,
        }),
      );
    case "direction-arrow": {
      const forward = -sign;
      const startX = forward > 0 ? box.x + box.width + 14 : box.x - 14;
      return [line(startX, box.y + box.height / 2, [[0, 0], [forward * 62, 0]], {
        strokeColor: "#e8590c", endArrowhead: "arrow",
      })];
    }
    case "emotion-mark":
      return [
        line(box.x + box.width * 0.5, box.y - 30, [[0, 0], [0, 16]], { strokeColor: "#f08c00", strokeWidth: 3 }),
        ellipse(box.x + box.width * 0.5 - 2, box.y - 10, 5, 5, { strokeColor: "#f08c00" }),
      ];
    case "speech-bubble":
      return [
        ellipse(box.x + box.width * 0.5, box.y - 74, 130, 56),
        line(box.x + box.width * 0.62, box.y - 20, [[0, 0], [-14, 22], [18, 3]]),
        ...(text ? [label(box.x + box.width * 0.5 + 16, box.y - 58, text, { fontSize: 14 })] : []),
      ];
    case "rain-lines":
      return Array.from({ length: 6 }, (_, i) =>
        line(box.x + 10 + i * (box.width / 6), box.y - 34, [[0, 0], [-7, 26]], { strokeColor: BLUE }),
      );
    case "smoke":
      return [0, 1, 2].map((i) =>
        ellipse(box.x + box.width * 0.62 + i * 12, box.y - 26 - i * 16, 22 + i * 6, 16 + i * 4, {
          strokeColor: "#adb5bd",
        }),
      );
    case "light-rays":
      return Array.from({ length: 6 }, (_, i) => {
        const a = -Math.PI / 2 + (i - 2.5) * 0.24;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const r = Math.max(box.width, box.height) * 0.6;
        return line(cx + Math.cos(a) * r, cy + Math.sin(a) * r, [[0, 0], [Math.cos(a) * 22, Math.sin(a) * 22]], {
          strokeColor: SUN,
        });
      });
    case "sound-marks":
      return [0, 1, 2].map((i) =>
        line(box.x + box.width + 8 + i * 9, box.y + box.height * 0.3, [
          [0, 0], [7, 8], [0, 16],
        ], { strokeColor: SOFT, strokeWidth: 1 + i * 0.5 }),
      );
  }
}
