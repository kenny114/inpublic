/**
 * Shared, deterministic fixtures for the browser smoke suite. No model call,
 * no Deepgram connection — every test drives the board through
 * `window.inpublic.express({ delta })`, which skips meaning extraction
 * entirely (lib/expression/entry.ts) and goes straight into the world fold.
 */
export const SMOKE_DELTA_A = {
  entities: [
    { id: "a", type: "concept", label: "Coffee" },
    { id: "b", type: "concept", label: "Sleep" },
  ],
  relations: [{ id: "r1", source: "a", type: "prevents", target: "b" }],
  claims: [],
  interpretation: "Coffee prevents sleep.",
};

/**
 * A continuation of SMOKE_DELTA_A's own topic (same entity ids reused, one
 * new entity added), not an unrelated topic shift — the engine is allowed to
 * demote or drop an unrelated prior topic (composition/plan.ts's occupancy
 * cap), so testing "the board is never wiped" needs a same-topic extension,
 * matching the real corpus's own "incremental expression: the board extends,
 * it does not redraw" case.
 */
export const SMOKE_DELTA_B = {
  entities: [
    { id: "a", type: "concept", label: "Coffee" },
    { id: "b", type: "concept", label: "Sleep" },
    { id: "e", type: "concept", label: "Focus" },
  ],
  relations: [{ id: "r2", source: "a", type: "enables", target: "e" }],
  claims: [],
  interpretation: "Coffee also enables focus.",
};

declare global {
  interface SmokeCanvasObservation {
    elements: Array<{
      id: string;
      type: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    selection: { elementIds: string[]; groupIds: string[] };
    viewport: { scrollX: number; scrollY: number; zoom: number; width: number; height: number };
    revisions: { scene: string; selection: string; viewport: string };
  }

  interface Window {
    inpublic: {
      express(request: { delta?: unknown; text?: string }): Promise<{
        status: string;
        objects?: number;
        connectors?: number;
        error?: string;
      } | null>;
      undo(): void;
      clear(): void;
      elements(): Array<{ id: string; isDeleted?: boolean }>;
      observe(): SmokeCanvasObservation | null;
    };
  }
}
