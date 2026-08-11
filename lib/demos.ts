/**
 * The three recorded Standard Mode sessions.
 *
 * Each one is a real capture: the spoken script below was played into a signed-in
 * /create session, transcribed by Deepgram, decided on by the beat, planned by
 * the Artist and drawn by the organizer, with the canvas recorded as it
 * happened (scripts/demo-driver.js). Nothing here is illustrated, redrawn or
 * touched up — if the product draws something weak, the demo shows it.
 */

export interface VisualDemoSource {
  id: "demo-a" | "demo-b" | "demo-c";
  /** Tab label. One word, so the selector stays quiet. */
  tab: string;
  title: string;
  /** Two short lines at most — the demo is the argument, not the copy. */
  caption: string;
  /** What was actually said, kept next to the recording it produced. */
  script: string;
  video: string;
  poster: string;
}

export const VISUAL_DEMOS: VisualDemoSource[] = [
  {
    id: "demo-a",
    tab: "Explain",
    title: "Business thinking",
    caption: "Speak through an idea. InPublic organizes the relationships while you talk.",
    script:
      "Our revenue increased after we launched the new plan, but churn increased too. Most of that churn came from new customers who cancelled after their first month. So our next priority is improving onboarding and retention.",
    video: "/demos/demo-a.webm",
    poster: "/demos/demo-a.png",
  },
  {
    id: "demo-b",
    tab: "Teach",
    title: "Teaching",
    caption: "Explain a process out loud. The steps and what connects them appear as you reach them.",
    script:
      "Photosynthesis starts when a plant absorbs sunlight. The plant takes carbon dioxide from the air, and water from the soil. It uses that energy to create glucose, and releases oxygen.",
    video: "/demos/demo-b.webm",
    poster: "/demos/demo-b.png",
  },
  {
    id: "demo-c",
    tab: "Plan",
    title: "Planning",
    caption: "Think through what comes first. Priorities and sequence take shape while you decide them.",
    script:
      "Before we launch, we need to finish payments first. Then optimize latency and usage costs. After that, bring in ten testers, collect their feedback, and prepare the public launch.",
    video: "/demos/demo-c.webm",
    poster: "/demos/demo-c.png",
  },
];

export function visualDemo(id: VisualDemoSource["id"]) {
  return VISUAL_DEMOS.find((demo) => demo.id === id) ?? VISUAL_DEMOS[0];
}
