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
      text?: string;
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
      act(action: unknown): Promise<{
        status: "applied" | "noop" | "rejected";
        category: string;
        reason: string;
        before: { scene: { objects: Array<{ id: string; entityId?: string }> } };
        after: {
          world: { entities: Array<{ id: string; label: string }>; relations: Array<{ id: string }> };
          observation: SmokeCanvasObservation | null;
        };
      }>;
      runVisualAgent(instruction: string, options?: { maxSteps?: number; decisions?: unknown[]; decisionDelayMs?: number }): Promise<{
        status: "completed" | "blocked" | "step_limit" | "stalled" | "cancelled";
        steps: number;
        reason?: string;
        trace: {
          presence: Array<{
            step: number;
            phase: string;
            atMs: number;
            state: { status: string; target?: { entityId: string }; gesture?: string };
            outcome?: string;
          }>;
          steps: Array<{
            observed: { world: string; expressionScene: string; scene: string; selection: string; viewport: string };
            decision: { type: string };
            actionResult?: {
              status: "applied" | "noop" | "rejected";
              changed: { world: boolean; expressionScene: boolean; canvasScene: boolean; selection: boolean; viewport: boolean };
            };
            resulting?: { world: string; expressionScene: string; scene: string; selection: string; viewport: string };
          }>;
        };
        final: {
          world: { entities: Array<{ id: string; label: string }> };
          canvas: SmokeCanvasObservation;
        };
      }>;
      interact(text: string, options?: { meaning?: unknown; maxSteps?: number; decisions?: unknown[]; decisionDelayMs?: number }): Promise<{
        status: "completed" | "cancelled" | "failed";
        intent: "express" | "manipulate" | "present" | "ignore";
        reason?: string;
        trace: {
          status: "routed" | "running" | "completed" | "cancelled" | "failed";
          routingReason: string;
          agentStatus?: string;
          metrics: {
            speechFinalToRouteMs: number;
            speechFinalToFirstVisualChangeMs?: number;
            expressRouteToFirstVisualChangeMs?: number;
            agentRouteToFirstDecisionMs?: number;
            agentDecisionToActionResultMs?: number;
            agentActionToReobservationMs?: number;
            totalAgentRunMs?: number;
            routingModelCalls: 0;
            modelCalls: number;
            agentSteps: number;
          };
        };
      }>;
      interactionLast(): {
        intent: string;
        status: string;
        metrics: {
          speechFinalToFirstVisualChangeMs?: number;
          routingModelCalls: 0;
          modelCalls: number;
          agentSteps: number;
        };
      } | null;
      interactionTraces(): Array<{ intent: string; status: string }>;
      agentLastRun(): { status: string; steps: number } | null;
      agentPresence(): {
        status: string;
        gesture: string;
        visible: boolean;
        suppressed: boolean;
        target: null | {
          entityId: string;
          elementIds: string[];
          point: { x: number; y: number };
          bounds: { x: number; y: number; width: number; height: number };
        };
      };
      observe(): SmokeCanvasObservation | null;
      expressionState(): {
        version: number;
        world: {
          entities: Array<{ id: string; label: string; description?: string }>;
          relations: Array<{ id: string; source: string; target: string; type: string }>;
          claims: Array<{ id: string; text: string }>;
          salience: string[];
          seq: number;
        };
      } | null;
    };
    __agentPresenceRun?: ReturnType<Window["inpublic"]["runVisualAgent"]>;
  }
}
