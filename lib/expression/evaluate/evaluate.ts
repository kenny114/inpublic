/**
 * Visual evaluation by reverse interpretation.
 *
 * The question is NOT "does this look good". It is: if you deleted the
 * transcript and showed a stranger only this arrangement, which relations
 * could they reconstruct — and would they reconstruct any the speaker never
 * asserted?
 *
 * So this module is deliberately amnesiac about how the scene was built. It
 * takes the ScenePlan as raw geometry and marks, applies the reading rules
 * a viewer applies (an arrow means direction; a box inside a box means
 * containment; two equal things side by side means comparison; a thing
 * above another means above), and produces a recovered relation set. Only
 * then does it compare that against the world.
 *
 * That is why `recoverRelations` reads `connector.style` and coordinates
 * rather than `plan.connections` — a connector the composer resolved to
 * style "none" is invisible, and an evaluator that credited it because the
 * plan intended it would be grading the intention rather than the picture.
 *
 * Two failure classes, and they are not symmetrical:
 *  - a MISSING relation costs comprehension: the viewer learns less;
 *  - an INVENTED relation costs truth: the viewer learns something wrong.
 * Invented relations are therefore scored much more harshly, and a scene
 * that implies containment nobody claimed fails even if it is otherwise
 * complete.
 */

import {
  relationFamily,
  type DimensionScore,
  type EvaluationResult,
  type Preservation,
  type Problem,
  type ScenePlan,
  type SceneConnector,
  type SceneObject,
  type WorldRelation,
  type WorldState,
} from "../schemas";

/** How much vertical drift still reads as "the same row". */
const ROW_TOLERANCE = 40;

interface RecoveredEdge {
  from: string;
  to: string;
  /** What a viewer could tell about it, not what it actually is. */
  reading: "directed" | "undirected" | "containment" | "parallel" | "above" | "below" | "beside";
}

function objectsByEntity(scene: ScenePlan): Map<string, SceneObject> {
  const map = new Map<string, SceneObject>();
  for (const object of scene.objects) {
    if (object.entityId && !map.has(object.entityId)) map.set(object.entityId, object);
  }
  return map;
}

function encloses(outer: SceneObject, inner: SceneObject): boolean {
  if (outer.id === inner.id) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h &&
    outer.w * outer.h > inner.w * inner.h
  );
}

function entityOf(scene: ScenePlan, objectId: string): string | undefined {
  return scene.objects.find((o) => o.id === objectId)?.entityId;
}

/**
 * What a viewer can read off this arrangement, with no access to the world.
 * The output is in ENTITY ids because that is the only vocabulary shared
 * with the thing being checked against.
 */
export function recoverRelations(scene: ScenePlan): RecoveredEdge[] {
  const edges: RecoveredEdge[] = [];

  for (const connector of scene.connectors) {
    const from = entityOf(scene, connector.fromObjectId);
    const to = entityOf(scene, connector.toObjectId);
    if (!from || !to) continue;
    if (connector.style === "arrow") edges.push({ from, to, reading: "directed" });
    else if (connector.style === "line") edges.push({ from, to, reading: "undirected" });
    else if (connector.style === "bracket") edges.push({ from, to, reading: "parallel" });
    // style "none" contributes nothing: an invisible connector is invisible.
  }

  // Enclosure, read from geometry alone — this is how a viewer knows a
  // department is part of a company without any line being drawn.
  for (const outer of scene.objects) {
    for (const inner of scene.objects) {
      if (!encloses(outer, inner)) continue;
      if (!outer.entityId || !inner.entityId) continue;
      edges.push({ from: outer.entityId, to: inner.entityId, reading: "containment" });
    }
  }

  // Two comparably-weighted SIBLINGS side by side on the same row read as a
  // comparison whether or not anything was drawn between them. Siblings,
  // not merely top-level objects: two children inside one container sit in
  // parallel just as visibly as two boxes on the page do, and an earlier
  // version of this that only looked at top-level objects scored a real
  // contrast between two enclosed things as unexpressed.
  const withEntity = scene.objects.filter((o) => o.entityId);
  for (let i = 0; i < withEntity.length; i += 1) {
    for (let j = i + 1; j < withEntity.length; j += 1) {
      const a = withEntity[i];
      const b = withEntity[j];
      if ((a.parentObjectId ?? null) !== (b.parentObjectId ?? null)) continue;
      if (Math.abs(a.y - b.y) > ROW_TOLERANCE) continue;
      if (Math.abs(a.weight - b.weight) > 1) continue;
      edges.push({ from: a.entityId!, to: b.entityId!, reading: "parallel" });
    }
  }

  const topLevel = scene.objects.filter((o) => !o.parentObjectId && o.entityId);

  // Vertical and lateral placement, for spatial claims.
  for (const a of topLevel) {
    for (const b of topLevel) {
      if (a === b) continue;
      const sameColumn = Math.abs(a.x - b.x) < Math.max(a.w, b.w) * 0.6;
      if (sameColumn && a.y + a.h <= b.y) edges.push({ from: a.entityId!, to: b.entityId!, reading: "above" });
      if (sameColumn && b.y + b.h <= a.y) edges.push({ from: a.entityId!, to: b.entityId!, reading: "below" });
      if (!sameColumn && Math.abs(a.y - b.y) <= ROW_TOLERANCE) edges.push({ from: a.entityId!, to: b.entityId!, reading: "beside" });
    }
  }

  return edges;
}

/**
 * Which readings would let a viewer recover this relation. A causal claim
 * needs direction — nothing weaker will do, because "A and B are related"
 * is not "A causes B". Containment can be read from enclosure or from a
 * line. A comparison needs the poles to actually sit in parallel.
 */
function acceptableReadings(relation: WorldRelation): RecoveredEdge["reading"][] {
  switch (relationFamily(relation.type)) {
    case "causal":
    case "temporal":
      return ["directed"];
    case "structural":
      return ["containment", "undirected"];
    case "comparative":
      return ["parallel", "undirected"];
    case "spatial":
      switch (relation.spatial) {
        case "above":
          return ["above"];
        case "below":
          return ["below"];
        case "inside":
          return ["containment"];
        case "beside":
        case "near":
          return ["beside", "undirected"];
        default:
          return ["beside", "above", "below", "undirected"];
      }
    case "argumentative":
      return ["directed", "containment", "undirected"];
    case "attributive":
    case "associative":
    default:
      return ["undirected", "containment", "directed"];
  }
}

/**
 * Which end of a relation reads as the OUTER box when it is drawn as
 * enclosure — or null when the relation is not a containment claim at all.
 *
 * One rule, shared by the recovery check and the invention check, because
 * they have to agree: if they disagree, the same drawing is simultaneously
 * scored as expressing the relation and as inventing one, which is exactly
 * what happened before this was factored out.
 */
function enclosureDirection(relation: WorldRelation): { outer: string; inner: string } | null {
  switch (relation.type) {
    case "contains":
      return { outer: relation.source, inner: relation.target };
    case "part_of":
    case "member_of":
    // A reason drawn beneath the claim it backs sits inside it; the claim is
    // the boundary.
    case "supports":
      return { outer: relation.target, inner: relation.source };
    case "located_at":
      return relation.spatial === "inside" || relation.spatial === "on"
        ? { outer: relation.target, inner: relation.source }
        : null;
    default:
      return null;
  }
}

function isRecovered(relation: WorldRelation, edges: RecoveredEdge[]): boolean {
  const accepted = acceptableReadings(relation);
  return edges.some((edge) => {
    if (!accepted.includes(edge.reading)) return false;
    if (edge.reading === "containment") {
      // A containment reading always runs outer -> inner, whichever way the
      // relation itself is written.
      const direction = enclosureDirection(relation);
      return direction ? edge.from === direction.outer && edge.to === direction.inner : edge.from === relation.source && edge.to === relation.target;
    }
    if (edge.reading === "directed" || edge.reading === "above" || edge.reading === "below") {
      return edge.from === relation.source && edge.to === relation.target;
    }
    return (
      (edge.from === relation.source && edge.to === relation.target) ||
      (edge.from === relation.target && edge.to === relation.source)
    );
  });
}

/**
 * Structure the picture asserts that the world never did. Only geometric
 * implications count here — a connector cannot be invented, since every one
 * of them carries the id of the relation it came from. What CAN be invented
 * is enclosure produced by a layout accident, which is exactly the kind of
 * error a human reviewer misses and a viewer silently believes.
 */
function findInvented(scene: ScenePlan, world: WorldState): string[] {
  const invented: string[] = [];
  for (const outer of scene.objects) {
    for (const inner of scene.objects) {
      if (!encloses(outer, inner) || !outer.entityId || !inner.entityId) continue;
      const claimed = world.relations.some((r) => {
        const direction = enclosureDirection(r);
        return direction && direction.outer === outer.entityId && direction.inner === inner.entityId;
      });
      if (!claimed) invented.push(`${outer.entityId} appears to contain ${inner.entityId}`);
    }
  }
  return invented;
}

function overlapping(scene: ScenePlan): Array<[SceneObject, SceneObject]> {
  const pairs: Array<[SceneObject, SceneObject]> = [];
  const objects = scene.objects.filter((o) => o.primitive !== "text_label");
  for (let i = 0; i < objects.length; i += 1) {
    for (let j = i + 1; j < objects.length; j += 1) {
      const a = objects[i];
      const b = objects[j];
      if (encloses(a, b) || encloses(b, a)) continue;
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (hit) pairs.push([a, b]);
    }
  }
  return pairs;
}

export function evaluateScene(world: WorldState, scene: ScenePlan): EvaluationResult {
  const problems: Problem[] = [];
  const edges = recoverRelations(scene);
  const drawn = objectsByEntity(scene);

  // Only relations whose endpoints are both on the canvas are the scene's
  // responsibility. A relation to something the planner deliberately left
  // out is a budget decision, not a rendering failure — but a PRIMARY
  // entity missing is, and is caught separately below.
  const answerable = world.relations.filter((r) => drawn.has(r.source) && drawn.has(r.target));
  const recovered = answerable.filter((r) => isRecovered(r, edges));
  const missing = answerable.filter((r) => !recovered.includes(r));

  for (const relation of missing) {
    problems.push({
      type: "missing_relation",
      detail: `${relation.source} -${relation.type}-> ${relation.target} is drawn but not readable as ${acceptableReadings(relation).join("/")}`,
      relationId: relation.id,
      entityIds: [relation.source, relation.target],
      severity: relationFamily(relation.type) === "causal" ? 0.8 : 0.5,
    });
  }

  const invented = findInvented(scene, world);
  for (const detail of invented) {
    problems.push({ type: "false_relation", detail, severity: 0.9 });
  }

  // A role that is not written down cannot be recovered: an unlabelled line
  // between two people says they are connected, not that one is the other's
  // mother.
  for (const relation of answerable) {
    if (relation.type !== "role_of" || !relation.role) continue;
    const connector = scene.connectors.find((c: SceneConnector) => c.relationId === relation.id);
    if (!connector || connector.style === "none" || !connector.label) {
      problems.push({
        type: "ambiguous_relation",
        detail: `the "${relation.role}" role between ${relation.source} and ${relation.target} is not readable from the drawing`,
        relationId: relation.id,
        entityIds: [relation.source, relation.target],
        severity: 0.6,
      });
    }
  }

  let missingPrimary = 0;
  for (const entity of world.entities) {
    if (entity.status === "superseded" || entity.importance !== "primary") continue;
    if (!drawn.has(entity.id)) {
      missingPrimary += 1;
      problems.push({
        type: "missing_entity",
        detail: `"${entity.label}" is the primary subject but is not on the canvas`,
        entityIds: [entity.id],
        severity: 0.9,
      });
    }
  }

  // A stated number that ended up as a plain box has lost the very thing
  // that made it worth saying.
  for (const entity of world.entities) {
    // A quantity of one is not a count worth drawing as extent — "a family"
    // and "a family of one" are the same picture, so only 2+ is flagged.
    if (!entity.quantity || entity.quantity.value < 2 || entity.status === "superseded") continue;
    const object = drawn.get(entity.id);
    if (!object) continue;
    if (object.count === undefined && object.primitive !== "container") {
      problems.push({
        type: "unexpressed_quantity",
        detail: `"${entity.label}" carries a quantity of ${entity.quantity.value} but is drawn as a ${object.primitive}`,
        entityIds: [entity.id],
        severity: 0.4,
      });
    }
  }

  for (const [a, b] of overlapping(scene)) {
    problems.push({
      type: "overlap",
      detail: `${a.label ?? a.id} and ${b.label ?? b.id} overlap and read as one thing`,
      severity: 0.7,
    });
  }

  const dominant = scene.objects.filter((o) => o.weight >= 2);
  if (scene.objects.length >= 2 && !dominant.length) {
    problems.push({ type: "no_focus", detail: "nothing dominates; the eye has no entry point", severity: 0.5 });
  } else if (dominant.length > 3) {
    problems.push({
      type: "no_focus",
      detail: `${dominant.length} objects compete for dominance`,
      severity: 0.4,
    });
  }

  const visibleConnectors = scene.connectors.filter((c) => c.style !== "none").length;
  if (scene.objects.length > 10 || visibleConnectors > 12) {
    problems.push({
      type: "clutter",
      detail: `${scene.objects.length} objects and ${visibleConnectors} visible connectors`,
      severity: 0.5,
    });
  }

  // Score.
  //
  // The ratio alone answers "of what was drawn, how much is readable" — and
  // a live run showed why that is not enough on its own: a scene that drew a
  // stale sequence perfectly, while omitting the subject the conversation had
  // moved on to, scored a clean 1.0 with a severity-0.9 problem sitting right
  // beside it. A number that disagrees with the problem list is worse than no
  // number, so both kinds of loss are priced in:
  //
  //   invented structure   the picture says something false      -0.25 each
  //   missing subject      the picture is about the wrong thing  -0.30 each
  const preservation = measurePreservation(world, scene, edges, drawn, recovered);

  // The headline is the MEAN OF THE APPLICABLE DIMENSIONS, not a ratio of its
  // own. It used to be `recovered / answerable`, and that number had a
  // perverse property the discovery corpus exposed immediately: `answerable`
  // only counts relations between two DRAWN entities, so dropping an entity
  // also drops its relations from the denominator. A scene that lost a third
  // of its subjects scored a clean 1.0 — losing content raised the score.
  //
  // Averaging the dimensions makes the headline a summary of `preservation`
  // rather than a rival to it, so it can no longer disagree with the
  // breakdown sitting next to it. Dimensions that do not apply are excluded,
  // never counted as 1.0.
  const applicableScores = Object.values(preservation)
    .map((d) => d.score)
    .filter((s): s is number => s !== null);
  const base = applicableScores.length
    ? applicableScores.reduce((sum, s) => sum + s, 0) / applicableScores.length
    : scene.objects.length
      ? 1
      : 0;
  const semanticPreservation = Math.max(0, Math.min(1, base - invented.length * 0.25 - missingPrimary * 0.3));
  const repairRequired = semanticPreservation < 0.85 || problems.some((p) => p.severity >= 0.6);

  return {
    semanticPreservation: Number(semanticPreservation.toFixed(3)),
    preservation,
    recoveredRelationIds: recovered.map((r) => r.id),
    inventedRelations: invented.slice(0, 16),
    problems: problems.sort((a, b) => b.severity - a.severity).slice(0, 16),
    repairRequired,
  };
}

// ────────────────────────────────────────────── round-trip dimensions

function dimension(applicable: number, preserved: number, lost: string[]): DimensionScore {
  return {
    applicable,
    preserved,
    score: applicable === 0 ? null : Number((preserved / applicable).toFixed(3)),
    lost: lost.slice(0, 8),
  };
}

/**
 * The round trip, read one dimension at a time.
 *
 * Each of these asks a different question of the same scene, because each
 * fails for a different reason and is repaired at a different layer. Losing
 * an entity is a planning problem; losing causal direction is a connector
 * problem; losing ordering is a composition problem; losing polarity is a
 * labelling problem. Averaging them would name none of those.
 *
 * A dimension with nothing to measure scores `null`, never 1.0 — a sentence
 * with no numbers has not preserved quantity perfectly.
 */
function measurePreservation(
  world: WorldState,
  scene: ScenePlan,
  edges: RecoveredEdge[],
  drawn: Map<string, SceneObject>,
  recovered: WorldRelation[],
): Preservation {
  const live = world.entities.filter((e) => e.status !== "superseded");
  const recoveredIds = new Set(recovered.map((r) => r.id));

  // ---- entity: did the things being discussed reach the canvas? ------
  // Details are excluded deliberately: the planner has a display budget and
  // dropping a detail is a decision, not a failure.
  const shouldBeDrawn = live.filter((e) => e.importance !== "detail");
  const missingEntities = shouldBeDrawn.filter((e) => !drawn.has(e.id));
  const entity = dimension(
    shouldBeDrawn.length,
    shouldBeDrawn.length - missingEntities.length,
    missingEntities.map((e) => `"${e.label}" (${e.importance}) never reached the canvas`),
  );

  // ---- relation: is the link recoverable from the arrangement? -------
  const answerable = world.relations.filter((r) => drawn.has(r.source) && drawn.has(r.target));
  const unreadable = answerable.filter((r) => !recoveredIds.has(r.id));
  const relation = dimension(
    answerable.length,
    answerable.length - unreadable.length,
    unreadable.map((r) => `${r.source} -${r.type}-> ${r.target} is drawn but not readable`),
  );

  // ---- causal: is DIRECTION recoverable, not just connection? --------
  // Stricter than `relation` on purpose. "A and B are related" is not
  // "A causes B", so only a directed reading counts here.
  const causalRelations = world.relations.filter((r) => relationFamily(r.type) === "causal");
  const causalAnswerable = causalRelations.filter((r) => drawn.has(r.source) && drawn.has(r.target));
  const causalDirected = causalAnswerable.filter((r) =>
    edges.some((e) => e.reading === "directed" && e.from === r.source && e.to === r.target),
  );
  const causal = dimension(
    causalRelations.length,
    causalDirected.length,
    causalRelations
      .filter((r) => !causalDirected.includes(r))
      .map((r) =>
        drawn.has(r.source) && drawn.has(r.target)
          ? `${r.source} -${r.type}-> ${r.target} has no directed reading`
          : `${r.source} -${r.type}-> ${r.target} is not on the canvas`,
      ),
  );

  // ---- quantity: is a stated number visible as extent? ---------------
  // Scoped to the entities the scene was responsible for, exactly as the
  // `entity` dimension is. Counting a detail the planner deliberately
  // budgeted out would report a quantity failure for a decision that was
  // correct, and the two dimensions would be measuring different populations.
  const counted = live.filter((e) => e.quantity && e.quantity.value >= 2 && e.importance !== "detail");
  const countExpressed = counted.filter((e) => {
    const object = drawn.get(e.id);
    return object ? object.count !== undefined || object.primitive === "container" : false;
  });
  const quantity = dimension(
    counted.length,
    countExpressed.length,
    counted
      .filter((e) => !countExpressed.includes(e))
      .map((e) => {
        const object = drawn.get(e.id);
        return object
          ? `"${e.label}" (${e.quantity!.value}) is drawn as a ${object.primitive}, not as extent`
          : `"${e.label}" (${e.quantity!.value}) is not on the canvas`;
      }),
  );

  // ---- ordering: does visual order match described order? ------------
  // Position IS the claim for a sequence. A chain drawn in the wrong order
  // says something the speaker did not, while scoring perfectly on
  // `relation` — this is the only dimension that would catch it.
  const ordered = world.relations
    .filter((r) => r.type === "precedes" || r.type === "transforms_into")
    .filter((r) => drawn.has(r.source) && drawn.has(r.target));
  const correctlyOrdered = ordered.filter((r) => {
    const from = drawn.get(r.source)!;
    const to = drawn.get(r.target)!;
    // Later steps sit below, or to the right when laid out in a row.
    return to.y > from.y || (Math.abs(to.y - from.y) <= 40 && to.x > from.x);
  });
  const ordering = dimension(
    ordered.length,
    correctlyOrdered.length,
    ordered
      .filter((r) => !correctlyOrdered.includes(r))
      .map((r) => `${r.source} should read before ${r.target} but is not placed before it`),
  );

  // ---- polarity: can a negative still be told from a positive? -------
  // "Rest prevents burnout" and "rest causes burnout" are opposite claims
  // that draw as the same arrow. Only a label distinguishes them, so a
  // negative relation without one has lost its meaning entirely.
  const NEGATIVE = new Set(["prevents", "refutes", "less_than"]);
  const negatives = world.relations.filter((r) => NEGATIVE.has(r.type) && drawn.has(r.source) && drawn.has(r.target));
  const polarityKept = negatives.filter((r) => {
    const connector = scene.connectors.find((c) => c.relationId === r.id);
    return Boolean(connector && connector.style !== "none" && connector.label);
  });
  const polarity = dimension(
    negatives.length,
    polarityKept.length,
    negatives
      .filter((r) => !polarityKept.includes(r))
      .map((r) => `${r.source} -${r.type}-> ${r.target} is drawn without polarity — it reads as its own opposite`),
  );

  // ---- uncertainty: is hedged meaning still marked as hedged? --------
  const hedged = [
    ...world.claims.filter((c) => c.uncertain).map((c) => ({ id: c.id, what: `claim "${c.text}"` })),
    ...world.relations
      .filter((r) => r.confidence === "low" && drawn.has(r.source) && drawn.has(r.target))
      .map((r) => ({ id: r.id, what: `${r.source} -${r.type}-> ${r.target}` })),
  ];
  const hedgeShown = hedged.filter((h) => {
    const object = scene.objects.find((o) => o.claimId === h.id);
    const connector = scene.connectors.find((c) => c.relationId === h.id);
    // Nothing in ScenePlan can currently say "this is uncertain" — see the
    // module note. Presence is the weakest possible proxy and is scored as
    // such, so the gap shows up as a real loss rather than as a silent 1.0.
    return Boolean(object) || Boolean(connector && connector.style !== "none");
  });
  const uncertainty = dimension(
    hedged.length,
    hedgeShown.length,
    hedged.filter((h) => !hedgeShown.includes(h)).map((h) => `hedged ${h.what} is not visible at all`),
  );

  return { entity, relation, causal, quantity, ordering, polarity, uncertainty };
}
