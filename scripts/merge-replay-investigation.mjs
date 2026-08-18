import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [cleanPath, reconnectPath, outputPath] = process.argv.slice(2);
if (!cleanPath || !reconnectPath || !outputPath) {
  throw new Error("usage: node scripts/merge-replay-investigation.mjs <clean.json> <reconnect.json> <output.json>");
}

const clean = JSON.parse(await readFile(resolve(cleanPath), "utf8"));
const reconnect = JSON.parse(await readFile(resolve(reconnectPath), "utf8"));
const runs = [...clean.runs.slice(0, 5), ...reconnect.runs];

const percentile = (values, quantile) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]);
};

for (const run of runs) {
  let latestProviderConfirmedAudioMs = null;
  for (const response of run.audio.diagnostics.providerResponses) {
    if (response.globalRegionEndMs !== null) {
      latestProviderConfirmedAudioMs = Math.max(latestProviderConfirmedAudioMs ?? -Infinity, response.globalRegionEndMs);
    }
    response.latestProviderConfirmedAudioMs = latestProviderConfirmedAudioMs;
    response.audioLiveEdgeLagMs = response.latestAudioSentMs !== null && latestProviderConfirmedAudioMs !== null
      ? Math.max(0, response.latestAudioSentMs - latestProviderConfirmedAudioMs)
      : null;
  }
  const edge = run.audio.diagnostics.providerResponses.flatMap((response) =>
    response.audioLiveEdgeLagMs === null ? [] : [response.audioLiveEdgeLagMs]);
  run.audio.diagnostics.summary.audioLiveEdgeLagP50 = percentile(edge, .5);
  run.audio.diagnostics.summary.audioLiveEdgeLagP95 = percentile(edge, .95);
  run.audio.diagnostics.summary.audioLiveEdgeLagMax = edge.length ? Math.round(Math.max(...edge)) : null;
}

const payload = {
  title: "InPublic Speech Tail-Latency Investigation",
  generatedAt: new Date().toISOString(),
  audio: runs[0]?.audio ?? null,
  validRunCount: runs.length,
  cleanRunCount: 5,
  reconnectRunCount: 2,
  runs,
};

const resolvedOutput = resolve(outputPath);
await mkdir(dirname(resolvedOutput), { recursive: true });
await writeFile(resolvedOutput, JSON.stringify(payload, null, 2));

const mdPath = resolvedOutput.replace(/\.json$/i, ".md");
const csvPath = resolvedOutput.replace(/\.json$/i, ".csv");
const lines = [
  "# InPublic Speech Tail-Latency Investigation",
  "",
  `Audio: ${runs[0]?.audio.name ?? "unknown"} (${((runs[0]?.audio.durationMs ?? 0) / 1000).toFixed(2)}s)`,
  "",
  "| RUN | PLAN | INTERIM P50/P95 | GROUNDED REGION P50/P95/MAX | LIVE EDGE P50/P95/MAX | SEND LAG P50/P95/MAX | BUFFER MAX | RECONNECTS |",
  "|---|---|---:|---:|---:|---:|---:|---:|",
];
runs.forEach((run, index) => {
  const summary = run.audio.diagnostics.summary;
  const plan = run.audio.diagnostics.disconnectPlan.atAudioMs.length
    ? run.audio.diagnostics.disconnectPlan.atAudioMs.map((value) => `${value / 1000}s`).join(",")
    : "clean";
  lines.push(`| ${index + 1} | ${plan} | ${run.latency.interimLagP50}/${run.latency.interimLagP95} | ${summary.providerRegionLagP50}/${summary.providerRegionLagP95}/${summary.providerRegionLagMax} | ${summary.audioLiveEdgeLagP50}/${summary.audioLiveEdgeLagP95}/${summary.audioLiveEdgeLagMax} | ${summary.sendLagP50}/${summary.sendLagP95}/${summary.sendLagMax} | ${summary.bufferedAmountMax} | ${summary.reconnectCount} |`);
});
await writeFile(mdPath, `${lines.join("\n")}\n`);

const csvRows = [["run", "plan", "response", "receivedAtMs", "socketGeneration", "globalRegionEndMs", "latestProviderConfirmedAudioMs", "providerRegionLagMs", "audioLiveEdgeLagMs", "legacyLatestChunkToMessageMs", "isFinal", "speechFinal"]];
runs.forEach((run, runIndex) => run.audio.diagnostics.providerResponses.forEach((response) => csvRows.push([
  runIndex + 1,
  run.audio.diagnostics.disconnectPlan.atAudioMs.join(";"),
  response.responseSequence,
  Math.round(response.receivedAtMs),
  response.socketGeneration,
  response.globalRegionEndMs ?? "",
  response.latestProviderConfirmedAudioMs ?? "",
  response.providerRegionLagMs === null ? "" : Math.round(response.providerRegionLagMs),
  response.audioLiveEdgeLagMs === null ? "" : Math.round(response.audioLiveEdgeLagMs),
  response.legacyLatestChunkToMessageMs ?? "",
  response.isFinal,
  response.speechFinal,
])));
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
await writeFile(csvPath, csvRows.map((row) => row.map(quote).join(",")).join("\n"));

console.log(JSON.stringify({ json: resolvedOutput, markdown: mdPath, csv: csvPath, runs: runs.length }));
