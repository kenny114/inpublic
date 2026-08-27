/**
 * The composer: ExpressionPlan -> ScenePlan.
 *
 * The planner decided what the picture MEANS. This decides where everything
 * goes. It is the first layer allowed to know about coordinates, and it is
 * deterministic arithmetic from end to end — no model invents a pixel here,
 * which is what makes a scene reproducible, diffable, and testable without
 * a network.
 *
 * One layout routine per spatial logic, selected by the plan's grammar:
 *
 *   flow      cause_effect / sequence / process   a vertical spine, branches on their step's row
 *   poles     comparison / quantity               parallel columns on a shared row grid
 *   enclosure hierarchy / grouping                children inside the parent —
 *                                                 or, when the "hierarchy" is a claim
 *                                                 standing on its reasons rather than a
 *                                                 whole containing its parts, a tree
 *                                                 beneath it (see isSupportHierarchy)
 *   space     spatial                             the described arrangement
 *   scene     scene / relationship                a subject with context around it
 *
 * Nested regions (`Region.childRegionIds`) are placed inside their parent's
 * box by every routine, so a counted family inside an identity scene works
 * the same way a department inside a company does.
 *
 * After placement, three passes that are about comprehension rather than
 * arrangement: emphasis scaling, overlap separation, and connector routing
 * from box edge to box edge. Then everything is translated so the scene
 * starts at the origin, because a renderer should never have to reason
 * about negative space it did not create.
 */

import { resolvePrimitive, type ResolvedPrimitive } from "../primitives/resolve";
import {
  relationFamily,
  ScenePlanSchema,
  type ConnectorStyle,
  type ExpressionPlan,
  type Region,
  type ScenePlan,
  type SceneConnector,
  type GrammarId,
  type PresentationLayout,
  type PresentationPlan,
  type SceneObject,
  type WorldEntity,
  type WorldRelation,
  type WorldState,
} from "../schemas";
import type { PresentationIntent } from "../presentation/intent";

const GAP_X = 72;
const GAP_Y = 88;
const PADDING = 48;
/** Room a container leaves around its contents. */
const INSET = 28;
const INSET_TOP = 52;

/**
 * Emphasis does not change colour alone — it changes size, so hierarchy
 * survives a greyscale print.
 *
 * The gap between 2 and 3 is deliberately wide. Weight 2 is "this is the
 * subject"; weight 3 is "this is what just happened", and at 1.25 it was
 * within the ordinary variation between a short label and a long one — so
 * the one thing the round was actually about did not read as different at
 * all. Both renderers pair this with a heavier stroke at 3 for the same
 * reason: size alone is comparative (you need the other boxes to see it),
 * stroke is absolute.
 */
const WEIGHT_SCALE: Record<number, number> = { 0: 0.82, 1: 0.92, 2: 1.12, 3: 1.5 };

/**
 * Why the whole table moved down and the top moved up.
 *
 * Hierarchy is a RATIO, and the old spread was too narrow to read as one:
 * the subject at 1.15 against context at 1.0 is a 15% difference, which is
 * inside the ordinary variation between a short label and a long one. Every
 * box therefore looked like every other box and the page read as a list.
 * The subject is now 1.5 against a 0.92 default — a 63% difference, which
 * is the difference between a heading and body text, and which survives
 * both a glance and a greyscale print.
 *
 * Context sits BELOW 1 rather than at it, so supporting boxes recede
 * instead of merely failing to advance. That is what stops five things on
 * a page from competing: four of them are visibly not the point.
 */

/**
 * The most any box can outgrow its intrinsic size — WEIGHT_SCALE's top
 * entry, read from the table rather than repeated, so raising emphasis can
 * never leave the grids below too small for it.
 *
 * A grid built from intrinsic sizes is what holds a live board still (see
 * Placed.baseW/baseH), but a cell sized to the intrinsic box is too small
 * for the emphasised one that may sit in it — and an overlap is not a
 * cosmetic problem here: `separate` resolves it by shoving the offender
 * hundreds of pixels down the page, which is precisely the jump the grid
 * exists to prevent. So every cell reserves the room emphasis COULD need,
 * whether or not this round's occupant is using it. The reservation depends
 * only on base sizes, so it is the same every round.
 */
const EMPHASIS_HEADROOM = WEIGHT_SCALE[3];

/** A grid cell wide/tall enough for `base` at any emphasis. */
function cell(base: number): number {
  return Math.round(base * EMPHASIS_HEADROOM);
}

/** The cell size a row of objects needs, from their intrinsic heights. */
function rowCell(cells: Placed[]): number {
  return cell(Math.max(...cells.map((c) => c.baseH), 0));
}

interface Placed {
  region: Region;
  entity: WorldEntity | null;
  resolved: ResolvedPrimitive;
  weight: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * The size this object would be at weight 1 — its primitive's own size,
   * before WEIGHT_SCALE. Layouts build their GRIDS from this and then place
   * the real (scaled) box inside the cell.
   *
   * That separation is what makes a live board hold still. Emphasis decays
   * every round by design: what was just said is weight 3 and drops to 1 the
   * moment something newer arrives, so under a grid built from actual sizes
   * EVERY box's cell resized every single turn, and each resize pushed
   * everything after it. A chain three sentences long re-flowed end to end
   * on each new sentence, for a reason that had nothing to do with the
   * meaning changing. The grid now ignores emphasis entirely; emphasis still
   * changes the box, which is the part a viewer is meant to see.
   */
  baseW: number;
  baseH: number;
  parentRegionId?: string;
}

// ─────────────────────────────────────────────────────────── setup

function weightFor(plan: ExpressionPlan, region: Region, options: ComposeOptions): number {
  const layout = layoutFromPresentation(plan, options);
  if ((layout === "vertical-spine" || layout === "left-to-right") && region.entityId) {
    if (region.entityId === options.primaryId) return 3;
    if (options.demote?.includes(region.entityId)) return 0;
    if (options.spineIds?.length && !options.spineIds.includes(region.entityId)) return 0;
    return 1;
  }
  const emphasis = plan.emphasis.find((e) => e.regionId === region.id);
  if (emphasis) return emphasis.weight;
  switch (region.role) {
    case "primary_subject":
    case "hierarchy_root":
      return 2;
    case "annotation":
      return 0;
    case "context":
      return 0;
    default:
      return 1;
  }
}

function prepare(world: WorldState, plan: ExpressionPlan, options: ComposeOptions = {}): Map<string, Placed> {
  const byId = new Map<string, Placed>();
  const parentOf = new Map<string, string>();
  for (const region of plan.regions) {
    for (const child of region.childRegionIds ?? []) parentOf.set(child, region.id);
  }
  for (const region of plan.regions) {
    const entity = region.entityId ? world.entities.find((e) => e.id === region.entityId) ?? null : null;
    const resolved = resolvePrimitive(entity, region);
    const weight = weightFor(plan, region, options);
    const scale = WEIGHT_SCALE[weight] ?? 1;
    byId.set(region.id, {
      region,
      entity,
      resolved,
      weight,
      x: 0,
      y: 0,
      w: Math.round(resolved.size.w * scale),
      h: Math.round(resolved.size.h * scale),
      baseW: resolved.size.w,
      baseH: resolved.size.h,
      parentRegionId: parentOf.get(region.id),
    });
  }
  return byId;
}

function ordered(placed: Map<string, Placed>, plan: ExpressionPlan, role: Region["role"]): Placed[] {
  return plan.regions
    .filter((r) => r.role === role)
    .map((r) => placed.get(r.id)!)
    .filter(Boolean)
    .sort((a, b) => (a.region.order ?? 0) - (b.region.order ?? 0));
}

/** Top-level = not drawn inside another region. Only these participate in the main layout. */
function topLevel(placed: Map<string, Placed>): Placed[] {
  return [...placed.values()].filter((p) => !p.parentRegionId && p.region.role !== "annotation");
}

// ───────────────────────────────────────────────────────── layouts

/**
 * A vertical spine: each step below the last, centres aligned. Direction is
 * the meaning.
 *
 * A causal explanation is a graph, not a path — the grammar keeps the
 * branches that hang off the spine without lying on it (see causeEffect) —
 * and where those branches LAND is what decides whether the picture still
 * reads as one story. Parked in a leftover column to the right, as they
 * were, they formed a second unlabelled stack that competed with the spine
 * for the same reading; nothing said which step any of them belonged to,
 * and the connector had to be traced by eye to find out.
 *
 * So a branch is placed on the row of the step it is actually connected to,
 * alternating right then left so a step with two conditions gets one on
 * either side. It is a placement, not a claim: the branch's own connector
 * still carries the relation, and a branch with no connection to any step
 * falls through to layoutStragglers exactly as before.
 */
function layoutFlow(placed: Map<string, Placed>, plan: ExpressionPlan): void {
  const steps = [
    ...ordered(placed, plan, "chain_step"),
    ...ordered(placed, plan, "sequence_step"),
  ];
  const spine = steps.length ? steps : topLevel(placed);
  // The grid is intrinsic: a fixed centre axis and a fixed row pitch, both
  // computed from base sizes. Steps are TOP-aligned in their row rather than
  // centred, so an emphasised step grows down into the gap beneath it
  // instead of nudging the row line every step after it reads from.
  const widest = cell(Math.max(...spine.map((p) => p.baseW), 0));
  const pitch = rowCell(spine) + GAP_Y;
  spine.forEach((step, index) => {
    step.x = Math.round((widest - step.w) / 2);
    step.y = index * pitch;
  });

  const onSpine = new Set(spine.map((p) => p.region.id));
  const laidOut = [...spine];
  const used = new Map<string, { right: number; left: number }>();
  for (const branch of topLevel(placed)) {
    if (onSpine.has(branch.region.id)) continue;
    const anchor = spine.find((step) =>
      plan.connections.some(
        (c) =>
          (c.fromRegionId === branch.region.id && c.toRegionId === step.region.id) ||
          (c.toRegionId === branch.region.id && c.fromRegionId === step.region.id),
      ),
    );
    if (!anchor) continue;
    const slots = used.get(anchor.region.id) ?? { right: 0, left: 0 };
    const goRight = slots.right <= slots.left;
    const depth = goRight ? slots.right++ : slots.left++;
    used.set(anchor.region.id, slots);
    // Clear of the spine column by construction: the nearest edge of a
    // branch sits a full gap beyond the widest step, whichever side it is on.
    const offset = widest / 2 + GAP_X + branch.w / 2 + depth * (branch.w + GAP_X);
    // (widest is the intrinsic column width — see the grid note above.)
    branch.x = Math.round(anchor.x + anchor.w / 2 + (goRight ? offset : -offset) - branch.w / 2);
    branch.y = Math.round(anchor.y + (anchor.h - branch.h) / 2);
    const children = (branch.region.childRegionIds ?? []).map((id) => placed.get(id)).filter((p): p is Placed => Boolean(p));
    if (children.length) packInside(branch, children, branch.y);
    laidOut.push(branch, ...children);
  }

  layoutStragglers(placed, plan, laidOut, Math.max(...laidOut.map((p) => p.x + p.w), widest) + GAP_X, 0);
}

/**
 * A horizontal spine: each step to the right of the last, centres aligned.
 * Time and "and then" read left-to-right; cause still prefers the vertical
 * layout above. Branches sit above/below the step they attach to, same
 * reasoning as layoutFlow — a leftover column would compete with the path.
 */
function layoutFlowHorizontal(placed: Map<string, Placed>, plan: ExpressionPlan): void {
  const steps = [
    ...ordered(placed, plan, "chain_step"),
    ...ordered(placed, plan, "sequence_step"),
  ];
  const spine = steps.length ? steps : topLevel(placed);
  const tallest = cell(Math.max(...spine.map((p) => p.baseH), 0));
  const col = cell(Math.max(...spine.map((p) => p.baseW), 0));
  const pitch = col + GAP_X;
  spine.forEach((step, index) => {
    step.x = index * pitch + Math.round((col - step.w) / 2);
    step.y = Math.round((tallest - step.h) / 2);
  });

  const onSpine = new Set(spine.map((p) => p.region.id));
  const laidOut = [...spine];
  const used = new Map<string, { above: number; below: number }>();
  for (const branch of topLevel(placed)) {
    if (onSpine.has(branch.region.id)) continue;
    const anchor = spine.find((step) =>
      plan.connections.some(
        (c) =>
          (c.fromRegionId === branch.region.id && c.toRegionId === step.region.id) ||
          (c.toRegionId === branch.region.id && c.fromRegionId === step.region.id),
      ),
    );
    if (!anchor) continue;
    const slots = used.get(anchor.region.id) ?? { above: 0, below: 0 };
    const goBelow = slots.below <= slots.above;
    const depth = goBelow ? slots.below++ : slots.above++;
    used.set(anchor.region.id, slots);
    const offset = tallest / 2 + GAP_Y + branch.h / 2 + depth * (branch.h + GAP_Y / 2);
    branch.x = Math.round(anchor.x + (anchor.w - branch.w) / 2);
    branch.y = Math.round(anchor.y + anchor.h / 2 + (goBelow ? offset : -offset) - branch.h / 2);
    const children = (branch.region.childRegionIds ?? []).map((id) => placed.get(id)).filter((p): p is Placed => Boolean(p));
    if (children.length) packInside(branch, children, branch.y);
    laidOut.push(branch, ...children);
  }

  layoutStragglers(
    placed,
    plan,
    laidOut,
    0,
    Math.max(...laidOut.map((p) => p.y + p.h), tallest) + GAP_Y,
  );
}

/**
 * Parallel columns. No arrow is drawn between the poles — the parallel
 * arrangement is the comparison, and an arrow would assert a direction the
 * speaker never claimed. Each pole's own properties stack beneath it, so
 * the two columns are read against each other row by row.
 *
 * "Row by row" is the whole point, and it has to be built rather than hoped
 * for. Two things had stopped it being true:
 *
 *  - Each column started its stack at its OWN height, so a taller pole
 *    pushed its dimensions down and the two columns ran out of step from the
 *    first row. Every column now starts beneath the tallest pole, on a
 *    shared grid of rows whose height is the tallest cell in that row.
 *  - Dimensions were stacked in whatever order the grammar emitted them, so
 *    the row a viewer reads across could pair cost against duration. A
 *    dimension the speaker actually compared against one already seated now
 *    takes that dimension's row; the rest fill the gaps in order.
 *
 * The shared row grid is also what makes the comparison RECOVERABLE rather
 * than merely tidy: lib/expression/evaluate/evaluate.ts reads two siblings
 * on the same row as a parallel, which is precisely the reading a
 * comparative relation needs and precisely what drifting columns denied it.
 *
 * `layoutStragglers` is handed the children as well as the columns. It was
 * handed only the columns, which made every dimension look unplaced — so the
 * straggler pass immediately re-parked the whole grid into one column off to
 * the side, undoing the layout above it.
 */
function layoutPoles(placed: Map<string, Placed>, plan: ExpressionPlan, world: WorldState): void {
  const poles = ordered(placed, plan, "comparison_pole");
  const subject = ordered(placed, plan, "primary_subject");
  const columns = [...subject, ...poles].filter((p, i, arr) => arr.indexOf(p) === i);
  if (!columns.length) return layoutScene(placed, plan);

  const columnChildren = columns.map((column) =>
    (column.region.childRegionIds ?? []).map((id) => placed.get(id)).filter((p): p is Placed => Boolean(p)),
  );

  // Rows, as a grid of column index -> the dimension sitting in that cell.
  const rows: Array<Map<number, Placed>> = [];
  const seat = (columnIndex: number, child: Placed, rowIndex: number) => {
    while (rows.length <= rowIndex) rows.push(new Map());
    rows[rowIndex].set(columnIndex, child);
  };
  /** The row holding a dimension this one was explicitly compared against. */
  const partnerRow = (child: Placed, columnIndex: number): number =>
    rows.findIndex(
      (row) =>
        !row.has(columnIndex) &&
        [...row.values()].some(
          (other) =>
            other.region.entityId &&
            world.relations.some(
              (r) =>
                relationFamily(r.type) === "comparative" &&
                ((r.source === child.region.entityId && r.target === other.region.entityId) ||
                  (r.target === child.region.entityId && r.source === other.region.entityId)),
            ),
        ),
    );
  const firstFreeRow = (columnIndex: number) => {
    const free = rows.findIndex((row) => !row.has(columnIndex));
    return free === -1 ? rows.length : free;
  };

  columnChildren[0]?.forEach((child, index) => seat(0, child, index));
  for (let ci = 1; ci < columns.length; ci += 1) {
    const unpaired: Placed[] = [];
    for (const child of columnChildren[ci]) {
      const row = child.region.entityId ? partnerRow(child, ci) : -1;
      if (row === -1) unpaired.push(child);
      else seat(ci, child, row);
    }
    for (const child of unpaired) seat(ci, child, firstFreeRow(ci));
  }

  // Base sizes throughout, for the same reason layoutFlow uses them: the row
  // a dimension sits on must not move because a pole stopped being the
  // newest thing said. A second turn adding a dimension under one pole then
  // leaves every existing cell exactly where it was.
  const columnWidths = columns.map((column, ci) => cell(Math.max(column.baseW, ...columnChildren[ci].map((c) => c.baseW), 0)));
  const rowY: number[] = [];
  let cursor = rowCell(columns) + GAP_Y / 2;
  for (const row of rows) {
    rowY.push(cursor);
    cursor += rowCell([...row.values()]) + 24;
  }

  let x = 0;
  columns.forEach((column, ci) => {
    column.x = x + Math.round((columnWidths[ci] - column.w) / 2);
    column.y = 0;
    rows.forEach((row, ri) => {
      const child = row.get(ci);
      if (!child) return;
      child.x = x + Math.round((columnWidths[ci] - child.w) / 2);
      child.y = rowY[ri];
      child.parentRegionId = undefined; // stacked beneath, not enclosed
    });
    x += columnWidths[ci] + GAP_X * 1.5;
  });
  layoutStragglers(placed, plan, [...columns, ...columnChildren.flat()], x, 0);
}

/**
 * Enclosure: children inside the parent's boundary. The parent grows to fit
 * them, which is why its size is computed here rather than taken from the
 * primitive table. Containment is the one relation a picture states without
 * any words, so this layout is what lets those connectors be drawn as
 * nothing at all.
 */
function layoutEnclosure(placed: Map<string, Placed>, plan: ExpressionPlan, world: WorldState): void {
  const roots = [...ordered(placed, plan, "hierarchy_root"), ...ordered(placed, plan, "primary_subject")].filter(
    (p, i, arr) => arr.indexOf(p) === i,
  );
  if (!roots.length) return layoutScene(placed, plan);

  let rootY = 0;
  for (const root of roots) {
    const children = (root.region.childRegionIds ?? [])
      .map((id) => placed.get(id))
      .filter((p): p is Placed => Boolean(p));
    if (isSupportHierarchy(root, children, world)) packBelow(root, children, rootY);
    else packInside(root, children, rootY);
    rootY += root.h + GAP_Y;
  }
  const used = new Set(roots.flatMap((r) => [r.region.id, ...(r.region.childRegionIds ?? [])]));
  layoutStragglers(
    placed,
    plan,
    [...placed.values()].filter((p) => used.has(p.region.id)),
    Math.max(...roots.map((r) => r.x + r.w), 0) + GAP_X,
    0,
  );
}

/**
 * Is this root a CLAIM standing on its reasons, rather than a whole
 * containing its parts?
 *
 * The hierarchy grammar builds both — containment, and a claim backed by two
 * or more `supports` (see its own comment) — and enclosure is right for only
 * one of them. A department really is inside a company, so drawing it inside
 * states the relation with no words at all. A reason is not inside the claim
 * it backs: it stands under it holding it up, and enclosing it says the
 * argument is a part of its own conclusion.
 *
 * Decided from the world's relations rather than from a new region role,
 * because the distinction is entirely a fact about the relations that
 * produced the hierarchy. If ANY child is structurally contained the whole
 * root stays enclosure — a mixed root is a containment that also happens to
 * be argued for, and containment is the stronger claim to get right.
 */
function isSupportHierarchy(root: Placed, children: Placed[], world: WorldState): boolean {
  if (!root.region.entityId || !children.length) return false;
  const childIds = new Set(children.map((c) => c.region.entityId).filter(Boolean) as string[]);
  const between = world.relations.filter(
    (r) =>
      (r.source === root.region.entityId && childIds.has(r.target)) ||
      (r.target === root.region.entityId && childIds.has(r.source)),
  );
  if (between.some((r) => relationFamily(r.type) === "structural")) return false;
  return between.some((r) => r.type === "supports");
}

/**
 * A tree: the claim on top, its reasons in a row beneath it, the root
 * centred over them. The `supports` connectors then become real lines from
 * each reason up to the claim, which is what a viewer reads as "these hold
 * this up" — and, unlike enclosure, it stays readable when a reason has
 * reasons of its own.
 *
 * Children are un-parented here on purpose: `parentObjectId` means "drawn
 * inside", and lib/expression/evaluate/evaluate.ts reads enclosure straight
 * off the geometry. A child left parented while sitting outside its parent's
 * box would be a scene that contradicts itself.
 */
function packBelow(root: Placed, children: Placed[], originY: number): void {
  const rowWidth = children.reduce((sum, c) => sum + c.w, 0) + (children.length - 1) * 24;
  root.x = Math.round(Math.max(0, (rowWidth - root.w) / 2));
  root.y = originY;

  let x = Math.round(Math.max(0, (root.w - rowWidth) / 2));
  // root.baseH, not root.h: the reasons stay put when the claim stops being
  // the newest thing said. Same grid discipline as layoutFlow/layoutPoles.
  const childY = Math.round(originY + cell(root.baseH) + GAP_Y * 0.6);
  for (const child of children) {
    child.parentRegionId = undefined;
    child.x = x;
    child.y = childY;
    x += child.w + 24;
  }
}

/** Grid-packs `children` inside `parent`, resizing the parent to fit. */
function packInside(parent: Placed, children: Placed[], originY: number): void {
  parent.x = 0;
  parent.y = originY;
  if (!children.length) return;

  const perRow = Math.min(children.length, Math.ceil(Math.sqrt(children.length * 1.6)));
  const cellW = Math.max(...children.map((c) => c.w));
  const cellH = Math.max(...children.map((c) => c.h));
  const rows = Math.ceil(children.length / perRow);
  const innerW = perRow * cellW + (perRow - 1) * 24;
  const innerH = rows * cellH + (rows - 1) * 24;

  parent.w = Math.max(parent.w, innerW + INSET * 2);
  parent.h = Math.max(parent.h, innerH + INSET_TOP + INSET);

  children.forEach((child, index) => {
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    child.x = parent.x + INSET + col * (cellW + 24) + Math.round((cellW - child.w) / 2);
    child.y = parent.y + INSET_TOP + row * (cellH + 24);
  });
}

const SPATIAL_OFFSET: Record<string, { dx: number; dy: number }> = {
  above: { dx: 0, dy: -1 },
  below: { dx: 0, dy: 1 },
  beside: { dx: 1, dy: 0 },
  near: { dx: 1, dy: 0.3 },
  behind: { dx: 0.35, dy: -0.6 },
  in_front_of: { dx: -0.35, dy: 0.6 },
  on: { dx: 0, dy: -0.9 },
  inside: { dx: 0, dy: 0 },
};

/**
 * Space described in words becomes space on the canvas. "The lamp is behind
 * the chair" places the lamp up and back from the chair; the picture is
 * then true in the same way the sentence was, and needs no arrow saying
 * "behind".
 */
function layoutSpace(placed: Map<string, Placed>, plan: ExpressionPlan, world: WorldState): void {
  const anchorsPlaced = new Set<string>();
  const byEntity = new Map<string, Placed>();
  for (const p of placed.values()) if (p.region.entityId) byEntity.set(p.region.entityId, p);

  const first = topLevel(placed)[0];
  if (!first) return;
  first.x = 0;
  first.y = 0;
  anchorsPlaced.add(first.region.entityId ?? first.region.id);

  const spatialRels = world.relations.filter((r) => r.type === "located_at");

  /** Places `mover` relative to `anchor`, honouring the stated arrangement. `flip` reverses it when the anchor is the sentence's subject. */
  const attach = (mover: Placed, anchor: Placed, spatial: string | undefined, flip: boolean) => {
    if (spatial === "inside") {
      // "The keys are inside the drawer" is enclosure, not offset — and it
      // has to actually nest, or the evaluator (rightly) cannot recover it.
      const [outer, inner] = flip ? [mover, anchor] : [anchor, mover];
      inner.parentRegionId = outer.region.id;
      packInside(outer, [inner], outer.y);
      return;
    }
    const base = SPATIAL_OFFSET[spatial ?? "near"] ?? SPATIAL_OFFSET.near;
    const offset = flip ? { dx: -base.dx, dy: -base.dy } : base;
    mover.x = anchor.x + Math.round(offset.dx * (anchor.w + GAP_X));
    mover.y = anchor.y + Math.round(offset.dy * (anchor.h + GAP_Y * 0.6));
  };

  // Repeat until no more can be attached. Each pass places anything anchored
  // to something already on the canvas — in EITHER direction, since "the
  // kitchen is below the studio" is equally usable whichever of the two the
  // layout happened to place first.
  for (let pass = 0; pass < spatialRels.length + 1; pass += 1) {
    let progressed = false;
    for (const rel of spatialRels) {
      const subject = byEntity.get(rel.source);
      const anchor = byEntity.get(rel.target);
      if (!subject || !anchor) continue;
      const subjectPlaced = anchorsPlaced.has(rel.source);
      const anchorPlaced = anchorsPlaced.has(rel.target);
      if (subjectPlaced === anchorPlaced) continue;
      if (anchorPlaced) {
        attach(subject, anchor, rel.spatial, false);
        anchorsPlaced.add(rel.source);
      } else {
        attach(anchor, subject, rel.spatial, true);
        anchorsPlaced.add(rel.target);
      }
      progressed = true;
    }
    if (!progressed) break;
  }

  const unplaced = topLevel(placed).filter((p) => !anchorsPlaced.has(p.region.entityId ?? p.region.id));
  layoutStragglers(placed, plan, topLevel(placed).filter((p) => !unplaced.includes(p)), 0, 0);
}

/**
 * Slots around a subject, in a fixed order so the same meaning always
 * produces the same picture. Right first because it reads as "and then";
 * below second because it reads as "belongs to".
 */
const SCENE_SLOTS: Array<{ dx: number; dy: number }> = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: -1 },
];

/** A subject at the centre with its context arranged around it. */
function layoutScene(placed: Map<string, Placed>, plan: ExpressionPlan): void {
  const all = topLevel(placed);
  if (!all.length) return;
  const subject =
    all.find((p) => p.region.role === "primary_subject") ??
    all.find((p) => p.region.id === plan.emphasis[0]?.regionId) ??
    all[0];

  subject.x = 0;
  subject.y = 0;
  const others = all.filter((p) => p !== subject);
  others.forEach((other, index) => {
    const slot = SCENE_SLOTS[index % SCENE_SLOTS.length];
    const ring = 1 + Math.floor(index / SCENE_SLOTS.length);
    other.x = Math.round(slot.dx * ring * (subject.w / 2 + other.w / 2 + GAP_X) - other.w / 2 + subject.w / 2);
    other.y = Math.round(slot.dy * ring * (subject.h / 2 + other.h / 2 + GAP_Y) - other.h / 2 + subject.h / 2);
    const children = (other.region.childRegionIds ?? []).map((id) => placed.get(id)).filter((p): p is Placed => Boolean(p));
    if (children.length) packInside(other, children, other.y);
  });

  const subjectChildren = (subject.region.childRegionIds ?? [])
    .map((id) => placed.get(id))
    .filter((p): p is Placed => Boolean(p));
  if (subjectChildren.length) packInside(subject, subjectChildren, subject.y);
}

/**
 * Anything a layout routine did not place — a region the chosen grammar
 * produced but whose role that routine has no slot for. Parked in a column
 * to the side rather than dropped, because silently losing a region the
 * planner deliberately created is the kind of bug that only ever shows up
 * as "why isn't that on the canvas".
 */
function layoutStragglers(placed: Map<string, Placed>, plan: ExpressionPlan, laidOut: Placed[], startX: number, startY: number): void {
  const done = new Set(laidOut.map((p) => p.region.id));
  let y = startY;
  for (const p of topLevel(placed)) {
    if (done.has(p.region.id)) continue;
    p.x = startX;
    p.y = y;
    y += p.h + 24;
    const children = (p.region.childRegionIds ?? []).map((id) => placed.get(id)).filter((c): c is Placed => Boolean(c));
    if (children.length) packInside(p, children, p.y);
  }
}

/** Annotations sit just beneath whatever they annotate — a note on a thing, never a floating sentence. */
function layoutAnnotations(placed: Map<string, Placed>, plan: ExpressionPlan): void {
  for (const region of plan.regions) {
    if (region.role !== "annotation") continue;
    const note = placed.get(region.id);
    const anchor = [...placed.values()].find((p) => p.region.role !== "annotation" && p.region.entityId === region.entityId);
    if (!note) continue;
    if (!anchor) {
      note.x = 0;
      note.y = 0;
      continue;
    }
    note.x = anchor.x;
    note.y = anchor.y + anchor.h + 12;
    note.w = Math.max(note.w, anchor.w);
  }
}

/** Magnitude reads as aligned extent; comparison reads as parallel columns. */
function layoutMagnitude(placed: Map<string, Placed>, plan: ExpressionPlan): void {
  const rows = topLevel(placed).sort((a, b) => (a.region.order ?? 0) - (b.region.order ?? 0));
  let y = 0;
  for (const row of rows) {
    row.x = 0;
    row.y = y;
    y += cell(row.baseH) + Math.round(GAP_Y * 0.55);
  }
  layoutStragglers(placed, plan, rows, Math.max(...rows.map((row) => row.w), 0) + GAP_X, 0);
}

/**
 * Realise the tiny presentation-level spatial vocabulary. These distances
 * are composer policy, never model output and never semantic `located_at`.
 */
function applyRequestedSpatialArrangement(placed: Map<string, Placed>, request: PresentationIntent | undefined): void {
  const arrangement = request?.spatial?.arrangement;
  if (!arrangement) return;
  const scoped = request.scope?.entityIds;
  const selected = topLevel(placed).filter(
    (candidate) => !scoped?.length || (candidate.region.entityId && scoped.includes(candidate.region.entityId)),
  );
  if (selected.length < 2) return;

  const move = (item: Placed, x: number, y: number) => {
    const dx = x - item.x;
    const dy = y - item.y;
    item.x = x;
    item.y = y;
    for (const child of placed.values()) {
      if (isDescendant(child, item, placed)) {
        child.x += dx;
        child.y += dy;
      }
    }
  };

  if (arrangement === "separated") {
    let x = 0;
    selected.forEach((item, index) => {
      move(item, x, index % 2 === 0 ? 0 : Math.round(GAP_Y * 0.8));
      x += cell(item.baseW) + GAP_X * 3;
    });
    return;
  }

  if (arrangement === "clustered") {
    const columns = Math.ceil(Math.sqrt(selected.length));
    const cellW = Math.max(...selected.map((item) => cell(item.baseW))) + 18;
    const cellH = Math.max(...selected.map((item) => cell(item.baseH))) + 18;
    selected.forEach((item, index) => {
      move(item, (index % columns) * cellW, Math.floor(index / columns) * cellH);
    });
    return;
  }

  const requestedPrimary = request.emphasis?.primaryEntityIds?.[0];
  const centre = selected.find((item) => item.region.entityId === requestedPrimary) ?? selected[0];
  move(centre, 0, 0);
  const others = selected.filter((item) => item !== centre);
  const radius = arrangement === "surrounding" ? 300 : 185;
  others.forEach((item, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / others.length;
    move(item, Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius));
  });
}

// ──────────────────────────────────────────────────── post-passes

/**
 * The layout may not contradict a stated spatial relation.
 *
 * Only the `spatial` grammar arranges by described space; every other layout
 * places by its own logic and can land two objects in an arrangement that
 * says the opposite of what was said. "A boy found an injured bird beneath a
 * tree" is a SEQUENCE — so the sequence layout ran, parked the bird and the
 * tree in a leftover column, and put the bird above the tree. The picture
 * then asserted something the speaker never said, and it scored well because
 * every relation it drew was drawn correctly.
 *
 * So this runs for every grammar, as an invariant rather than a layout: if
 * the placement contradicts a directional claim, swap the two. It is
 * deliberately a repair and not a placement — it never moves anything that
 * is already consistent, so a grammar that got it right is untouched.
 */
function honourSpatialRelations(placed: Map<string, Placed>, world: WorldState): void {
  const byEntity = new Map<string, Placed>();
  for (const p of placed.values()) {
    if (p.region.entityId && !p.parentRegionId) byEntity.set(p.region.entityId, p);
  }

  for (const relation of world.relations) {
    if (relation.type !== "located_at") continue;
    const subject = byEntity.get(relation.source);
    const anchor = byEntity.get(relation.target);
    if (!subject || !anchor) continue;

    // "on" and "above" put the subject higher; "below" and "behind" lower.
    const subjectShouldBeAbove =
      relation.spatial === "above" || relation.spatial === "on" || relation.spatial === "behind";
    const subjectShouldBeBelow = relation.spatial === "below" || relation.spatial === "in_front_of";
    if (!subjectShouldBeAbove && !subjectShouldBeBelow) continue;

    const subjectIsAbove = subject.y + subject.h <= anchor.y;
    const subjectIsBelow = anchor.y + anchor.h <= subject.y;
    const contradicted = (subjectShouldBeAbove && subjectIsBelow) || (subjectShouldBeBelow && subjectIsAbove);
    if (!contradicted) continue;

    const subjectY = subject.y;
    subject.y = anchor.y;
    anchor.y = subjectY;
    // Share a column so the vertical relationship is readable as one; two
    // things stacked in different columns do not read as above and below.
    const column = Math.min(subject.x, anchor.x);
    subject.x = column;
    anchor.x = column;
  }
}

function overlaps(a: Placed, b: Placed): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function isDescendant(child: Placed, ancestor: Placed, placed: Map<string, Placed>): boolean {
  let current = child.parentRegionId;
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    if (current === ancestor.region.id) return true;
    guard.add(current);
    current = placed.get(current)?.parentRegionId;
  }
  return false;
}

/**
 * Nothing may sit on top of anything else unless it was deliberately placed
 * inside it. Overlap is not a cosmetic problem — two boxes touching read as
 * one thing, which changes what the picture says.
 */
function separate(placed: Map<string, Placed>): void {
  const movable = [...placed.values()];
  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    for (let i = 0; i < movable.length; i += 1) {
      for (let j = i + 1; j < movable.length; j += 1) {
        const a = movable[i];
        const b = movable[j];
        if (!overlaps(a, b)) continue;
        if (isDescendant(a, b, placed) || isDescendant(b, a, placed)) continue;
        const pushDown = a.y + a.h - b.y + 24;
        const later = a.y <= b.y ? b : a;
        const children = movable.filter((p) => isDescendant(p, later, placed));
        later.y += pushDown;
        for (const child of children) child.y += pushDown;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** Where a line from `from`'s centre toward `to`'s centre leaves `from`'s box. */
function borderPoint(from: Placed, to: Placed): [number, number] {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  const tx = to.x + to.w / 2;
  const ty = to.y + to.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const scaleX = dx === 0 ? Infinity : from.w / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : from.h / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return [Math.round(cx + dx * scale), Math.round(cy + dy * scale)];
}

function contains(outer: Placed, inner: Placed): boolean {
  return (
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
  );
}

/**
 * Connector style is a semantic decision, not a stylistic one:
 *  - a flow gets an arrow, because direction is the claim;
 *  - a containment that is already drawn as enclosure gets NOTHING, because
 *    the enclosure has already said it and a line would say it twice;
 *  - a comparison gets nothing unless a magnitude was stated, in which case
 *    a bracket carries the number without implying a direction.
 */
function styleFor(kind: string, from: Placed, to: Placed, hasLabel: boolean, relation?: WorldRelation): ConnectorStyle {
  if (kind === "flow") return "arrow";
  if (kind === "containment") return contains(from, to) || contains(to, from) ? "none" : "line";
  // An explicit contrast is the one comparative relation whose whole content
  // is opposition, and it was the one being drawn as nothing at all: with no
  // magnitude to bracket, "these two are set against each other" was left to
  // the poles happening to sit in a row. True in the comparison layout, and
  // false the moment the same contrast turns up in a scene — so the claim
  // survived or vanished depending on which grammar had been chosen. The
  // tension mark carries it either way, and carries no direction, which is
  // exactly what `contrasts_with` does and does not assert.
  if (relation?.type === "contrasts_with") return "tension";
  if (kind === "comparison") return hasLabel ? "bracket" : "none";
  return "line";
}

/**
 * The opposition mark: a zigzag along the line between two poles. It is
 * symmetric on purpose — read from either end it says the same thing, which
 * is the difference between a contrast and a cause.
 */
function tensionPoints(from: [number, number], to: [number, number]): Array<[number, number]> {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const amplitude = Math.min(14, length / 6);
  const nx = (-dy / length) * amplitude;
  const ny = (dx / length) * amplitude;
  const at = (t: number, side: number): [number, number] => [
    Math.round(x1 + dx * t + nx * side),
    Math.round(y1 + dy * t + ny * side),
  ];
  return [from, at(0.25, 1), at(0.5, -1), at(0.75, 1), to];
}

// ─────────────────────────────────────────────── layout continuity

export interface ComposeOptions {
  /**
   * The scene currently on the canvas. Used only to keep already-drawn
   * objects where the viewer last saw them; never to decide what is drawn.
   */
  previous?: ScenePlan | null;
  /**
   * The grammar `previous` was composed under. Anchoring is skipped when it
   * differs from this plan's, because a grammar change IS a redraw: the
   * spatial logic itself changed, so "the same object" no longer has a
   * comparable slot, and dragging the new arrangement onto the old one's
   * coordinates would preserve nothing but the illusion of continuity.
   */
  previousGrammar?: GrammarId | null;
  /** Presentation layout `previous` was composed under — a layout change is a redraw, same as a grammar change. */
  previousLayout?: PresentationLayout | null;
  /** How this scene should be shown. Membership is already decided; this picks the form. */
  presentation?: PresentationPlan | null;
  /** High-level caller preference. Geometry remains owned and resolved here. */
  presentationIntent?: PresentationIntent;
  primaryId?: string;
  spineIds?: string[];
  demote?: string[];
}

const KEEP_LAYOUT_GRAMMAR = new Set<GrammarId>(["comparison", "quantity", "spatial"]);

function layoutFromPresentation(plan: ExpressionPlan, options: ComposeOptions): PresentationLayout | null {
  if (!options.presentation) return null;
  if (KEEP_LAYOUT_GRAMMAR.has(plan.grammar)) return null;
  return options.presentation.layout;
}

/**
 * Is this scene a continuation of the one already on the canvas, or a fresh
 * picture? The single definition of that question — anchoring below reads
 * it, and the pipeline reports it as the round's mode so a log can say
 * whether a turn extended the diagram or rebuilt it.
 */
export function isContinuation(plan: ExpressionPlan, options: ComposeOptions): boolean {
  if (!options.previous?.objects.length || !options.previousGrammar || options.previousGrammar !== plan.grammar) {
    return false;
  }
  const layout = layoutFromPresentation(plan, options);
  if (layout && options.previousLayout && layout !== options.previousLayout) return false;
  return true;
}

/** Lower median, so an even-sized sample is still one deterministic value. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length / 2) - 1)];
}

/**
 * Hold the picture still under the viewer's eye.
 *
 * Every layout above is relative — it produces an arrangement, then the
 * scene is translated so it starts at the origin. That translation is
 * computed from the scene's own extent, which means anything that changes
 * the extent moves EVERYTHING: a branch appearing to the left of a spine, a
 * new pole widening a comparison, or just the box that was emphasised last
 * turn shrinking back to its ordinary size. The arrangement was right in
 * every one of those cases and the whole diagram slid sideways anyway.
 *
 * So when the grammar has not changed, the scene is re-anchored onto the one
 * already on the canvas: the median offset of the objects that appear in
 * both is applied to all of them. A layout that genuinely did not move now
 * lands byte-identically, which is what lets planCanvasDiff
 * (lib/canvas/excalidraw/sync.ts) leave those elements strictly
 * alone rather than rebuild them.
 *
 * The median, not the mean: a mean would let one object that really did move
 * — a chain step re-ordered, a dimension re-seated — drag the whole scene by
 * a fraction of its own displacement, so nothing would land exactly. The
 * median ignores a minority of movers entirely.
 *
 * It is a translation and nothing else. No object is placed anywhere its
 * layout did not put it, so no arrangement decision from Track A is
 * revisited here; and the scene is shifted back if the offset would push any
 * part of it to a negative coordinate, since a renderer's viewport starts at
 * the origin.
 */
function anchorToPrevious(all: Placed[], plan: ExpressionPlan, options: ComposeOptions): boolean {
  if (!isContinuation(plan, options)) return false;
  const before = new Map(options.previous!.objects.map((o) => [o.id, o]));
  const settled: Array<[number, number]> = [];
  const retained: Array<[number, number]> = [];
  for (const p of all) {
    const was = before.get(`o-${p.region.id}`.slice(0, 48));
    if (!was) continue;
    retained.push([was.x - p.x, was.y - p.y]);
    // A box that changed size had to move: it is drawn centred in its grid
    // cell, so shrinking back from emphasis moves its top-left corner by
    // half the difference. Anchoring on those would drag everything that
    // did NOT resize by that half-difference — which is how a comparison
    // ended up sliding its untouched dimensions sideways because a pole
    // stopped being the newest thing said. The offset is taken from the
    // objects that had no reason to move at all, and only falls back to the
    // full set when every retained object resized.
    if (was.w === p.w && was.h === p.h) settled.push([was.x - p.x, was.y - p.y]);
  }
  const sample = settled.length ? settled : retained;
  if (!sample.length) return false;

  const dx = median(sample.map(([x]) => x));
  const dy = median(sample.map(([, y]) => y));
  if (!dx && !dy) return true;
  for (const p of all) {
    p.x += dx;
    p.y += dy;
  }
  const shiftX = Math.max(0, -Math.min(...all.map((p) => p.x)));
  const shiftY = Math.max(0, -Math.min(...all.map((p) => p.y)));
  if (shiftX || shiftY) {
    for (const p of all) {
      p.x += shiftX;
      p.y += shiftY;
    }
  }
  return true;
}

// ───────────────────────────────────────────────────────── compose

export function compose(world: WorldState, plan: ExpressionPlan, options: ComposeOptions = {}): ScenePlan {
  if (!plan.regions.length) return { objects: [], connectors: [], width: 0, height: 0 };

  const placed = prepare(world, plan, options);
  const presentationLayout = layoutFromPresentation(plan, options);

  if (presentationLayout === "left-to-right") {
    layoutFlowHorizontal(placed, plan);
  } else if (presentationLayout === "vertical-spine") {
    layoutFlow(placed, plan);
  } else if (presentationLayout === "central-primary") {
    layoutScene(placed, plan);
  } else if (presentationLayout === "hierarchy") {
    layoutEnclosure(placed, plan, world);
  } else switch (plan.grammar) {
    case "cause_effect":
    case "sequence":
    case "process":
      layoutFlow(placed, plan);
      break;
    case "comparison":
      layoutPoles(placed, plan, world);
      break;
    case "quantity":
      layoutMagnitude(placed, plan);
      break;
    case "hierarchy":
    case "grouping":
      layoutEnclosure(placed, plan, world);
      break;
    case "spatial":
      layoutSpace(placed, plan, world);
      break;
    case "scene":
    case "relationship":
    default:
      layoutScene(placed, plan);
      break;
  }

  applyRequestedSpatialArrangement(placed, options.presentationIntent);
  layoutAnnotations(placed, plan);
  honourSpatialRelations(placed, world);
  separate(placed);

  // Translate to the origin with padding.
  const all = [...placed.values()];
  const minX = Math.min(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  for (const p of all) {
    p.x = p.x - minX + PADDING;
    p.y = p.y - minY + PADDING;
  }
  anchorToPrevious(all, plan, options);

  const objects: SceneObject[] = all.map((p) => ({
    id: `o-${p.region.id}`.slice(0, 48),
    entityId: p.region.entityId,
    claimId: p.region.claimId,
    regionId: p.region.id,
    primitive: p.resolved.primitive,
    label: labelFor(p, world),
    count: p.resolved.count,
    sketchKey: p.resolved.sketchKey,
    tentative: p.entity?.confidence === "low" || undefined,
    // Display is capped tighter than the world keeps (6 points, not the
    // world's 12) — a "simple ordered series" that tries to show every
    // point ever stated stops being simple. The world's own history is
    // never trimmed; this is a composer-time display decision only.
    metric: p.entity?.metric ? { ...p.entity.metric, history: p.entity.metric.history.slice(-6) } : undefined,
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    weight: p.weight,
    parentObjectId: p.parentRegionId ? `o-${p.parentRegionId}`.slice(0, 48) : undefined,
  }));

  const relationById = new Map(world.relations.map((r) => [r.id, r]));
  const connectors: SceneConnector[] = [];
  for (const connection of plan.connections) {
    const from = placed.get(connection.fromRegionId);
    const to = placed.get(connection.toRegionId);
    if (!from || !to) continue;
    const relation = relationById.get(connection.relationId);
    const tentative = relation?.confidence === "low" || undefined;
    const style = styleFor(connection.kind, from, to, Boolean(connection.label), relation);
    if (style === "none" && !connection.label) {
      // Still recorded, so the evaluator can see the relation is expressed
      // by arrangement rather than by a line — but drawn as nothing.
      connectors.push({
        id: `k-${connection.id}`.slice(0, 48),
        relationId: connection.relationId,
        fromObjectId: `o-${from.region.id}`.slice(0, 48),
        toObjectId: `o-${to.region.id}`.slice(0, 48),
        style: "none",
        tentative,
        points: [borderPoint(from, to), borderPoint(to, from)],
      });
      continue;
    }
    const ends: [[number, number], [number, number]] = [borderPoint(from, to), borderPoint(to, from)];
    connectors.push({
      id: `k-${connection.id}`.slice(0, 48),
      relationId: connection.relationId,
      fromObjectId: `o-${from.region.id}`.slice(0, 48),
      toObjectId: `o-${to.region.id}`.slice(0, 48),
      style,
      label: connection.label,
      tentative,
      points: style === "tension" ? tensionPoints(ends[0], ends[1]) : ends,
    });
  }

  const width = Math.max(...all.map((p) => p.x + p.w), 0) + PADDING;
  const height = Math.max(...all.map((p) => p.y + p.h), 0) + PADDING;
  const focusRegion = plan.emphasis[0]?.regionId ?? plan.regions.find((r) => r.role === "primary_subject")?.id;

  const scene: ScenePlan = {
    objects,
    connectors,
    width,
    height,
    focusObjectId: focusRegion ? `o-${focusRegion}`.slice(0, 48) : undefined,
  };
  const parsed = ScenePlanSchema.safeParse(scene);
  return parsed.success ? parsed.data : { objects: [], connectors: [], width: 0, height: 0 };
}

/**
 * Words appear only where identity or precision needs them. A figure gets
 * its person's name (you cannot tell two people apart without it); a
 * container gets its title; an annotation is text by definition. A counted
 * array of marks does NOT get its number written next to it — the marks are
 * the number, and writing it too is the transcript creeping back in.
 */
function labelFor(placed: Placed, world: WorldState): string | undefined {
  if (placed.region.role === "annotation") {
    return world.claims.find((c) => c.id === placed.region.claimId)?.text.slice(0, 60);
  }
  if (!placed.entity) return undefined;
  if (placed.resolved.primitive === "quantity_array" && placed.entity.type === "quantity") return placed.entity.label;
  return placed.entity.label;
}
