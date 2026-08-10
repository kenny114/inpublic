import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const recorder = read("hooks/useCanvasRecorder.ts");
const panel = read("components/RecordingPanel.tsx");
const landing = [
  read("app/page.tsx"),
  read("components/landing/LandingSections.tsx"),
].join("\n");
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
  ["landing explains Story Mode", landing.includes("Story Mode")],
  ["landing uses real product proof", landing.includes("/product-standard.png")],
  ["pricing shows exact Creator price", pricing.includes("$15/month")],
  ["pricing keeps product quality identical", pricing.includes("same modes, AI models, canvas, recording quality and exports")],
  ["checkout return does not claim entitlement", pricing.includes("does not change access")],
  ["Discord destination is centrally configured", product.includes("NEXT_PUBLIC_DISCORD_URL")],
  ["client source does not read provider secrets", ![recorder, panel, landing].some((source) => /DEEPGRAM_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY/.test(source))],
];

for (const [name, passed] of checks) {
  assert.equal(passed, true, name);
  console.log(`✓ ${name}`);
}
console.log(`\n✓ ${checks.length} product packaging checks passed`);
