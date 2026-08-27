import { test, expect } from "@playwright/test";
import { SMOKE_DELTA_A } from "./fixtures";

test("semantic VisualAction removal flows through WorldState, Expression, and Canvas", async ({ page }) => {
  await page.goto("/try?replay=1");
  await page.locator(".excalidraw").first().waitFor({ timeout: 45_000 });

  const expressed = await page.evaluate((delta) => window.inpublic.express({ delta }), SMOKE_DELTA_A);
  expect(expressed?.status).toBe("updated");

  const sleepId = await page.evaluate(() =>
    window.inpublic.expressionState()?.world.entities.find((entity) => entity.label === "Sleep")?.id ?? null,
  );
  expect(sleepId).not.toBeNull();

  const result = await page.evaluate(
    (entityId) => window.inpublic.act({ type: "remove_entity", entityId }),
    sleepId!,
  );
  expect(result.status).toBe("applied");
  expect(result.category).toBe("semantic");
  expect(result.after.world.entities.some((entity) => entity.id === sleepId)).toBe(false);

  const removedObjectId = result.before.scene.objects.find((object) => object.entityId === sleepId)?.id;
  expect(removedObjectId).toBeTruthy();
  expect(
    result.after.observation?.elements.some(
      (element) => element.id === removedObjectId || element.id.startsWith(`${removedObjectId}-`),
    ),
  ).toBe(false);

  const live = await page.evaluate(() => ({
    world: window.inpublic.expressionState()?.world ?? null,
    observation: window.inpublic.observe(),
  }));
  expect(live.world?.entities.some((entity) => entity.id === sleepId)).toBe(false);
  expect(
    live.observation?.elements.some(
      (element) => element.id === removedObjectId || element.id.startsWith(`${removedObjectId}-`),
    ),
  ).toBe(false);
});
