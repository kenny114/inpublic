import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const recorder = read("hooks/useCanvasRecorder.ts");
const panel = read("components/RecordingPanel.tsx");
const landing = read("app/page.tsx");
const pricing = read("app/pricing/page.tsx");
const product = read("lib/product.ts");

const checks = [
  ["owned canvas capture is used", recorder.includes("output.captureStream(30)")],
  ["recorder supports pause", recorder.includes("recorder.pause()")],
  ["recorder supports resume", recorder.includes("recorder.resume()")],
  ["all media tracks are stopped", recorder.includes("recordingStreamRef.current?.getTracks().forEach((track) => track.stop())")],
  ["interrupted recordings are disclosed", /previous recording was interrupted/i.test(recorder)],
  ["webcam is optional", panel.includes("Camera") && recorder.includes("webcam: false")],
  ["transcript capture is optional", panel.includes("Transcript") && recorder.includes("transcriptVisible")],
  ["landing explains Standard Mode", landing.includes("Standard Mode")],
  ["landing explains evolving Story Mode", landing.includes("Story Mode · Evolving")],
  ["pricing does not pretend checkout works", pricing.includes("billing is not connected")],
  ["Discord destination is centrally configured", product.includes("NEXT_PUBLIC_DISCORD_URL")],
  ["client source does not read provider secrets", ![recorder, panel, landing].some((source) => /DEEPGRAM_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY/.test(source))],
];

for (const [name, passed] of checks) {
  assert.equal(passed, true, name);
  console.log(`✓ ${name}`);
}
console.log(`\n✓ ${checks.length} product packaging checks passed`);
