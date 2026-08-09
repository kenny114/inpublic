/**
 * The drawing operations the Scribe emits, and the pen that places them.
 *
 * The division of labour matters: the model chooses WHAT to draw and how much
 * it matters. The pen decides WHERE. No model ever emits a coordinate.
 */

import { resolveIcon } from "./icons";
import { labelSpot, routeArrow } from "./routing";
import type { SceneElement } from "./scene";

export type Op =
  | { op: "title"; text: string }
  | { op: "heading"; text: string }
  | { op: "word"; text: string }
  | { op: "note"; text: string }
  | { op: "bullet"; text: string }
  | { op: "box"; text: string }
  | { op: "icon"; name: string }
  | { op: "wave" }
  | { op: "link"; from: string; to: string; label?: string }
  | { op: "underline"; text: string };

// --- parsing --------------------------------------------------------------

const QUOTED = `"([^"]*)"`;

const PATTERNS: { re: RegExp; build: (m: RegExpMatchArray) => Op | null }[] = [
  {
    re: new RegExp(`^title\\s+${QUOTED}`, "i"),
    build: (m) => ({ op: "title", text: m[1] }),
  },
  {
    re: new RegExp(`^heading\\s+${QUOTED}`, "i"),
    build: (m) => ({ op: "heading", text: m[1] }),
  },
  {
    re: new RegExp(`^word\\s+${QUOTED}`, "i"),
    build: (m) => ({ op: "word", text: m[1] }),
  },
  {
    re: new RegExp(`^note\\s+${QUOTED}`, "i"),
    build: (m) => ({ op: "note", text: m[1] }),
  },
  {
    re: new RegExp(`^bullet\\s+${QUOTED}`, "i"),
    build: (m) => ({ op: "bullet", text: m[1] }),
  },
  {
    re: new RegExp(`^box\\s+${QUOTED}`, "i"),
    build: (m) => ({ op: "box", text: m[1] }),
  },
  {
    re: /^icon\s+([a-z_-]+)/i,
    build: (m) => ({ op: "icon", name: m[1] }),
  },
  { re: /^wave\b/i, build: () => ({ op: "wave" }) },
  {
    re: new RegExp(
      `^link\\s+${QUOTED}\\s*->\\s*${QUOTED}(?:\\s*:\\s*${QUOTED})?`,
      "i",
    ),
    build: (m) => ({ op: "link", from: m[1], to: m[2], label: m[3] }),
  },
  {
    re: new RegExp(`^underline\\s+${QUOTED}`, "i"),
    build: (m) => ({ op: "underline", text: m[1] }),
  },
];

/** Parse one line. Anything unrecognised is dropped silently — a malformed
 *  op should cost one mark, never the stream. */
export function parseOp(line: string): Op | null {
  return parseLine(line)[0] ?? null;
}

/**
 * Words that leave a phrase hanging. A whiteboard mark ending in one of these
 * is a sentence fragment the speaker hadn't finished — "Elon is in", "build a",
 * "system where". The prompt asks the model to avoid them; it mostly does, and
 * "mostly" is not good enough for something this visible on camera.
 */
/**
 * Words that always leave a phrase hanging: articles, prepositions,
 * conjunctions, auxiliaries. "build a", "Elon is in", "AI agents can".
 */
const HARD_DANGLING = new Set(
  `a an the and or but nor so if of to in on at for with from by as
   is are was were be been being am will would can could shall should may
   might must do does did have has had
   about into over under between through before after during while when where
   which who whom whose than then behind toward towards within without`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Weak endings that are only a problem in a short phrase. "scan me" and
 * "isn't really there" are perfectly good marks; "to me" and "it is" are not.
 */
const SOFT_DANGLING = new Set(
  `it its they them we us you your our their he she his her him my me i
   there here this that these those not no
   just very much more most also too same such each other some any`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Leading these, in a short phrase, means it's scaffolding: "in today's
 * video". Prepositions and articles only — a leading conjunction is fine
 * ("so easy to build").
 */
const LEADING_META = new Set(
  `in on at for with from by of to about into over under during while when
   a an the`
    .split(/\s+/)
    .filter(Boolean),
);

/** Is this text too fragmentary to stand alone as a mark? */
export function isFragment(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  const last = words[words.length - 1];
  // Hanging on a function word — the noun never arrived.
  if (HARD_DANGLING.has(last)) return true;
  // A weak ending only condemns a phrase that is already short.
  if (words.length <= 2 && SOFT_DANGLING.has(last)) return true;
  // Nothing but function words.
  if (words.every((w) => HARD_DANGLING.has(w) || SOFT_DANGLING.has(w))) {
    return true;
  }
  // A lone short word ("get", "and so") carries nothing on a board.
  if (words.length === 1 && words[0].length < 5) return true;
  // Short phrases that open with a preposition are scaffolding, not content.
  if (words.length <= 4 && LEADING_META.has(words[0])) return true;
  return false;
}

const TEXT_OPS = new Set(["title", "heading", "word", "note", "bullet", "box"]);

/**
 * A line usually yields one op, but the model reliably wants to write
 * `word "mass calling" phone` — icon and mark together, which reads naturally.
 * Rather than fight it, accept a trailing icon name and split it out.
 */
export function parseLine(line: string): Op[] {
  const trimmed = line.trim().replace(/^[-*\d.)\s]+/, "");
  if (!trimmed) return [];
  for (const { re, build } of PATTERNS) {
    const m = trimmed.match(re);
    if (!m) continue;
    const op = build(m);
    if (!op) return [];
    if (TEXT_OPS.has(op.op) && "text" in op && isFragment(op.text)) return [];
    const ops: Op[] = [op];

    const rest = trimmed.slice(m[0].length).trim();
    const iconMatch = rest.match(/^(?:icon\s+)?([a-z_-]+)$/i);
    if (op.op !== "icon" && iconMatch && resolveIcon(iconMatch[1])) {
      ops.push({ op: "icon", name: iconMatch[1] });
    }
    return ops;
  }
  return [];
}

// --- the pen --------------------------------------------------------------

/**
 * Sheet geometry. The page is deliberately smaller than it could be: it gets
 * fitted to the viewport, so a bigger sheet means smaller text on camera.
 * These numbers trade marks-per-page for legibility, and legibility wins —
 * you are reading this over your own shoulder while you talk.
 */
export const PAGE_W = 1040;
export const PAGE_H = 780;
export const PAGE_GAP = 220;
/** Breathing room inside the sheet, so nothing sits flush to the edge. */
export const PAGE_PAD = 44;
const CONTENT_W = PAGE_W - PAGE_PAD * 2;
const CONTENT_H = PAGE_H - PAGE_PAD * 2;
const GAP_X = 42;
const GAP_Y = 46;

/** Pages sit side by side, like a book laid out flat. */
export function pageOrigin(index: number): { x: number; y: number } {
  return { x: index * (PAGE_W + PAGE_GAP), y: 0 };
}

/**
 * A pen at the top-left of a page's WRITING AREA, not of the page.
 *
 * `PAGE_PAD` was subtracted from the content size but never added to the
 * content start, so every page's margin ended up entirely at the bottom and
 * the right. The first line of a sheet sat flush against its top edge — and
 * since the camera centres the page, that put it directly under the toolbar,
 * clipped in half. A margin is on all four sides or it isn't a margin.
 */
export function newPagePen(index: number): Pen {
  const origin = pageOrigin(index);
  return newPen(origin.x + PAGE_PAD, origin.y + PAGE_PAD);
}

/** Would placing this block run off the bottom of the sheet? */
export function willOverflow(pen: Pen, w: number, h: number): boolean {
  const right = pen.originX + CONTENT_W;
  const wraps = pen.x > pen.originX && pen.x + w > right;
  const y = wraps ? pen.y + pen.lineH + GAP_Y : pen.y;
  return y + h > pen.originY + CONTENT_H;
}

export interface Pen {
  originX: number;
  originY: number;
  x: number;
  y: number;
  lineH: number;
}

export function newPen(originX: number, originY: number): Pen {
  return { originX, originY, x: originX, y: originY, lineH: 0 };
}

/**
 * Where a fresh full-width row begins — without advancing the pen. The live
 * line needs to know where it will sit long before it knows how tall it is,
 * so it can't just call `place`.
 */
export function lineStart(pen: Pen): { x: number; y: number } {
  return pen.x > pen.originX
    ? { x: pen.originX, y: pen.y + pen.lineH + GAP_Y }
    : { x: pen.originX, y: pen.y };
}

/** Reserve a block and advance. `fullWidth` forces its own line. */
export function place(
  pen: Pen,
  w: number,
  h: number,
  fullWidth = false,
): { x: number; y: number } {
  const right = pen.originX + CONTENT_W;
  if (fullWidth || pen.x + w > right) {
    if (pen.x > pen.originX) {
      pen.y += pen.lineH + GAP_Y;
      pen.lineH = 0;
    }
    pen.x = pen.originX;
  }
  const spot = { x: pen.x, y: pen.y };
  if (fullWidth) {
    pen.y += h + GAP_Y;
    pen.lineH = 0;
    pen.x = pen.originX;
  } else {
    pen.x += w + GAP_X;
    pen.lineH = Math.max(pen.lineH, h);
  }
  return spot;
}

// --- marks ----------------------------------------------------------------

/** A placed mark the model can refer to later by its text. */
export interface Mark {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * The text as lettered, before markKey flattened it. The Organizer adopts
   * marks by meaning and then uses the page's spelling, which needs the
   * original.
   */
  text?: string;
  /**
   * The element carrying this mark. Needed so the Organizer can bind a
   * relationship to words the Scribe already lettered instead of drawing a
   * second copy of them.
   */
  elementId?: string;
}

export const markKey = (text: string) =>
  text.trim().toLowerCase().replace(/\s+/g, " ");

// --- rendering ------------------------------------------------------------

const HAND = 1; // Excalifont
const INK = "#1e1e1e";
const SOFT = "#495057";
const ACCENT = "#e8590c";
/**
 * The Organizer's ink. Structure drawn around existing writing reads as a
 * second pass over the notes only if it is a different colour from them —
 * otherwise the ring around a word looks like part of the word.
 */
const ORGANIZE = "#1971c2";

/**
 * One source of truth for type sizes. These were duplicated between measureOp
 * and buildOp, which is exactly how a layout drifts out of sync with itself.
 */
export const SIZE = {
  title: 52,
  heading: 34,
  word: 26,
  note: 21,
  bullet: 21,
  box: 21,
} as const;

/** Excalifont has no metrics available here, so estimate. Caps run wider. */
const textW = (text: string, size: number) => {
  const caps = /^[^a-z]*$/.test(text) ? 0.66 : 0.55;
  return Math.max(40, Math.round(text.length * size * caps));
};

function swoosh(width: number): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    pts.push([t * width, Math.sin(t * Math.PI) * -5 + Math.sin(t * 9) * 1.4]);
  }
  return pts;
}

// --- the live line --------------------------------------------------------

/** The words being spoken right now. Between a note and a word in weight —
 *  it carries the page, so it has to read on camera. */
export const LIVE_SIZE = SIZE.word;

/**
 * Break a run of speech into lines that fit the sheet. Excalidraw only wraps
 * text that is bound to a container, so a standalone line has to carry its own
 * newlines.
 */
export function wrapSpeech(
  text: string,
  size = LIVE_SIZE,
  maxW = CONTENT_W,
): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textW(next, size) > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export interface LiveLine {
  elements: SceneElement[];
  w: number;
  h: number;
}

/**
 * The utterance currently being spoken, as one text element.
 *
 * No model is involved and none should be: the words are already in the
 * transcript, so putting them on the sheet costs a render, not a round trip.
 *
 * Rebuilt from scratch on every interim rather than patched in place, so
 * Excalidraw measures it against the real hand face instead of us guessing at
 * the metrics — the same reason `applyOp` waits on the font.
 *
 * `settled` is the only difference between a phrase Deepgram is still
 * revising and one it has committed to: grey while it can still change,
 * ink once it can't.
 */
export async function buildLiveLine(
  text: string,
  x: number,
  y: number,
  settled: boolean,
  /**
   * Stable id for the utterance. Excalidraw's `_newElementBase` honours a
   * supplied id (`id: rest.id || randomId()`), so the element keeps its
   * identity across every interim instead of being replaced ~5x/second.
   */
  id?: string,
): Promise<LiveLine> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const wrapped = wrapSpeech(text);
  const elements = convertToExcalidrawElements([
    {
      ...(id ? { id } : {}),
      type: "text",
      x,
      y,
      text: wrapped,
      fontSize: LIVE_SIZE,
      fontFamily: HAND,
      strokeColor: settled ? INK : SOFT,
    },
  ] as never) as unknown as SceneElement[];

  // Excalidraw has just measured this for us — far better than our estimate.
  const first = elements[0];
  const lines = wrapped.split("\n").length;
  return {
    elements,
    w: (first?.width as number) || textW(wrapped, LIVE_SIZE),
    h: (first?.height as number) || lines * LIVE_SIZE * 1.25,
  };
}

// --- concepts and bound relationships -------------------------------------

/** Ink by role, so a reader can tell an input from a problem at a glance. */
const KIND_STROKE: Record<string, string> = {
  input: "#1971c2",
  process: "#1e1e1e",
  output: "#2f9e44",
  person: "#1e1e1e",
  product: "#1e1e1e",
  problem: "#c2255c",
  solution: "#2f9e44",
  goal: "#e8590c",
  note: SOFT,
};

export interface BuiltConcept {
  elements: SceneElement[];
  /** The box itself — the binding target for arrows. */
  nodeId: string;
  mark: Mark;
}

/**
 * One concept as a labelled box with a caller-supplied id.
 *
 * The id has to come from outside because the semantic board owns identity;
 * an arrow drawn ten minutes later binds to this element by that id.
 */
export async function buildConceptNode(
  nodeId: string,
  label: string,
  kind: string,
  pen: Pen,
): Promise<BuiltConcept | null> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const size = SIZE.box;
  const w = Math.max(170, textW(label, size) + 48);
  const h = 70;
  const p = place(pen, w, h);
  const stroke = KIND_STROKE[kind] ?? SOFT;

  const elements = convertToExcalidrawElements([
    {
      id: nodeId,
      type: "rectangle",
      x: p.x,
      y: p.y,
      width: w,
      height: h,
      strokeColor: stroke,
      backgroundColor: "transparent",
      roughness: 2,
      strokeWidth: 1,
      label: { text: label, fontSize: size, fontFamily: HAND, strokeColor: INK },
    },
  ] as never) as unknown as SceneElement[];

  // A labelled rectangle goes through `bindTextToContainer`, which rebuilds the
  // container and does NOT keep the id we supplied. So take the id Excalidraw
  // actually emitted rather than assuming ours survived — this is the binding
  // target every future arrow will look up.
  const node = elements.find((el) => el.type === "rectangle");
  if (!node) return null;
  return {
    elements,
    nodeId: node.id,
    mark: { key: markKey(label), x: p.x, y: p.y, w, h },
  };
}

/**
 * A light box drawn AROUND something already on the page.
 *
 * This is how the Organizer adopts a mark the Scribe lettered: rather than
 * drawing a second, boxed copy of "AI agents" beside the words the speaker
 * already watched appear, it rings the words that are there and binds the
 * arrows to the ring. Nothing existing moves, nothing is redrawn, and the
 * organised structure stays visually distinct from the live writing — the ring
 * is the only new ink.
 *
 * `pen` is deliberately not touched. The mark already occupies this space.
 */
export async function buildReferenceBox(
  boxId: string,
  mark: Mark,
): Promise<{ elements: SceneElement[]; nodeId: string } | null> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const padX = 12;
  const padY = 8;
  const elements = convertToExcalidrawElements([
    {
      id: boxId,
      type: "rectangle",
      x: mark.x - padX,
      y: mark.y - padY,
      width: mark.w + padX * 2,
      height: mark.h + padY * 2,
      strokeColor: ORGANIZE,
      backgroundColor: "transparent",
      roughness: 2,
      strokeWidth: 1,
      // Lighter than a drawn concept: this is annotation, not content.
      opacity: 70,
    },
  ] as never) as unknown as SceneElement[];
  const node = elements.find((el) => el.type === "rectangle");
  if (!node) return null;
  return { elements, nodeId: node.id };
}

export interface BuiltRelationship {
  arrow: SceneElement;
  /** Label text element, if the relationship is named. */
  extras: SceneElement[];
  /** `boundElements` additions the caller must patch onto the two nodes. */
  bindPatches: { id: string; boundElements: unknown[] }[];
}

/**
 * A real Excalidraw binding between two existing elements.
 *
 * `convertToExcalidrawElements` can only bind elements created in the *same*
 * call — its `oldToNewElementIdMap` does not span calls — so an arrow to
 * something drawn a minute ago has to set `startBinding`/`endBinding` itself
 * and register on both nodes' `boundElements`. That registration is what makes
 * Excalidraw re-route the arrow when either node moves.
 */
export async function buildBoundArrow(
  arrowId: string,
  from: SceneElement,
  to: SceneElement,
  label: string,
  /**
   * Everything else on the page. The arrow routes around these — without them
   * it draws a straight line through whatever the speaker had already written
   * between the two things it connects.
   */
  obstacles: SceneElement[] = [],
): Promise<BuiltRelationship | null> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");

  const rect = (el: SceneElement) => ({
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    // The caller tags the live transcript rows. They span the sheet, so
    // treating them as impassable leaves no route at all on a busy page.
    soft: el.softObstacle === true,
  });
  const route = routeArrow(
    rect(from),
    rect(to),
    obstacles
      .filter((el) => el.id !== from.id && el.id !== to.id)
      .filter((el) => el.type !== "arrow" && el.type !== "frame")
      .filter((el) => (el.width ?? 0) > 0 && (el.height ?? 0) > 0)
      .map(rect),
  );
  const { start, end } = route;

  const built = convertToExcalidrawElements([
    {
      id: arrowId,
      type: "arrow",
      x: start.x,
      y: start.y,
      points: route.points,
      strokeColor: SOFT,
      strokeWidth: 1,
      roughness: 2,
    },
  ] as never) as unknown as SceneElement[];

  const arrow = built.find((el) => el.type === "arrow");
  if (!arrow) return null;

  const GAP = 4;
  arrow.startBinding = { elementId: from.id, focus: 0, gap: GAP };
  arrow.endBinding = { elementId: to.id, focus: 0, gap: GAP };

  const extras: SceneElement[] = [];
  if (label) {
    const mid = labelSpot(route);
    extras.push(
      ...(convertToExcalidrawElements([
        {
          type: "text",
          x: mid.x - textW(label, 14) / 2,
          y: mid.y,
          text: label,
          fontSize: 14,
          fontFamily: HAND,
          strokeColor: SOFT,
        },
      ] as never) as unknown as SceneElement[]),
    );
  }

  const ref = { id: arrow.id, type: "arrow" };
  return {
    arrow,
    extras,
    bindPatches: [
      {
        id: from.id,
        boundElements: [
          ...((from.boundElements as unknown[]) ?? []),
          ref,
        ],
      },
      {
        id: to.id,
        boundElements: [...((to.boundElements as unknown[]) ?? []), ref],
      },
    ],
  };
}

export interface BuiltOp {
  elements: SceneElement[];
  mark?: Mark;
}

export interface OpSize {
  w: number;
  h: number;
  fullWidth: boolean;
  /** Ops that annotate existing marks don't consume pen space. */
  noPlace: boolean;
}

/**
 * How much room this op needs. Split out from buildOp so the caller can turn
 * the page *before* drawing rather than discovering the overflow after.
 */
export function measureOp(op: Op, marks: Map<string, Mark>): OpSize | null {
  const none = { noPlace: true, fullWidth: false, w: 0, h: 0 };
  switch (op.op) {
    case "title":
      return { w: textW(op.text.toUpperCase(), SIZE.title), h: SIZE.title + 30, fullWidth: true, noPlace: false };
    case "heading":
      return { w: textW(op.text, SIZE.heading), h: SIZE.heading + 12, fullWidth: true, noPlace: false };
    case "word":
      return { w: textW(op.text, SIZE.word), h: SIZE.word + 8, fullWidth: false, noPlace: false };
    case "note":
      return { w: textW(op.text, SIZE.note), h: SIZE.note + 8, fullWidth: false, noPlace: false };
    case "bullet":
      return { w: textW(op.text, SIZE.bullet) + 26, h: SIZE.bullet + 10, fullWidth: false, noPlace: false };
    case "box":
      return {
        w: Math.max(170, textW(op.text, SIZE.box) + 48),
        h: 70,
        fullWidth: false,
        noPlace: false,
      };
    case "icon":
      return resolveIcon(op.name)
        ? { w: 46, h: 46, fullWidth: false, noPlace: false }
        : null;
    case "wave":
      return { w: 44, h: 44, fullWidth: false, noPlace: false };
    case "link": {
      const a = marks.get(markKey(op.from));
      const b = marks.get(markKey(op.to));
      if (!a || !b) return null;
      // An arrow between marks that are rows apart drags a line straight
      // through everything written in between. Connect neighbours only; a
      // missing arrow costs less than a scribble across the page.
      const sameRow = Math.abs(a.y - b.y) < Math.max(a.h, b.h);
      const rowsApart = Math.abs(a.y - b.y) > 170;
      return sameRow || !rowsApart ? none : null;
    }
    case "underline":
      return marks.has(markKey(op.text)) ? none : null;
  }
}

/**
 * Turn one op into elements. `marks` is the registry of what's already on the
 * page, used by the ops that reference earlier marks.
 *
 * The wrapper attaches the mark's element identity. A mark is only useful to
 * the Organizer if it can be pointed at later, and the individual cases below
 * have no reason to care which of their elements is the bindable one.
 */
export async function buildOp(
  op: Op,
  pen: Pen,
  marks: Map<string, Mark>,
): Promise<BuiltOp | null> {
  const built = await buildOpElements(op, pen, marks);
  if (!built?.mark) return built;
  // Prefer a container: Excalidraw binds arrows to a rectangle more reliably
  // than to a bare text element, and a boxed mark has one.
  const anchor =
    built.elements.find((el) => el.type === "rectangle") ??
    built.elements.find((el) => el.type === "text") ??
    built.elements[0];
  built.mark.elementId = anchor?.id;
  if ("text" in op) built.mark.text = op.text;

  // Take the geometry Excalidraw actually produced, not the estimate that was
  // used to reserve the space.
  //
  // `textW` guesses at Excalifont's metrics because they aren't available when
  // the pen has to decide where a block goes. That guess is fine for layout —
  // being a few pixels out just changes the spacing. It is NOT fine for a mark
  // that something else will later be drawn AROUND: the reference ring landed
  // near the words instead of enclosing them, and arrows then treated the
  // words as ordinary obstacles rather than as part of the concept they belong
  // to, so they were routed straight across them. Measured on the real canvas,
  // not caught by any test that didn't render.
  if (anchor) {
    const w = anchor.width as number;
    const h = anchor.height as number;
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      built.mark.x = anchor.x;
      built.mark.y = anchor.y;
      built.mark.w = w;
      built.mark.h = h;
    }
  }
  return built;
}

async function buildOpElements(
  op: Op,
  pen: Pen,
  marks: Map<string, Mark>,
): Promise<BuiltOp | null> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const conv = (s: Record<string, unknown>[]) =>
    convertToExcalidrawElements(s as never) as unknown as SceneElement[];

  const size_ = measureOp(op, marks);
  if (!size_) return null;

  switch (op.op) {
    case "title": {
      const size = SIZE.title;
      const text = op.text.toUpperCase();
      const w = size_.w;
      const p = place(pen, size_.w, size_.h, true);
      return {
        elements: conv([
          { type: "text", x: p.x, y: p.y, text, fontSize: size, fontFamily: HAND, strokeColor: INK },
          { type: "line", x: p.x, y: p.y + size + 10, points: swoosh(w), strokeColor: ACCENT, strokeWidth: 2, roughness: 2 },
        ]),
        mark: { key: markKey(op.text), x: p.x, y: p.y, w, h: size },
      };
    }

    case "heading": {
      const size = SIZE.heading;
      const w = size_.w;
      const p = place(pen, size_.w, size_.h, true);
      return {
        elements: conv([
          { type: "text", x: p.x, y: p.y, text: op.text, fontSize: size, fontFamily: HAND, strokeColor: INK },
        ]),
        mark: { key: markKey(op.text), x: p.x, y: p.y, w, h: size },
      };
    }

    case "word": {
      const size = SIZE.word;
      const w = size_.w;
      const p = place(pen, size_.w, size_.h);
      return {
        elements: conv([
          { type: "text", x: p.x, y: p.y, text: op.text, fontSize: size, fontFamily: HAND, strokeColor: INK },
        ]),
        mark: { key: markKey(op.text), x: p.x, y: p.y, w, h: size },
      };
    }

    case "note": {
      const size = SIZE.note;
      const w = size_.w;
      const p = place(pen, size_.w, size_.h);
      return {
        elements: conv([
          { type: "text", x: p.x, y: p.y, text: op.text, fontSize: size, fontFamily: HAND, strokeColor: SOFT },
        ]),
        mark: { key: markKey(op.text), x: p.x, y: p.y, w, h: size },
      };
    }

    case "bullet": {
      const size = SIZE.bullet;
      const w = size_.w;
      const p = place(pen, size_.w, size_.h);
      return {
        elements: conv([
          { type: "ellipse", x: p.x, y: p.y + 6, width: 8, height: 8, strokeColor: ACCENT, backgroundColor: ACCENT, fillStyle: "solid", roughness: 2 },
          { type: "text", x: p.x + 20, y: p.y, text: op.text, fontSize: size, fontFamily: HAND, strokeColor: SOFT },
        ]),
        mark: { key: markKey(op.text), x: p.x, y: p.y, w, h: size },
      };
    }

    case "box": {
      const size = SIZE.box;
      const w = size_.w;
      const h = size_.h;
      const p = place(pen, w, h);
      return {
        elements: conv([
          {
            type: "rectangle", x: p.x, y: p.y, width: w, height: h,
            strokeColor: SOFT, backgroundColor: "transparent",
            roughness: 2, strokeWidth: 1,
            label: { text: op.text, fontSize: size, fontFamily: HAND, strokeColor: INK },
          },
        ]),
        mark: { key: markKey(op.text), x: p.x, y: p.y, w, h },
      };
    }

    case "icon": {
      const art = resolveIcon(op.name)!;
      const S = 46;
      const p = place(pen, size_.w, size_.h);
      const sx = (v: number) => p.x + (v / 100) * S;
      const sy = (v: number) => p.y + (v / 100) * S;
      const skeleton: Record<string, unknown>[] = [];
      for (const stroke of art.strokes) {
        const [hx, hy] = stroke[0];
        skeleton.push({
          type: "line", x: sx(hx), y: sy(hy),
          points: stroke.map(([px, py]) => [sx(px) - sx(hx), sy(py) - sy(hy)]),
          strokeColor: SOFT, strokeWidth: 1, roughness: 2,
        });
      }
      for (const [cx, cy, rx, ry] of art.ellipses) {
        skeleton.push({
          type: "ellipse",
          x: sx(cx - rx), y: sy(cy - ry),
          width: (rx * 2 / 100) * S, height: (ry * 2 / 100) * S,
          strokeColor: SOFT, backgroundColor: "transparent",
          strokeWidth: 1, roughness: 2,
        });
      }
      return { elements: conv(skeleton) };
    }

    case "wave": {
      const S = 44;
      const p = place(pen, size_.w, size_.h);
      const arc = (dx: number, scale: number) => {
        const pts: number[][] = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          const a = (-0.7 + t * 1.4) * Math.PI * 0.5;
          pts.push([dx + Math.cos(a) * 13 * scale, Math.sin(a) * 20 * scale]);
        }
        return pts;
      };
      return {
        elements: conv(
          [1, 0.7, 0.45].map((scale, i) => ({
            type: "line", x: p.x + i * 14, y: p.y + S / 2,
            points: arc(0, scale), strokeColor: ACCENT,
            strokeWidth: 1, roughness: 2,
          })),
        ),
      };
    }

    case "link": {
      const a = marks.get(markKey(op.from))!;
      const b = marks.get(markKey(op.to))!;
      // Leave from the edge that faces the target. A fixed right-to-left
      // arrow drags a diagonal straight through whatever sits between them
      // when the two marks are on different lines.
      const sameRow = Math.abs(a.y - b.y) < Math.max(a.h, b.h);
      const from = sameRow
        ? { x: a.x + a.w, y: a.y + a.h / 2 }
        : { x: a.x + a.w / 2, y: a.y + a.h };
      const to = sameRow
        ? { x: b.x, y: b.y + b.h / 2 }
        : { x: b.x + b.w / 2, y: b.y };
      const skeleton: Record<string, unknown>[] = [
        {
          // Inset both ends so the head doesn't collide with the mark it points at.
          type: "arrow",
          x: sameRow ? from.x + 6 : from.x,
          y: sameRow ? from.y : from.y + 6,
          points: [
            [0, 0],
            sameRow
              ? [to.x - from.x - 12, to.y - from.y]
              : [to.x - from.x, to.y - from.y - 12],
          ],
          strokeColor: SOFT, strokeWidth: 1, roughness: 2,
        },
      ];
      if (op.label) {
        skeleton.push({
          type: "text",
          x: (from.x + to.x) / 2 - textW(op.label, 14) / 2,
          y: (from.y + to.y) / 2 - 22,
          text: op.label, fontSize: 16, fontFamily: HAND, strokeColor: SOFT,
        });
      }
      return { elements: conv(skeleton) };
    }

    case "underline": {
      const m = marks.get(markKey(op.text))!;
      return {
        elements: conv([
          {
            type: "line", x: m.x, y: m.y + m.h + 8,
            points: swoosh(m.w), strokeColor: ACCENT,
            strokeWidth: 2, roughness: 2,
          },
        ]),
      };
    }
  }
}
