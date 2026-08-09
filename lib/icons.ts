/**
 * Hand-drawable pictograms for the Scribe.
 *
 * Each icon is authored in a 0-100 box as plain strokes and ellipses, then
 * scaled and handed to Excalidraw with high roughness so it comes out looking
 * drawn rather than placed. Keep them simple — they render at ~46px and read
 * better as five confident strokes than twenty accurate ones.
 */

export interface IconArt {
  /** Polylines in 0-100 space. */
  strokes: number[][][];
  /** [cx, cy, rx, ry] in 0-100 space. */
  ellipses: number[][];
}

export const ICONS: Record<string, IconArt> = {
  person: {
    ellipses: [[50, 20, 13, 13]],
    strokes: [[[28, 84], [33, 50], [67, 50], [72, 84]]],
  },
  people: {
    ellipses: [
      [34, 24, 11, 11],
      [68, 30, 9, 9],
    ],
    strokes: [
      [[14, 84], [19, 52], [49, 52], [54, 84]],
      [[58, 84], [61, 58], [83, 58], [86, 84]],
    ],
  },
  phone: {
    ellipses: [[50, 82, 4, 4]],
    strokes: [
      [[32, 8], [68, 8], [68, 92], [32, 92], [32, 8]],
      [[43, 18], [57, 18]],
    ],
  },
  cloud: {
    ellipses: [
      [32, 62, 18, 15],
      [54, 52, 23, 20],
      [74, 63, 16, 14],
    ],
    strokes: [],
  },
  server: {
    ellipses: [
      [28, 30, 3, 3],
      [28, 55, 3, 3],
      [28, 80, 3, 3],
    ],
    strokes: [
      [[14, 18], [86, 18], [86, 42], [14, 42], [14, 18]],
      [[14, 43], [86, 43], [86, 67], [14, 67], [14, 43]],
      [[14, 68], [86, 68], [86, 92], [14, 92], [14, 68]],
    ],
  },
  database: {
    ellipses: [
      [50, 22, 30, 10],
      [50, 50, 30, 10],
      [50, 78, 30, 10],
    ],
    strokes: [
      [[20, 22], [20, 78]],
      [[80, 22], [80, 78]],
    ],
  },
  gear: {
    ellipses: [
      [50, 50, 24, 24],
      [50, 50, 9, 9],
    ],
    strokes: [
      [[50, 18], [50, 8]],
      [[50, 82], [50, 92]],
      [[18, 50], [8, 50]],
      [[82, 50], [92, 50]],
      [[27, 27], [20, 20]],
      [[73, 73], [80, 80]],
      [[73, 27], [80, 20]],
      [[27, 73], [20, 80]],
    ],
  },
  bulb: {
    ellipses: [[50, 38, 22, 22]],
    strokes: [
      [[39, 58], [39, 74], [61, 74], [61, 58]],
      [[42, 82], [58, 82]],
    ],
  },
  warning: {
    ellipses: [[50, 72, 3, 3]],
    strokes: [
      [[50, 10], [90, 84], [10, 84], [50, 10]],
      [[50, 34], [50, 60]],
    ],
  },
  lock: {
    ellipses: [],
    strokes: [
      [[24, 44], [76, 44], [76, 90], [24, 90], [24, 44]],
      [[36, 44], [36, 28], [50, 20], [64, 28], [64, 44]],
      [[50, 58], [50, 74]],
    ],
  },
  money: {
    ellipses: [[50, 50, 13, 13]],
    strokes: [
      [[10, 26], [90, 26], [90, 74], [10, 74], [10, 26]],
      [[50, 36], [50, 64]],
    ],
  },
  clock: {
    ellipses: [[50, 50, 34, 34]],
    strokes: [
      [[50, 50], [50, 26]],
      [[50, 50], [69, 60]],
    ],
  },
  check: {
    ellipses: [],
    strokes: [[[20, 52], [41, 74], [82, 24]]],
  },
  cross: {
    ellipses: [],
    strokes: [
      [[26, 26], [74, 74]],
      [[74, 26], [26, 74]],
    ],
  },
  chart: {
    ellipses: [],
    strokes: [
      [[16, 12], [16, 86], [90, 86]],
      [[30, 86], [30, 60], [44, 60], [44, 86]],
      [[50, 86], [50, 42], [64, 42], [64, 86]],
      [[70, 86], [70, 24], [84, 24], [84, 86]],
    ],
  },
  globe: {
    ellipses: [
      [50, 50, 34, 34],
      [50, 50, 14, 34],
    ],
    strokes: [[[16, 50], [84, 50]]],
  },
  doc: {
    ellipses: [],
    strokes: [
      [[26, 10], [64, 10], [78, 26], [78, 90], [26, 90], [26, 10]],
      [[64, 10], [64, 26], [78, 26]],
      [[38, 44], [66, 44]],
      [[38, 58], [66, 58]],
      [[38, 72], [56, 72]],
    ],
  },
  mic: {
    ellipses: [[50, 32, 13, 22]],
    strokes: [
      [[30, 44], [30, 56], [40, 68], [60, 68], [70, 56], [70, 44]],
      [[50, 68], [50, 84]],
      [[36, 90], [64, 90]],
    ],
  },
  brain: {
    ellipses: [
      [36, 42, 20, 22],
      [64, 42, 20, 22],
    ],
    strokes: [
      [[50, 24], [50, 76]],
      [[40, 78], [60, 78], [58, 90], [42, 90], [40, 78]],
    ],
  },
  rocket: {
    ellipses: [[50, 34, 9, 9]],
    strokes: [
      [[50, 8], [68, 44], [68, 74], [32, 74], [32, 44], [50, 8]],
      [[32, 60], [16, 78], [32, 74]],
      [[68, 60], [84, 78], [68, 74]],
      [[42, 74], [50, 92], [58, 74]],
    ],
  },
};

export const ICON_NAMES = Object.keys(ICONS);

/** Nearest supported icon, or null. Unknown names degrade to no icon. */
export function resolveIcon(name: string): IconArt | null {
  const key = name.trim().toLowerCase();
  if (ICONS[key]) return ICONS[key];
  const alias: Record<string, string> = {
    user: "person",
    users: "people",
    team: "people",
    call: "phone",
    calling: "phone",
    mobile: "phone",
    api: "server",
    servers: "server",
    db: "database",
    storage: "database",
    settings: "gear",
    config: "gear",
    idea: "bulb",
    insight: "bulb",
    risk: "warning",
    alert: "warning",
    danger: "warning",
    security: "lock",
    auth: "lock",
    cost: "money",
    price: "money",
    pricing: "money",
    revenue: "money",
    time: "clock",
    speed: "clock",
    latency: "clock",
    done: "check",
    yes: "check",
    no: "cross",
    fail: "cross",
    growth: "chart",
    metrics: "chart",
    data: "chart",
    web: "globe",
    internet: "globe",
    world: "globe",
    file: "doc",
    document: "doc",
    voice: "mic",
    audio: "mic",
    ai: "brain",
    model: "brain",
    agent: "brain",
    launch: "rocket",
    ship: "rocket",
  };
  return alias[key] ? ICONS[alias[key]] : null;
}
