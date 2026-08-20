/**
 * Draws a `VisualSign` — the wordless replacement for `buildConceptNode`.
 *
 * `buildConceptNode` (lib/ops.ts) makes a rectangle whose entire job is to
 * hold a label; strip the label and nothing is left but an empty box. This
 * builds the opposite: a glyph carrying the meaning, with an *invisible*
 * bindable rectangle behind it.
 *
 * That hidden rectangle is not a hedge back toward boxes. Excalidraw only
 * binds arrows to bindable element types (rectangle / ellipse / diamond /
 * text / image / frame) — a bare set of lines cannot be an arrow endpoint. A
 * transparent rectangle at the sign's bounds is what lets lib/ops.ts's
 * existing `buildBoundArrow` keep working unchanged, and keeps arrows
 * re-routing when the composition layer moves a sign. It draws nothing.
 *
 * Modifiers are drawn *over* the glyph rather than swapping it for another
 * glyph, which is what makes the vocabulary compose (see lib/meaning/
 * lexicon.ts): `funnel` + cluttered + problem is a tangled, red-inked funnel,
 * not a 25th symbol someone had to author.
 */

import { resolveIcon, type IconArt } from "../icons";
import type { SceneElement } from "../scene";
import { resolveGlyph } from "./glyphs";
import { CHARGE_STROKE, type VisualSign } from "./lexicon";

/** Base edge of a sign's square drawing box, before `sign.scale`. */
export const SIGN_BASE = 84;

export interface BuiltSign {
  elements: SceneElement[];
  /** The transparent anchor — the id arrows bind to, and the concept's identity. */
  nodeId: string;
  w: number;
  h: number;
}

function art(glyph: string): IconArt {
  return resolveGlyph(glyph) ?? resolveIcon(glyph) ?? resolveGlyph("mass")!;
}

/** Deterministic jitter so a "cluttered" sign looks scrawled, not randomised
 *  differently on every re-render (which would read as flicker). */
function noise(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

export interface SignGeometry {
  /** Drawing box edge in canvas units, after scale. */
  size: number;
}

export function signGeometry(sign: VisualSign): SignGeometry {
  return { size: Math.round(SIGN_BASE * sign.scale) };
}

/**
 * The sign as plain element descriptors, before Excalidraw sees it.
 *
 * Split out from `buildSign` so the wordless invariant is testable in Node:
 * `@excalidraw/excalidraw` cannot be imported outside a browser, which is why
 * nothing downstream of it is covered by scripts/. A test can assert against
 * this skeleton that no descriptor is `type: "text"` — the one property the
 * whole overhaul rests on — without a DOM.
 */
export function signSkeleton(
  nodeId: string,
  sign: VisualSign,
  cx: number,
  cy: number,
): Record<string, unknown>[] {
  const { size } = signGeometry(sign);
  const x0 = cx - size / 2;
  const y0 = cy - size / 2;
  const sx = (v: number) => x0 + (v / 100) * size;
  const sy = (v: number) => y0 + (v / 100) * size;

  const ink = CHARGE_STROKE[sign.charge];
  // Weight is emphasis. A tentative reading is drawn thin so a viewer reads it
  // as "the system is still deciding" without any word saying so.
  const strokeWidth = sign.tentative ? 1 : sign.scale >= 1.3 ? 3 : 2;
  const strokeStyle = sign.tentative ? "dashed" : "solid";
  const roughness = sign.texture === "cluttered" ? 2 : sign.texture === "clean" ? 0 : 1;

  const skeleton: Record<string, unknown>[] = [
    // The bindable anchor. Transparent on both axes — it is scaffolding.
    {
      id: nodeId,
      type: "rectangle",
      x: x0,
      y: y0,
      width: size,
      height: size,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
    },
  ];

  const shape = art(sign.glyph);
  for (const stroke of shape.strokes) {
    const [hx, hy] = stroke[0];
    skeleton.push({
      type: "line",
      x: sx(hx),
      y: sy(hy),
      points: stroke.map(([px, py]) => [sx(px) - sx(hx), sy(py) - sy(hy)]),
      strokeColor: ink,
      strokeWidth,
      strokeStyle,
      roughness,
    });
  }
  for (const [ecx, ecy, rx, ry] of shape.ellipses) {
    skeleton.push({
      type: "ellipse",
      x: sx(ecx - rx),
      y: sy(ecy - ry),
      width: ((rx * 2) / 100) * size,
      height: ((ry * 2) / 100) * size,
      strokeColor: ink,
      backgroundColor: "transparent",
      strokeWidth,
      strokeStyle,
      roughness,
    });
  }

  // --- modifiers ----------------------------------------------------------

  // Disorder: extra scrawl across the glyph. Order: nothing added — clarity is
  // the absence of ink, so `clean` is expressed by the low roughness above.
  if (sign.texture === "cluttered") {
    for (let i = 0; i < 3; i++) {
      const a = noise(i + 1);
      const b = noise(i + 11);
      skeleton.push({
        type: "line",
        x: sx(8 + a * 20),
        y: sy(14 + b * 60),
        points: [
          [0, 0],
          [(size * (0.3 + a * 0.35)), (size * (b - 0.5) * 0.4)],
          [(size * (0.55 + b * 0.3)), (size * (a - 0.5) * 0.5)],
        ],
        strokeColor: ink,
        strokeWidth: 1,
        roughness: 2,
      });
    }
  }

  // Direction of travel, drawn beside the sign so it never obscures it.
  const cue = motionCue(sign.motion, x0, y0, size);
  for (const stroke of cue) {
    skeleton.push({
      type: "line",
      x: stroke[0][0],
      y: stroke[0][1],
      points: stroke.map(([px, py]) => [px - stroke[0][0], py - stroke[0][1]]),
      strokeColor: ink,
      strokeWidth: 2,
      roughness: 1,
    });
  }

  // Negation: struck through. The concept stays visible — the speaker said it,
  // and cancelling something the viewer already saw is itself the meaning.
  if (sign.negated) {
    skeleton.push({
      type: "line",
      x: sx(6),
      y: sy(88),
      points: [
        [0, 0],
        [((94 - 6) / 100) * size, ((12 - 88) / 100) * size],
      ],
      strokeColor: CHARGE_STROKE.problem,
      strokeWidth: 3,
      roughness: 2,
    });
  }

  return skeleton;
}

/**
 * @param nodeId Stable id from the concept, so a sign keeps its identity (and
 *               its arrow bindings) across re-draws — same contract as
 *               buildConceptNode's caller-supplied id.
 * @param cx,cy  Centre of the sign, not its top-left: signs vary in size with
 *               emphasis, and layout positions them by centre so a growing
 *               sign expands around its place instead of shoving neighbours.
 */
export async function buildSign(
  nodeId: string,
  sign: VisualSign,
  cx: number,
  cy: number,
): Promise<BuiltSign | null> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const { size } = signGeometry(sign);
  const elements = convertToExcalidrawElements(
    signSkeleton(nodeId, sign, cx, cy) as never,
  ) as unknown as SceneElement[];
  const anchor = elements.find((el) => el.type === "rectangle");
  if (!anchor) return null;
  return { elements, nodeId: anchor.id, w: size, h: size };
}

/** Motion cues live in a gutter to the right of / below the glyph box. */
function motionCue(motion: VisualSign["motion"], x0: number, y0: number, size: number): number[][][] {
  const gx = x0 + size + size * 0.12;
  const cy = y0 + size / 2;
  const s = size * 0.28;
  switch (motion) {
    case "rise":
      return [
        [[gx, cy + s], [gx + s * 0.6, cy - s]],
        [[gx + s * 0.2, cy - s * 0.6], [gx + s * 0.6, cy - s], [gx + s * 0.75, cy - s * 0.35]],
      ];
    case "fall":
      return [
        [[gx, cy - s], [gx + s * 0.6, cy + s]],
        [[gx + s * 0.2, cy + s * 0.6], [gx + s * 0.6, cy + s], [gx + s * 0.75, cy + s * 0.35]],
      ];
    case "exit":
      return [
        [[gx, cy], [gx + s, cy]],
        [[gx + s * 0.65, cy - s * 0.3], [gx + s, cy], [gx + s * 0.65, cy + s * 0.3]],
      ];
    case "loop":
      return [
        [
          [gx, cy - s * 0.5],
          [gx + s * 0.7, cy - s * 0.7],
          [gx + s, cy],
          [gx + s * 0.7, cy + s * 0.7],
          [gx, cy + s * 0.5],
        ],
      ];
    case "still":
    default:
      return [];
  }
}
