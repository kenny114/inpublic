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
 *   flow      cause_effect / sequence / process   a vertical spine
 *   poles     comparison / quantity               parallel columns
 *   enclosure hierarchy / grouping                children inside the parent
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
  ScenePlanSchema,
  type ConnectorStyle,
  type ExpressionPlan,
  type Region,
  type ScenePlan,
  type SceneConnector,
  type SceneObject,
  type WorldEntity,
  type WorldState,
} from "../schemas";

const GAP_X = 72;
const GAP_Y = 88;
const PADDING = 48;
/** Room a container leaves around its contents. */
const INSET = 28;
const INSET_TOP = 52;

/** Emphasis does not change colour alone — it changes size, so hierarchy survives a greyscale print. */
const WEIGHT_SCALE: Record<number, number> = { 0: 0.9, 1: 1, 2: 1.1, 3: 1.25 };

interface Placed {
  region: Region;
  entity: WorldEntity | null;
  resolved: ResolvedPrimitive;
  weight: number;
  x: number;
  y: number;
  w: number;
  h: number;
  parentRegionId?: string;
}

// ─────────────────────────────────────────────────────────── setup

function weightFor(plan: ExpressionPlan, region: Region): number {
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

function prepare(world: WorldState, plan: ExpressionPlan): Map<string, Placed> {
  const byId = new Map<string, Placed>();
  const parentOf = new Map<string, string>();
  for (const region of plan.regions) {
    for (const child of region.childRegionIds ?? []) parentOf.set(child, region.id);
  }
  for (const region of plan.regions) {
    const entity = region.entityId ? world.entities.find((e) => e.id === region.entityId) ?? null : null;
    const resolved = resolvePrimitive(entity, region);
    const weight = weightFor(plan, region);
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

/** A vertical spine: each step below the last, centres aligned. Direction is the meaning. */
function layoutFlow(placed: Map<string, Placed>, plan: ExpressionPlan): void {
  const steps = [
    ...ordered(placed, plan, "chain_step"),
    ...ordered(placed, plan, "sequence_step"),
  ];
  const spine = steps.length ? steps : topLevel(placed);
  const widest = Math.max(...spine.map((p) => p.w), 0);
  let y = 0;
  for (const step of spine) {
    step.x = Math.round((widest - step.w) / 2);
    step.y = y;
    y += step.h + GAP_Y;
  }
  layoutStragglers(placed, plan, spine, widest + GAP_X, 0);
}

/**
 * Parallel columns. No arrow is drawn between the poles — the parallel
 * arrangement is the comparison, and an arrow would assert a direction the
 * speaker never claimed. Each pole's own properties stack beneath it, so
 * the two columns are read against each other row by row.
 */
function layoutPoles(placed: Map<string, Placed>, plan: ExpressionPlan): void {
  const poles = ordered(placed, plan, "comparison_pole");
  const subject = ordered(placed, plan, "primary_subject");
  const columns = [...subject, ...poles].filter((p, i, arr) => arr.indexOf(p) === i);
  if (!columns.length) return layoutScene(placed, plan);

  let x = 0;
  for (const column of columns) {
    const children = (column.region.childRegionIds ?? [])
      .map((id) => placed.get(id))
      .filter((p): p is Placed => Boolean(p));
    const columnWidth = Math.max(column.w, ...children.map((c) => c.w), 0);
    column.x = x + Math.round((columnWidth - column.w) / 2);
    column.y = 0;
    let y = column.h + GAP_Y / 2;
    for (const child of children) {
      child.x = x + Math.round((columnWidth - child.w) / 2);
      child.y = y;
      y += child.h + 24;
      child.parentRegionId = undefined; // stacked beneath, not enclosed
    }
    x += columnWidth + GAP_X * 1.5;
  }
  layoutStragglers(placed, plan, columns, x, 0);
}

/**
 * Enclosure: children inside the parent's boundary. The parent grows to fit
 * them, which is why its size is computed here rather than taken from the
 * primitive table. Containment is the one relation a picture states without
 * any words, so this layout is what lets those connectors be drawn as
 * nothing at all.
 */
function layoutEnclosure(placed: Map<string, Placed>, plan: ExpressionPlan): void {
  const roots = [...ordered(placed, plan, "hierarchy_root"), ...ordered(placed, plan, "primary_subject")].filter(
    (p, i, arr) => arr.indexOf(p) === i,
  );
  if (!roots.length) return layoutScene(placed, plan);

  let rootY = 0;
  for (const root of roots) {
    const children = (root.region.childRegionIds ?? [])
      .map((id) => placed.get(id))
      .filter((p): p is Placed => Boolean(p));
    packInside(root, children, rootY);
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
function styleFor(kind: string, from: Placed, to: Placed, hasLabel: boolean): ConnectorStyle {
  if (kind === "flow") return "arrow";
  if (kind === "containment") return contains(from, to) || contains(to, from) ? "none" : "line";
  if (kind === "comparison") return hasLabel ? "bracket" : "none";
  return "line";
}

// ───────────────────────────────────────────────────────── compose

export function compose(world: WorldState, plan: ExpressionPlan): ScenePlan {
  if (!plan.regions.length) return { objects: [], connectors: [], width: 0, height: 0 };

  const placed = prepare(world, plan);

  switch (plan.grammar) {
    case "cause_effect":
    case "sequence":
    case "process":
      layoutFlow(placed, plan);
      break;
    case "comparison":
    case "quantity":
      layoutPoles(placed, plan);
      break;
    case "hierarchy":
    case "grouping":
      layoutEnclosure(placed, plan);
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

  const objects: SceneObject[] = all.map((p) => ({
    id: `o-${p.region.id}`.slice(0, 48),
    entityId: p.region.entityId,
    claimId: p.region.claimId,
    regionId: p.region.id,
    primitive: p.resolved.primitive,
    label: labelFor(p, world),
    count: p.resolved.count,
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    weight: p.weight,
    parentObjectId: p.parentRegionId ? `o-${p.parentRegionId}`.slice(0, 48) : undefined,
  }));

  const connectors: SceneConnector[] = [];
  for (const connection of plan.connections) {
    const from = placed.get(connection.fromRegionId);
    const to = placed.get(connection.toRegionId);
    if (!from || !to) continue;
    const style = styleFor(connection.kind, from, to, Boolean(connection.label));
    if (style === "none" && !connection.label) {
      // Still recorded, so the evaluator can see the relation is expressed
      // by arrangement rather than by a line — but drawn as nothing.
      connectors.push({
        id: `k-${connection.id}`.slice(0, 48),
        relationId: connection.relationId,
        fromObjectId: `o-${from.region.id}`.slice(0, 48),
        toObjectId: `o-${to.region.id}`.slice(0, 48),
        style: "none",
        points: [borderPoint(from, to), borderPoint(to, from)],
      });
      continue;
    }
    connectors.push({
      id: `k-${connection.id}`.slice(0, 48),
      relationId: connection.relationId,
      fromObjectId: `o-${from.region.id}`.slice(0, 48),
      toObjectId: `o-${to.region.id}`.slice(0, 48),
      style,
      label: connection.label,
      points: [borderPoint(from, to), borderPoint(to, from)],
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
