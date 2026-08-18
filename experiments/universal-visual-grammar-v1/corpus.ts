export interface CorpusEntry {
  id: string;
  title: string;
  kind: "natural" | "recorded_demo" | "focused_fixture";
  topic: string;
  audioPath: string;
  /** Null when the retained public demo has no trustworthy duration sidecar. */
  durationMs: number | null;
  transcriptPath?: string;
  sessionPath?: string;
  transcript?: string;
  thoughtSource: "retained_settled_thoughts" | "recreated_with_current_boundary_policy";
}

export const CORPUS: CorpusEntry[] = [
  {
    id: "natural-audience-growth",
    title: "Natural reflection on audience growth and the day",
    kind: "natural",
    topic: "Disfluent personal narrative, reciprocal action, quantity change, contrast, and emotion",
    audioPath: "artifacts/demo-studio/demo-8e2512e7-f856-42af-b90a-c393d673c5c0/source-audio.ogg",
    durationMs: 87960,
    transcriptPath: "artifacts/demo-studio/demo-8e2512e7-f856-42af-b90a-c393d673c5c0/transcript.txt",
    sessionPath: "artifacts/demo-studio/demo-8e2512e7-f856-42af-b90a-c393d673c5c0/session.json",
    thoughtSource: "retained_settled_thoughts",
  },
  {
    id: "natural-inpublic-explainer",
    title: "Natural explanation of InPublic",
    kind: "natural",
    topic: "Abstract system explanation, data flow, relationships, spatial language, and aspiration",
    audioPath: "artifacts/demo-studio/demo-c7f3168a-7bcc-4a9d-9010-2411ccdd978f/source-audio.ogg",
    durationMs: 46580,
    transcriptPath: "artifacts/demo-studio/demo-c7f3168a-7bcc-4a9d-9010-2411ccdd978f/transcript.txt",
    sessionPath: "artifacts/demo-studio/demo-c7f3168a-7bcc-4a9d-9010-2411ccdd978f/session.json",
    thoughtSource: "retained_settled_thoughts",
  },
  {
    id: "demo-business-thinking",
    title: "Recorded business explanation",
    kind: "recorded_demo",
    topic: "Revenue/churn change, causal attribution, and priorities",
    audioPath: "public/demos/demo-a.webm",
    durationMs: null,
    transcript: "Our revenue increased after we launched the new plan, but churn increased too. Most of that churn came from new customers who cancelled after their first month. So our next priority is improving onboarding and retention.",
    thoughtSource: "recreated_with_current_boundary_policy",
  },
  {
    id: "demo-photosynthesis",
    title: "Recorded photosynthesis lesson",
    kind: "recorded_demo",
    topic: "Concrete objects, inputs, directed creation, release, and process",
    audioPath: "public/demos/demo-b.webm",
    durationMs: null,
    transcript: "Photosynthesis starts when a plant absorbs sunlight. The plant takes carbon dioxide from the air, and water from the soil. It uses that energy to create glucose, and releases oxygen.",
    thoughtSource: "recreated_with_current_boundary_policy",
  },
  {
    id: "demo-launch-plan",
    title: "Recorded launch plan",
    kind: "recorded_demo",
    topic: "Ordered dependencies, priorities, quantities, and actions",
    audioPath: "public/demos/demo-c.webm",
    durationMs: null,
    transcript: "Before we launch, we need to finish payments first. Then optimize latency and usage costs. After that, bring in ten testers, collect their feedback, and prepare the public launch.",
    thoughtSource: "recreated_with_current_boundary_policy",
  },
  {
    id: "fixture-sequence",
    title: "Focused sequence fixture",
    kind: "focused_fixture",
    topic: "Explicit four-step process",
    audioPath: "artifacts/visual-reentry-sequence-v2/sequence-capability.wav",
    durationMs: 18035,
    transcript: "First, we collect the data. Then we clean the data. Finally, we train the model. Once that's finished, I can explain the result to the team.",
    thoughtSource: "recreated_with_current_boundary_policy",
  },
  {
    id: "fixture-cause-effect",
    title: "Focused cause/effect fixture",
    kind: "focused_fixture",
    topic: "Causal chain followed by explicitly uncertain correlation",
    audioPath: "artifacts/visual-reentry-cause-effect-v1/cause-effect-capability.wav",
    durationMs: 27185,
    transcript: "Marketing creates traffic. And that traffic creates more sign ups. That gives the team a useful way to explain what happened. After we changed the website, sign ups increased, but I don't know if one caused the other. We will keep measuring before we make a stronger claim.",
    thoughtSource: "recreated_with_current_boundary_policy",
  },
  {
    id: "fixture-comparison",
    title: "Focused comparison fixture",
    kind: "focused_fixture",
    topic: "Two-sided option comparison and unresolved choice",
    audioPath: "artifacts/visual-reentry-comparison-v1/comparison-capability-proof.wav",
    durationMs: 18585,
    transcript: "Option A is cheaper and faster to set up. Option B costs more. But it gives you more control. I'm still deciding which one I would actually choose.",
    thoughtSource: "recreated_with_current_boundary_policy",
  },
];
