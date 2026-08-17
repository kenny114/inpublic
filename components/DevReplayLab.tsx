"use client";

import { useEffect, useMemo, useState } from "react";
import {
  REPLAY_MODES,
  buildReplayComparison,
  formatHumanReplayReport,
  type ReplayDisconnectPlan,
  type ReplayExperimentMode,
  type ReplayRunReport,
} from "@/lib/replayLab";
import { renderCorpusScreenshots, type CorpusRecordingKind, type CorpusManifestEntry } from "@/lib/corpus";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function jsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
}

export function DevReplayLab({
  run,
}: {
  run: (mode: ReplayExperimentMode, file: File, round: number, disconnectPlan?: ReplayDisconnectPlan) => Promise<ReplayRunReport>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [rounds, setRounds] = useState(3);
  const [runs, setRuns] = useState<ReplayRunReport[]>([]);
  const [status, setStatus] = useState("Choose the prerecorded voice note.");
  const [running, setRunning] = useState(false);
  const [corpusKind, setCorpusKind] = useState<CorpusRecordingKind>("synthetic");
  const [topicDescription, setTopicDescription] = useState("");
  const [corpusStatus, setCorpusStatus] = useState("");
  const comparison = useMemo(() => buildReplayComparison(runs), [runs]);
  const cameraValidation = useMemo(() => {
    const latest = runs.at(-1);
    if (!latest) return null;
    const events = latest.events;
    const coalesced = events.filter((event) => event.type === "camera-page-arrival-coalesced");
    const camera = events.filter((event) => event.type === "camera");
    const proposals = events.filter((event) => event.type === "camera-proposal");
    const started = new Set(camera.filter((event) => event.event === "started").map((event) => event.proposalId));
    return {
      session: latest.audio.name,
      durationMs: latest.audio.durationMs,
      pageTurns: events.filter((event) => event.type === "page").length,
      coalesced: coalesced.length,
      starts: camera.filter((event) => event.event === "started").length,
      cancellations: camera.filter((event) => event.event === "cancelled").length,
      completions: camera.filter((event) => event.event === "completed").length,
      pageFakeStarts: coalesced.filter((event) => started.has(event.pageProposalId)).length,
      liveStarts: coalesced.filter((event) => started.has(event.liveProposalId)).length,
      targetDifferences: coalesced.filter((event) => {
        const proposal = proposals.find((candidate) => candidate.eventId === event.liveProposalId);
        return JSON.stringify(event.retainedLiveTarget) !== JSON.stringify(proposal?.recorded.target);
      }).length,
      fitFailures: coalesced.filter((event) => {
        const proposal = proposals.find((candidate) => candidate.eventId === event.liveProposalId);
        return !proposal?.recorded.contentFits || proposal.recorded.webcamCollisions > 0 || proposal.recorded.readabilityViolations.length > 0;
      }).length,
      longTasks: events.filter((event) => event.type === "long-task").length,
      transitions: coalesced.map((event) => ({
        transitionId: event.transitionId,
        pageIndex: event.pageIndex,
        eventCycleId: event.eventCycleId,
        pageProposalId: event.pageProposalId,
        liveProposalId: event.liveProposalId,
      })),
    };
  }, [runs]);

  useEffect(() => {
    const validationWindow = window as Window & { __inpublicReplayValidationRuns?: ReplayRunReport[] };
    validationWindow.__inpublicReplayValidationRuns = runs;
    return () => {
      delete validationWindow.__inpublicReplayValidationRuns;
    };
  }, [runs]);

  const execute = async (modes: readonly ReplayExperimentMode[], roundCount: number, disconnectPlan: ReplayDisconnectPlan = { atAudioMs: [] }) => {
    if (!file || running) return;
    setRunning(true);
    try {
      for (let round = 1; round <= roundCount; round += 1) {
        for (const mode of modes) {
          setStatus(`Running ${mode}, round ${round}/${roundCount}…`);
          const result = await run(mode, file, round, disconnectPlan);
          setRuns((current) => [...current, result]);
          setStatus(`Cooldown after ${mode}…`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
      setStatus("Experiment complete. Export the comparison report.");
    } catch (error) {
      setStatus(`Run failed: ${String((error as Error)?.message ?? error)}`);
    } finally {
      setRunning(false);
    }
  };

  const exportReport = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      audio: runs[0]?.audio ?? null,
      rounds,
      runs,
      comparison,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `inpublic-replay-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    const markdown = new Blob([formatHumanReplayReport(runs)], { type: "text/markdown" });
    const markdownUrl = URL.createObjectURL(markdown);
    const summaryAnchor = document.createElement("a");
    summaryAnchor.href = markdownUrl;
    summaryAnchor.download = `inpublic-replay-${Date.now()}.md`;
    summaryAnchor.click();
    URL.revokeObjectURL(markdownUrl);

    const csvRows = [["run", "mode", "round", "response", "receivedAtMs", "socketGeneration", "globalRegionEndMs", "globalLatestWordEndMs", "latestProviderConfirmedAudioMs", "providerRegionLagMs", "latestWordLagMs", "audioLiveEdgeLagMs", "legacyLatestChunkToMessageMs", "isFinal", "speechFinal"]];
    runs.forEach((item, runIndex) => item.audio.diagnostics.providerResponses.forEach((response) => csvRows.push([
      String(runIndex + 1), item.mode, String(item.round), String(response.responseSequence), String(Math.round(response.receivedAtMs)), String(response.socketGeneration), String(response.globalRegionEndMs ?? ""), String(response.globalLatestWordEndMs ?? ""), String(response.latestProviderConfirmedAudioMs ?? ""), String(response.providerRegionLagMs === null ? "" : Math.round(response.providerRegionLagMs)), String(response.latestWordLagMs === null ? "" : Math.round(response.latestWordLagMs)), String(response.audioLiveEdgeLagMs === null ? "" : Math.round(response.audioLiveEdgeLagMs)), String(response.legacyLatestChunkToMessageMs ?? ""), String(response.isFinal), String(response.speechFinal),
    ])));
    const csv = new Blob([csvRows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const csvUrl = URL.createObjectURL(csv);
    const csvAnchor = document.createElement("a");
    csvAnchor.href = csvUrl;
    csvAnchor.download = `inpublic-replay-${Date.now()}.csv`;
    csvAnchor.click();
    URL.revokeObjectURL(csvUrl);
  };

  const exportCorpusArtifacts = async () => {
    const latest = runs.at(-1);
    if (!latest || !file || running) return;
    if (corpusKind === "natural" && latest.mode !== "vr_full") {
      setCorpusStatus("Natural corpus entries require a vr_full run so existing-family outcomes are present.");
      return;
    }
    if (corpusKind === "natural" && !topicDescription.trim()) {
      setCorpusStatus("Add a neutral description of what the speaker explained.");
      return;
    }
    setCorpusStatus("Rendering corpus artifacts…");
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const base = `inpublic-corpus-${corpusKind}-${stamp}`;
      const extension = file.name.includes(".") ? `.${file.name.split(".").at(-1)}` : "";
      const audioName = `${base}-audio${extension}`;
      const screenshots = await renderCorpusScreenshots(latest.scene);
      const manifest: CorpusManifestEntry = {
        sessionId: latest.latency.sessionId ?? "unknown",
        date: latest.startedAt,
        durationMs: latest.audio.durationMs,
        kind: corpusKind,
        topicDescription: topicDescription.trim() || "Unspecified fixture topic",
        audioArtifact: audioName,
        audioReference: latest.audio.name,
        transcriptArtifact: `${base}-transcript.txt`,
        thoughtArtifact: `${base}-thoughts.json`,
        sceneArtifact: `${base}-scene.excalidraw`,
        screenshots: screenshots.map((item) => `${base}-${item.name}`),
        telemetryArtifact: `${base}-telemetry.json`,
        notes: [
          `Collected with unmodified ${latest.mode} visual behavior.`,
          corpusKind === "synthetic" ? "Excluded from natural-frequency statistics." : "Speaker attested as natural/unprompted for visual grammar.",
        ],
      };
      downloadBlob(file, audioName);
      downloadBlob(jsonBlob(latest), `${base}-session.json`);
      downloadBlob(jsonBlob(latest.scene), `${base}-scene.excalidraw`);
      downloadBlob(jsonBlob(latest.settledThoughts), `${base}-thoughts.json`);
      downloadBlob(new Blob([latest.transcript], { type: "text/plain" }), `${base}-transcript.txt`);
      downloadBlob(jsonBlob({
        audio: latest.audio,
        vr: latest.vr,
        visualSources: latest.visualSources,
        visualLifecycles: latest.visualLifecycles,
        pageTurns: latest.pageTurns,
        events: latest.events,
        latency: latest.latency,
      }), `${base}-telemetry.json`);
      downloadBlob(jsonBlob(manifest), `${base}-manifest-entry.json`);
      for (const screenshot of screenshots) downloadBlob(screenshot.blob, `${base}-${screenshot.name}`);
      setCorpusStatus(`Exported ${latest.settledThoughts.length} thoughts, ${latest.scene.pageCount} page(s), and ${screenshots.length} screenshot(s).`);
    } catch (error) {
      setCorpusStatus(`Corpus export failed: ${String((error as Error)?.message ?? error)}`);
    }
  };

  return (
    <aside data-testid="replay-lab" className="fixed left-4 top-4 z-[100] max-h-[calc(100vh-2rem)] w-[390px] overflow-y-auto rounded-xl border border-amber-400/40 bg-neutral-950/95 p-4 text-xs text-white shadow-2xl">
      <div className="mb-1 text-sm font-semibold text-amber-300">DEV ONLY · Deterministic Voice Replay</div>
      <div className="mb-3 text-white/60">PCM16 · 48 kHz · 80 ms · shared Deepgram stream</div>
      <input
        data-testid="replay-file"
        type="file"
        accept="audio/*,.ogg"
        disabled={running}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        className="mb-3 block w-full text-white/80"
      />
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="replay-rounds">Rounds</label>
        <input id="replay-rounds" data-testid="replay-rounds" type="number" min={1} max={10} value={rounds} disabled={running} onChange={(event) => setRounds(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} className="w-14 rounded bg-white/10 px-2 py-1" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {REPLAY_MODES.map((mode, index) => (
          <button key={mode} disabled={!file || running} data-testid={`run-${mode}`} onClick={() => void execute([mode], 1)} className="rounded bg-white/10 px-2 py-2 disabled:opacity-40">
            Run {String.fromCharCode(65 + index)} · {mode}
          </button>
        ))}
        <button data-testid="run-all" disabled={!file || running} onClick={() => void execute(REPLAY_MODES, rounds)} className="col-span-2 rounded bg-amber-400 px-2 py-2 font-semibold text-black disabled:opacity-40">Run All</button>
        <button data-testid="run-v2-rounds" disabled={!file || running} onClick={() => void execute(["v2_only"], rounds)} className="col-span-2 rounded bg-emerald-400 px-2 py-2 font-semibold text-black disabled:opacity-40">Run V2 × {rounds}</button>
        <button data-testid="run-v2-close-once" disabled={!file || running} onClick={() => void execute(["v2_only"], 1, { atAudioMs: [20_000] })} className="rounded bg-rose-400/80 px-2 py-2 text-black disabled:opacity-40">V2 · close @20s</button>
        <button data-testid="run-v2-close-twice" disabled={!file || running} onClick={() => void execute(["v2_only"], 1, { atAudioMs: [20_000, 40_000] })} className="rounded bg-rose-400/80 px-2 py-2 text-black disabled:opacity-40">V2 · close @20/40s</button>
      </div>
      <div data-testid="replay-status" className="mt-3 rounded bg-white/5 p-2 text-white/75">{status}</div>
      {runs.length > 0 && (
        <div className="mt-3 max-h-36 overflow-auto font-mono text-[10px] text-white/65">
          {runs.map((item, index) => (
            <div key={`${item.mode}-${item.round}-${index}`}>
              {item.mode} r{item.round}: legacy interim {item.latency.interimLagP50 ?? "—"}/{item.latency.interimLagP95 ?? "—"} ms · grounded region {item.audio.diagnostics.summary.providerRegionLagP50 ?? "—"}/{item.audio.diagnostics.summary.providerRegionLagP95 ?? "—"} ms · edge {item.audio.diagnostics.summary.audioLiveEdgeLagP95 ?? "—"} ms · source drift {item.audio.diagnostics.summary.sendLagP95 ?? "—"} ms · rebases {item.audio.diagnostics.summary.rebaseCount} [{item.audio.diagnostics.summary.rebaseReasons.join(",") || "none"}] · intentional {item.audio.diagnostics.summary.intentionalRebaseDelayMs} ms · buffer {item.audio.diagnostics.summary.bufferedAmountMax ?? "—"} B · reconnects {item.audio.diagnostics.summary.reconnectCount}
            </div>
          ))}
        </div>
      )}
      <button data-testid="export-report" disabled={!runs.length || running} onClick={exportReport} className="mt-3 w-full rounded border border-white/15 px-2 py-2 disabled:opacity-40">Export JSON + summary + CSV</button>
      {cameraValidation ? <pre data-testid="camera-page-arrival-validation" className="sr-only">{JSON.stringify(cameraValidation)}</pre> : null}
      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="mb-2 font-semibold text-amber-200">Natural Speech Corpus V1</div>
        <div className="mb-2 grid grid-cols-[88px_1fr] items-center gap-2">
          <label htmlFor="corpus-kind">Recording</label>
          <select id="corpus-kind" data-testid="corpus-kind" value={corpusKind} disabled={running} onChange={(event) => setCorpusKind(event.target.value as CorpusRecordingKind)} className="rounded bg-white/10 px-2 py-1">
            <option value="synthetic">Synthetic fixture</option>
            <option value="natural">Natural talk</option>
          </select>
          <label htmlFor="corpus-topic">Topic</label>
          <input id="corpus-topic" data-testid="corpus-topic" value={topicDescription} disabled={running} onChange={(event) => setTopicDescription(event.target.value)} placeholder="What the speaker explained" className="rounded bg-white/10 px-2 py-1" />
        </div>
        <button data-testid="export-corpus" disabled={!runs.length || !file || running || (corpusKind === "natural" && (runs.at(-1)?.mode !== "vr_full" || !topicDescription.trim()))} onClick={() => void exportCorpusArtifacts()} className="w-full rounded border border-amber-300/30 px-2 py-2 disabled:opacity-40">Export latest run as corpus artifacts</button>
        {corpusStatus ? <div data-testid="corpus-status" className="mt-2 text-[10px] text-white/65">{corpusStatus}</div> : null}
      </div>
    </aside>
  );
}
