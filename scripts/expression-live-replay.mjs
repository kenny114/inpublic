/**
 * Deterministic replay of a captured live session — no API calls.
 *
 * Reads the JSON a developer downloaded via `inpublic.captureDownload()`
 * (browser console, `?v2=1&xe=1&capture=1`; see lib/expression/capture.ts)
 * and feeds each turn's already-sanitized MeaningDelta straight into a fresh
 * ExpressionSession via `ingestDelta`, exactly like the frozen-meeting
 * replay scripts do — model extraction is never repeated, because the
 * capture already holds what extraction produced.
 *
 * The production live path (lib/expression/live.ts) runs with
 * `enableIdentityLayer`/`identityJudge`/`targetJudge` all left at their
 * defaults (off / abstain — see pipeline.ts's SessionOptions doc), so this
 * replay constructs the session the same way. That is what makes it
 * deterministic: nothing here consults a model, a judge, or randomness.
 *
 * What this proves, per turn: feeding the captured (input, delta) pair back
 * through the pipeline reproduces the captured `world`/`plan`/`scene`
 * byte-for-byte. If it doesn't, either the pipeline changed since capture
 * (expected after a real code change — rerun capture) or the capture is
 * missing something replay needs (a bug in capture.ts, worth knowing about
 * immediately rather than after a live session is gone).
 *
 * Usage:
 *   node --no-warnings --import ./scripts/ts-register.mjs \
 *     scripts/expression-live-replay.mjs path/to/expression-capture-*.json [--svg] [--log]
 *
 *   --svg   write an SVG snapshot per turn to <outdir>/turn-XXX.svg
 *   --log   write the full formatTrace() log to <outdir>/replay-log.txt
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { formatTrace } from "../lib/expression/trace.ts";
import { svgRenderer } from "../lib/expression/render/svg.ts";

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith("--"));
const writeSvg = args.includes("--svg");
const writeLog = args.includes("--log");

if (!filePath) {
  console.error("usage: expression-live-replay.mjs path/to/expression-capture-*.json [--svg] [--log]");
  process.exit(1);
}
if (!existsSync(filePath)) {
  console.error(`not found: ${filePath}`);
  process.exit(1);
}

const capture = JSON.parse(readFileSync(filePath, "utf8"));
if (capture.version !== 1) {
  console.error(`unsupported capture version: ${capture.version}`);
  process.exit(1);
}

const OUT_DIR = path.join("scripts/fixtures/.live-replay-out", capture.sessionId ?? "session");
if (writeSvg || writeLog) mkdirSync(OUT_DIR, { recursive: true });

console.log("═".repeat(80));
console.log("LIVE CAPTURE REPLAY (deterministic — no API calls)");
console.log("═".repeat(80));
console.log(`file:       ${filePath}`);
console.log(`sessionId:  ${capture.sessionId}`);
console.log(`startedAt:  ${capture.startedAt}`);
console.log(`turns:      ${capture.turns.length}`);

// Never called: every turn replays via ingestDelta with the captured delta,
// exactly the AI-agent-input path pipeline.ts documents for this purpose.
const session = new ExpressionSession({
  extract: async () => {
    throw new Error("replay must not call extract() — the captured delta should already cover every turn");
  },
});

let mismatches = 0;
let firstWallClock = null;
const logLines = [];

for (const turn of capture.turns) {
  const { trace } = turn;
  if (firstWallClock === null) firstWallClock = turn.wallClockStart;
  const relativeMs = turn.wallClockStart - firstWallClock;

  const replayed = await session.ingestDelta(trace.input, trace.delta);

  const worldMatch = JSON.stringify(replayed.world) === JSON.stringify(trace.world);
  const sceneMatch = JSON.stringify(replayed.scene) === JSON.stringify(trace.scene);
  const planMatch = JSON.stringify(replayed.plan) === JSON.stringify(trace.plan);
  const ok = worldMatch && sceneMatch && planMatch;
  if (!ok) mismatches += 1;

  const mark = ok ? "✓" : "✗ MISMATCH";
  const t = `${Math.floor(relativeMs / 60000)}:${String(Math.floor((relativeMs % 60000) / 1000)).padStart(2, "0")}`;
  const line = `  ${mark}  turn ${String(turn.index).padStart(3)}  @${t}  "${trace.input.text.slice(0, 60)}${trace.input.text.length > 60 ? "…" : ""}"`;
  console.log(line);
  if (!ok) {
    if (!worldMatch) console.log("       world differs from capture");
    if (!planMatch) console.log("       plan differs from capture");
    if (!sceneMatch) console.log("       scene differs from capture");
  }

  if (writeLog) logLines.push(formatTrace(replayed));
  if (writeSvg) {
    writeFileSync(
      path.join(OUT_DIR, `turn-${String(turn.index).padStart(3, "0")}.svg`),
      svgRenderer.render(replayed.scene, replayed.patch),
    );
  }
}

if (writeLog) writeFileSync(path.join(OUT_DIR, "replay-log.txt"), logLines.join("\n\n"));

console.log("─".repeat(80));
if (mismatches === 0) {
  console.log(`all ${capture.turns.length} turns replayed byte-identical to the capture.`);
} else {
  console.log(`${mismatches} / ${capture.turns.length} turns diverged from the capture — see above.`);
  process.exitCode = 1;
}
if (writeSvg || writeLog) console.log(`\nwrote ${OUT_DIR}/`);
