import { test, expect } from "@playwright/test";
import { SMOKE_DELTA_A } from "./fixtures";

test("bounded visual agent acts, re-observes the real canvas, and stops", async ({ page }) => {
  await page.goto("/try?replay=1");
  await page.locator(".excalidraw").first().waitFor({ timeout: 45_000 });

  const expressed = await page.evaluate((delta) => window.inpublic.express({ delta }), SMOKE_DELTA_A);
  expect(expressed?.status).toBe("updated");

  const sleep = await page.evaluate(() => {
    const entity = window.inpublic.expressionState()?.world.entities.find((candidate) => candidate.label === "Sleep");
    const observation = window.inpublic.observe();
    return {
      entityId: entity?.id ?? null,
      sceneRevision: observation?.revisions.scene ?? null,
      canvasIds: observation?.elements.filter((element) => element.text === "Sleep").map((element) => element.id) ?? [],
    };
  });
  expect(sleep.entityId).not.toBeNull();
  expect(sleep.canvasIds.length).toBeGreaterThan(0);

  const run = await page.evaluate(
    ({ entityId }) => window.inpublic.runVisualAgent("Remove Sleep from the visual world", {
      decisions: [
        { type: "act", action: { type: "remove_entity", entityId } },
        { type: "done" },
      ],
    }),
    { entityId: sleep.entityId! },
  );

  expect(run.status).toBe("completed");
  expect(run.steps).toBe(1);
  expect(run.trace.steps).toHaveLength(2);
  expect(run.trace.steps[0].decision.type).toBe("act");
  expect(run.trace.steps[0].actionResult?.status).toBe("applied");
  expect(run.trace.steps[0].resulting?.scene).not.toBe(sleep.sceneRevision);
  expect(run.trace.steps[1].observed.scene).toBe(run.trace.steps[0].resulting?.scene);
  expect(run.trace.steps[1].decision.type).toBe("done");
  expect(run.final.world.entities.some((entity) => entity.id === sleep.entityId)).toBe(false);

  const live = await page.evaluate(() => ({
    world: window.inpublic.expressionState()?.world ?? null,
    observation: window.inpublic.observe(),
    lastRun: window.inpublic.agentLastRun(),
  }));
  expect(live.world?.entities.some((entity) => entity.id === sleep.entityId)).toBe(false);
  expect(live.lastRun?.status).toBe("completed");
  expect(run.trace.steps[0].actionResult?.changed.canvasScene).toBe(true);
  expect(live.observation?.revisions.scene).toBe(run.final.canvas.revisions.scene);
  expect(live.observation?.elements.some((element) => sleep.canvasIds.includes(element.id))).toBe(false);
});
