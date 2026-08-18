import fs from "node:fs";
import path from "node:path";
import { CORPUS } from "./corpus.ts";
import { analyzeThought } from "./analyze.ts";
import { EMPTY_PRESENTATION_THOUGHT, flushPresentationThought, pushPresentationSegment } from "../../lib/liveSpeech.ts";
import { advanceVisualEvidence } from "../../lib/visualReentry/evidence.ts";
import { tryDeterministicVisualIntent } from "../../lib/visualReentry/fastPath.ts";

const ROOT = process.cwd();
const RESULT_DIR = path.join(ROOT, "experiments", "universal-visual-grammar-v1", "results");
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac"]);

function relative(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function walkAudio(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ["node_modules", ".git", ".next"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walkAudio(target, found);
    else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) found.push(target);
  }
  return found;
}

function wavDurationMs(file) {
  if (path.extname(file).toLowerCase() !== ".wav") return null;
  const buffer = fs.readFileSync(file);
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt " && size >= 16) byteRate = buffer.readUInt32LE(offset + 16);
    if (id === "data") { dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  return byteRate && dataSize ? Math.round((dataSize / byteRate) * 1000) : null;
}

function inventoryAudio() {
  const selected = new Map(CORPUS.map((item) => [item.audioPath.replaceAll("\\", "/"), item]));
  return walkAudio(ROOT).sort().map((file) => {
    const filePath = relative(file);
    const corpus = selected.get(filePath);
    let exclusionReason = null;
    if (!corpus && filePath.startsWith("scripts/stt/audio/")) exclusionReason = "Short STT pronunciation/domain fixture; too narrow for meaning-graph evaluation.";
    else if (!corpus && /comparison-capability(?:-final)?\.wav$/.test(filePath)) exclusionReason = "Duplicate/superseded comparison recording; proof fixture selected instead.";
    else if (!corpus && filePath.endsWith("/video.webm")) exclusionReason = "Derived video duplicates the selected Demo Studio source audio.";
    else if (!corpus) exclusionReason = "Not selected after diversity and retained-transcript review.";
    return {
      path: filePath,
      bytes: fs.statSync(file).size,
      durationMs: corpus?.durationMs ?? wavDurationMs(file),
      selected: Boolean(corpus),
      recordingId: corpus?.id ?? null,
      transcriptSource: corpus ? corpus.sessionPath ?? corpus.transcriptPath ?? "retained script in lib/demos.ts / corpus manifest" : null,
      exclusionReason,
    };
  });
}

function recreateThoughts(entry, transcript) {
  // The timestamp is used only to keep a deterministic evidence window. Three
  // legacy public demos have no retained duration sidecar, so use a clearly
  // synthetic text-length clock rather than fabricating a media duration.
  const analysisClockMs = entry.durationMs ?? Math.max(1, transcript.split(/\s+/).length * 400);
  const pushed = pushPresentationSegment(EMPTY_PRESENTATION_THOUGHT, transcript, analysisClockMs);
  const flushed = flushPresentationThought(pushed.state, analysisClockMs);
  const emissions = [...pushed.thoughts, ...flushed.thoughts];
  const count = Math.max(1, emissions.length);
  return emissions.map((emission, index) => ({
    id: `${entry.id}:recreated:${index + 1}`,
    text: emission.text,
    sourceSegments: emission.rawSegments,
    page: 0,
    startedAt: Math.round((analysisClockMs * index) / count),
    settledAt: Math.round((analysisClockMs * (index + 1)) / count),
    boundaryReason: emission.reason,
  }));
}

function loadEntry(entry) {
  if (!fs.existsSync(path.join(ROOT, entry.audioPath))) throw new Error(`Missing selected audio: ${entry.audioPath}`);
  const transcript = entry.transcriptPath
    ? fs.readFileSync(path.join(ROOT, entry.transcriptPath), "utf8").trim()
    : entry.transcript.trim();
  if (entry.thoughtSource === "retained_settled_thoughts") {
    const session = JSON.parse(fs.readFileSync(path.join(ROOT, entry.sessionPath), "utf8"));
    return {
      transcript,
      thoughts: session.settledThoughts.map((thought, index) => ({
        id: thought.thoughtId ?? `${entry.id}:retained:${index + 1}`,
        text: thought.text,
        sourceSegments: thought.sourceSegments ?? [thought.text],
        page: thought.pageId ?? 0,
        startedAt: thought.startedAtMs,
        settledAt: thought.settledAtMs,
        sourceRegion: thought.sourceRegion,
        retainedOutcome: thought.outcome,
        retainedOutcomeReason: thought.outcomeReason,
      })),
    };
  }
  return { transcript, thoughts: recreateThoughts(entry, transcript) };
}

function currentLane(thoughts) {
  let evidence = [];
  return thoughts.map((thought) => {
    const decision = advanceVisualEvidence(evidence, thought);
    evidence = decision.next;
    if (decision.status === "pending") {
      return { status: "pending", family: decision.family, reason: decision.reason };
    }
    if (decision.status === "rejected" || !decision.candidate) {
      return { status: "text_only", family: decision.family, reason: decision.reason };
    }
    const fast = tryDeterministicVisualIntent(decision.candidate);
    if (fast.intent) {
      return { status: "visual", family: fast.intent.type, reason: fast.reason, visualIntent: fast.intent };
    }
    return { status: "model_fallback_unexecuted", family: decision.family, reason: fast.reason };
  });
}

function experimentalLane(thoughts) {
  const results = [];
  for (let index = 0; index < thoughts.length; index += 1) {
    const thought = thoughts[index];
    const continuation = /^(?:then|next|after that|finally|once|option\s+b|and\s+that)\b/i.test(thought.text.trim());
    const priorComparison = index > 0 && /\boption\s+a\b/i.test(thoughts[index - 1].text) && /\boption\s+b\b/i.test(thought.text);
    const priorCausal = index > 0 && /^and\s+that\b/i.test(thought.text.trim());
    const context = (continuation || priorComparison || priorCausal) && index > 0 ? [thoughts[index - 1]] : [];
    const analysisText = [...context, thought].map((item) => item.text).join(" ");
    results.push({ analysisText, contextThoughtIds: context.map((item) => item.id), ...analyzeThought(analysisText) });
  }
  return results;
}

const audioInventory = inventoryAudio();
const recordings = [];
const thoughts = [];
for (const entry of CORPUS) {
  const loaded = loadEntry(entry);
  const current = currentLane(loaded.thoughts);
  const experimental = experimentalLane(loaded.thoughts);
  const start = thoughts.length;
  for (const [index, thought] of loaded.thoughts.entries()) {
    thoughts.push({
      recordingId: entry.id,
      thoughtId: thought.id,
      text: thought.text,
      sourceSegments: thought.sourceSegments,
      boundary: {
        source: entry.thoughtSource,
        reason: thought.boundaryReason ?? null,
        retainedOutcome: thought.retainedOutcome ?? null,
      },
      current: current[index],
      experimental: experimental[index],
    });
  }
  const subset = thoughts.slice(start);
  recordings.push({
    ...entry,
    transcript: loaded.transcript,
    thoughtCount: loaded.thoughts.length,
    currentVisualCount: subset.filter((item) => item.current.status === "visual").length,
    currentFallbackCount: subset.filter((item) => item.current.status === "model_fallback_unexecuted").length,
    experimentalEligibleCount: subset.filter((item) => item.experimental.plan.eligible).length,
  });
}

const currentVisual = thoughts.filter((item) => item.current.status === "visual").length;
const currentFallback = thoughts.filter((item) => item.current.status === "model_fallback_unexecuted").length;
const experimentalEligible = thoughts.filter((item) => item.experimental.plan.eligible).length;
const newlyEligible = thoughts.filter((item) => item.experimental.plan.eligible && item.current.status !== "visual" && item.current.status !== "model_fallback_unexecuted").length;
const familyCounts = Object.fromEntries([...new Set(thoughts.map((item) => item.experimental.plan.family))].sort().map((family) => [family, thoughts.filter((item) => item.experimental.plan.family === family).length]));
const nodeCounts = Object.fromEntries([...new Set(thoughts.flatMap((item) => item.experimental.graph.nodes.map((node) => node.kind)))].sort().map((kind) => [kind, thoughts.flatMap((item) => item.experimental.graph.nodes).filter((node) => node.kind === kind).length]));
const edgeCounts = Object.fromEntries([...new Set(thoughts.flatMap((item) => item.experimental.graph.edges.map((edge) => edge.kind)))].sort().map((kind) => [kind, thoughts.flatMap((item) => item.experimental.graph.edges).filter((edge) => edge.kind === kind).length]));
const actionCounts = Object.fromEntries([...new Set(thoughts.flatMap((item) => item.experimental.graph.actions.map((action) => action.kind)))].sort().map((kind) => [kind, thoughts.flatMap((item) => item.experimental.graph.actions).filter((action) => action.kind === kind).length]));

const exampleCandidates = thoughts
  .map((item) => ({
    item,
    score: (item.experimental.plan.eligible ? 5 : 0) + (item.current.status === "visual" ? 2 : 0) + item.experimental.graph.edges.length * 2 + item.experimental.graph.actions.length + item.experimental.graph.ambiguities.length,
  }))
  .sort((a, b) => b.score - a.score);
const examples = [];
const perRecording = new Map();
for (const candidate of exampleCandidates) {
  const used = perRecording.get(candidate.item.recordingId) ?? 0;
  if (used >= 4) continue;
  examples.push(candidate.item);
  perRecording.set(candidate.item.recordingId, used + 1);
  if (examples.length === 24) break;
}

const errorAnalysis = {
  possibleFalsePositives: thoughts.filter((item) => item.experimental.plan.eligible && (item.experimental.plan.confidence < 0.72 || item.experimental.graph.figurative || item.experimental.graph.ambiguities.length > 0)).map((item) => ({ recordingId: item.recordingId, thoughtId: item.thoughtId, text: item.text, reason: item.experimental.plan.unsupported })),
  possibleFalseNegatives: thoughts.filter((item) => !item.experimental.plan.eligible && /\b(?:relationship|structure|flow|inside|above|below|between|part of|belongs to|toward|away|becomes|transform)\b/i.test(item.text)).map((item) => ({ recordingId: item.recordingId, thoughtId: item.thoughtId, text: item.text, reason: "Visual cue present but no sufficiently grounded graph relation was extracted." })),
  notes: [
    "These are rule-based audit queues, not labeled truth sets.",
    "Pronouns and ASR disfluencies can yield under-specified nodes; low-confidence plans must remain shadow-only.",
    "Recreated thoughts use the current boundary policy on retained complete transcripts, not original provider-final timing.",
  ],
};

const result = {
  experiment: "universal-visual-grammar-v1",
  generatedAt: new Date().toISOString(),
  mode: "offline_shadow_no_model_no_render_no_canvas_write",
  corpusSummary: {
    discoveredAudioFiles: audioInventory.length,
    selectedRecordings: recordings.length,
    selectedKnownDurationMs: recordings.reduce((sum, item) => sum + (item.durationMs ?? 0), 0),
    selectedKnownDurationCount: recordings.filter((item) => item.durationMs !== null).length,
    selectedKinds: Object.fromEntries(["natural", "recorded_demo", "focused_fixture"].map((kind) => [kind, recordings.filter((item) => item.kind === kind).length])),
  },
  metrics: {
    settledThoughts: thoughts.length,
    currentVisual,
    currentModelFallbackUnexecuted: currentFallback,
    currentPotentialVisualCoveragePct: Number((((currentVisual + currentFallback) / thoughts.length) * 100).toFixed(1)),
    experimentalEligible,
    experimentalCoveragePct: Number(((experimentalEligible / thoughts.length) * 100).toFixed(1)),
    newlyEligible,
    newlyEligiblePct: Number(((newlyEligible / thoughts.length) * 100).toFixed(1)),
    familyCounts,
    nodeCounts,
    edgeCounts,
    actionCounts,
  },
  reuseReadiness: {
    currentVisualReentry: { grade: "A", use: "Retain as the production baseline and as specialized renderers/gates for its five proven families." },
    legacySemanticBoard: { grade: "B", use: "Reuse concept, relationship, section, and provenance ideas after adaptation to the graph schema; do not revive its live path." },
    organizerAndBoundArrows: { grade: "B", use: "Adapt deterministic placement, bound endpoints, and routing as a renderer substrate behind typed visual plans." },
    directorChoreographer: { grade: "C", use: "Borrow comparison/process heuristics only; legacy state and production timing assumptions are incompatible." },
    storySchemaAndRecipes: { grade: "B", use: "Reuse entity/action/relation/state vocabulary and procedural visual recipes as a specialized literal-scene grammar." },
    storyProductionPath: { grade: "D", use: "Do not reuse for Standard integration; its mutation model and mode contract are out of scope." },
    mathGroundingAndVerification: { grade: "B", use: "Adapt provenance, symbolic validation, and deterministic verification patterns; keep math rendering specialized." },
    freeFormArtistActions: { grade: "D", use: "Reject as the universal contract because free-form mutation weakens grounding and testability." },
  },
  audioInventory,
  recordings,
  thoughts,
  examples,
  errorAnalysis,
};

fs.mkdirSync(RESULT_DIR, { recursive: true });
const resultPath = path.join(RESULT_DIR, "shadow-results.json");
fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ resultPath: relative(resultPath), corpusSummary: result.corpusSummary, metrics: result.metrics, errors: errorAnalysis }, null, 2));
