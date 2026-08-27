import type {
  AgentPresenceGesture,
  AgentPresenceState,
  CanvasPresenceController,
  CanvasPresenceGeometry,
  CanvasPresenceResolver,
  CanvasPresenceSnapshot,
} from "./types";

export const AGENT_POINTER_TRAVEL_MS = 220;
export const AGENT_ACTING_HOLD_MS = 650;
export const AGENT_HIGHLIGHT_MS = 900;
export const AGENT_HUMAN_SUPPRESSION_MS = 900;

interface ControllerOptions {
  resolve: CanvasPresenceResolver;
  now?: () => number;
}

const IDLE: AgentPresenceState = { status: "idle", gesture: "none" };

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function createCanvasPresenceController(options: ControllerOptions): CanvasPresenceController {
  const now = options.now ?? (() => performance.now());
  const listeners = new Set<() => void>();
  let requested: AgentPresenceState = IDLE;
  let displayedStatus: AgentPresenceState["status"] = "idle";
  let target: CanvasPresenceGeometry | null = null;
  let travelFrom: CanvasPresenceGeometry["point"] | null = null;
  let travelTo: CanvasPresenceGeometry["point"] | null = null;
  let travelStartedAt = 0;
  let actingUntil = 0;
  let highlightUntil = 0;
  let suppressedUntil = 0;
  let reducedMotion = false;
  let revision = 0;

  const emit = () => {
    revision += 1;
    for (const listener of listeners) listener();
  };

  const update = (time: number, notify: boolean): void => {
    const before = JSON.stringify(snapshot(time));
    if (displayedStatus === "acting" && requested.status !== "idle" && time >= actingUntil) {
      displayedStatus = requested.status;
    }
    if (travelTo && target) {
      const amount = reducedMotion ? 1 : Math.min(1, Math.max(0, (time - travelStartedAt) / AGENT_POINTER_TRAVEL_MS));
      const from = travelFrom ?? travelTo;
      target = { ...target, point: { x: lerp(from.x, travelTo.x, amount), y: lerp(from.y, travelTo.y, amount) } };
      if (amount >= 1) {
        travelFrom = null;
        travelTo = null;
      }
    }
    if (highlightUntil && time >= highlightUntil) highlightUntil = 0;
    if (notify && before !== JSON.stringify(snapshot(time))) emit();
  };

  const snapshot = (time = now()): CanvasPresenceSnapshot => {
    const suppressed = time < suppressedUntil;
    const gesture: AgentPresenceGesture = suppressed || !target
      ? "none"
      : highlightUntil > time
        ? "highlight"
        : requested.gesture === "pointer" || requested.gesture === "highlight"
          ? "pointer"
          : "none";
    return {
      status: displayedStatus,
      gesture,
      // Human activity suppresses only gestures; the passive status chip can
      // remain visible and keeps the overlay clock alive until suppression expires.
      visible: displayedStatus !== "idle",
      suppressed,
      target: suppressed ? null : target,
      revision,
    };
  };

  return {
    setState(state) {
      const time = now();
      requested = { ...state, gesture: state.gesture ?? "none" };
      if (state.status === "idle") {
        displayedStatus = "idle";
        target = null;
        travelFrom = null;
        travelTo = null;
        highlightUntil = 0;
        actingUntil = 0;
        emit();
        return;
      }
      if (state.status === "acting") {
        displayedStatus = "acting";
        actingUntil = time + AGENT_ACTING_HOLD_MS;
      } else if (!(displayedStatus === "acting" && time < actingUntil)) {
        displayedStatus = state.status;
      }
      if (state.target) {
        const resolved = options.resolve(state.target);
        if (resolved) {
          travelFrom = target?.point ?? resolved.point;
          travelTo = resolved.point;
          travelStartedAt = time;
          target = { ...resolved, point: { ...travelFrom } };
          if (state.gesture === "highlight") highlightUntil = time + AGENT_HIGHLIGHT_MS;
        }
      }
      update(time, false);
      emit();
    },
    clear() {
      requested = IDLE;
      displayedStatus = "idle";
      target = null;
      travelFrom = null;
      travelTo = null;
      highlightUntil = 0;
      actingUntil = 0;
      emit();
    },
    getSnapshot() {
      update(now(), false);
      return snapshot();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    noteHumanInteraction() {
      suppressedUntil = now() + AGENT_HUMAN_SUPPRESSION_MS;
      travelFrom = null;
      travelTo = null;
      emit();
    },
    setReducedMotion(reduced) {
      reducedMotion = reduced;
      if (reduced && travelTo && target) {
        target = { ...target, point: travelTo };
        travelFrom = null;
        travelTo = null;
      }
      emit();
    },
    tick(time = now()) {
      update(time, true);
    },
  };
}
