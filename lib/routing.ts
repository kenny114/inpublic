/**
 * Where an arrow goes.
 *
 * `buildBoundArrow` used to draw a straight segment between the facing edges
 * of two boxes, which is correct for neighbours and wrong for everything else:
 * on a sketchnote page the space between two concepts is full of lettered
 * words and icons, and a straight line goes right through them. The result
 * reads as a scribble across the speaker's own notes.
 *
 * So: try straight, and if the segment crosses anything, route around it with
 * an elbow. Orthogonal elbows only — a hand-drawn board tolerates a right
 * angle far better than a diagonal through a word.
 *
 * Pure geometry, no Excalidraw, so it can be tested directly.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Avoid if possible, cross if there is no alternative.
   *
   * The live transcript is the case this exists for. It runs the full width of
   * the sheet, several rows of it, so on a busy page EVERY route between two
   * concepts crosses one — and treating that as impassable means the router
   * finds nothing, falls back to a straight line, and crosses the lettered
   * words too. Better to cross the transcript deliberately, in the one place
   * that keeps the arrow clear of everything that names something.
   */
  soft?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface Route {
  start: Point;
  end: Point;
  /** Relative to `start`, in Excalidraw's arrow-points convention. */
  points: [number, number][];
  /** Whether an obstacle forced an elbow. For the log. */
  routed: boolean;
}

const centre = (r: Rect): Point => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

/** Grow a rect by `pad` on every side. */
export function inflate(r: Rect, pad: number): Rect {
  return {
    x: r.x - pad,
    y: r.y - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  // Cheap reject.
  if (maxX < r.x || minX > r.x + r.width) return false;
  if (maxY < r.y || minY > r.y + r.height) return false;

  // Liang–Barsky clip of the segment against the rect.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tests: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.width - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.height - a.y],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return false; // parallel and outside
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

/** Does this polyline cross any obstacle? */
export function pathBlocked(path: Point[], obstacles: Rect[]): boolean {
  for (let i = 0; i + 1 < path.length; i += 1) {
    for (const o of obstacles) {
      if (segmentHitsRect(path[i], path[i + 1], o)) return true;
    }
  }
  return false;
}

/** The point on `r`'s edge facing `toward`, plus which side it left from. */
function exitPoint(
  r: Rect,
  toward: Point,
): { at: Point; side: "left" | "right" | "top" | "bottom" } {
  const c = centre(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { at: { x: r.x + r.width, y: c.y }, side: "right" }
      : { at: { x: r.x, y: c.y }, side: "left" };
  }
  return dy >= 0
    ? { at: { x: c.x, y: r.y + r.height }, side: "bottom" }
    : { at: { x: c.x, y: r.y }, side: "top" };
}

/** Clearance kept between an arrow and anything it passes. */
export const CLEARANCE = 14;

/**
 * Route an arrow from `from` to `to`, avoiding `obstacles`.
 *
 * `obstacles` should exclude the two endpoints themselves — an arrow is
 * allowed to touch what it points at. Anything else on the page (lettered
 * words, icons, other boxes) belongs in the list.
 */
export function routeArrow(
  from: Rect,
  to: Rect,
  obstacles: Rect[] = [],
): Route {
  // An obstacle that overlaps an endpoint cannot be routed around: the arrow
  // has to start or finish inside it. This is not a corner case — an adopted
  // concept is a ring drawn around an existing mark, so the mark it rings sits
  // inside its own endpoint, and once inflated by the clearance it covers the
  // ring's edge. Left in the list it blocks every candidate route from that
  // endpoint, which is exactly why arrows were coming out straight and
  // crossing the page.
  const touchesEndpoint = (o: Rect) => overlaps(o, from) || overlaps(o, to);
  const relevant = obstacles.filter((o) => !touchesEndpoint(o));
  const hardOnly = relevant.filter((o) => !o.soft);

  // Passes, in order of how much they give up:
  //
  //   1. everything, at full clearance      — the arrow reads well
  //   2. everything, at half clearance      — it squeezes through
  //   3. hard obstacles only                — it crosses the transcript
  //   4. hard obstacles, half clearance     — it squeezes past the words
  //   5. straight                           — it crosses something, and an
  //                                           arrow that crosses beats no
  //                                           arrow at all: the relationship
  //                                           is the information.
  const pad = (list: Rect[], clearance: number) =>
    list.map((o) => inflate(o, clearance));
  const attempt = (list: Rect[], clearance: number) =>
    routeAgainst(from, to, pad(list, clearance));

  return (
    attempt(relevant, CLEARANCE) ??
    attempt(relevant, CLEARANCE / 2) ??
    attempt(hardOnly, CLEARANCE) ??
    attempt(hardOnly, CLEARANCE / 2) ??
    straightLine(from, to)
  );
}

/** The last resort: an arrow that crosses something beats no arrow at all. */
function straightLine(from: Rect, to: Rect): Route {
  const start = exitPoint(from, centre(to)).at;
  const end = exitPoint(to, centre(from)).at;
  return {
    start,
    end,
    points: [
      [0, 0],
      [end.x - start.x, end.y - start.y],
    ],
    routed: false,
  };
}

function routeAgainst(from: Rect, to: Rect, padded: Rect[]): Route | null {
  const exit = exitPoint(from, centre(to));
  const entry = exitPoint(to, centre(from));
  const start = exit.at;
  const end = entry.at;

  const rel = (pts: Point[]): [number, number][] =>
    pts.map((p) => [p.x - start.x, p.y - start.y] as [number, number]);

  /**
   * An arrow must leave by the side it exits and arrive by the side it enters.
   *
   * Without this a lane can be chosen that leaves the left edge and then
   * immediately runs right, straight back across the box it just came out of
   * and over its own label. The obstacle test never catches it, because a
   * box is not an obstacle to the arrow attached to it.
   */
  const respectsSides = (path: Point[]): boolean => {
    if (path.length < 2) return true;
    const a = path[1];
    const okStart =
      exit.side === "left"
        ? a.x <= start.x
        : exit.side === "right"
          ? a.x >= start.x
          : exit.side === "top"
            ? a.y <= start.y
            : a.y >= start.y;
    const b = path[path.length - 2];
    const okEnd =
      entry.side === "left"
        ? b.x <= end.x
        : entry.side === "right"
          ? b.x >= end.x
          : entry.side === "top"
            ? b.y <= end.y
            : b.y >= end.y;
    return okStart && okEnd;
  };

  const usable = (path: Point[]) =>
    respectsSides(path) && !pathBlocked(path, padded);

  // 1. Straight. Almost always the right answer for neighbours.
  const straight = [start, end];
  if (!pathBlocked(straight, padded)) {
    return { start, end, points: rel(straight), routed: false };
  }

  // 2. Two elbows: leave the way we're facing, cross, come back.
  //    Which one reads better depends on how the two boxes are arranged, so
  //    try both orders and keep the first clear one.
  const horizontalFirst: Point[] = [
    start,
    { x: end.x, y: start.y },
    end,
  ];
  const verticalFirst: Point[] = [start, { x: start.x, y: end.y }, end];
  const preferVertical = exit.side === "top" || exit.side === "bottom";
  for (const candidate of preferVertical
    ? [verticalFirst, horizontalFirst]
    : [horizontalFirst, verticalFirst]) {
    if (usable(candidate)) {
      return { start, end, points: rel(candidate), routed: true };
    }
  }

  // 3. A channel: leave, run along a lane that is clear, come back.
  //
  //    Both axes get tried, in the order that suits the exit side. Only one
  //    was tried at first, and it was the wrong one for the commonest case on
  //    this board: two boxes side by side on the same row with a lettered word
  //    between them. A lane that varies x cannot get around an obstacle when
  //    both boxes sit at the same y — every candidate is the same flat line.
  //    Lanes are offsets from three anchors — the midpoint and both ends —
  //    because the clear channel on a sketchnote page is usually just past a
  //    row rather than halfway between two things. Nearest offset first, so
  //    the arrow detours as little as it can.
  const lanes: number[] = [0];
  const span = Math.abs(end.y - start.y) + Math.abs(end.x - start.x);
  for (let step = 1; step <= 16; step += 1) {
    const offset = step * Math.round(CLEARANCE * 1.5);
    lanes.push(offset, -offset);
    if (offset > span + 260) break;
  }

  /** Out sideways, across at `y`, back in. */
  const horizontalLane = (anchor: number) => (lane: number): Point[] => {
    const y = anchor + lane;
    return [start, { x: start.x, y }, { x: end.x, y }, end];
  };
  /** Out vertically, across at `x`, back in. */
  const verticalLane = (anchor: number) => (lane: number): Point[] => {
    const x = anchor + lane;
    return [start, { x, y: start.y }, { x, y: end.y }, end];
  };

  const hAnchors = [(start.y + end.y) / 2, start.y, end.y];
  const vAnchors = [(start.x + end.x) / 2, start.x, end.x];
  const families = preferVertical
    ? [...vAnchors.map(verticalLane), ...hAnchors.map(horizontalLane)]
    : [...hAnchors.map(horizontalLane), ...vAnchors.map(verticalLane)];

  for (const build of families) {
    for (const lane of lanes) {
      const candidate = build(lane);
      if (usable(candidate)) {
        return { start, end, points: rel(candidate), routed: true };
      }
    }
  }

  // Nothing here is clear. The caller decides what to relax.
  return null;
}

/**
 * Where to put a relationship's label so it doesn't land on the arrow or on
 * whatever the arrow is passing. Picks the longest straight run of the route
 * and sits just above its middle.
 */
export function labelSpot(route: Route): Point {
  const abs = route.points.map((p) => ({
    x: route.start.x + p[0],
    y: route.start.y + p[1],
  }));
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i + 1 < abs.length; i += 1) {
    const len = Math.hypot(abs[i + 1].x - abs[i].x, abs[i + 1].y - abs[i].y);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  const a = abs[best];
  const b = abs[best + 1] ?? abs[best];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 20 };
}
