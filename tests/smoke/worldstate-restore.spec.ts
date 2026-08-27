import { test, expect } from "@playwright/test";
import { SMOKE_DELTA_A } from "./fixtures";

test("canvas and semantic WorldState survive a real autosave and reload", async ({ page }) => {
  await page.goto("/try?replay=1");
  await page.locator(".excalidraw").first().waitFor({ timeout: 45_000 });

  const result = await page.evaluate((delta) => window.inpublic.express({ delta }), SMOKE_DELTA_A);
  expect(result?.status).toBe("updated");
  await page.waitForTimeout(4500);

  const before = await page.evaluate(() => ({
    activeElements: window.inpublic.elements().filter((element) => !element.isDeleted).length,
    expressionState: window.inpublic.expressionState(),
  }));
  expect(before.activeElements).toBeGreaterThan(0);
  expect(before.expressionState?.version).toBe(1);
  expect(before.expressionState?.world.entities.length).toBe(2);
  expect(before.expressionState?.world.relations.length).toBe(1);

  // Development replay is the only unauthenticated Board route. restore=1
  // changes only its startFresh flag, exercising Board's real loadSession and
  // restoreSession path against the real IndexedDB record saved above.
  await page.goto("/try?replay=1&restore=1");
  await page.locator(".excalidraw").first().waitFor({ timeout: 45_000 });

  await expect.poll(
    () => page.evaluate(() => window.inpublic.expressionState()?.world.entities.length ?? 0),
    { timeout: 10_000 },
  ).toBe(2);

  const after = await page.evaluate(() => ({
    activeElements: window.inpublic.elements().filter((element) => !element.isDeleted).length,
    expressionState: window.inpublic.expressionState(),
  }));
  expect(after.activeElements).toBeGreaterThan(0);
  expect(after.expressionState).toEqual(before.expressionState);
});
