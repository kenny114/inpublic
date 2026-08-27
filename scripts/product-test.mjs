import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { features } from "../lib/features.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const recorder = read("hooks/useCanvasRecorder.ts");
const panel = read("components/RecordingPanel.tsx");
const landing = [
  read("app/page.tsx"),
  read("components/landing/LandingSections.tsx"),
].join("\n");
const pricing = read("app/pricing/page.tsx");
const product = read("lib/product.ts");
const demos = read("lib/demos.ts");
const demoPlayer = read("components/VisualDemo.tsx");
const dashboard = read("components/DashboardHome.tsx");
const shell = read("components/DashboardShell.tsx");
const usage = read("components/UsageSurfaces.tsx");
const settings = read("components/SettingsForm.tsx");
const rootLayout = read("app/layout.tsx");
/** Everything a visitor or a signed-in user can read. */
const userFacing = [landing, pricing, dashboard, shell, usage, settings, demos, demoPlayer].join("\n");

const checks = [
  ["owned canvas capture is used", recorder.includes("output.captureStream(30)")],
  ["recorder supports pause", recorder.includes("recorder.pause()")],
  ["recorder supports resume", recorder.includes("recorder.resume()")],
  ["all media tracks are stopped", recorder.includes("recordingStreamRef.current?.getTracks().forEach((track) => track.stop())")],
  ["interrupted recordings are disclosed", /previous recording was interrupted/i.test(recorder)],
  ["webcam is optional", panel.includes("Camera") && recorder.includes("webcam: false")],
  ["transcript capture is optional", panel.includes("Transcript") && recorder.includes("transcriptVisible")],
  // The landing page's proof is a recording of the product, not a picture of
  // it. If these three go, the page is back to describing itself.
  ["landing leads with a recorded session", landing.includes("<VisualDemo") && landing.includes("HeroDemo")],
  ["landing offers all three recorded demos", landing.includes("VisualDemoTabs")],
  ["demos are labelled Standard Mode", demoPlayer.includes("Standard Mode")],
  ["every demo names the script it was recorded from", ["demo-a", "demo-b", "demo-c"].every((id) => demos.includes(id)) && demos.includes("script:")],
  ["demo playback is quiet by default", demoPlayer.includes("muted") && demoPlayer.includes("loop") && demoPlayer.includes("IntersectionObserver")],
  ["demos honour reduced motion", demoPlayer.includes("prefers-reduced-motion")],
  // Story Mode and Audio Replay were removed entirely in the Strip-Down.
  // Standard Mode is the only mode.
  ["Standard Mode is the enabled default", features.standardMode === true],
  ["pricing shows exact Creator price", pricing.includes("$15") && pricing.includes("/month")],
  ["pricing keeps product quality identical", pricing.includes("Same models, canvas and export quality")],
  ["checkout return does not claim entitlement", pricing.includes("does not change access")],
  // Allowances are read from lib/plans (mirrored from the database), never
  // typed into a page — that is how "200 minutes" survived a pricing change.
  ["pricing derives its minutes from the plan definitions", pricing.includes("minutesOf(creator.allowanceSeconds)") && pricing.includes("minutesOf(free.allowanceSeconds)")],
  ["pricing shows a real playthrough", pricing.includes("<VisualDemo")],
  ["founding places are only shown when the database answers", pricing.includes("foundingPlacesRemaining") && pricing.includes("remaining !== null")],
  ["Whop is supporting text, not the pitch", !/Whop/.test(pricing.split("plan-fineprint")[0])],
  // The finalized structure. No surface may still promise the old allowance.
  ["no surface still claims 200 Creator minutes", !/\b200\s*(visual-speech\s*)?minutes?\b/i.test(userFacing)],
  ["no surface offers Story Mode or Audio Reply as available", !/visual-story|audio reply/i.test(userFacing)],
  // Plan and usage must be reachable without digging through Settings.
  ["the dashboard header carries plan and usage", shell.includes("UsagePill")],
  ["the dashboard shows plan and remaining minutes", dashboard.includes("UsagePanel")],
  ["upgrade goes straight to pricing", usage.includes('href="/pricing"')],
  ["usage numbers come from the server entitlement", usage.includes("useEntitlement") && !/allowanceSeconds:\s*\d/.test(usage)],
  ["founding position is shown from the server, not inferred", usage.includes("planLabel")],
  ["administrative accounts show unlimited usage", usage.includes("Unlimited visual-speech time") && settings.includes('entitlement.unlimitedMinutes ? "Unlimited"')],
  ["administrative accounts are not prompted to upgrade", usage.includes('entitlement.plan === "free" && !entitlement.unlimitedMinutes') && settings.includes('entitlement.plan === "free" && !entitlement.isAdmin')],
  ["new users are offered a real example without leaving the app", dashboard.includes("See an example") && dashboard.includes("VisualDemoTabs")],
  ["the empty dashboard invites speaking", dashboard.includes("No visual sessions yet.")],
  // Settings is a control panel: only settings that are stored and read.
  ["settings persists the recording defaults it offers", settings.includes("recordCameraByDefault") && settings.includes("showTranscriptByDefault")],
  ["settings no longer carries the self-hosting card", !/self-hosting/i.test(settings)],
  ["settings can actually clear local recordings", settings.includes("deleteRecording")],
  ["Discord destination is centrally configured", product.includes("NEXT_PUBLIC_DISCORD_URL")],
  ["client source does not read provider secrets", ![recorder, panel, landing].some((source) => /DEEPGRAM_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY/.test(source))],
  ["Vercel Analytics covers every route from the root layout", rootLayout.includes('@vercel/analytics/next') && rootLayout.includes("<Analytics />")],
];

for (const [name, passed] of checks) {
  assert.equal(passed, true, name);
  console.log(`✓ ${name}`);
}
console.log(`\n✓ ${checks.length} product packaging checks passed`);
