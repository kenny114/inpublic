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
  id: "demo-a" | "demo-b" | "demo-c" | "demo-d" | "demo-transform" | "demo-forwho";
  /**
   * Tab label for the DemoShowcase selector. One word, so the selector stays
   * quiet. Omitted for demos that are embedded directly elsewhere on the page
   * rather than through the tab switcher.
   */
  tab?: string;
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
  {
    id: "demo-d",
    tab: "Build",
    title: "Technical explaining",
    caption: "Walk through how a system works. Each step appears as you describe it, in order.",
    script:
      "Let's explain an API in the simplest way possible. On one side, you have the user of the app. In the middle, you have the API. On the other side, you have the servers of the data. Step one, the user does something like pressing a button. Step two, the app sends a request to the API. Step three, the API passes it to the server. Step four, the server processes it. Step five, the server sends a response back through the API. Step six, the app shows the results to the user.",
    video: "/demos/demo-d.webm",
    poster: "/demos/demo-d.png",
  },
  {
    id: "demo-transform",
    title: "Before and after",
    caption: "The same explanation, with the visual layer appearing while it's spoken instead of added afterward.",
    script:
      "If I was explaining this in a normal talking-head video, I'd still need to add those visuals later. But with InPublic, those workflows, the arrows, the before-and-after comparison — the key benefits can appear while I'm speaking.",
    video: "/demos/demo-transform.webm",
    poster: "/demos/demo-transform.png",
  },
  {
    id: "demo-forwho",
    title: "Who it's for",
    caption: "For creators who sit in front of a camera and explain — where the ideas are good but the video stays flat.",
    script:
      "InPublic is mostly useful for creators who make talking-head explanatory content. These are the people who sit in front of a camera and explain — useful, valuable content that is still mostly just the top of a head talking. The problem is not that the ideas are boring. The problem is that the visual layer is missing.",
    video: "/demos/demo-forwho.webm",
    poster: "/demos/demo-forwho.png",
  },
];

export function visualDemo(id: VisualDemoSource["id"]) {
  return VISUAL_DEMOS.find((demo) => demo.id === id) ?? VISUAL_DEMOS[0];
}

/** Demos shown through the DemoShowcase tab selector. */
export function tabbedDemos() {
  return VISUAL_DEMOS.filter((demo): demo is VisualDemoSource & { tab: string } => Boolean(demo.tab));
}
