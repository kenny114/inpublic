/**
 * Reconciles the expression region of a live Excalidraw sheet against a
 * ScenePlan.
 *
 * The counterpart of lib/meaning/apply.ts's syncMeaningCanvas, and it takes
 * the same posture on purpose — reserve a region on the page, own only the
 * elements inside it, turn the page when the diagram outgrows the sheet —
 * because those conventions belong to the board, not to either engine.
 *
 * What is different, and what the whole ScenePlan layer buys:
 *
 * syncMeaningCanvas has to re-derive geometry from SemanticState on every
 * call, then compare Excalidraw elements field by field to work out what
 * moved. Here the geometry arrived already decided, and the conversion is
 * IDEMPOTENT: the same scene at the same origin produces byte-identical
 * elements with identical ids (see excalidraw.ts's labelSkeleton note on why
 * bound labels had to go). So reconciliation is a plain signature diff, and
 * an element whose signature is unchanged is not touched at all — not
 * re-created, not re-styled, not re-bound.
 *
 * That matters for one specific reason: a viewer is tracking a box with
 * their eyes while the speaker keeps talking. An element that is deleted and
 * re-added at the same coordinates looks like a flicker, and enough of those
 * make a live board feel like it is redrawing itself constantly — which is
 * exactly the failure the brief calls out as "do not wipe the board and
 * regenerate everything".
 *
 * Arrows are the one deliberate exception: they are rebuilt whenever either
 * endpoint moved. Excalidraw only re-routes a bound arrow when a human drags
 * the bound element in the editor; moving a node programmatically leaves the
 * arrow pointing at stale coordinates. syncMeaningCanvas rebuilds every
 * arrow every pass for this reason; here the RenderPatch already knows which
 * connectors were rerouted, so only those are rebuilt.
 */

import { place, willOverflow, type Pen } from "../../ops";
import type { SceneElement } from "../../scene";
import { applyStableIds, skeletonsForScene, type ExpressionSkeleton } from "./excalidraw";
import type { RenderPatch, ScenePlan } from "../schemas";

/** Headroom over the scene's exact footprint, so a growing diagram doesn't re-reserve on every sentence. */
const REGION_PADDING = 1.35;
const MIN_REGION_W = 320;
const MIN_REGION_H = 200;
/** Clears the Excalidraw left rail, so the region is never drawn under the tools. */
const INSET_X = 72;
const INSET_Y = 16;

export interface ExpressionIdentity {
  /** Every element id this region owns, mapped to the signature it was built from. */
  signatureByElementId: Map<string, string>;
  /** The region reserved on the sheet. */
  origin: { x: number; y: number } | null;
  originPage: number | null;
  regionW: number;
  regionH: number;
}

export function createExpressionIdentity(): ExpressionIdentity {
  return {
    signatureByElementId: new Map(),
    origin: null,
    originPage: null,
    regionW: 0,
    regionH: 0,
  };
}

export interface SyncExpressionCanvasResult {
  elements: SceneElement[];
  addedIds: string[];
  removedIds: string[];
  /** Elements that already existed and were rebuilt in place — a move or a content change. */
  updatedIds: string[];
}

/**
 * A skeleton's full content, as a comparable string. Everything that affects
 * what is drawn is in here, so two equal signatures genuinely mean "nothing
 * a viewer could see has changed".
 */
function signatureOf(skeleton: ExpressionSkeleton): string {
  return JSON.stringify(skeleton);
}

export interface CanvasDiff {
  /** Ids that are not on the sheet yet. */
  addedIds: string[];
  /** Ids that exist and changed — rebuilt in place, keeping the same id. */
  updatedIds: string[];
  /** Ids this region owns that the new scene no longer contains. */
  removedIds: string[];
  /** The old elements to drop before writing (the updated ones). */
  staleIds: string[];
  /** The skeletons that actually need converting. */
  rebuild: ExpressionSkeleton[];
}

/**
 * The reconciliation decision, as a pure function.
 *
 * Split out from syncExpressionCanvas so it can be tested without a browser:
 * everything below this point needs @excalidraw/excalidraw, which is a
 * browser-only ESM package, and this is the part where a bug would actually
 * hurt — deciding wrongly here means either a flickering board or a stale one.
 */
export function planCanvasDiff(
  skeletons: ExpressionSkeleton[],
  elements: SceneElement[],
  identity: ExpressionIdentity,
  patch: RenderPatch,
): CanvasDiff {
  const nextSignatures = new Map<string, string>();
  for (const skeleton of skeletons) {
    if (typeof skeleton.id === "string") nextSignatures.set(skeleton.id, signatureOf(skeleton));
  }

  // A rerouted connector can be geometrically identical to its old self when
  // both endpoints moved by the same amount — the signature would match, and
  // the arrow would be left bound to stale positions. Force those to rebuild.
  const forceRebuild = new Set<string>([
    ...patch.connectorsRerouted.map((c) => c.id),
    ...patch.connectorsRerouted.map((c) => `${c.id}-label`),
  ]);

  const onSheet = new Set(elements.map((el) => el.id));
  const addedIds: string[] = [];
  const updatedIds: string[] = [];
  const staleIds: string[] = [];
  const rebuild: ExpressionSkeleton[] = [];

  for (const skeleton of skeletons) {
    const id = typeof skeleton.id === "string" ? skeleton.id : null;
    if (!id) continue;
    const previous = identity.signatureByElementId.get(id);
    const stillOnSheet = previous !== undefined && onSheet.has(id);
    // Unchanged and still present: leave it strictly alone. Not re-created,
    // not re-styled — this branch is the whole reason the board does not
    // flicker while someone keeps talking.
    if (stillOnSheet && previous === nextSignatures.get(id) && !forceRebuild.has(id)) continue;
    if (stillOnSheet) {
      staleIds.push(id);
      updatedIds.push(id);
    } else {
      addedIds.push(id);
    }
    rebuild.push(skeleton);
  }

  const removedIds: string[] = [];
  for (const id of identity.signatureByElementId.keys()) {
    if (!nextSignatures.has(id)) removedIds.push(id);
  }

  return { addedIds, updatedIds, removedIds, staleIds, rebuild };
}

export async function syncExpressionCanvas(
  scene: ScenePlan,
  patch: RenderPatch,
  elements: SceneElement[],
  pen: Pen,
  pageIndex: number,
  identity: ExpressionIdentity,
  onOverflow?: () => void,
): Promise<SyncExpressionCanvasResult> {
  // An empty scene means the engine decided there is nothing worth showing
  // yet. That is a real answer, and it must not erase a diagram that is
  // already on the sheet — silence is "no new expression", not "undo".
  if (!scene.objects.length) {
    return { elements, addedIds: [], removedIds: [], updatedIds: [] };
  }

  const needsRegion =
    identity.origin === null ||
    identity.originPage !== pageIndex ||
    scene.width > identity.regionW ||
    scene.height > identity.regionH;

  if (needsRegion) {
    const w = Math.max(MIN_REGION_W, Math.ceil(scene.width * REGION_PADDING)) + INSET_X;
    const h = Math.max(MIN_REGION_H, Math.ceil(scene.height * REGION_PADDING)) + INSET_Y;
    if (willOverflow(pen, w, h)) onOverflow?.();
    const spot = place(pen, w, h, true);
    identity.origin = { x: spot.x + INSET_X, y: spot.y + INSET_Y };
    identity.originPage = pageIndex;
    identity.regionW = w - INSET_X;
    identity.regionH = h - INSET_Y;
  }
  const origin = identity.origin!;

  const skeletons = skeletonsForScene(scene, origin);
  const diff = planCanvasDiff(skeletons, elements, identity, patch);

  const { addedIds, updatedIds, removedIds, rebuild, staleIds } = diff;
  for (const id of removedIds) identity.signatureByElementId.delete(id);

  if (!rebuild.length && !removedIds.length) {
    return { elements, addedIds: [], removedIds: [], updatedIds: [] };
  }

  // Arrows bind by id, so the elements they point at must be present in the
  // same conversion batch. Converting the whole scene and then keeping only
  // the elements we actually intend to write is cheaper to reason about than
  // partial batches with dangling bindings, and the conversion is pure.
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const converted = convertToExcalidrawElements(skeletons as never) as unknown as SceneElement[];
  const identified = applyStableIds(converted, skeletons);
  if (!identified) {
    // Conversion did not map one-to-one, so no element can be trusted to be
    // the one its id claims. Writing anyway would attach the wrong label to
    // the wrong shape; leaving the sheet untouched is the safe failure.
    console.error("[expression] skipped a scene: conversion produced", converted.length, "elements for", skeletons.length, "skeletons");
    return { elements, addedIds: [], removedIds: [], updatedIds: [] };
  }
  const wanted = new Set(rebuild.map((s) => String(s.id)));
  const fresh = identified.filter((el) => wanted.has(el.id));

  const drop = new Set([...staleIds, ...removedIds]);
  const kept = elements.filter((el) => !drop.has(el.id));

  for (const skeleton of rebuild) {
    identity.signatureByElementId.set(String(skeleton.id), signatureOf(skeleton));
  }

  return {
    elements: [...kept, ...fresh],
    addedIds,
    removedIds,
    updatedIds,
  };
}

/** Bounding box of the freshly written elements, for the camera. Null when nothing was written. */
export function boundsOf(elements: SceneElement[], ids: string[]): { x: number; y: number; w: number; h: number } | null {
  const target = elements.filter((el) => ids.includes(el.id));
  if (!target.length) return null;
  const xs = target.map((el) => el.x);
  const ys = target.map((el) => el.y);
  const xe = target.map((el) => el.x + (el.width ?? 0));
  const ye = target.map((el) => el.y + (el.height ?? 0));
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xe) - Math.min(...xs),
    h: Math.max(...ye) - Math.min(...ys),
  };
}
