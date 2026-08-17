/**
 * Natural Speech Corpus V1 evidence helpers.
 *
 * Everything here is post-hoc: it converts development/session logs into a
 * research record. Nothing in this module is imported by candidate gates,
 * grounding, rendering, placement, or commit policy.
 */
import type { SceneElement } from "./scene";
import type { LogEvent } from "./types";
import { PAGE_H, PAGE_W, pageOrigin } from "./ops";

export type ExistingVisualFamily =
  | "enumeration"
  | "quantitative_change"
  | "sequence"
  | "cause_effect"
  | "comparison";

export type CorpusRecordingKind = "natural" | "synthetic";

export interface SettledThoughtEvidence {
  thoughtId: string;
  text: string;
  sourceSegments: string[];
  startedAtMs: number;
  settledAtMs: number;
  pageId: number;
  sessionId: string;
  sessionGeneration: number;
  sourceRegion: { audioStartMs: number; audioEndMs: number } | null;
  outcome: ExistingVisualFamily | "no_candidate" | "not_evaluated";
  outcomeReason: string | null;
  pendingEvidence: boolean;
}

export interface VisualSourceEvidence {
  sourceId: string;
  participantThoughtIds: string[];
  combinedLiteralSource: string;
  family: ExistingVisualFamily | null;
  candidateOutcome: "accepted" | "rejected";
  ownershipReason: string | null;
  decisionSource: "deterministic_fast_path" | "model_fallback" | null;
  groundingResult: "passed" | "failed" | "not_attempted";
  commitResult: "quiet_committed" | "committed" | "held" | "expired" | "not_attempted";
}

export interface CorpusSceneEvidence {
  type: "excalidraw";
  version: 2;
  source: "inpublic-corpus-v1";
  pageCount: number;
  currentPage: number;
  elements: SceneElement[];
  appState: { viewBackgroundColor: "#ffffff"; gridSize: null };
  files: Record<string, never>;
}

export interface CorpusManifestEntry {
  sessionId: string;
  date: string;
  durationMs: number;
  kind: CorpusRecordingKind;
  topicDescription: string;
  audioArtifact: string | null;
  audioReference: string;
  transcriptArtifact: string | null;
  thoughtArtifact: string | null;
  sceneArtifact: string | null;
  screenshots: string[];
  telemetryArtifact: string | null;
  notes?: string[];
}

type VrEvent = Extract<LogEvent, { type: "visual-reentry" }>;
type ThoughtEvent = Extract<LogEvent, { type: "settled-thought" }>;

function sourceThoughtIds(event: VrEvent): string[] {
  if (event.participantThoughtIds?.length) return [...event.participantThoughtIds];
  const id = event.thoughtId ?? "unknown";
  if (!id.startsWith("evidence:")) return [id];
  return id.slice("evidence:".length).split("+").filter(Boolean);
}

function sourceEvents(events: VrEvent[], sourceId: string): VrEvent[] {
  return events.filter((event) => event.thoughtId === sourceId);
}

export function buildCorpusEvidence(events: LogEvent[]): {
  settledThoughts: SettledThoughtEvidence[];
  visualSources: VisualSourceEvidence[];
} {
  const thoughts = events.filter((event): event is ThoughtEvent => event.type === "settled-thought");
  const vr = events.filter((event): event is VrEvent => event.type === "visual-reentry");
  const candidates = vr.filter((event) => event.event === "candidate-accepted" || event.event === "candidate-rejected");

  const visualSources = candidates.map((candidate): VisualSourceEvidence => {
    const sameSource = sourceEvents(vr, candidate.thoughtId ?? "unknown");
    const grounding = sameSource.find((event) => event.event === "grounding-passed" || event.event === "grounding-failed");
    const quiet = sameSource.some((event) => event.event === "durable-result-quiet-committed");
    const committed = sameSource.some((event) => event.event === "durable-result-committed");
    const held = sameSource.some((event) => event.event === "durable-result-held");
    const expired = sameSource.some((event) => event.event === "durable-result-expired");
    const decision = sameSource.find((event) => event.decisionSource !== undefined);
    return {
      sourceId: candidate.thoughtId ?? "unknown",
      participantThoughtIds: sourceThoughtIds(candidate),
      combinedLiteralSource: candidate.sourceText ?? candidate.sourceExcerpt ?? "",
      family: candidate.visualFamily ?? null,
      candidateOutcome: candidate.event === "candidate-accepted" ? "accepted" : "rejected",
      ownershipReason: candidate.reason ?? null,
      decisionSource: decision?.decisionSource ?? null,
      groundingResult: grounding?.event === "grounding-passed" ? "passed" : grounding?.event === "grounding-failed" ? "failed" : "not_attempted",
      commitResult: quiet ? "quiet_committed" : committed ? "committed" : expired ? "expired" : held ? "held" : "not_attempted",
    };
  });

  const settledThoughts = thoughts.map((thought): SettledThoughtEvidence => {
    const owned = visualSources.find((source) => source.candidateOutcome === "accepted" && source.participantThoughtIds.includes(thought.thoughtId));
    const rejected = visualSources.find((source) => source.candidateOutcome === "rejected" && source.participantThoughtIds.includes(thought.thoughtId));
    const held = vr.find((event) => event.event === "evidence-held" && event.thoughtId === thought.thoughtId);
    const evaluated = owned ?? rejected;
    return {
      thoughtId: thought.thoughtId,
      text: thought.text,
      sourceSegments: [...thought.sourceSegments],
      startedAtMs: thought.startedAtMs,
      settledAtMs: thought.settledAtMs,
      pageId: thought.pageId,
      sessionId: thought.sessionId,
      sessionGeneration: thought.sessionGeneration,
      sourceRegion: thought.sourceRegion ? { ...thought.sourceRegion } : null,
      outcome: owned?.family ?? (rejected || held ? "no_candidate" : "not_evaluated"),
      outcomeReason: evaluated?.ownershipReason ?? held?.reason ?? null,
      pendingEvidence: Boolean(held && !owned),
    };
  });

  return { settledThoughts, visualSources };
}

export function buildCorpusScene(
  elements: SceneElement[],
  currentPage: number,
): CorpusSceneEvidence {
  return {
    type: "excalidraw",
    version: 2,
    source: "inpublic-corpus-v1",
    pageCount: Math.max(1, currentPage + 1),
    currentPage,
    elements: elements.map((element) => ({ ...element })),
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    files: {},
  };
}

function intersectsPage(element: SceneElement, pageIndex: number): boolean {
  const origin = pageOrigin(pageIndex);
  const right = element.x + Math.max(0, Number(element.width ?? 0));
  const bottom = element.y + Math.max(0, Number(element.height ?? 0));
  return right >= origin.x && element.x <= origin.x + PAGE_W && bottom >= origin.y && element.y <= origin.y + PAGE_H;
}

/**
 * Renders immutable corpus screenshots from a retained scene. The synthetic
 * page rectangle exists only in the exported image so every page keeps a
 * stable 1040×780 review frame; it never reaches the live canvas.
 */
export async function renderCorpusScreenshots(scene: CorpusSceneEvidence): Promise<Array<{ name: string; blob: Blob }>> {
  const { convertToExcalidrawElements, exportToBlob } = await import("@excalidraw/excalidraw");
  const pageBoundary = (pageIndex: number) => {
    const origin = pageOrigin(pageIndex);
    return convertToExcalidrawElements([{
      type: "rectangle",
      x: origin.x,
      y: origin.y,
      width: PAGE_W,
      height: PAGE_H,
      strokeColor: "transparent",
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
    }] as never) as unknown as SceneElement[];
  };
  const render = (elements: SceneElement[]) => exportToBlob({
    elements: elements as never,
    appState: { exportBackground: true, viewBackgroundColor: "#ffffff" } as never,
    files: null,
    mimeType: "image/png",
    exportPadding: 0,
  });

  const results: Array<{ name: string; blob: Blob }> = [];
  const fullElements = Array.from({ length: scene.pageCount }, (_, pageIndex) => pageBoundary(pageIndex)).flat();
  results.push({ name: "full-board.png", blob: await render([...fullElements, ...scene.elements]) });
  for (let pageIndex = 0; pageIndex < scene.pageCount; pageIndex += 1) {
    const elements = scene.elements.filter((element) => intersectsPage(element, pageIndex));
    results.push({ name: `page-${String(pageIndex + 1).padStart(2, "0")}.png`, blob: await render([...pageBoundary(pageIndex), ...elements]) });
  }
  return results;
}
