/**
 * Renderer core: the scene diff every renderer consumes.
 *
 * "Do not wipe the board and regenerate everything" is enforced here rather
 * than trusted to each renderer. A renderer is handed the new ScenePlan AND
 * the patch that turns the old one into it, and the patch distinguishes the
 * four cases that need genuinely different treatment on a live canvas:
 *
 *   added      draw it — and this is the only case that may animate in
 *   moved      same thing, new place: reposition, never re-create, or the
 *              viewer loses track of an object they were following
 *   updated    same place, changed content or weight
 *   removed    gone
 *
 * Connectors are diffed separately and get a third category, `rerouted`:
 * an edge whose relation is unchanged but whose endpoints moved. Those must
 * be redrawn even though nothing about the meaning changed, which is a
 * property of drawing lines between boxes, not a property of meaning.
 */

import type { RenderPatch, ScenePlan, SceneConnector, SceneObject } from "../schemas";

function samePosition(a: SceneObject, b: SceneObject): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function sameContent(a: SceneObject, b: SceneObject): boolean {
  return a.label === b.label && a.primitive === b.primitive && a.count === b.count && a.weight === b.weight;
}

function samePoints(a: SceneConnector, b: SceneConnector): boolean {
  return JSON.stringify(a.points) === JSON.stringify(b.points) && a.style === b.style && a.label === b.label;
}

export function diffScenes(prev: ScenePlan | null, next: ScenePlan): RenderPatch {
  const patch: RenderPatch = {
    added: [],
    moved: [],
    updated: [],
    removed: [],
    connectorsAdded: [],
    connectorsRemoved: [],
    connectorsRerouted: [],
  };
  const prevObjects = new Map((prev?.objects ?? []).map((o) => [o.id, o]));
  const nextObjects = new Map(next.objects.map((o) => [o.id, o]));

  for (const object of next.objects) {
    const before = prevObjects.get(object.id);
    if (!before) {
      patch.added.push(object);
      continue;
    }
    if (!sameContent(before, object)) patch.updated.push({ object, prev: before });
    else if (!samePosition(before, object)) patch.moved.push({ object, prev: before });
  }
  for (const id of prevObjects.keys()) {
    if (!nextObjects.has(id)) patch.removed.push(id);
  }

  const prevConnectors = new Map((prev?.connectors ?? []).map((c) => [c.id, c]));
  const nextConnectors = new Map(next.connectors.map((c) => [c.id, c]));
  for (const connector of next.connectors) {
    const before = prevConnectors.get(connector.id);
    if (!before) patch.connectorsAdded.push(connector);
    else if (!samePoints(before, connector)) patch.connectorsRerouted.push(connector);
  }
  for (const id of prevConnectors.keys()) {
    if (!nextConnectors.has(id)) patch.connectorsRemoved.push(id);
  }
  return patch;
}

export function isNoOpPatch(patch: RenderPatch): boolean {
  return (
    !patch.added.length &&
    !patch.moved.length &&
    !patch.updated.length &&
    !patch.removed.length &&
    !patch.connectorsAdded.length &&
    !patch.connectorsRemoved.length &&
    !patch.connectorsRerouted.length
  );
}

/** One line per change — the debug panel's render column. */
export function describePatch(patch: RenderPatch): string[] {
  return [
    ...patch.added.map((o) => `ADD ${o.primitive} ${o.label ?? o.id}`),
    ...patch.moved.map(({ object }) => `MOVE ${object.label ?? object.id}`),
    ...patch.updated.map(({ object, prev }) => `UPDATE ${object.label ?? object.id} (was ${prev.label ?? prev.primitive})`),
    ...patch.removed.map((id) => `REMOVE ${id}`),
    ...patch.connectorsAdded.map((c) => `CONNECT ${c.fromObjectId} -> ${c.toObjectId} (${c.style})`),
    ...patch.connectorsRerouted.map((c) => `REROUTE ${c.id}`),
    ...patch.connectorsRemoved.map((id) => `DISCONNECT ${id}`),
  ];
}
