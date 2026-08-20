/**
 * Syncs the meaning-diagram region of the canvas to a SemanticState.
 * lib/meaning/plan.ts chooses the form and the display subset; this module
 * only draws that subset. causal_chain is a vertical spine, comparison is
 * two columns, hierarchy is an enclosure (title in the header, children inside).
 *
 * Still built entirely on the existing element primitives —
 * buildConceptNode/buildBoundArrow/place/willOverflow from lib/ops.ts —
 * rather than a parallel renderer.
 *
 * Nodes keep identity across a sync: an unchanged concept's box is left
 * alone, a relabeled/reimportanced/repositioned one is rebuilt in place
 * (same id, new geometry), and a removed one is deleted. Edges are NOT
 * given the same "patch in place" treatment: Excalidraw's start/endBinding
 * only auto-reroutes an arrow when a human drags the bound element in the
 * live editor — moving a node programmatically via updateScene() does not
 * trigger that, so every arrow whose endpoints came from THIS pass would
 * silently go stale (pointing at old coordinates) if left alone. Rebuilding
 * every meaning-engine arrow fresh, every sync, is the simplest way to
 * guarantee an edge always matches the current layout — arrows are cheap to
 * regenerate and carry no independent identity a viewer would notice
 * flicker on (unlike a concept's box, which is the thing a viewer is
 * tracking as "the same idea").
 */

import { buildConceptNode, buildEnclosureFrame, buildBoundArrow, place, willOverflow, type Pen } from "../ops";
import type { SceneElement } from "../scene";
import { displayConceptLabel } from "./display";
import { signForConcept } from "./lexicon";
import { buildSign, signGeometry } from "./sign";
import { computeMeaningLayout } from "./layout";
import { planMeaning } from "./plan";
import type { ConceptImportance, RelationshipType, SemanticState, VisualPlan } from "./types";

/** Reuses lib/ops.ts's existing kind->stroke vocabulary (KIND_STROKE) by name rather than inventing a second one. */
const IMPORTANCE_KIND: Record<ConceptImportance, string> = {
  primary: "goal",
  supporting: "process",
  detail: "note",
};

function shouldDrawArrow(type: RelationshipType, family: VisualPlan["family"]): boolean {
  if (family === "comparison" || family === "hierarchy") return false;
  return type === "causes" || type === "leads_to" || type === "depends_on";
}

export interface MeaningIdentity {
  nodeIdByConceptId: Map<string, string>;
  arrowIdByRelationshipId: Map<string, string>;
  /** Arrow-label text ids, deleted with the arrow so they cannot pile up across syncs. */
  extraIdsByRelationshipId: Map<string, string[]>;
  /** Free title text for an enclosure parent — not bound to the rectangle. */
  titleIdByConceptId: Map<string, string>;
  /**
   * The stroke/ellipse elements that make up a wordless sign. Unlike a
   * labelled box (whose text is reachable through `boundElements`), a sign's
   * ink is a loose set of siblings around the transparent anchor — untracked,
   * it would survive every removal and pile up as ghost strokes.
   */
  signPartIdsByConceptId: Map<string, string[]>;
  /** `${label}|${importance}` per concept, so a content-only change can be told apart from a pure position change without re-reading Excalidraw element state. */
  signatureByConceptId: Map<string, string>;
  /** The meaning diagram's reserved region on the page — set once, grown only if the diagram outgrows it. */
  origin: { x: number; y: number } | null;
  originPage: number | null;
  regionW: number;
  regionH: number;
}

export function createMeaningIdentity(): MeaningIdentity {
  return {
    nodeIdByConceptId: new Map(),
    arrowIdByRelationshipId: new Map(),
    extraIdsByRelationshipId: new Map(),
    titleIdByConceptId: new Map(),
    signPartIdsByConceptId: new Map(),
    signatureByConceptId: new Map(),
    origin: null,
    originPage: null,
    regionW: 0,
    regionH: 0,
  };
}

type BoundRef = { id: string; type: string };

function enclosureTitleId(built: unknown): string | null {
  if (!built || typeof built !== "object" || !("titleId" in built)) return null;
  const id = (built as { titleId: unknown }).titleId;
  return typeof id === "string" ? id : null;
}

/**
 * Record a sign's non-anchor ink so a later removal or rebuild can delete it.
 * A labelled box has no parts, so this clears the entry rather than leaving a
 * stale one behind when a concept switches renderers.
 */
function rememberSignParts(
  identity: MeaningIdentity,
  conceptId: string,
  built: { elements: SceneElement[]; nodeId: string },
): void {
  const parts = built.elements.filter((el) => el.id !== built.nodeId).map((el) => el.id);
  if (parts.length) identity.signPartIdsByConceptId.set(conceptId, parts);
  else identity.signPartIdsByConceptId.delete(conceptId);
}

/** Keep bound labels; drop stale arrow refs. Wiping the whole array unbinds the box text and leaves empty rectangles (session-2026-08-20T01-17). */
export function keepTextBindings(bound: BoundRef[] | undefined): BoundRef[] {
  return (bound ?? []).filter((b) => b.type === "text");
}

export interface SyncMeaningCanvasResult {
  elements: SceneElement[];
  addedIds: string[];
  removedIds: string[];
  movedIds: string[];
}

/** Headroom over the current layout's exact footprint, so a small diagram doesn't re-reserve on every added node. */
const REGION_PADDING = 1.35;
const MIN_REGION_W = 280;
const MIN_REGION_H = 160;
const POSITION_EPSILON = 0.5;
/** Clear the Excalidraw left rail so a household region is not drawn under the tools. */
const MEANING_INSET_X = 72;
const MEANING_INSET_Y = 16;

/**
 * Reconciles the whole meaning-diagram region against `nextState` in one
 * pass. Not incremental-by-op the way lib/meaning/reconcile.ts's diff is —
 * a coherent hierarchy layout can legitimately need to reposition existing
 * siblings when a new one arrives, so this recomputes the full layout every
 * time and only touches the elements whose content or position actually
 * changed. `onOverflow` fires when the diagram doesn't fit on the current
 * sheet (either its first reservation, or a later re-reservation after
 * outgrowing its headroom).
 */
export async function syncMeaningCanvas(
  nextState: SemanticState,
  elements: SceneElement[],
  pen: Pen,
  pageIndex: number,
  identity: MeaningIdentity,
  onOverflow?: () => void,
  plan?: VisualPlan,
  /**
   * `wordless: true` swaps every labelled box for a drawn sign
   * (lib/meaning/sign.ts) and leaves no readable text in the meaning region.
   * The SemanticState still carries its English labels — they just stop at
   * lib/meaning/lexicon.ts and never reach the canvas.
   */
  options?: { wordless?: boolean },
): Promise<SyncMeaningCanvasResult> {
  const wordless = options?.wordless === true;
  let current = elements;
  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const findEl = (id: string) => current.find((el) => el.id === id);
  const boundTextIds = (el: SceneElement | undefined) =>
    ((el?.boundElements as { id: string; type: string }[] | undefined) ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.id);

  const visualPlan = plan ?? planMeaning(nextState);
  const focusIds = new Set(visualPlan.focusConceptIds);
  const visible: SemanticState = {
    ...nextState,
    concepts: nextState.concepts.filter((c) => focusIds.has(c.id)),
    relationships: nextState.relationships.filter((r) => visualPlan.focusRelationshipIds.includes(r.id)),
    claims: nextState.claims.filter((c) => visualPlan.annotationClaimIds.includes(c.id)),
  };
  const layout = computeMeaningLayout(visible, visualPlan);

  const needsRegion =
    identity.origin === null ||
    identity.originPage !== pageIndex ||
    layout.width > identity.regionW ||
    layout.height > identity.regionH;
  if (needsRegion) {
    const w = Math.max(MIN_REGION_W, Math.ceil(layout.width * REGION_PADDING)) + MEANING_INSET_X;
    const h = Math.max(MIN_REGION_H, Math.ceil(layout.height * REGION_PADDING)) + MEANING_INSET_Y;
    if (willOverflow(pen, w, h)) onOverflow?.();
    const spot = place(pen, w, h, true);
    identity.origin = { x: spot.x + MEANING_INSET_X, y: spot.y + MEANING_INSET_Y };
    identity.originPage = pageIndex;
    identity.regionW = w - MEANING_INSET_X;
    identity.regionH = h - MEANING_INSET_Y;
  }
  const origin = identity.origin!;

  // Concepts no longer in the display budget: remove their box (+ bound text).
  const nextIds = new Set(visible.concepts.map((c) => c.id));
  for (const [conceptId, elementId] of [...identity.nodeIdByConceptId]) {
    if (nextIds.has(conceptId)) continue;
    const existing = findEl(elementId);
    const titleId = identity.titleIdByConceptId.get(conceptId);
    const staleIds = new Set([
      elementId,
      ...boundTextIds(existing),
      ...(titleId ? [titleId] : []),
      ...(identity.signPartIdsByConceptId.get(conceptId) ?? []),
    ]);
    current = current.filter((el) => !staleIds.has(el.id));
    removed.push(...staleIds);
    identity.nodeIdByConceptId.delete(conceptId);
    identity.signatureByConceptId.delete(conceptId);
    identity.titleIdByConceptId.delete(conceptId);
    identity.signPartIdsByConceptId.delete(conceptId);
  }

  const rootId = visualPlan.family === "hierarchy" ? visualPlan.focusConceptIds[0] : undefined;
  const paintOrder = [...visible.concepts].sort((a, b) => {
    if (a.id === rootId) return -1;
    if (b.id === rootId) return 1;
    return 0;
  });

  // Concepts present: enclosure parent first so children paint on top of it.
  for (const concept of paintOrder) {
    const box = layout.boxes.get(concept.id);
    if (!box) continue;
    const absX = origin.x + box.x;
    const absY = origin.y + box.y;
    const sign = wordless ? signForConcept(concept) : null;
    const drawnLabel = wordless ? "" : displayConceptLabel(concept.label, concept.quantity);
    const signature = sign
      ? `${sign.glyph}|${sign.charge}|${sign.texture}|${sign.motion}|${sign.scale}|${sign.negated}|${sign.tentative}|${box.w}x${box.h}`
      : `${drawnLabel}|${concept.importance}|${box.w}x${box.h}`;
    const existingId = identity.nodeIdByConceptId.get(concept.id);
    const existing = existingId ? findEl(existingId) : undefined;
    const isEnclosureRoot = visualPlan.family === "hierarchy" && visualPlan.focusConceptIds[0] === concept.id;
    const scratchPen: Pen = { originX: absX, originY: absY, x: absX, y: absY, lineH: 0 };

    // An enclosure root stays a frame even wordless — the region IS the
    // "contains" relation — but loses its title text. Every other concept
    // becomes a sign centred in the box the layout reserved for it.
    const paint = async () =>
      isEnclosureRoot
        ? buildEnclosureFrame(concept.id, drawnLabel, IMPORTANCE_KIND[concept.importance], scratchPen, { w: box.w, h: box.h })
        : sign
          ? buildSign(concept.id, sign, absX + box.w / 2, absY + box.h / 2)
          : buildConceptNode(concept.id, drawnLabel, IMPORTANCE_KIND[concept.importance], scratchPen, { w: box.w, h: box.h });

    if (!existing) {
      const built = await paint();
      if (!built) continue;
      identity.nodeIdByConceptId.set(concept.id, built.nodeId);
      identity.signatureByConceptId.set(concept.id, signature);
      const titleId = enclosureTitleId(built);
      if (titleId) identity.titleIdByConceptId.set(concept.id, titleId);
      rememberSignParts(identity, concept.id, built);
      current = [...current, ...built.elements];
      added.push(...built.elements.map((el) => el.id));
      continue;
    }

    // A sign's anchor sits at the centre of the layout box, so compare against
    // where THIS renderer would put it — not against the box origin, or every
    // sync would see a phantom move and rebuild the whole diagram.
    const expect =
      sign && !isEnclosureRoot
        ? (() => {
            const { size } = signGeometry(sign);
            return { x: absX + box.w / 2 - size / 2, y: absY + box.h / 2 - size / 2 };
          })()
        : { x: absX, y: absY };
    const positionChanged = Math.abs(existing.x - expect.x) > POSITION_EPSILON || Math.abs(existing.y - expect.y) > POSITION_EPSILON;
    const contentChanged = identity.signatureByConceptId.get(concept.id) !== signature;
    if (!positionChanged && !contentChanged) continue;

    const rebuilt = await paint();
    if (!rebuilt) continue;
    const prevTitle = identity.titleIdByConceptId.get(concept.id);
    const staleIds = new Set([
      existing.id,
      ...boundTextIds(existing),
      ...(prevTitle ? [prevTitle] : []),
      ...(identity.signPartIdsByConceptId.get(concept.id) ?? []),
    ]);
    identity.nodeIdByConceptId.set(concept.id, rebuilt.nodeId);
    identity.signatureByConceptId.set(concept.id, signature);
    const titleId = enclosureTitleId(rebuilt);
    if (titleId) identity.titleIdByConceptId.set(concept.id, titleId);
    else identity.titleIdByConceptId.delete(concept.id);
    rememberSignParts(identity, concept.id, rebuilt);
    current = [...current.filter((el) => !staleIds.has(el.id)), ...rebuilt.elements];
    removed.push(...staleIds);
    added.push(...rebuilt.elements.map((el) => el.id));
    if (positionChanged) moved.push(rebuilt.nodeId);
  }

  // Rebuild arrows every sync (see module doc). Strip only arrow bindings —
  // never the bound label text, or the boxes go empty.
  const meaningNodeIds = new Set(identity.nodeIdByConceptId.values());
  current = current.map((el) =>
    meaningNodeIds.has(el.id)
      ? ({ ...el, boundElements: keepTextBindings(el.boundElements as BoundRef[] | undefined) } as SceneElement)
      : el,
  );

  const staleArrowInk = new Set<string>();
  for (const [, arrowId] of identity.arrowIdByRelationshipId) staleArrowInk.add(arrowId);
  for (const extras of identity.extraIdsByRelationshipId.values()) {
    for (const id of extras) staleArrowInk.add(id);
  }
  if (staleArrowInk.size) {
    current = current.filter((el) => !staleArrowInk.has(el.id));
    removed.push(...staleArrowInk);
  }
  identity.arrowIdByRelationshipId.clear();
  identity.extraIdsByRelationshipId.clear();

  for (const rel of visible.relationships) {
    const fromId = identity.nodeIdByConceptId.get(rel.from);
    const toId = identity.nodeIdByConceptId.get(rel.to);
    const fromEl = fromId ? findEl(fromId) : undefined;
    const toEl = toId ? findEl(toId) : undefined;
    if (!fromEl || !toEl) continue;
    if (!shouldDrawArrow(rel.type, visualPlan.family)) continue;
    const label = "";
    const built = await buildBoundArrow(rel.id, fromEl, toEl, label, current);
    if (!built) continue;
    identity.arrowIdByRelationshipId.set(rel.id, built.arrow.id);
    identity.extraIdsByRelationshipId.set(rel.id, built.extras.map((el) => el.id));
    current = current.map((el) => {
      const patchEntry = built.bindPatches.find((p) => p.id === el.id);
      return patchEntry ? ({ ...el, boundElements: patchEntry.boundElements } as SceneElement) : el;
    });
    current = [...current, built.arrow, ...built.extras];
    added.push(built.arrow.id, ...built.extras.map((el) => el.id));
  }

  return {
    elements: restackMeaningInk(current, identity),
    addedIds: added,
    removedIds: removed,
    movedIds: moved,
  };
}

/** Enclosure frame under children; arrows on top. Transcript and everything else stay put. */
function restackMeaningInk(elements: SceneElement[], identity: MeaningIdentity): SceneElement[] {
  const enclosureNodeIds = new Set(
    [...identity.titleIdByConceptId.keys()]
      .map((id) => identity.nodeIdByConceptId.get(id))
      .filter((id): id is string => Boolean(id)),
  );
  const titleIds = new Set(identity.titleIdByConceptId.values());
  const meaningNodeIds = new Set(identity.nodeIdByConceptId.values());
  const childNodeIds = new Set([...meaningNodeIds].filter((id) => !enclosureNodeIds.has(id)));
  const arrowIds = new Set(identity.arrowIdByRelationshipId.values());
  const extraIds = new Set<string>();
  for (const ids of identity.extraIdsByRelationshipId.values()) for (const id of ids) extraIds.add(id);

  const enclosure: SceneElement[] = [];
  const titles: SceneElement[] = [];
  const children: SceneElement[] = [];
  const arrows: SceneElement[] = [];
  const rest: SceneElement[] = [];
  for (const el of elements) {
    const containerId = (el as SceneElement & { containerId?: string }).containerId;
    if (enclosureNodeIds.has(el.id)) enclosure.push(el);
    else if (titleIds.has(el.id)) titles.push(el);
    else if (childNodeIds.has(el.id) || (containerId && childNodeIds.has(containerId))) children.push(el);
    else if (arrowIds.has(el.id) || extraIds.has(el.id)) arrows.push(el);
    else rest.push(el);
  }
  return [...rest, ...enclosure, ...titles, ...children, ...arrows];
}
