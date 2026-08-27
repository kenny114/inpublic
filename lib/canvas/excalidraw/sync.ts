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

import { PAGE_H, PAGE_PAD, PAGE_W, pageOrigin, place, willOverflow, type Pen } from "../../ops";
import type { SceneElement } from "../../scene";
import { applyStableIds, skeletonsForScene, type ExpressionSkeleton } from "./conversion";
import type { Sketch } from "../../expression/draw/schemas";
import type { RenderPatch, ScenePlan } from "../../expression/schemas";

/** Headroom over the scene's exact footprint, so a growing diagram doesn't re-reserve on every sentence. */
const REGION_PADDING = 1.12;
const MIN_REGION_W = 320;
const MIN_REGION_H = 200;
/** Clears the Excalidraw left rail, so the region is never drawn under the tools. */
const INSET_X = 72;
const INSET_Y = 16;
/** Same-topic overflow must not flip the sheet this often — eval #1's 8–10s cadence. */
const SAME_TOPIC_TURN_COOLDOWN_MS = 12_000;

const CONTENT_W = PAGE_W - PAGE_PAD * 2;
const CONTENT_H = PAGE_H - PAGE_PAD * 2;

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
  /**
   * Set only when a scene was DROPPED rather than drawn — currently just the
   * conversion failing to map one-to-one. An empty result is otherwise
   * ambiguous (nothing to do, or everything went wrong), and the caller needs
   * to tell those apart to log the second one. Same reasoning as
   * ExpressionLiveController's onNoChange/onError.
   */
  skipped?: string;
}

export type ExpressionElementConverter = (skeletons: ExpressionSkeleton[]) => Promise<SceneElement[]> | SceneElement[];

async function convertWithInstalledExcalidraw(skeletons: ExpressionSkeleton[]): Promise<SceneElement[]> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  return convertToExcalidrawElements(skeletons as never) as unknown as SceneElement[];
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

/** Everything syncExpressionCanvas's caller needs to know about why an automatic page turn fired. */
export interface OverflowInfo {
  neededW: number;
  neededH: number;
  pen: Pen;
  pageIndex: number;
  alreadyOnThisPage: boolean;
}

/**
 * Signals from the live board that decide whether an overflowing region
 * should turn the page or stay and grow. Omitted (tests, first scene) keeps
 * the historical behaviour: willOverflow still fires onOverflow.
 */
export interface OverflowPolicy {
  topicChanged: boolean;
  msSincePreviousTurn: number | null;
  /** Right-side caption rail reserved so the diagram does not sit under live speech. */
  insetRight?: number;
}

export interface OverflowDecision {
  turn: boolean;
  reason: string;
}

/**
 * Whether an overflowing expression region should turn the page.
 *
 * A page turn only helps when the current sheet is occupied by something
 * else AND a blank sheet would actually fit this region. Same-topic growth
 * that already owns the page, or a scene bigger than a blank page, must
 * stay and grow in place — turning is the flicker storm (eval #1 finding #6).
 */
export function decideExpressionOverflow(info: {
  neededW: number;
  neededH: number;
  alreadyOnThisPage: boolean;
  topicChanged: boolean;
  msSincePreviousTurn: number | null;
  fitsBlankPage: boolean;
}): OverflowDecision {
  if (info.alreadyOnThisPage) {
    return { turn: false, reason: "already on this sheet: grow in place" };
  }
  if (!info.fitsBlankPage) {
    return { turn: false, reason: "fresh sheet would not fit either" };
  }
  if (
    !info.topicChanged &&
    info.msSincePreviousTurn !== null &&
    info.msSincePreviousTurn < SAME_TOPIC_TURN_COOLDOWN_MS
  ) {
    return { turn: false, reason: "page-turn cooldown" };
  }
  if (!info.topicChanged) {
    return { turn: false, reason: "same topic: grow in place" };
  }
  return { turn: true, reason: "topic change and current sheet is full" };
}

function desiredRegion(sceneW: number, sceneH: number, maxW: number, maxH: number): { w: number; h: number } {
  return {
    w: Math.min(maxW, Math.max(MIN_REGION_W, Math.ceil(sceneW * REGION_PADDING))),
    h: Math.min(maxH, Math.max(MIN_REGION_H, Math.ceil(sceneH * REGION_PADDING))),
  };
}

/** True when RenderPatch describes literally nothing new, moved, changed, or removed. */
function patchIsEmpty(patch: RenderPatch): boolean {
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

export async function syncExpressionCanvas(
  scene: ScenePlan,
  patch: RenderPatch,
  elements: SceneElement[],
  pen: Pen,
  pageIndex: number,
  identity: ExpressionIdentity,
  onOverflow?: (info: OverflowInfo) => void,
  /**
   * The Drawing Agent's strokes for this scene, keyed by sketchKey. Resolved
   * by the caller (Board's applyExpressionUpdate) because fetching them is a
   * network call and this function must stay a pure reconciliation step.
   * Omitted or incomplete is normal — every sketchable primitive falls back
   * to its plain geometry.
   */
  sketches?: Map<string, Sketch>,
  policy?: OverflowPolicy,
  convertElements: ExpressionElementConverter = convertWithInstalledExcalidraw,
): Promise<SyncExpressionCanvasResult> {
  // An empty scene means the engine decided there is nothing worth showing
  // yet. That is a real answer, and it must not erase a diagram that is
  // already on the sheet — silence is "no new expression", not "undo".
  if (!scene.objects.length) {
    return { elements, addedIds: [], removedIds: [], updatedIds: [] };
  }

  // INVARIANT (docs/EXPRESSION-ENGINE-LIVE-EVAL-1-REPORT.md, finding #6): an
  // automatic page turn must never fire when there is no meaningful visual
  // delta. Before this check existed, `needsRegion` below compared the
  // scene's raw footprint against the REGION reserved for it — a comparison
  // that is blind to `identity.originPage !== pageIndex`, i.e. the page
  // having already turned for an unrelated reason (Tier 1's own
  // "long-utterance" page turn, a manual page change, anything). The next
  // time this function ran afterwards, `needsRegion` was true purely from
  // the stale page index, so it reserved a fresh region at a new origin —
  // which changes every existing skeleton's absolute x/y, which changes
  // every signature, which made planCanvasDiff below treat the entire
  // unchanged scene as "updated": a full silent redraw plus a camera move,
  // for a round where `patch` (the actual semantic diff from the world/plan
  // layer) was empty. `patch` is the ground truth for "did anything worth
  // showing actually change" — nothing downstream of it needs to run when
  // it says no.
  if (patchIsEmpty(patch)) {
    return { elements, addedIds: [], removedIds: [], updatedIds: [] };
  }

  const insetRight = policy?.insetRight ?? 0;
  const maxW = Math.max(MIN_REGION_W, CONTENT_W - INSET_X - insetRight);
  const maxH = Math.max(MIN_REGION_H, CONTENT_H - INSET_Y);
  const desired = desiredRegion(scene.width, scene.height, maxW, maxH);
  const alreadyOnThisPage = identity.origin !== null && identity.originPage === pageIndex;
  const canGrow = alreadyOnThisPage && (desired.w > identity.regionW || desired.h > identity.regionH);
  const needsNewOrigin = identity.origin === null || identity.originPage !== pageIndex;

  if (alreadyOnThisPage && canGrow) {
    // Grow the reserved box up to the page. Never turn: this sheet already
    // holds the diagram, and a same-topic patch that flips the page is the
    // occupancy storm (eval #1 finding #6).
    identity.regionW = Math.max(identity.regionW, desired.w);
    identity.regionH = Math.max(identity.regionH, desired.h);
  } else if (needsNewOrigin) {
    const w = desired.w + INSET_X;
    const h = desired.h + INSET_Y;
    const overflow = willOverflow(pen, w, h);
    const fitsBlankPage = desired.w <= maxW && desired.h <= maxH;
    const decision = overflow
      ? decideExpressionOverflow({
          neededW: w,
          neededH: h,
          alreadyOnThisPage: false,
          topicChanged: policy?.topicChanged ?? true,
          msSincePreviousTurn: policy?.msSincePreviousTurn ?? null,
          fitsBlankPage,
        })
      : { turn: false, reason: "fits" };
    if (overflow && decision.turn) {
      onOverflow?.({ neededW: w, neededH: h, pen: { ...pen }, pageIndex, alreadyOnThisPage });
      const spot = place(pen, w, h, true);
      identity.origin = { x: spot.x + INSET_X, y: spot.y + INSET_Y };
    } else if (overflow && !decision.turn) {
      // Stay. Pin to this page's origin so a suppressed turn does not write
      // the diagram off the bottom of a pen that has already walked down.
      const page = pageOrigin(pageIndex);
      identity.origin = { x: page.x + INSET_X, y: page.y + INSET_Y };
    } else {
      const spot = place(pen, w, h, true);
      identity.origin = { x: spot.x + INSET_X, y: spot.y + INSET_Y };
    }
    identity.originPage = pageIndex;
    identity.regionW = desired.w;
    identity.regionH = desired.h;
  }
  const origin = identity.origin!;

  const skeletons = skeletonsForScene(scene, origin, sketches);
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
  const converted = await convertElements(skeletons);
  const identified = applyStableIds(converted, skeletons);
  if (!identified) {
    // Conversion did not map one-to-one, so no element can be trusted to be
    // the one its id claims. Writing anyway would attach the wrong label to
    // the wrong shape; leaving the sheet untouched is the safe failure.
    const reason = `conversion produced ${converted.length} elements for ${skeletons.length} skeletons`;
    console.error("[expression] skipped a scene:", reason);
    return { elements, addedIds: [], removedIds: [], updatedIds: [], skipped: reason };
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
